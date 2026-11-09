"""The daily story (Story → New story every day): a new story each day, written from the
words and settings the Story tab was set to when it was turned on, but only once the
newest story has been read (Reading → Mark as read).

Each profile keeps its settings in its stories database ("daily": enabled, the user who
turned it on, their timezone and the recipe). A loop checks every few minutes; marking a
story read checks right away.
"""
import asyncio
import os
import random
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from database import (
    get_account_db_path, get_all_accounts, get_story_setting, get_user,
    get_user_accessible_containers, latest_story, set_story_setting,
)
from security import can, current_profile

CHECK_EVERY = 10 * 60
# After a try that failed (Anki starting, the AI down…), wait before the next one.
RETRY_AFTER = 30 * 60

_last_try: dict[str, float] = {}
_running: set[str] = set()


def pick_weighted(data: dict, weights: dict, count: int) -> list[str]:
    """`count` words with each card category's share proportional to its weight (as the
    Story tab's smart pick, Story.tsx pickWeighted)."""
    by: dict[str, list[str]] = {}
    for word in data.get("words", []):
        by.setdefault(data.get("categories", {}).get(word) or "new", []).append(word)
    cats = sorted((c for c, w in weights.items() if w > 0), key=lambda c: -weights[c])
    total = sum(weights[c] for c in cats)
    if not total:
        return []
    take: dict[str, int] = {}
    left = count
    for c in cats:
        take[c] = min(-(-weights[c] * count // total), len(by.get(c, [])), left)
        left -= take[c]
    for c in cats:
        more = min(len(by.get(c, [])) - take[c], left)
        if more > 0:
            take[c] += more
            left -= more
    return [w for c in cats for w in random.sample(by.get(c, []), take[c])]


def pick_any(data: dict, count: int) -> list[str]:
    """When the weights leave nothing to pick (e.g. only "learning" weighted, and nothing
    is being learned): any words that aren't suspended or buried."""
    cats = data.get("categories", {})
    words = [w for w in data.get("words", []) if cats.get(w) not in ("suspended", "buried")]
    return random.sample(words, min(count, len(words)))


def pick_quizlet(data: dict, starred_first: bool, missed_first: bool, count: int) -> list[str]:
    """Starred terms first, then the most missed, then random (Story.tsx pickQuizlet)."""
    out: list[str] = []

    def add(words):
        for w in words:
            if len(out) < count and w not in out:
                out.append(w)

    if starred_first:
        add(random.sample(data.get("starred") or [], len(data.get("starred") or [])))
    if missed_first:
        add(w for w, _ in sorted((data.get("missed") or {}).items(), key=lambda kv: -kv[1]))
    add(random.sample(data.get("words", []), len(data.get("words", []))))
    return out


def _today(tz: str, rollover: int) -> date:
    """Today in `tz`, the day starting at the collection's "next day starts at" hour."""
    try:
        zone = ZoneInfo(tz)
    except Exception:
        zone = timezone.utc
    return (datetime.now(zone) - timedelta(hours=rollover)).date()


def _day_of(created_at: str, tz: str, rollover: int) -> Optional[date]:
    """The local day of a stored UTC timestamp ("YYYY-MM-DD HH:MM:SS")."""
    try:
        when = datetime.fromisoformat(str(created_at)).replace(tzinfo=timezone.utc)
        return (when.astimezone(ZoneInfo(tz)) - timedelta(hours=rollover)).date()
    except Exception:
        return None


def _enabled(container: str) -> Optional[dict]:
    """The daily settings when the daily story is on."""
    if not os.path.exists(get_account_db_path(container)):
        return None
    config = get_story_setting("daily", container)
    if not config or not config.get("enabled") or not config.get("recipe"):
        return None
    return config


def _due(container: str, config: dict, rollover: int) -> bool:
    """A story should be written now: nothing was written today, and the newest story has
    been read (or there's none)."""
    tz = config.get("tz") or "UTC"
    newest = latest_story(container)
    if newest:
        if _day_of(newest["created_at"], tz, rollover) == _today(tz, rollover):
            return False
        if not newest["read_at"]:
            return False
    return True


async def follow_deck(recipe: Optional[dict], client) -> bool:
    """Keep an Anki recipe on its deck by id, so renaming (or moving) the deck doesn't lose
    it: fills in the id from the name, or the current name from the id. True when the
    recipe changed (save it)."""
    if not recipe or recipe.get("source") != "anki" or not recipe.get("deck"):
        return False
    decks = await client.get_deck_names_and_ids()
    names = {did: name for name, did in decks.items()}
    did = recipe.get("deck_id")
    if did in names and names[did] != recipe["deck"]:
        recipe["deck"] = recipe["deck_name"] = names[did]
        return True
    if did not in names and recipe["deck"] in decks:
        recipe["deck_id"] = decks[recipe["deck"]]
        return True
    return False


async def _request_for(config: dict, user: dict):
    """The Story tab's request, with today's words picked from the recipe's source, or
    (None, why) when there's nothing to write with."""
    from main import StoryRequest, get_anki_client, get_deck_words
    from database import get_quizlet_set_words
    recipe = config["recipe"]
    source = recipe.get("source")
    count = int(recipe.get("count") or 15)
    words: list[str] = []
    word_data: dict = {}
    problem = "There are no words to write with. Choose a deck or a set in the Story tab."
    if source == "anki" and recipe.get("deck"):
        deck = recipe["deck"]
        client = get_anki_client()
        data = await get_deck_words(deck_name=deck, limit=500, field=recipe.get("field") or "", client=client, _=user)
        if not data.get("words") and recipe.get("field") and data.get("total"):
            # The chosen field isn't on these notes (anymore): let it find the word field.
            data = await get_deck_words(deck_name=deck, limit=500, field="", client=client, _=user)
        words = pick_weighted(data, recipe.get("weights") or {}, count) or pick_any(data, count)
        word_data = data.get("word_data") or {}
        if not data.get("total"):
            problem = (f"The deck “{deck.replace('::', ' › ')}” has no cards. Was it renamed or deleted? "
                       "Choose it again in the Story tab.")
        elif not data.get("words"):
            problem = f"No words found in the deck “{deck.replace('::', ' › ')}”. Choose its word field in the Story tab."
        else:
            problem = f"Every card in the deck “{deck.replace('::', ' › ')}” is suspended or buried."
    elif source == "quizlet" and recipe.get("set"):
        data = get_quizlet_set_words(user["id"], int(recipe["set"]),
                                     "definition" if recipe.get("side") == "definition" else "term")
        if data:
            words = pick_quizlet(data, recipe.get("q_starred", True), recipe.get("q_missed", True), count)
            word_data = data.get("word_data") or {}
            problem = "The Quizlet set has no cards."
        else:
            problem = "The Quizlet set is gone. Choose another one in the Story tab."
    # The words typed in yourself ("My words", or added to the picked ones).
    words = list(dict.fromkeys(words + [w for w in recipe.get("words") or [] if w]))
    if not words:
        return None, problem
    return StoryRequest(
        words=words,
        word_data={w: word_data[w] for w in words if w in word_data} or None,
        style=recipe.get("style") or "casual",
        custom_instructions=recipe.get("custom_instructions"),
        length=recipe.get("length") or "auto",
        language=recipe.get("language") or "auto",
        target_language=recipe.get("target_language"),
        level=recipe.get("level"),
        provider=recipe.get("provider"),
        model=recipe.get("model"),
        deck_name=recipe.get("deck_name"),
        lookup_fields=recipe.get("lookup_fields"),
    ), None


async def run(account: dict, force: bool = False) -> None:
    """Write the profile's daily story if one is due. `force`: don't wait out a failed try
    (a story was just marked read, or the setting was just turned on)."""
    container = account["container_name"]
    if container in _running or (not force and time.time() - _last_try.get(container, 0) < RETRY_AFTER):
        return
    token = current_profile.set(account)
    _running.add(container)
    try:
        config = _enabled(container)
        if not config:
            return
        import stats_engine as se
        from main import get_anki_client
        try:
            rollover = await se.rollover_hour(get_anki_client())
        except Exception:  # Anki not ready: its default
            rollover = se.ROLLOVER_HOURS
        if not _due(container, config, rollover):
            return
        _last_try[container] = time.time()
        # Whoever turned it on must still be allowed to use the AI on this profile.
        user = get_user(config.get("user_id"))
        if not user or not can(user, "use_ai"):
            return
        if account["id"] not in {p["id"] for p in get_user_accessible_containers(user["id"])}:
            return
        from main import get_anki_client as anki
        try:
            if await follow_deck(config.get("recipe"), anki()):
                set_story_setting("daily", config, container)
        except Exception:  # Anki not ready: the words below say so
            pass
        request, problem = await _request_for(config, user)
        if request is None:
            print(f"Daily story ({container}): {problem}")
            _note_problem(container, problem)
            return
        from main import write_story
        result = await write_story(request)
        print(f"Daily story ({container}): wrote \"{result['title']}\"")
        _note_problem(container, None)
    except Exception as e:
        print(f"Daily story ({container}) failed: {e}")
        _note_problem(container, f"Couldn’t write today’s story: {getattr(e, 'detail', None) or e}")
    finally:
        _running.discard(container)
        current_profile.reset(token)


def _note_problem(container: str, problem: Optional[str]) -> None:
    """Keep why the last try didn't write a story, for Settings → AI → Daily story (cleared
    once one is written, or when the setting is saved again)."""
    config = get_story_setting("daily", container)
    if config and config.get("problem") != problem:
        config["problem"] = problem
        set_story_setting("daily", config, container)


_tasks: set[asyncio.Task] = set()


def kick(account: Optional[dict]) -> None:
    """Check this profile now, in the background (a story was marked read, or the setting
    was turned on)."""
    if not account:
        return
    task = asyncio.create_task(run(account, force=True))
    _tasks.add(task)  # asyncio only keeps a weak reference
    task.add_done_callback(_tasks.discard)


async def loop() -> None:
    """Check every profile every few minutes (started with the server)."""
    await asyncio.sleep(60)  # let the Anki engine start
    while True:
        try:
            for account in get_all_accounts():
                await run(account)
        except Exception as e:
            print(f"Daily story check failed: {e}")
        await asyncio.sleep(CHECK_EVERY)
