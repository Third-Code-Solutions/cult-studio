import { useState, type FormEvent } from 'react';
import wordmark from '../assets/cult-wordmark-yellow.png';
import { bridge, call, type CreatorStatus, type Me } from '../lib/bridge';
import { errorText } from '../lib/errors';
import { Icon } from './Icon';
import { Brand, WindowControls } from './TitleBar';

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <header className="titlebar" style={{ gridTemplateColumns: '1fr auto' }}>
        <Brand />
        <div className="tb-right">
          <WindowControls />
        </div>
      </header>
      <main className="auth-body">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

type Props = { apiBase: string; onSignedIn: (me: Me) => void; onSettings: () => void };

export function SignIn({ apiBase, onSignedIn, onSettings }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [mfa, setMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ me?: Me; mfaRequired?: boolean }>(bridge().login({ identifier: identifier.trim(), password, ...(mfa ? { totp } : {}) }));
      if (r.mfaRequired) setMfa(true);
      else onSignedIn(await call<Me>(bridge().session()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <img className="mark" src={wordmark} alt="CULT" />
      <div style={{ display: 'grid', gap: 6 }}>
        <h2>{mfa ? 'Enter your 6-digit code' : 'Sign in to go LIVE'}</h2>
        <p>{mfa ? 'Open your authenticator app and enter the current code for CULT.' : 'Use your CULT creator account.'}</p>
      </div>
      <form onSubmit={submit}>
        {!mfa ? (
          <>
            <label className="field">
              <span>Email or username</span>
              <input className="input" name="identifier" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="input" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </>
        ) : (
          <label className="field">
            <span>Authentication code</span>
            <input className="input mono" name="totp" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} autoFocus required />
          </label>
        )}
        {error && <div className="notice error" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Signing in…' : mfa ? 'Verify' : 'Sign in'}
        </button>
        {mfa && (
          <button type="button" className="btn ghost" onClick={() => (setMfa(false), setTotp(''), setError(null))}>
            Use a different account
          </button>
        )}
      </form>
      <div className="auth-foot">
        <span>Server: {apiBase.replace(/^https?:\/\//, '')}</span>
        <button className="link" onClick={onSettings}>Change</button>
      </div>
    </AuthShell>
  );
}

const STATUS_COPY: Record<CreatorStatus['status'], { title: string; body: string }> = {
  none: { title: 'This account isn’t a creator yet', body: 'CULT Live Studio is for approved creators. Apply for creator access in Creator Studio; it usually takes a few days.' },
  pending: { title: 'Your creator application is in review', body: 'We’ll notify you when it’s approved. You can go LIVE from here as soon as it is.' },
  rejected: { title: 'Your creator application wasn’t approved', body: 'You can review the reason and apply again in Creator Studio.' },
  suspended: { title: 'Creator access is suspended', body: 'You can’t go LIVE while creator access is suspended. Check Creator Studio for details.' },
  approved: { title: '', body: '' },
};

export function NotCreator({ me, status, onSignOut, onRefresh }: { me: Me; status: CreatorStatus; onSignOut: () => void; onRefresh: () => void }) {
  const copy = STATUS_COPY[status.status];
  return (
    <AuthShell>
      <img className="mark" src={wordmark} alt="CULT" />
      <div style={{ display: 'grid', gap: 6 }}>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        {status.decisionReason && <div className="notice">Reason: {status.decisionReason}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={() => void bridge().openStudio('')}>
          {status.status === 'none' || status.status === 'rejected' ? 'Apply in Creator Studio' : 'Open Creator Studio'} <Icon name="external" size={14} />
        </button>
        <button className="btn" onClick={onRefresh}>
          <Icon name="refresh" size={14} /> Check again
        </button>
      </div>
      <div className="auth-foot">
        <span>Signed in as @{me.handle}</span>
        <button className="link" onClick={onSignOut}>Sign out</button>
      </div>
    </AuthShell>
  );
}
