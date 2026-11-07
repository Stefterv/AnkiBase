"""Sync accounts made for profiles, so the apps set up sync by themselves.

A profile (one Anki collection, maybe shared by several users) gets its own account on this
AnkiBase's sync server (sync_server.py) the first time an app asks: the server's copy of the
profile is connected to it and uploaded, and the app gets the account's login to sync the
phone's copy with it. So the phone, the server and everyone using the profile share one
collection. The password is kept encrypted (setting "profile_sync:<profile id>"), never shown.
"""
from __future__ import annotations

import asyncio
import json
import re
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import anki_server
import security
import sync_server
from anki_client import AnkiConnectClient, AnkiError

router = APIRouter()

_lock = asyncio.Lock()  # one account made at a time (each restarts the sync server)


def _key(profile_id: int) -> str:
    return f"profile_sync:{profile_id}"


def _saved(profile_id: int) -> Optional[dict]:
    from database import get_setting
    try:
        data = json.loads(get_setting(_key(profile_id)) or "null")
        return {"name": data["name"], "password": security.decrypt(data["password"])} if data else None
    except Exception:
        return None


def _save(profile_id: int, name: str, password: str) -> None:
    from database import set_setting
    set_setting(_key(profile_id), json.dumps({"name": name, "password": security.encrypt(password)}))


def _free_name(profile_name: str) -> str:
    taken = {a["name"].lower() for a in sync_server.accounts()}
    base = re.sub(r"[^A-Za-z0-9._@+-]+", "-", profile_name).strip("-")[:56] or "profile"
    name, n = base, 2
    while name.lower() in taken:
        name, n = f"{base}-{n}", n + 1
    return name


async def _account(profile: dict) -> dict:
    """The profile's sync account, made (and the sync server restarted) when it has none."""
    async with _lock:
        saved = _saved(profile["id"])
        if saved and any(a["name"] == saved["name"] for a in sync_server.accounts()):
            return saved
        name = _free_name(profile["container_name"])
        password = secrets.token_urlsafe(24)
        sync_server.add_account(name, password)
        if not await asyncio.to_thread(sync_server.start):
            raise HTTPException(status_code=503, detail="The sync server didn't restart")
        _save(profile["id"], name, password)
        print(f"✓ Made sync account '{name}' for profile '{profile['container_name']}'")
        return {"name": name, "password": password}


async def _connect_profile(profile: dict, account: dict) -> bool:
    """Connect the server's copy of the profile to the account and sync it (the first sync
    uploads it). Left alone when it already syncs somewhere else."""
    client = AnkiConnectClient(anki_server.profile_url(profile["container_name"]), anki_server.api_key())
    local = sync_server.URL + "/"
    state = await client.rpc("sync.account")
    if state.get("loggedIn"):
        same = (state.get("endpoint") or "").rstrip("/") == sync_server.URL and state.get("username") == account["name"]
        if not same:
            return False
    else:
        await client.rpc("sync.login", timeout=60.0, username=account["name"], password=account["password"], endpoint=local)
    result = await client.sync()
    return result.get("outcome") != "fullSyncRequired"


@router.post("/api/syncserver/profile-account")
async def profile_account(user: dict = Depends(security.require_auth)):
    """The login for the current profile's sync account (made on first use), for the apps.
    409 when this AnkiBase doesn't run a sync server."""
    from database import get_active_account
    profile = get_active_account()
    if not profile:
        raise HTTPException(status_code=409, detail="You don't have a profile yet")
    if not sync_server.enabled() or not await asyncio.to_thread(sync_server.healthy):
        raise HTTPException(status_code=409, detail="This AnkiBase doesn't run a sync server")
    try:
        account = await _account(profile)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        connected = await _connect_profile(profile, account)
    except (AnkiError, Exception) as e:  # the phone can still sync; the server's copy just isn't connected
        print(f"✗ Couldn't connect profile '{profile['container_name']}' to its sync account: {e}")
        connected = False
    return {"username": account["name"], "password": account["password"], "profile_connected": connected}
