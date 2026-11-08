import { CHANGELOG } from '../../changelog';

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/** Settings → What's new: the changelog, newest first. */
export function WhatsNewSection() {
  return (
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
  );
}
