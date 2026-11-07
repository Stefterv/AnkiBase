import { useEffect, useState } from 'react';

/** Decks, Quizlet sets and stories hidden from the Study page (and its badge), chosen with
 *  "Show in Study" where they're renamed. Per device, so the phone and the browser can differ.
 *  A hidden Anki deck hides its subdecks too. */
export type StudyKind = 'anki' | 'stories' | 'quizlet';
export type HiddenFromStudy = Record<StudyKind, number[]>;

const KEY = 'ankibase-study-hidden';
const EVENT = 'ankibase-study-hidden';
const NONE: HiddenFromStudy = { anki: [], stories: [], quizlet: [] };

export function hiddenFromStudy(): HiddenFromStudy {
  try { return { ...NONE, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return NONE; }
}

export function setShownInStudy(kind: StudyKind, id: number, shown: boolean) {
  const all = hiddenFromStudy();
  const rest = all[kind].filter(x => x !== id);
  const next = { ...all, [kind]: shown ? rest : [...rest, id] };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onHiddenFromStudyChange(handler: () => void) {
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
