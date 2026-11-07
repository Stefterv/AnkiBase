import { useEffect, useState } from 'react';
import { Check, ChevronRight, Copy, KeyRound, Loader2 } from 'lucide-react';
import { oidcAdmin, type OidcConfig } from '../../api';
import { Segmented, Toggle } from '../quizlet/ui';

/** Settings → Users: sign in with an OpenID Connect provider (backend/oidc.py). Admins only. */
export function SsoAdminSection() {
  const [saved, setSaved] = useState<OidcConfig | null>(null);
  const [form, setForm] = useState<OidcConfig | null>(null);
  const [secret, setSecret] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [copied, setCopied] = useState(false);

  const load = (c: OidcConfig) => {
    setSaved(c); setForm(c); setSecret('');
    if (c.scopes !== 'openid profile email' || c.redirect_uri) setAdvanced(true);
  };
  useEffect(() => { oidcAdmin.get().then(load).catch(e => setError(e instanceof Error ? e.message : 'Couldn’t load the settings')); }, []);

  if (!form || !saved) {
    return <section className="card">{error ? <p className="text-sm text-(--error)">{error}</p> : <div className="skeleton h-24 rounded-lg" />}</section>;
  }
  const set = <K extends keyof OidcConfig>(k: K, v: OidcConfig[K]) => { setForm({ ...form, [k]: v }); setDone(''); };
  const dirty = secret !== '' || (['enabled', 'issuer', 'client_id', 'name', 'scopes', 'redirect_uri', 'auto_create', 'profile_mode', 'starter_profile'] as const).some(k => form[k] !== saved[k])
    || [...form.default_profiles].sort().join() !== [...saved.default_profiles].sort().join();
  const callback = form.redirect_uri || form.default_redirect_uri;

  const run = async (action: () => Promise<OidcConfig>, message: string) => {
    setBusy(true); setError(''); setDone('');
    try { load(await action()); setDone(message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t save'); }
    finally { setBusy(false); }
  };
  const save = () => run(() => oidcAdmin.save({
    enabled: form.enabled, issuer: form.issuer, client_id: form.client_id, name: form.name, scopes: form.scopes,
    redirect_uri: form.redirect_uri, auto_create: form.auto_create, default_profiles: form.default_profiles, profile_mode: form.profile_mode, starter_profile: form.starter_profile, client_secret: secret || null,
  }), form.enabled ? 'Saved. The login page now offers single sign-on.' : 'Saved.');
  const copy = async () => {
    try { await navigator.clipboard.writeText(callback); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  const field = 'input w-full text-sm';
  const label = 'text-xs font-medium text-(--text-secondary)';

  return (
    <section className="card space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-(--accent)/15 text-(--accent) flex items-center justify-center shrink-0"><KeyRound className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold">Single sign-on</h3>
          <p className="text-xs text-(--text-secondary) mt-0.5">
            Let people sign in with an OpenID Connect provider such as Authentik, Keycloak, Authelia or Google. Users connect their account in Settings → Account.
          </p>
        </div>
        <Toggle on={form.enabled} onChange={v => set('enabled', v)} disabled={busy} />
      </div>

      {saved.source === 'env' && (
        <p className="text-xs rounded-lg bg-(--bg-tertiary)/60 px-3 py-2 text-(--text-secondary)">
          These come from the <code>OIDC_*</code> settings in the server’s <code>.env</code>. Saving here replaces them.
        </p>
      )}

      <div className="space-y-3 max-w-xl">
        <div className="space-y-1">
          <p className={label}>Redirect URI <span className="font-normal">· register this with the provider</span></p>
          <div className="flex gap-2">
            <code className="flex-1 min-w-0 truncate rounded-lg bg-(--bg-tertiary)/60 px-3 py-2 text-xs">{callback}</code>
            <button type="button" onClick={copy} className="icon-btn shrink-0" title="Copy">{copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}</button>
          </div>
        </div>
        <label className="block space-y-1">
          <span className={label}>Issuer URL</span>
          <input value={form.issuer} onChange={e => set('issuer', e.target.value)} placeholder="https://auth.example.com/application/o/ankibase/"
            className={field} autoCapitalize="off" autoCorrect="off" spellCheck={false} inputMode="url" />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className={label}>Client ID</span>
            <input value={form.client_id} onChange={e => set('client_id', e.target.value)} className={field} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="block space-y-1">
            <span className={label}>Client secret</span>
            <input type="password" value={secret} onChange={e => { setSecret(e.target.value); setDone(''); }} autoComplete="new-password"
              placeholder={saved.has_secret ? 'Saved · type to replace' : 'None (public client)'} className={field} />
          </label>
        </div>
        <label className="block space-y-1">
          <span className={label}>Button name <span className="font-normal">· “Sign in with {form.name || 'SSO'}”</span></span>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="SSO" maxLength={40} className={field} />
        </label>

        <label className="flex items-start gap-3 rounded-lg bg-(--bg-tertiary)/40 p-3 cursor-pointer">
          <input type="checkbox" checked={form.auto_create} onChange={e => set('auto_create', e.target.checked)} className="mt-0.5 accent-(--accent)" />
          <span className="text-sm">
            Create users automatically
            <span className="block text-xs text-(--text-secondary) mt-0.5">
              Anyone the provider lets in gets an AnkiBase user on first sign-in (not an admin, no profiles until you give them some).
              Limit who can use the application at the provider, especially with a public one like Google.
            </span>
          </span>
        </label>
        {form.auto_create && (
          <div className="space-y-3 pl-3">
            <div className="space-y-1.5">
              <p className={label}>New users study in</p>
              <Segmented value={form.profile_mode} onChange={v => set('profile_mode', v)}
                options={[{ value: 'own', label: 'Their own profile' }, { value: 'shared', label: 'Shared profiles' }]} />
            </div>
            {form.profile_mode === 'own' ? (
              <label className="block space-y-1">
                <span className={label}>Start with the decks from</span>
                <select value={form.starter_profile ?? ''} onChange={e => set('starter_profile', e.target.value ? Number(e.target.value) : null)} className="input w-full text-sm max-w-xs">
                  <option value="">Nothing (an empty profile)</option>
                  {form.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span className="block text-xs text-(--text-secondary)">
                  Each new user gets a private profile named after them{form.starter_profile ? ', with a fresh copy of these decks: the same cards and media, all new, without anyone’s progress' : ''}.
                </span>
              </label>
            ) : (
              <div className="space-y-1.5">
                {form.profiles.length === 0 ? <p className="text-xs text-(--text-secondary)">No profiles yet.</p> : (
                  <div className="flex flex-wrap gap-1.5">
                    {form.profiles.map(p => {
                      const on = form.default_profiles.includes(p.id);
                      return (
                        <button key={p.id} type="button" aria-pressed={on}
                          onClick={() => set('default_profiles', on ? form.default_profiles.filter(x => x !== p.id) : [...form.default_profiles, p.id])}
                          className={`h-8 px-3 rounded-lg text-xs inline-flex items-center gap-1.5 transition-colors ${on ? 'bg-(--accent)/15 text-white ring-1 ring-(--accent)/50' : 'bg-(--bg-tertiary) text-(--text-secondary) hover:text-white'}`}>
                          {on && <Check className="w-3.5 h-3.5 text-(--accent)" />}{p.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs text-(--text-secondary)">{form.default_profiles.length ? 'They study in these together with everyone else who has them.' : 'None: they wait until you give them a profile in the list below.'}</p>
              </div>
            )}
          </div>
        )}

        <button type="button" onClick={() => setAdvanced(a => !a)} className="text-xs text-(--text-secondary) hover:text-white inline-flex items-center gap-1">
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${advanced ? 'rotate-90' : ''}`} /> Advanced
        </button>
        {advanced && (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className={label}>Scopes</span>
              <input value={form.scopes} onChange={e => set('scopes', e.target.value)} className={field} autoCapitalize="off" spellCheck={false} />
            </label>
            <label className="block space-y-1">
              <span className={label}>Redirect URI override <span className="font-normal">· only if the one above is wrong (unusual proxies)</span></span>
              <input value={form.redirect_uri} onChange={e => set('redirect_uri', e.target.value)} placeholder={form.default_redirect_uri}
                className={field} autoCapitalize="off" spellCheck={false} inputMode="url" />
            </label>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-(--error) anim-rise">{error}</p>}
      {done && <p className="text-sm text-green-400 flex items-center gap-2 anim-rise"><Check className="w-4 h-4" />{done}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={save} disabled={busy || !dirty} className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-60">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} {busy && form.enabled ? 'Checking the provider…' : 'Save'}
        </button>
        {dirty && !busy && <button onClick={() => { setForm(saved); setSecret(''); setError(''); }} className="btn btn-secondary">Undo changes</button>}
        {saved.source === 'settings' && !busy && (
          <button onClick={() => run(oidcAdmin.reset, 'Using the server’s .env settings again.')} className="ml-auto text-xs text-(--text-secondary) hover:text-white">
            Use the .env settings instead
          </button>
        )}
      </div>
    </section>
  );
}
