import { useEffect, useRef, useState } from 'react';
import { decks } from '../api';
import { quizletToday } from '../quizletToday';

/** How many top-level decks have something to study today (new cards within the daily
 *  limit, learning or reviews, as the decks show them; a deck's counts include its subdecks'),
 *  plus 1 for today's Quizlet session until it's done: the Study tab's badge, in the browser
 *  and the apps. (The iPhone app's icon just shows 1.) */
async function countDue(): Promise<number> {
  const [data, qz] = await Promise.all([decks.list().catch(() => null), quizletToday()]);
  const ankiDecks = data ? Object.entries(data.decks).filter(([name, id]) => {
    const stats = data.stats[id];
    return !name.includes('::') && !!stats && stats.new_count + stats.learn_count + stats.review_count > 0;
  }).length : 0;
  return ankiDecks + (qz.due ? 1 : 0);
}

/** The count, kept fresh: after a sync, when the app comes back, and after studying
 *  (`studying` turning false). */
export function useStudyBadge(studying: boolean): number {
  const [count, setCount] = useState(0);
  const wasStudying = useRef(studying);

  useEffect(() => {
    let live = true;
    const refresh = () => { countDue().then(n => { if (live) setCount(n); }).catch(() => {}); };
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('anki-sync-complete', refresh);
    document.addEventListener('visibilitychange', onVisible);
    // Back from studying.
    window.addEventListener('ankibase-studied', refresh);
    return () => {
      live = false;
      window.removeEventListener('anki-sync-complete', refresh);
      window.removeEventListener('ankibase-studied', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (wasStudying.current && !studying) window.dispatchEvent(new CustomEvent('ankibase-studied'));
    wasStudying.current = studying;
  }, [studying]);

  return count;
}
