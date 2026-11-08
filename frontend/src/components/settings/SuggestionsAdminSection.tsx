import { useEffect, useState } from 'react';
import { Check, RotateCcw, Trash2 } from 'lucide-react';
import { suggestions as api, type Suggestion } from '../../api';

/** Stored in UTC as "YYYY-MM-DD HH:MM:SS". */
const when = (createdAt: string) =>
  new Date(`${createdAt.replace(' ', 'T')}Z`).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Settings → Suggestions: what users sent from Settings → What's new. Admins only. */
export function SuggestionsAdminSection() {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState('');

  const load = () => api.list().then(r => setList(r.suggestions)).catch(e => setError(e instanceof Error ? e.message : 'Couldn’t load the suggestions'));
  useEffect(() => { load(); }, []);

  const act = async (job: Promise<unknown>) => {
    setError('');
    try { await job; await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t save that, try again'); }
  };

  return (
    <section className="card space-y-4">
      <div>
        <h3 className="font-semibold">Suggestions</h3>
        <p className="text-xs text-(--text-secondary) mt-0.5">What users sent from Settings → What’s new. Mark one done once it’s handled.</p>
      </div>
      {error && <p className="text-sm text-(--error) anim-rise">{error}</p>}
      {list === null ? (!error && <div className="skeleton h-24 rounded-lg" />)
        : list.length === 0 ? <p className="text-sm text-(--text-secondary)">No suggestions yet.</p>
        : (
          <ul className="space-y-2">
            {list.map(s => (
              <li key={s.id} className={`rounded-lg border border-(--bg-tertiary) p-3 flex gap-3 ${s.done ? 'opacity-60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm whitespace-pre-wrap break-words ${s.done ? 'line-through' : ''}`}>{s.text}</p>
                  <p className="text-xs text-(--text-secondary) mt-1">{s.username} · {when(s.created_at)}</p>
                </div>
                <div className="flex items-start gap-1 shrink-0">
                  <button onClick={() => act(api.setDone(s.id, !s.done))} className="btn btn-secondary p-1.5"
                    title={s.done ? 'Mark as open' : 'Mark as done'} aria-label={s.done ? 'Mark as open' : 'Mark as done'}>
                    {s.done ? <RotateCcw className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  </button>
                  <button onClick={() => act(api.remove(s.id))} className="btn btn-secondary p-1.5" title="Delete" aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
