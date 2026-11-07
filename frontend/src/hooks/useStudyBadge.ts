import { useEffect, useRef, useState } from 'react';
import { decks } from '../api';

/** How many cards are due (reviews and learning cards, as Anki counts "due"; new cards
 *  aren't): the Study tab's badge, in the browser and the apps. The top-level decks' counts
 *  include their subdecks'. (The iPhone app's icon just shows 1 while anything is due.) */
async function countDue(): Promise<number> {
  const data = await decks.list();
  return Object.entries(data.decks).reduce((sum, [name, id]) => {
    const stats = data.stats[id];
    return name.includes('::') || !stats ? sum : sum + stats.review_count + stats.learn_count;
  }, 0);
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
