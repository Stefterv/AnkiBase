import { useEffect, useState } from 'react';
import { collection, type StudyHiddenIds } from './api';

/** Decks, Quizlet sets and stories hidden from the Study page (and its badge), chosen with
 *  "Show in Study" where they're renamed. Kept in the Anki collection's config, so it syncs
 *  to every device with the collection; this device keeps a copy to read right away (and
 *  offline). A hidden Anki deck hides its subdecks too. */
export type StudyKind = 'anki' | 'stories' | 'quizlet';
export type HiddenFromStudy = StudyHiddenIds;

const KEY = 'ankibase-study-hidden';
/** Set while a change hasn't reached the collection yet (saved again on the next load). */
const PENDING = 'ankibase-study-hidden-pending';
const EVENT = 'ankibase-study-hidden';
const NONE: HiddenFromStudy = { anki: [], stories: [], quizlet: [] };

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function hiddenFromStudy(): HiddenFromStudy {
  try { return { ...NONE, ...JSON.parse(read(KEY) ?? '{}') }; } catch { return NONE; }
}

function keep(hidden: HiddenFromStudy) {
  write(KEY, JSON.stringify(hidden));
  window.dispatchEvent(new CustomEvent(EVENT));
}

const isEmpty = (h: HiddenFromStudy) => !h.anki.length && !h.stories.length && !h.quizlet.length;

// One save or load at a time, so an older answer never overwrites a newer change.
let queue: Promise<void> = Promise.resolve();
const enqueue = (job: () => Promise<void>) => { queue = queue.then(job).catch(() => { /* try again later */ }); };

function save() {
  write(PENDING, '1');
  enqueue(async () => {
    await collection.setStudyHidden(hiddenFromStudy());
    write(PENDING, null);
  });
}

let loaded = false;

/** Take the collection's list (after a sync, another device may have changed it). A change
 *  that didn't get through, or a list from before it was synced, is saved instead. */
function load() {
  loaded = true;
  enqueue(async () => {
    if (read(PENDING)) return save();
    const { hidden } = await collection.studyHidden();
    if (hidden) keep({ ...NONE, ...hidden });
    else if (!isEmpty(hiddenFromStudy())) save();
  });
}

// Only once something on screen asked for it (so never before logging in).
window.addEventListener('anki-sync-complete', () => { if (loaded) load(); });

export function setShownInStudy(kind: StudyKind, id: number, shown: boolean) {
  const all = hiddenFromStudy();
  const rest = all[kind].filter(x => x !== id);
  keep({ ...all, [kind]: shown ? rest : [...rest, id] });
  save();
}

export function onHiddenFromStudyChange(handler: () => void) {
  if (!loaded) load();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

export function useHiddenFromStudy(): HiddenFromStudy {
  const [hidden, setHidden] = useState(hiddenFromStudy);
  useEffect(() => onHiddenFromStudyChange(() => setHidden(hiddenFromStudy())), []);
  return hidden;
}

/** Whether an Anki deck is hidden: itself, or a deck it's under. `ids`: name → id. */
export function ankiDeckHidden(name: string, ids: Record<string, number>, hidden: HiddenFromStudy): boolean {
  const parts = name.split('::');
  return parts.some((_, i) => hidden.anki.includes(ids[parts.slice(0, i + 1).join('::')]));
}

/** Whether a Study session is about something hidden. `ankiIds`: name → id. */
export function sessionHidden(kind: string, refId: string, ankiIds: Record<string, number> | null, hidden: HiddenFromStudy): boolean {
  const id = Number(refId);
  if (kind === 'anki') {
    const name = ankiIds && Object.keys(ankiIds).find(n => ankiIds[n] === id);
    return name ? ankiDeckHidden(name, ankiIds!, hidden) : hidden.anki.includes(id);
  }
  return (kind.startsWith('quizlet-') ? hidden.quizlet : hidden.stories).includes(id);
}
