# AnkiBase

## Changelog (Settings → What's new)

Every commit that changes something users will notice adds a line to
`frontend/src/changelog.ts`, in the same commit. Skip pure refactors, build/CI, docs and
internal fixes nobody would see.

- Entries are grouped by day, newest first. Use today's date (`YYYY-MM-DD`): add to the
  top entry if it's already today, otherwise add a new entry at the top.
- One line per change, written for the person using the app: what they can now do or
  what works differently, and where to find it (e.g. "Settings → Study: …"). No file
  names, endpoints or internal terms.
- Newest change first within the day. If a later commit reworks something already
  listed today, edit that line instead of adding another.
