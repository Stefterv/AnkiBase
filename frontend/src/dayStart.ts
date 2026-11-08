import { collection } from './api';

/** When the study day starts: Anki's "Next day starts at" hour for the collection
 *  (Settings → Study; synced with Anki Desktop and AnkiWeb, 4am by default). Due cards and
 *  Stats follow it in Anki's engine; this is for what the app decides itself: "studied
 *  today" and the daily Quizlet session. */
export const DEFAULT_DAY_START = 4;
export const DAY_START_CHANGED = 'ankibase-day-start-changed';

let cached: Promise<number> | null = null;

// Another device may have changed it.
window.addEventListener('anki-sync-complete', () => { cached = null; });

export function dayStartHour(): Promise<number> {
  cached ??= collection.rollover()
    .then(r => r.hour)
    .catch(() => { cached = null; return DEFAULT_DAY_START; });  // try again next time
  return cached;
}

export async function setDayStartHour(hour: number): Promise<number> {
  const r = await collection.setRollover(hour);
  cached = Promise.resolve(r.hour);
  window.dispatchEvent(new CustomEvent(DAY_START_CHANGED));
  return r.hour;
}

/** When the current study day started, in the device's time. */
export function studyDayStart(hour: number, now = new Date()): Date {
  const start = new Date(now);
  start.setHours(hour, 0, 0, 0);
  if (start > now) start.setDate(start.getDate() - 1);
  return start;
}

/** When today started, with the collection's hour. */
export async function todayStart(): Promise<Date> {
  return studyDayStart(await dayStartHour());
}
