import { useState } from 'react';
import { Check, Loader2, Send } from 'lucide-react';
import { CHANGELOG } from '../../changelog';
import { suggestions } from '../../api';

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Settings → What's new: the changelog, newest first, and (with a server) a box to send
 *  the admins a suggestion. */
export function WhatsNewSection({ canSuggest }: { canSuggest: boolean }) {
  return (
    <>
      {canSuggest && <SuggestionBox />}
      <section className="card space-y-5">
        <h3 className="font-semibold">What’s new</h3>
        {CHANGELOG.map(day => (
          <div key={day.date} className="space-y-1.5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-(--text-secondary)">{dayLabel(day.date)}</h4>
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {day.changes.map(change => <li key={change}>{change}</li>)}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

function SuggestionBox() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await suggestions.send(text.trim());
      setText('');
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t send that, try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-3">
      <div>
        <h3 className="font-semibold">Suggest something</h3>
        <p className="text-xs text-(--text-secondary) mt-0.5">An idea, something that’s missing or something that doesn’t work? Your admin will see it.</p>
      </div>
      <form onSubmit={send} className="space-y-3">
        <textarea value={text} onChange={e => { setText(e.target.value); setSent(false); }} maxLength={2000} rows={3}
          placeholder="I’d like…" aria-label="Your suggestion" className="input w-full resize-y" disabled={busy} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || !text.trim()} className="btn btn-primary inline-flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
          </button>
          {sent && <p className="text-sm text-green-400 flex items-center gap-2 anim-rise"><Check className="w-4 h-4" />Thanks, it’s been sent</p>}
          {error && <p className="text-sm text-(--error) anim-rise">{error}</p>}
        </div>
      </form>
    </section>
  );
}
