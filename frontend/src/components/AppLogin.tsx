import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe, Loader2, LogIn, Smartphone, X } from 'lucide-react';
import { ankiweb, auth, syncServer } from '../api';
import { appStatus, device, onWebsiteLogin, startWebsiteLogin, useAppStatus } from '../native';

/** Sync with the profile's own account on the server's sync server, if the phone doesn't sync
 *  anywhere yet (backend/profile_sync.py). Best effort: otherwise Settings → Sync as before. */
async function setUpSync(server: string) {
  try {
    if ((await ankiweb.status()).configured) return;
    const account = await syncServer.profileAccount();
    await ankiweb.login(account.username, account.password, `${server.replace(/\/+$/, '')}/syncserver/`);
  } catch { /* no sync server, or it didn't answer */ }
}

/** The iPhone app's login: enter the server's address, then log in on its own website (password
 *  or single sign-on) in the system's sign-in sheet (backend/app_login.py). Not a full-screen
 *  overlay (no `inset-0`), so the tab bar stays and a tap on it just moves on (Layout closes this). */
export function AppLoginModal({ onClose }: { onClose: () => void }) {
  const app = useAppStatus();
  const [url, setUrl] = useState(app?.server ?? app?.default_server ?? '');
  const [busy, setBusy] = useState<'server' | 'website' | null>(null);
  const [error, setError] = useState('');

  // The sign-in sheet came back: trade its code for the app's session, then start over logged in.
  useEffect(() => onWebsiteLogin(async result => {
    if (!result.code || !result.verifier) {
      setBusy(null);
      if (result.error && result.error !== 'cancelled') setError('The website didn’t finish the login, try again.');
      return;
    }
    try {
      await auth.appSession(result.code, result.verifier);
      const status = await appStatus.refresh().catch(() => null);
      if (status?.server) await setUpSync(status.server);
      window.location.replace('/');  // the app syncs on start
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : 'Couldn’t log in, try again');
    }
  }), []);

  const logIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setError(''); setBusy('server');
    try {
      const next = await appStatus.setServer(url.trim());
      if (!next.server) throw new Error('Enter your AnkiBase server’s address');
      if (!next.online) throw new Error(`Couldn’t reach ${next.server}. Check the address, or try again when you’re online.`);
      setBusy('website');
      startWebsiteLogin(next.server);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : 'Couldn’t use that server');
    }
  };

  const phoneOnly = async () => {
    setError('');
    try { await appStatus.setServer(null); window.location.replace('/'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Couldn’t change the server'); }
  };

  return createPortal(
    <div className="fixed top-0 left-0 right-0 bottom-0 z-[120] bg-black/60 flex items-start sm:items-center justify-center p-4 pt-[max(4rem,env(safe-area-inset-top))]"
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-(--bg-secondary) border border-white/10 shadow-2xl p-5 space-y-4 anim-rise" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-(--accent)/15 text-(--accent) flex items-center justify-center shrink-0"><Globe className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-lg leading-tight">Log in to your server</h2>
            <p className="text-sm text-(--text-secondary) mt-0.5">Enter its address; you log in on its website, as in the browser.</p>
          </div>
          <button onClick={onClose} className="icon-btn shrink-0" title="Close"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={logIn} className="space-y-3">
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="anki.example.com" className="input w-full" autoFocus
            inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} disabled={!!busy} />
          {error && <p className="text-sm text-(--error)">{error}</p>}
          <button type="submit" disabled={!!busy || !url.trim()} className="btn btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {busy === 'server' ? 'Connecting…' : busy === 'website' ? 'Logging in on the website…' : 'Continue'}
          </button>
        </form>

        {app?.server && (
          <button onClick={phoneOnly} disabled={!!busy} className="w-full text-xs text-(--text-secondary) hover:text-white inline-flex items-center justify-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5" /> Use on this {device} only, without a server
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
