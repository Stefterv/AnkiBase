"""Single sign-on with an OpenID Connect provider (Authentik, Keycloak, Authelia, Google…).

The authorization code flow with PKCE, state and nonce. The ID token comes straight from the
provider's token endpoint over TLS, which OpenID Connect Core (3.1.3.7) accepts in place of
checking its signature; its issuer, audience, expiry and nonce are still checked.

Users are matched by the provider's issuer + subject, never by username or e-mail (someone
could pick a name at the provider to take over an account). Existing users link their provider
account in Settings → Account; with OIDC_AUTO_CREATE, unknown provider accounts get a new user.

Configured with OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (config.Settings).
"""
import base64
import hashlib
import json
import re
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

import security
from config import get_settings

router = APIRouter()

FLOW_COOKIE = "oidc_flow"
FLOW_SECONDS = 600
_discovery: dict = {}  # issuer -> (fetched at, document)


def enabled() -> bool:
    s = get_settings()
    return bool(s.oidc_issuer and s.oidc_client_id)


async def _provider() -> dict:
    """The provider's discovery document (cached for an hour)."""
    issuer = get_settings().oidc_issuer.rstrip("/")
    cached = _discovery.get(issuer)
    if cached and time.time() - cached[0] < 3600:
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
    configured = get_settings().oidc_redirect_uri
    if configured:
        return configured
    proto = "https" if security.is_https(request) else "http"
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip() or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}/api/auth/oidc/callback"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _claims(id_token: str) -> dict:
    try:
        payload = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError):
        raise ValueError("The provider sent an unreadable ID token")


def _fail(where: str, code: str) -> RedirectResponse:
    target = "/settings?tab=account&sso_error=" if where == "link" else "/login?sso_error="
    response = RedirectResponse(target + code, status_code=303)
    response.delete_cookie(FLOW_COOKIE, path="/api/auth/oidc")
    return response


@router.get("/api/auth/oidc")
async def oidc_info():
    """Whether single sign-on is set up, and what the login button says (no login needed)."""
    return {"enabled": enabled(), "name": get_settings().oidc_name or "SSO"}


@router.get("/api/auth/oidc/start")
async def oidc_start(request: Request, link: bool = False):
    """Send the browser to the provider. `link`: connect the provider account to the signed-in user."""
    if not enabled():
        raise HTTPException(status_code=404, detail="Single sign-on isn't set up")
    user = security.current_user.get()
    if link and not user:
        return _fail("login", "login_first")
    try:
        provider = await _provider()
    except Exception as e:
        print(f"✗ OIDC discovery failed: {e}")
        return _fail("link" if link else "login", "provider_unreachable")
    settings = get_settings()
    state, nonce, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    redirect_uri = _redirect_uri(request)
    params = {
        "response_type": "code",
        "client_id": settings.oidc_client_id,
        "redirect_uri": redirect_uri,
        "scope": settings.oidc_scopes or "openid",
        "state": state,
        "nonce": nonce,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
        "code_challenge_method": "S256",
    }
    flow = {"state": state, "nonce": nonce, "verifier": verifier, "redirect_uri": redirect_uri,
            "link_user": user["user_id"] if link else None, "exp": time.time() + FLOW_SECONDS}
    response = RedirectResponse(f"{provider['authorization_endpoint']}?{urlencode(params)}", status_code=303)
    # Encrypted, and only sent back to the callback (SameSite=Lax: the provider's redirect is a top-level GET).
    response.set_cookie(FLOW_COOKIE, security.encrypt(json.dumps(flow)), max_age=FLOW_SECONDS, httponly=True,
                        secure=security.is_https(request), samesite="lax", path="/api/auth/oidc")
    return response


async def _exchange(provider: dict, code: str, flow: dict) -> dict:
    """Trade the code for tokens and return the checked ID token claims (plus userinfo)."""
    settings = get_settings()
    data = {"grant_type": "authorization_code", "code": code, "redirect_uri": flow["redirect_uri"],
            "code_verifier": flow["verifier"]}
    auth = None
    methods = provider.get("token_endpoint_auth_methods_supported") or ["client_secret_basic"]
    if settings.oidc_client_secret and "client_secret_basic" in methods:
        auth = (settings.oidc_client_id, settings.oidc_client_secret)
    else:
        data["client_id"] = settings.oidc_client_id
        if settings.oidc_client_secret:
            data["client_secret"] = settings.oidc_client_secret
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
        if settings.oidc_client_id not in audiences or (len(audiences) > 1 and claims.get("azp") not in (None, settings.oidc_client_id)):
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
    where = "link" if flow and flow.get("link_user") else "login"
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
        if not get_settings().oidc_auto_create:
            return _fail("login", "not_linked")
        username = _new_username(claims)
        owner = create_user(username, secrets.token_urlsafe(32))  # a password nobody knows…
        set_password_login(owner, False)  # …and password sign-in off for them
        link_oidc_identity(owner, issuer, subject)
        print(f"✓ Made user '{username}' for a single sign-on account")

    from main import sessions
    session_id = secrets.token_urlsafe(32)
    sessions[session_id] = {"user_id": owner}
    response = RedirectResponse("/", status_code=303)
    security.set_session_cookie(response, request, session_id)
    response.delete_cookie(FLOW_COOKIE, path="/api/auth/oidc")
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
        "sso": {"enabled": enabled(), "name": get_settings().oidc_name or "SSO",
                "linked": bool(get_oidc_identity(user_id))} if enabled() else None,
        "has_password": bool((get_user(user_id) or {}).get("password_login", 1)),
    }
