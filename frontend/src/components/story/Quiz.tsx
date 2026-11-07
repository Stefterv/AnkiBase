import { useState } from 'react';
import { BookOpen, Check, CheckCircle2, CircleHelp, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { stories, type SavedStory, type StoryQuiz } from '../../api';
import { haptic } from '../../native';

type Phase = { kind: 'idle'; error?: string } | { kind: 'loading'; fresh: boolean } | { kind: 'asking'; i: number; picks: number[] } | { kind: 'done'; picks: number[] };

/** Scroll to the paragraph that answers a question and flash it. */
function showInStory(para: number) {
  const el = document.getElementById(`para-${para}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('bg-(--accent)/10');
  setTimeout(() => el.classList.remove('bg-(--accent)/10'), 2200);
}

/** "Check your understanding": an AI-written comprehension quiz at the end of a story. */
export function StoryQuizCard({ story, ai, onQuiz, onMarkRead }: {
  story: SavedStory;
  ai: { provider?: string; model?: string };
  onQuiz: (q: StoryQuiz) => void;
  /** Offered after a good score while the story is unread. */
  onMarkRead?: () => void;
}) {
  const quiz = story.quiz ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const start = async (fresh = false) => {
    if (quiz && !fresh) { setPhase({ kind: 'asking', i: 0, picks: [] }); return; }
    setPhase({ kind: 'loading', fresh });
    try {
      const r = await stories.quiz(story.id, { fresh, provider: ai.provider || undefined, model: ai.model || undefined });
      onQuiz(r.quiz);
      setPhase({ kind: 'asking', i: 0, picks: [] });
    } catch (e) {
      setPhase({ kind: 'idle', error: e instanceof Error ? e.message : 'Couldn’t write a quiz, try again' });
    }
  };

  // --- Not started ---------------------------------------------------------------
  if (phase.kind === 'idle' || phase.kind === 'loading' || !quiz) {
    const last = quiz?.result;
    const loading = phase.kind === 'loading';
    return (
      <section className="mt-10 rounded-xl bg-(--bg-secondary) p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-(--accent)/15 text-(--accent) flex items-center justify-center shrink-0"><CircleHelp className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold">Check your understanding</h2>
            <p className="text-sm text-(--text-secondary)">
              {last ? `Last time you got ${last.score} of ${last.total} right.`
                : quiz ? `${quiz.questions.length} questions about what happened in the story.`
                  : 'A few questions about what happened, to see if you got it all.'}
            </p>
          </div>
        </div>
        {phase.kind === 'idle' && phase.error && <p className="text-sm text-(--error)">{phase.error}</p>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => start(false)} disabled={loading} className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-60">
            {loading && !phase.fresh ? <><Loader2 className="w-4 h-4 animate-spin" /> Writing questions…</>
              : quiz ? <>{last ? <RotateCcw className="w-4 h-4" /> : <CircleHelp className="w-4 h-4" />} {last ? 'Retake quiz' : 'Start quiz'}</>
                : <><Sparkles className="w-4 h-4" /> Quiz me</>}
          </button>
          {quiz && (
            <button onClick={() => start(true)} disabled={loading} className="btn btn-secondary inline-flex items-center gap-2 disabled:opacity-60">
              {loading && phase.fresh ? <><Loader2 className="w-4 h-4 animate-spin" /> Writing questions…</> : <><Sparkles className="w-4 h-4" /> New questions</>}
            </button>
          )}
        </div>
      </section>
    );
  }

  const qs = quiz.questions;

  // --- Results -------------------------------------------------------------------
  if (phase.kind === 'done') {
    const score = phase.picks.filter((p, i) => p === qs[i].answer).length;
    const ratio = score / qs.length;
    const missed = qs.map((q, i) => ({ q, i, pick: phase.picks[i] })).filter(x => x.pick !== x.q.answer);
    return (
      <section className="mt-10 rounded-xl bg-(--bg-secondary) p-5 space-y-4">
        <div className="text-center space-y-1">
          <p className="text-4xl font-bold">{score}<span className="text-(--text-secondary) text-2xl"> / {qs.length}</span></p>
          <p className="text-sm text-(--text-secondary)">
            {ratio === 1 ? 'Perfect — you understood the whole story.'
              : ratio >= 0.6 ? 'Nicely done — you got the gist. Have a look at what you missed.'
                : 'Some of it slipped by. Reread the parts below and try again.'}
          </p>
        </div>
        {missed.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-(--text-secondary)">To look at again</p>
            {missed.map(({ q, i, pick }) => (
              <div key={i} className="rounded-lg bg-(--bg-tertiary)/60 p-3 space-y-1.5 text-sm">
                <p className="font-medium">{q.q}</p>
                <p className="text-(--error) inline-flex items-start gap-1.5"><X className="w-4 h-4 shrink-0 mt-0.5" /> {q.options[pick]}</p>
                <p className="text-green-400 flex items-start gap-1.5"><Check className="w-4 h-4 shrink-0 mt-0.5" /> {q.options[q.answer]}</p>
                {q.why && <p className="text-(--text-secondary)">{q.why}</p>}
                {q.para != null && (
                  <button onClick={() => showInStory(q.para!)} className="text-xs text-(--accent) hover:underline inline-flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Show in story</button>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-center">
          {onMarkRead && !story.read_at && ratio >= 0.6 && (
            <button onClick={onMarkRead} className="btn btn-primary inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Mark as read</button>
          )}
          <button onClick={() => setPhase({ kind: 'asking', i: 0, picks: [] })} className="btn btn-secondary inline-flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Retake</button>
          <button onClick={() => start(true)} className="btn btn-secondary inline-flex items-center gap-2"><Sparkles className="w-4 h-4" /> New questions</button>
        </div>
      </section>
    );
  }

  // --- A question ----------------------------------------------------------------
  const { i, picks } = phase;
  const q = qs[i];
  const pick = picks[i];
  const answered = pick != null;
  const choose = (o: number) => {
    if (answered) return;
    haptic(o === q.answer ? 'success' : 'warning');
    setPhase({ kind: 'asking', i, picks: [...picks.slice(0, i), o] });
  };
  const next = () => {
    if (i + 1 < qs.length) { setPhase({ kind: 'asking', i: i + 1, picks }); return; }
    const score = picks.filter((p, k) => p === qs[k].answer).length;
    setPhase({ kind: 'done', picks });
    stories.quizResult(story.id, score, qs.length).then(r => onQuiz(r.quiz)).catch(() => { /* the score just isn't remembered */ });
  };

  return (
    <section className="mt-10 rounded-xl bg-(--bg-secondary) p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 flex gap-1">
          {qs.map((_, k) => (
            <div key={k} className={`h-1.5 flex-1 rounded-full ${k < i || (k === i && answered)
              ? (picks[k] === qs[k].answer ? 'bg-green-500' : 'bg-(--error)')
              : k === i ? 'bg-(--accent)' : 'bg-(--bg-tertiary)'}`} />
          ))}
        </div>
        <span className="text-xs text-(--text-secondary) shrink-0">{i + 1} / {qs.length}</span>
        <button onClick={() => setPhase({ kind: 'idle' })} className="icon-btn shrink-0" title="Stop the quiz"><X className="w-4 h-4" /></button>
      </div>
      <p className="text-lg font-semibold leading-snug">{q.q}</p>
      <div className="grid gap-2">
        {q.options.map((o, k) => {
          const state = !answered ? 'open' : k === q.answer ? 'right' : k === pick ? 'wrong' : 'other';
          return (
            <button key={k} onClick={() => choose(k)} disabled={answered}
              className={`text-left rounded-lg px-3.5 py-2.5 text-sm border transition-colors flex items-center gap-2.5 ${
                state === 'open' ? 'border-white/10 bg-(--bg-tertiary)/60 hover:border-(--accent) hover:bg-(--accent)/10'
                  : state === 'right' ? 'border-green-500/60 bg-green-500/15'
                    : state === 'wrong' ? 'border-(--error)/60 bg-(--error)/15'
                      : 'border-white/5 opacity-50'}`}>
              <span className="w-5 h-5 rounded-full border border-white/20 text-[11px] flex items-center justify-center shrink-0">
                {state === 'right' ? <Check className="w-3.5 h-3.5 text-green-400" /> : state === 'wrong' ? <X className="w-3.5 h-3.5 text-(--error)" /> : String.fromCharCode(65 + k)}
              </span>
              <span className="flex-1">{o}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className="space-y-3">
          <div className="text-sm space-y-1.5">
            <p className={`font-semibold ${pick === q.answer ? 'text-green-400' : 'text-(--error)'}`}>{pick === q.answer ? 'Right!' : 'Not quite.'}</p>
            {q.why && <p className="text-(--text-secondary)">{q.why}</p>}
          </div>
          <div className="flex items-center gap-2">
            {q.para != null && (
              <button onClick={() => showInStory(q.para!)} className="btn btn-secondary inline-flex items-center gap-2"><BookOpen className="w-4 h-4" /> Show in story</button>
            )}
            <div className="flex-1" />
            <button onClick={next} autoFocus className="btn btn-primary">{i + 1 < qs.length ? 'Next' : 'See result'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
