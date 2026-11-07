"""A new user's own profile, optionally starting with the decks of a starter profile.

Used for users made by single sign-on (oidc.py, "Their own profile"). The decks are copied
fresh: each top-level deck of the starter profile is exported without scheduling (cards new,
no review history, media included) and imported into the new profile, in the background so
signing in doesn't wait for big decks.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from typing import Optional

import anki_server
from anki_client import AnkiConnectClient

_tasks: set[asyncio.Task] = set()  # keeps background copies alive until they finish


def _free_name(username: str) -> str:
    from anki_accounts import INVALID_NAME
    from database import get_all_accounts
    taken = {a["container_name"].lower() for a in get_all_accounts()}
    base = INVALID_NAME.sub("", username).lstrip(".")[:56] or "Profile"
    name, n = base, 2
    while name.lower() in taken:
        name, n = f"{base} {n}", n + 1
    return name


def _client(profile: str) -> AnkiConnectClient:
    return AnkiConnectClient(anki_server.profile_url(profile), anki_server.api_key())


async def copy_decks(source: str, target: str) -> int:
    """Copy every top-level deck (with its subdecks, notes and media) from one profile to another,
    without scheduling. Returns how many decks were copied."""
    src, dst = _client(source), _client(target)
    names = await src.request("deckNames")
    tops = [n for n in names if "::" not in n]
    folder = anki_server.DATA_DIR / ".imports"  # the engine reads and writes here (main._import_dir)
    folder.mkdir(parents=True, exist_ok=True)
    work = tempfile.mkdtemp(dir=folder)
    copied = 0
    try:
        for i, deck in enumerate(tops):
            if deck == "Default" and not await src.request("findCards", query='deck:"Default"'):
                continue  # Anki's empty default deck
            path = os.path.join(work, f"deck-{i}.apkg")
            if not await src.request("exportPackage", timeout=600.0, deck=deck, path=path, includeSched=False):
                print(f"✗ Couldn't export '{deck}' from profile '{source}'")
                continue
            await dst.request("importPackage", timeout=600.0, path=path)
            copied += 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return copied


async def give_own_profile(user_id: int, username: str, starter_id: Optional[int]) -> Optional[dict]:
    """Make a profile for the user, theirs alone; start copying the starter profile's decks into it.
    None (and a log line) when the engine can't make one: the user then waits for an admin."""
    from anki_accounts import AnkiAccountManager
    from database import get_account, set_user_container_permissions
    if anki_server.status != "ready":
        print(f"✗ No profile for '{username}': Anki isn't ready ({anki_server.status})")
        return None
    name = _free_name(username)
    try:
        profile = await asyncio.to_thread(AnkiAccountManager().create_account, name)
    except Exception as e:
        print(f"✗ Couldn't make a profile for '{username}': {e}")
        return None
    set_user_container_permissions(user_id, [profile["id"]])
    starter = get_account(starter_id) if starter_id else None
    if starter and starter["id"] != profile["id"]:
        async def run():
            try:
                n = await copy_decks(starter["container_name"], name)
                print(f"✓ Copied {n} deck(s) from '{starter['container_name']}' to '{name}'")
            except Exception as e:
                print(f"✗ Copying decks from '{starter['container_name']}' to '{name}' failed: {e}")
        task = asyncio.create_task(run())
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    print(f"✓ Made profile '{name}' for '{username}'")
    return profile
