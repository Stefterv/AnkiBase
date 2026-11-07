"""Syncing the server's copies of the profiles by themselves.

Every few minutes each profile that syncs somewhere (AnkiWeb, or a sync server like this
AnkiBase's own) does a normal sync, so what was studied on a phone shows up in the browser
without pressing Sync. A normal sync without changes is one small request. One-way full syncs
(an empty side) happen as with the Sync button; when both sides changed, nothing is done here
and the next Sync in the browser asks which copy wins.
"""
from __future__ import annotations

import asyncio

import anki_server
from anki_client import AnkiConnectClient

INTERVAL = 5 * 60
_failing: set[str] = set()  # profiles whose last sync failed, so it's logged once


async def sync_profile(name: str) -> None:
    client = AnkiConnectClient(anki_server.profile_url(name), anki_server.api_key())
    try:
        if not (await client.rpc("sync.account")).get("loggedIn"):
            return
        result = await client.sync()
        if result.get("outcome") == "fullSyncRequired":
            if name not in _failing:
                print(f"Auto sync of '{name}': both copies changed, waiting for a choice (Sync in the browser)")
            _failing.add(name)
        else:
            _failing.discard(name)
    except Exception as e:
        if name not in _failing:
            print(f"✗ Auto sync of '{name}' failed: {e}")
        _failing.add(name)


async def loop() -> None:
    from database import get_all_accounts
    await asyncio.sleep(60)  # let the engine start
    while True:
        if anki_server.status == "ready":
            for account in get_all_accounts():
                await sync_profile(account["container_name"])
        await asyncio.sleep(INTERVAL)
