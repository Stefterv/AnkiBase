import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, KeyRound, Link2, Unlink } from 'lucide-react';
import { auth, type User } from '../../api';
import { isNative } from '../../native';
import { SSO_ERRORS } from './ssoErrors';


/** Settings → Account: sign in with the server's OpenID Connect provider. */
export function SsoSection({ user, onChange }: { user: User; onChange: () => void }) {
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sso = user.sso;
  // The provider's redirect can't come back into the app's own session.
  if (!sso || isNative) return null;
  const linkedNow = params.get('sso') === 'linked';
  const returned = params.get('sso_error');
  const message = error || (returned ? SSO_ERRORS[returned] ?? SSO_ERRORS.provider : '');

  const clearParams = () => {
    if (!params.has('sso') && !params.has('sso_error')) return;
    const next = new URLSearchParams(params); next.delete('sso'); next.delete('sso_error');
    setParams(next, { replace: true });
  };
  const unlink = async () => {
    setBusy(true); setError(''); clearParams();
    try { await auth.unlinkSso(); onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t disconnect'); }
    finally { setBusy(false); }
  };

  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-(--accent)/15 text-(--accent) flex items-center justify-center shrink-0"><KeyRound className="w-5 h-5" /></div>
        <div className="flex-1 min-w-48">
          <h3 className="font-semibold">Sign in with {sso.name}</h3>
          <p className="text-xs text-(--text-secondary) mt-0.5">
            {sso.linked ? `Your ${sso.name} account is connected: you can sign in with it instead of your password.`
              : `Connect your ${sso.name} account to sign in with it instead of your password.`}
          </p>
        </div>
        {sso.linked ? (
          user.has_password !== false && (
            <button onClick={unlink} disabled={busy} className="btn btn-secondary inline-flex items-center gap-2 disabled:opacity-60"><Unlink className="w-4 h-4" /> Disconnect</button>
          )
        ) : (
          <a href="/api/auth/oidc/start?link=true" className="btn btn-primary inline-flex items-center gap-2"><Link2 className="w-4 h-4" /> Connect</a>
        )}
      </div>
      {linkedNow && sso.linked && <p className="text-sm text-green-400 flex items-center gap-2 anim-rise"><Check className="w-4 h-4" /> Connected. Next time, sign in with {sso.name}.</p>}
      {message && <p className="text-sm text-(--error) anim-rise">{message}</p>}
      {sso.linked && user.has_password === false && (
        <p className="text-xs text-(--text-secondary)">You sign in with {sso.name} only. Set a password below to be able to disconnect it.</p>
      )}
    </section>
  );
}
