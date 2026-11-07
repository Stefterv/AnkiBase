import { quizlet } from './api';

/** The daily Quizlet session: one in total, due until any set was studied today (the
 *  device's day). `set`: the one studied last, to pick up (the newest before any). Not due
 *  without sets, or without a server (no Quizlet then). */
export interface QuizletToday { due: boolean; set: { id: number; title: string } | null }

export async function quizletToday(): Promise<QuizletToday> {
  try {
    const r = await quizlet.lastStudied();
    if (!r.has_sets || !r.set) return { due: false, set: null };
    const last = r.at ? new Date(r.at) : null;
    return { due: !last || last.toDateString() !== new Date().toDateString(), set: r.set };
  } catch {
    return { due: false, set: null };
  }
}
