"""The phone app's login: the server's own website, in the system's sign-in sheet.

The app opens HANDOFF?challenge=… in the sheet (ASWebAuthenticationSession). Someone logged in
there (or after the website's login page: password, or single sign-on, which come back here)
gets a one-time code, sent to the app at APP_CALLBACK; that closes the sheet. The app then
trades the code and its secret (PKCE: only the secret's SHA-256 went through the browser) for a
session at /api/auth/app-session, which the app's engine keeps like any login cookie.
"""
import base64
import hashlib
import re
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

import security

router = APIRouter()

HANDOFF = "/api/auth/app-handoff"
APP_CALLBACK = "ankibase://login"
CODE_SECONDS = 120
_codes: dict[str, tuple[int, str, float]] = {}  # code -> (user id, challenge, expires)
_CHALLENGE = re.compile(r"[A-Za-z0-9_-]{43}")


def safe_next(next_url: Optional[str]) -> Optional[str]:
    """Where a login may go on to: only back to the app's handoff (no open redirects)."""
    if next_url and next_url.startswith(HANDOFF + "?") and "//" not in next_url and "\\" not in next_url:
        return next_url
    return None


@router.get(HANDOFF)
async def app_handoff(challenge: str = ""):
    """The sign-in sheet's first and last stop: the login page if needed, then back to the app."""
    if not _CHALLENGE.fullmatch(challenge):
        raise HTTPException(status_code=400, detail="This page is for the AnkiBase app")
    user = security.current_user.get()
    if not user:
        here = f"{HANDOFF}?{urlencode({'challenge': challenge})}"
        return RedirectResponse("/login?" + urlencode({"next": here}), status_code=303)
    now = time.time()
    for old in [c for c, (_, _, exp) in _codes.items() if exp < now]:
        del _codes[old]
    code = secrets.token_urlsafe(32)
    _codes[code] = (user["user_id"], challenge, now + CODE_SECONDS)
    return RedirectResponse(f"{APP_CALLBACK}?{urlencode({'code': code})}", status_code=303)


class AppSessionRequest(BaseModel):
    code: str
    verifier: str


@router.post("/api/auth/app-session")
async def app_session(body: AppSessionRequest, request: Request):
    """The app trades its one-time code and secret for a session cookie."""
    entry = _codes.pop(body.code, None)  # one try per code
    if not entry or entry[2] < time.time():
        raise HTTPException(status_code=400, detail="This login expired, try again")
    user_id, challenge, _ = entry
    digest = base64.urlsafe_b64encode(hashlib.sha256(body.verifier.encode()).digest()).rstrip(b"=").decode()
    if not secrets.compare_digest(digest, challenge):
        raise HTTPException(status_code=400, detail="This login couldn't be verified, try again")
    from main import sessions
    session_id = secrets.token_urlsafe(32)
    sessions[session_id] = {"user_id": user_id}
    response = JSONResponse({"success": True})
    security.set_session_cookie(response, request, session_id)
    return response
