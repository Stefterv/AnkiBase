import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle } from '../quizlet/ui';
import { reminderSettings, setReminders, type ReminderSettings } from '../../native';

const pad = (n: number) => String(n).padStart(2, '0');
const SNOOZES = [0, 1, 5, 15, 30, 60, 120];

/** Settings → Reminders (iPhone): a daily notification naming the decks that are behind,
 *  and the app icon's badge with how many there are (ios/Sources/AnkiBase/Reminders.swift).
 *  The badge can be snoozed for a while after studying even one card or word. */
export function RemindersSection() {
  const { t } = useTranslation();
  const [value, setValue] = useState<ReminderSettings>(reminderSettings() ?? { enabled: false, hour: 9, minute: 0 });
  const [busy, setBusy] = useState(false);

  const save = async (change: Partial<Omit<ReminderSettings, 'denied'>>) => {
    const next = { enabled: value.enabled, hour: value.hour, minute: value.minute, snooze: value.snooze ?? 0, ...change };
    setBusy(true);
    setValue({ ...next, denied: false });
    const strings = {
      title: t('reminders.notification.title'),
      one: t('reminders.notification.one'),
      other: t('reminders.notification.other'),
      and: t('reminders.notification.and'),
      more: t('reminders.notification.more'),
    };
    try { setValue(await setReminders(next, strings)); } finally { setBusy(false); }
  };

  const onTime = (text: string) => {
    const [hour, minute] = text.split(':').map(Number);
    if (Number.isInteger(hour) && Number.isInteger(minute)) save({ hour, minute });
  };

  return (
    <section className="card space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">{t('reminders.title')}</h3>
          <p className="text-xs text-(--text-secondary) mt-0.5">{t('reminders.description')}</p>
        </div>
        <Toggle on={value.enabled} disabled={busy}
          onChange={enabled => save({ enabled })} />
      </div>

      {value.enabled && (
        <label className="flex items-center justify-between gap-4 rounded-xl bg-(--bg-tertiary)/60 px-4 py-3 anim-rise">
          <span className="text-sm">{t('reminders.time')}</span>
          <input type="time" value={`${pad(value.hour)}:${pad(value.minute)}`} disabled={busy}
            onChange={e => onTime(e.target.value)}
            className="bg-transparent text-sm font-medium text-right" />
        </label>
      )}

      {value.enabled && (
        <label className="flex items-center justify-between gap-4 rounded-xl bg-(--bg-tertiary)/60 px-4 py-3 anim-rise">
          <span>
            <span className="block text-sm">{t('reminders.snooze')}</span>
            <span className="block text-xs text-(--text-secondary) mt-0.5">{t('reminders.snoozeHint')}</span>
          </span>
          <select value={value.snooze ?? 0} disabled={busy}
            onChange={e => save({ snooze: Number(e.target.value) })}
            className="bg-transparent text-sm font-medium text-right">
            {SNOOZES.map(m => (
              <option key={m} value={m}>
                {m === 0 ? t('reminders.snoozeOff') : m < 60 ? t('reminders.minutes', { count: m }) : t('reminders.hours', { count: m / 60 })}
              </option>
            ))}
          </select>
        </label>
      )}

      {value.denied && <p className="text-sm text-(--error) anim-rise">{t('reminders.denied')}</p>}
    </section>
  );
}
