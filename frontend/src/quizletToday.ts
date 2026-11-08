import { quizlet } from './api';
import { todayStart } from './dayStart';
import { hiddenFromStudy } from './studyShows';

/** The daily Quizlet session: one in total, due until any set was studied today (the
 *  device's day, starting at the collection's "Next day starts at" hour). `set`: the one
 *  studied last, to pick up (the newest before any). Not due without sets, or without a
 *  server (no Quizlet then). */
export interface QuizletToday { due: boolean; set: { id: number; title: string } | null }

export async function quizletToday(): Promise<QuizletToday> {
  try {
    const [r, start] = await Promise.all([quizlet.lastStudied(hiddenFromStudy().quizlet), todayStart()]);  // only the sets Study shows
    if (!r.has_sets || !r.set) return { due: false, set: null };
    const last = r.at ? new Date(r.at) : null;
    return { due: !last || last < start, set: r.set };
  } catch {
    return { due: false, set: null };
  }
}
