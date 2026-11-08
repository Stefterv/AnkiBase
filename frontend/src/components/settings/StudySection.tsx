import { useEffect, useState } from 'react';
import { dayStartHour, setDayStartHour } from '../../dayStart';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const label = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** Settings → Study: when the day starts. It's Anki's own "Next day starts at" preference,
 *  so it syncs with Anki Desktop and AnkiWeb, and Anki's due cards follow it too. */
export function StudySection() {
  const [hour, setHour] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { dayStartHour().then(setHour); }, []);

  const save = async (next: number) => {
    const before = hour;
    setHour(next);
    setBusy(true);
    setError('');
    try {
      setHour(await setDayStartHour(next));
    } catch (e) {
      setHour(before);
      setError(e instanceof Error ? e.message : 'Couldn’t save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">Next day starts at</h3>
          <p className="text-xs text-(--text-secondary) mt-0.5">
            When today’s cards, “studied today” and the daily Quizlet session reset, in your time.
            It’s Anki’s own setting, so it syncs with Anki Desktop and AnkiWeb.
          </p>
        </div>
        <select value={hour ?? ''} disabled={hour === null || busy} onChange={e => save(Number(e.target.value))}
          aria-label="Next day starts at" className="input text-sm w-auto shrink-0">
          {hour === null && <option value="">…</option>}
          {HOURS.map(h => <option key={h} value={h}>{label(h)}</option>)}
        </select>
      </div>
      {error && <p className="text-sm text-(--error) anim-rise">{error}</p>}
    </section>
  );
}
