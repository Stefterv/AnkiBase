/** Settings → What's new. Newest day first; one entry per day, a line per change people
 *  will notice. Add to it with every user-facing commit (see CLAUDE.md). */
export interface ChangelogDay {
  /** YYYY-MM-DD */
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogDay[] = [
  {
    date: '2026-11-08',
    changes: [
      'Settings → What’s new: this list of changes.',
      'Settings → Study: choose when the next day starts. It’s Anki’s own setting, so it syncs with Anki Desktop and AnkiWeb, and Stats, the daily story, “studied today” and the daily Quizlet session all follow it.',
    ],
  },
  {
    date: '2026-11-07',
    changes: [
      'Stories: mark a story as read, and get a new story every day (Settings → AI → Daily story) once the last one is read. On iPhone you get a notification when it’s ready.',
      'Stories: a quiz at the end of a story.',
      'Appearance: Match system switches between a light and a dark theme with your device.',
      'Study: choose per deck, set and story whether it shows up in Study.',
      'Study: one Quizlet session a day, and the decks with cards due are back.',
      'Study badge: counts the decks with something to study, new cards included.',
      'Sync runs by itself while you study, on the server and in the browser.',
      'Sign in with single sign-on (OpenID Connect), set up from the admin panel. New users get a private profile.',
      'iPhone: daily reminders, a native tab bar with a badge on Study, iPad support, and card audio plays.',
      'iPhone: log in on the server’s own website or with single sign-on, and sync sets itself up.',
      'Activity: on phones the heatmap opens on today.',
      'The Logout button moved to Settings → Account.',
    ],
  },
  {
    date: '2026-10-29',
    changes: [
      'Apps for Windows, macOS and Linux.',
      'AI: use local and other OpenAI-compatible servers (Ollama, Open WebUI, LM Studio).',
    ],
  },
  {
    date: '2026-10-28',
    changes: [
      'Docker: the whole server in one container (docker compose up -d).',
    ],
  },
  {
    date: '2026-10-27',
    changes: [
      'iPhone app with Anki’s engine on the phone: works fully offline, with its own sync server.',
      'Android app and downloadable releases.',
      'Anki’s own Deck Options and Statistics screens.',
      'Your own sync server in one click.',
      'Anki runs on anki-cli instead of separate containers.',
    ],
  },
  {
    date: '2026-10-26',
    changes: [
      'Study with Anki’s own reviewer, and resume sessions from the Study hub.',
      'Quizlet: Learn, Test, Match, Blast, Blocks and Write modes.',
      'Reading: AI-annotated stories for instant lookups, and explain a selection.',
      'Search rebuilt as a dictionary plus search in your cards.',
      'Stats rebuilt as a full Anki-style statistics screen, with Quizlet data.',
    ],
  },
];
