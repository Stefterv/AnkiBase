"""Single sign-on with an OpenID Connect provider (Authentik, Keycloak, Authelia, Google…).

The authorization code flow with PKCE, state and nonce. The ID token comes straight from the
provider's token endpoint over TLS, which OpenID Connect Core (3.1.3.7) accepts in place of
checking its signature; its issuer, audience, expiry and nonce are still checked.

Users are matched by the provider's issuer + subject, never by username or e-mail (someone
could pick a name at the provider to take over an account). Existing users link their provider
account in Settings → Account; with OIDC_AUTO_CREATE, unknown provider accounts get a new user.

Admins set it up in Settings → Users → Single sign-on, stored in the settings table as
"oidc" (the client secret encrypted with security.encrypt). Until they save it there, the
OIDC_* variables in .env are used (config.Settings).
"""
import base64
import hashlib
import json
import re
import secrets
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

import security

router = APIRouter()

FLOW_COOKIE = "oidc_flow"
FLOW_SECONDS = 600
_discovery: dict = {}  # issuer -> (fetched at, document)


SETTING = "oidc"


@dataclass
class Config:
    enabled: bool = False
    issuer: str = ""
    client_id: str = ""
    client_secret: str = ""
    name: str = "SSO"  # the login button: "Sign in with <name>"
    scopes: str = "openid profile email"
    # The callback URL registered with the provider; empty: <this server>/api/auth/oidc/callback.
    redirect_uri: str = ""
    # Make a user for provider accounts that aren't linked to one yet (no profiles until an
    # admin gives them some). Off: only users who connected SSO in Settings → Account.
    auto_create: bool = False
    # What a user made by auto_create studies in: "own" (a new profile of their own, starting
    # with starter_profile's decks, fresh) or "shared" (the existing default_profiles).
    profile_mode: str = "shared"
    starter_profile: Optional[int] = None
    default_profiles: list = field(default_factory=list)
    source: str = "settings"  # where it comes from: "settings" (Settings → Users), "env" (.env) or "none"


def _env_config() -> Config:
    from config import get_settings
    s = get_settings()
    return Config(enabled=bool(s.oidc_issuer and s.oidc_client_id), issuer=s.oidc_issuer, client_id=s.oidc_client_id,
                  client_secret=s.oidc_client_secret, name=s.oidc_name, scopes=s.oidc_scopes,
                  redirect_uri=s.oidc_redirect_uri, auto_create=s.oidc_auto_create,
                  source="env" if s.oidc_issuer or s.oidc_client_id else "none")


def get_config() -> Config:
    """The admin's settings; until there are any, .env's."""
    from database import get_setting
    saved = get_setting(SETTING)
    if not saved:
        cfg = _env_config()
    else:
        cfg = _from_saved(saved)
    cfg.name = cfg.name or "SSO"
    cfg.scopes = cfg.scopes or "openid profile email"
    return cfg


def _from_saved(saved: str) -> Config:
    try:
        raw = json.loads(saved)
    except ValueError:
        raw = {}
    cfg = Config(**{k: v for k, v in raw.items() if k in Config.__dataclass_fields__ and k != "client_secret"})
    if raw.get("client_secret"):
        try:
            cfg.client_secret = security.decrypt(raw["client_secret"])
        except Exception:
            print("✗ Couldn't decrypt the single sign-on client secret; set it again in Settings → Users")
    cfg.source = "settings"
    return cfg


def _save_config(cfg: Config) -> None:
    from database import set_setting
    data = {k: v for k, v in cfg.__dict__.items() if k != "source"}
    data["client_secret"] = security.encrypt(cfg.client_secret) if cfg.client_secret else ""
    set_setting(SETTING, json.dumps(data))


def enabled() -> bool:
    c = get_config()
    return bool(c.enabled and c.issuer and c.client_id)


async def _provider(issuer: Optional[str] = None, fresh: bool = False) -> dict:
    """The provider's discovery document (cached for an hour)."""
    issuer = (issuer or get_config().issuer).rstrip("/")
    cached = _discovery.get(issuer)
    if cached and not fresh and time.time() - cached[0] < 3600:
        return cached[1]
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{issuer}/.well-known/openid-configuration")
        r.raise_for_status()
        doc = r.json()
    for key in ("issuer", "authorization_endpoint", "token_endpoint"):
        if not doc.get(key):
            raise ValueError(f"The provider's configuration has no {key}")
    _discovery[issuer] = (time.time(), doc)
    return doc


def _redirect_uri(request: Request) -> str:
    return get_config().redirect_uri or _redirect_uri_default(request)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _claims(id_token: str) -> dict:
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise ValueError("The provider sent an unreadable ID token")


# The phone apps: the sign-in runs in the system's browser sheet (ASWebAuthenticationSession),
# which closes when it reaches this address. The app then trades the one-time code, with the
# secret only it knows (PKCE: the start URL had its SHA-256), for a session (oidc_app_session).
APP_CALLBACK = "ankibase://sso"
APP_CODE_SECONDS = 120
_app_codes: dict[str, tuple[int, str, float]] = {}  # code -> (user id, challenge, expires)


def _fail(where: str, code: str) -> RedirectResponse:
    target = {"link": "/settings?tab=account&sso_error=", "app": APP_CALLBACK + "?error="}.get(where, "/login?sso_error=")
    response = RedirectResponse(target + code, status_code=303)
    response.delete_cookie(FLOW_COOKIE, path="/api/auth/oidc")
    return response


@router.get("/api/auth/oidc")
async def oidc_info():
    """Whether single sign-on is set up, and what the login button says (no login needed)."""
    return {"enabled": enabled(), "name": get_config().name}


@router.get("/api/auth/oidc/start")
async def oidc_start(request: Request, link: bool = False, app: bool = False, challenge: str = ""):
    """Send the browser to the provider. `link`: connect the provider account to the signed-in
    user. `app`: sign in the phone app, which sent the SHA-256 of its secret as `challenge`."""
    if not enabled():
        raise HTTPException(status_code=404, detail="Single sign-on isn't set up")
    if app and (link or not re.fullmatch(r"[A-Za-z0-9_-]{43}", challenge)):
        raise HTTPException(status_code=400, detail="The app's sign-in needs a challenge")
    where = "app" if app else "link" if link else "login"
    user = security.current_user.get()
    if link and not user:
        return _fail("login", "login_first")
    try:
        provider = await _provider()
    except Exception as e:
        print(f"✗ OIDC discovery failed: {e}")
        return _fail(where, "provider_unreachable")
    settings = get_config()
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    redirect_uri = _redirect_uri(request)
    params = {
        "response_type": "code",
        "client_id": settings.client_id,
        "redirect_uri": redirect_uri,
        "scope": settings.scopes,
        "state": state,
        "nonce": nonce,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
        "code_challenge_method": "S256",
    }
    flow = {"state": state, "nonce": nonce, "verifier": verifier, "redirect_uri": redirect_uri,
            "link_user": user["user_id"] if link else None, "app_challenge": challenge if app else None,
            "exp": time.time() + FLOW_SECONDS}
    response = RedirectResponse(f"{provider['authorization_endpoint']}?{urlencode(params)}", status_code=303)
    # Encrypted, and only sent back to the callback (SameSite=Lax: the provider's redirect is a top-level GET).
    response.set_cookie(FLOW_COOKIE, security.encrypt(json.dumps(flow)), max_age=FLOW_SECONDS, httponly=True,
                        secure=security.is_https(request), samesite="lax", path="/api/auth/oidc")
    return response


async def _exchange(provider: dict, code: str, flow: dict) -> dict:
    """Trade the code for tokens and return the checked ID token claims (plus userinfo)."""
    settings = get_config()
    data = {"grant_type": "authorization_code", "code": code, "redirect_uri": flow["redirect_uri"],
            "code_verifier": flow["verifier"]}
    auth = None
    methods = provider.get("token_endpoint_auth_methods_supported") or ["client_secret_basic"]
    if settings.client_secret and "client_secret_basic" in methods:
        auth = (settings.client_id, settings.client_secret)
    else:
        data["client_id"] = settings.client_id
        if settings.client_secret:
            data["client_secret"] = settings.client_secret
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(provider["token_endpoint"], data=data, auth=auth, headers={"Accept": "application/json"})
        if r.status_code != 200:
            raise ValueError(f"token endpoint answered {r.status_code}: {r.text[:300]}")
        tokens = r.json()
        if not tokens.get("id_token"):
            raise ValueError("no ID token (is the 'openid' scope requested?)")
        claims = _claims(tokens["id_token"])

        aud = claims.get("aud")
        audiences = aud if isinstance(aud, list) else [aud]
        if claims.get("iss") != provider["issuer"]:
            raise ValueError(f"ID token from another issuer: {claims.get('iss')}")
        if settings.client_id not in audiences or (len(audiences) > 1 and claims.get("azp") not in (None, settings.client_id)):
            raise ValueError("ID token meant for another client")
        if not isinstance(claims.get("exp"), (int, float)) or claims["exp"] < time.time() - 60:
            raise ValueError("ID token expired")
        if not secrets.compare_digest(str(claims.get("nonce", "")), flow["nonce"]):
            raise ValueError("ID token nonce doesn't match")
        if not claims.get("sub"):
            raise ValueError("ID token without a subject")

        # Names and e-mail often only come from userinfo; never let it change the subject.
        if provider.get("userinfo_endpoint") and tokens.get("access_token"):
            try:
                u = await client.get(provider["userinfo_endpoint"], headers={"Authorization": f"Bearer {tokens['access_token']}"})
                info = u.json() if u.status_code == 200 else {}
                if info.get("sub") == claims["sub"]:
                    claims = {**info, **claims}
            except (httpx.HTTPError, ValueError):
                pass
    return claims


def _new_username(claims: dict) -> str:
    """A free username from the provider's preferred username, e-mail or name."""
    from database import get_user_by_username
    for raw in (claims.get("preferred_username"), (claims.get("email") or "").split("@")[0], claims.get("name")):
        base = re.sub(r"[^A-Za-z0-9._@-]+", "", str(raw or "").replace(" ", "."))[:36]
        if len(base) >= 3:
            break
    else:
        base = "user"
    name, n = base, 2
    while get_user_by_username(name):
        name, n = f"{base}{n}", n + 1
    return name


@router.get("/api/auth/oidc/callback")
async def oidc_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    """The provider sends the browser back here: sign in (or link), then on to the app."""
    from database import (get_oidc_user_id, link_oidc_identity, get_user, create_user, set_password_login)
    raw = request.cookies.get(FLOW_COOKIE)
    try:
        flow = json.loads(security.decrypt(raw)) if raw else None
    except Exception:
        flow = None
    where = "link" if flow and flow.get("link_user") else "app" if flow and flow.get("app_challenge") else "login"
    if not enabled():
        return _fail(where, "provider")
    if not flow or flow.get("exp", 0) < time.time():
        return _fail(where, "expired")
    if not state or not secrets.compare_digest(state, flow["state"]):
        return _fail(where, "state")
    if error or not code:
        return _fail(where, "denied" if error == "access_denied" else "provider")
    try:
        provider = await _provider()
        claims = await _exchange(provider, code, flow)
    except Exception as e:
        print(f"✗ OIDC sign-in failed: {e}")
        return _fail(where, "provider")

    issuer, subject = provider["issuer"], str(claims["sub"])
    owner = get_oidc_user_id(issuer, subject)

    if flow.get("link_user"):
        user_id = flow["link_user"]
        current = security.current_user.get()
        if not current or current["user_id"] != user_id:
            return _fail("link", "login_first")
        if owner and owner != user_id:
            return _fail("link", "taken")
        link_oidc_identity(user_id, issuer, subject)
        response = RedirectResponse("/settings?tab=account&sso=linked", status_code=303)
        response.delete_cookie(FLOW_COOKIE, path="/api/auth/oidc")
        return response

    if owner is None or not get_user(owner):
        if not get_config().auto_create:
            return _fail(where, "not_linked")
        username = _new_username(claims)
        owner = create_user(username, secrets.token_urlsafe(32))  # a password nobody knows…
        set_password_login(owner, False)  # …and password sign-in off for them
        link_oidc_identity(owner, issuer, subject)
        cfg = get_config()
        if cfg.profile_mode == "own":
            import starter_profile
            await starter_profile.give_own_profile(owner, username, cfg.starter_profile)
        else:
            from database import get_all_accounts, set_user_container_permissions
            known = {a["id"] for a in get_all_accounts()}
            set_user_container_permissions(owner, [p for p in cfg.default_profiles if p in known])
        print(f"✓ Made user '{username}' for a single sign-on account")

    if where == "app":
        now = time.time()
        for old in [c for c, (_, _, exp) in _app_codes.items() if exp < now]:
            del _app_codes[old]
        app_code = secrets.token_urlsafe(32)
        _app_codes[app_code] = (owner, flow["app_challenge"], now + APP_CODE_SECONDS)
        response = RedirectResponse(f"{APP_CALLBACK}?{urlencode({'code': app_code})}", status_code=303)
        response.delete_cookie(FLOW_COOKIE, path="/api/auth/oidc")
        return response

    from main import sessions
    session_id = secrets.token_urlsafe(32)
    sessions[session_id] = {"user_id": owner}
    response = RedirectResponse("/", status_code=303)
    security.set_session_cookie(response, request, session_id)
    response.delete_cookie(FLOW_COOKIE, path="/api/auth/oidc")
    return response


class AppSessionRequest(BaseModel):
    code: str
    verifier: str


@router.post("/api/auth/oidc/app-session")
async def oidc_app_session(body: AppSessionRequest, request: Request):
    """The phone app's half of an app sign-in: its one-time code and secret for a session cookie
    (which the app's engine keeps, as after a password login)."""
    from fastapi.responses import JSONResponse
    entry = _app_codes.pop(body.code, None)  # one try per code
    if not entry or entry[2] < time.time():
        raise HTTPException(status_code=400, detail="This sign-in expired, try again")
    owner, challenge, _ = entry
    if not secrets.compare_digest(_b64url(hashlib.sha256(body.verifier.encode()).digest()), challenge):
        raise HTTPException(status_code=400, detail="This sign-in couldn't be verified, try again")
    from main import sessions
    session_id = secrets.token_urlsafe(32)
    sessions[session_id] = {"user_id": owner}
    response = JSONResponse({"success": True})
    security.set_session_cookie(response, request, session_id)
    return response


@router.delete("/api/auth/oidc/link")
async def oidc_unlink(user: dict = Depends(security.require_auth)):
    """Stop signing in with the provider account (only when the user has a password to fall back on)."""
    from database import get_user, unlink_oidc_identity
    row = get_user(user["user_id"]) or {}
    if not row.get("password_login", 1):
        raise HTTPException(status_code=400, detail="Set a password first: single sign-on is how you sign in")
    unlink_oidc_identity(user["user_id"])
    return {"success": True}


def user_info(user_id: int) -> dict:
    """For /api/auth/me: whether SSO is set up and linked, and whether the user has a password."""
    from database import get_oidc_identity, get_user
    return {
        "sso": {"enabled": True, "name": get_config().name,
                "linked": bool(get_oidc_identity(user_id))} if enabled() else None,
        "has_password": bool((get_user(user_id) or {}).get("password_login", 1)),
    }


# --- Settings → Users → Single sign-on (admins) -------------------------------------------------

class ConfigUpdate(BaseModel):
    enabled: bool
    issuer: str = ""
    client_id: str = ""
    client_secret: Optional[str] = None  # None: keep the saved one; "": remove it
    name: str = "SSO"
    scopes: str = "openid profile email"
    redirect_uri: str = ""
    auto_create: bool = False
    default_profiles: list[int] = []
    profile_mode: str = "shared"
    starter_profile: Optional[int] = None


def _admin_view(cfg: Config, request: Request) -> dict:
    data = {k: v for k, v in cfg.__dict__.items() if k != "client_secret"}
    data["has_secret"] = bool(cfg.client_secret)
    data["default_redirect_uri"] = _redirect_uri_default(request)
    from database import get_all_accounts
    data["profiles"] = [{"id": a["id"], "name": a["container_name"]} for a in get_all_accounts()]
    # Profiles deleted since don't count.
    known = {a["id"] for a in data["profiles"]}
    data["default_profiles"] = [p for p in cfg.default_profiles if p in known]
    data["starter_profile"] = cfg.starter_profile if cfg.starter_profile in known else None
    return data


def _redirect_uri_default(request: Request) -> str:
    proto = "https" if security.is_https(request) else "http"
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip() or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}/api/auth/oidc/callback"


@router.get("/api/admin/oidc")
async def oidc_config(request: Request, _: dict = Depends(security.require_admin)):
    return _admin_view(get_config(), request)


@router.put("/api/admin/oidc")
async def oidc_config_update(body: ConfigUpdate, request: Request, _: dict = Depends(security.require_admin)):
    """Save the single sign-on settings; turning it on checks that the provider answers."""
    current = get_config()
    cfg = Config(
        enabled=body.enabled, issuer=body.issuer.strip(), client_id=body.client_id.strip(),
        client_secret=current.client_secret if body.client_secret is None else body.client_secret.strip(),
        name=body.name.strip()[:40] or "SSO", scopes=" ".join(body.scopes.split()) or "openid profile email",
        redirect_uri=body.redirect_uri.strip(), auto_create=body.auto_create,
        default_profiles=sorted(set(body.default_profiles)), source="settings",
        profile_mode="own" if body.profile_mode == "own" else "shared", starter_profile=body.starter_profile,
    )
    if cfg.issuer and not re.match(r"^https?://", cfg.issuer):
        raise HTTPException(status_code=400, detail="The issuer is a URL, like https://auth.example.com/application/o/ankibase/")
    if cfg.redirect_uri and not re.match(r"^https?://", cfg.redirect_uri):
        raise HTTPException(status_code=400, detail="The redirect URI is a full URL")
    if cfg.enabled:
        if not cfg.issuer or not cfg.client_id:
            raise HTTPException(status_code=400, detail="Fill in the issuer and client ID to turn single sign-on on")
        if "openid" not in cfg.scopes.split():
            raise HTTPException(status_code=400, detail="The scopes need to include openid")
        try:
            await _provider(cfg.issuer, fresh=True)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Couldn't read the provider's configuration at "
                                f"{cfg.issuer.rstrip('/')}/.well-known/openid-configuration ({e})")
    _save_config(cfg)
    return _admin_view(cfg, request)


@router.delete("/api/admin/oidc")
async def oidc_config_reset(request: Request, _: dict = Depends(security.require_admin)):
    """Forget the settings saved here, going back to .env's OIDC_* variables (if any)."""
    from database import get_db
    with get_db() as conn:
        conn.execute("DELETE FROM settings WHERE key = ?", (SETTING,))
        conn.commit()
    return _admin_view(get_config(), request)
