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

type Block = NonNullable<CreatorStatus['blockedBy']>;
const BLOCK_COPY: Record<Block | 'unknown', { title: string; body: string }> = {
  RULES_ACCEPTANCE_REQUIRED: { title: 'One step before your first stream', body: 'Every CULT account can go LIVE. Confirm you’ll follow the broadcasting rules and you’re in.' },
  BIRTH_DATE_REQUIRED: { title: 'Add your date of birth', body: 'Streamers must be 18 or older. Add your date of birth once in Creator Studio, then check again.' },
  CREATOR_MIN_AGE: { title: 'You need to be 18 to stream', body: 'You can keep watching and chatting on CULT. Going LIVE opens on your 18th birthday.' },
  CREATOR_SUSPENDED: { title: 'Streaming is suspended on this account', body: 'You can’t go LIVE while streaming is suspended. Check Creator Studio for details.' },
  unknown: { title: 'We couldn’t check your channel', body: 'Check your connection and try again.' },
};

export function NotCreator({ me, status, onSignOut, onRefresh }: { me: Me; status: CreatorStatus | null; onSignOut: () => void; onRefresh: () => void }) {
  const block: Block | 'unknown' = status?.blockedBy ?? 'unknown';
  const copy = BLOCK_COPY[block];
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const accept = async (e: FormEvent) => {
    e.preventDefault();
    if (!status || !agreed) return;
    setBusy(true);
    setErr(null);
    try {
      await call(bridge().api('POST', '/v1/creator/apply', { acceptBroadcastRules: true, rulesVersion: status.rulesVersion }));
      onRefresh();
    } catch (x) {
      setErr(errorText(x));
      setBusy(false);
    }
  };
  return (
    <AuthShell>
      <img className="mark" src={wordmark} alt="CULT" />
      <div style={{ display: 'grid', gap: 6 }}>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        {block === 'CREATOR_SUSPENDED' && status?.decisionReason && <div className="notice">Reason: {status.decisionReason}</div>}
      </div>
      {block === 'RULES_ACCEPTANCE_REQUIRED' ? (
        <form onSubmit={accept} style={{ display: 'grid', gap: 12 }}>
          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
            <span>I accept the CULT broadcasting rules{status?.rulesVersion ? ` (v${status.rulesVersion})` : ''} and the Community Guidelines.</span>
          </label>
          {err && <div className="notice error" role="alert">{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" type="submit" disabled={!agreed || busy}>
              {busy ? 'Saving…' : 'Start streaming'}
            </button>
            <button className="btn" type="button" onClick={() => void bridge().openStudio('')}>
              Open Creator Studio <Icon name="external" size={14} />
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          {block !== 'CREATOR_MIN_AGE' && block !== 'unknown' && (
            <button className="btn primary" onClick={() => void bridge().openStudio('')}>
              Open Creator Studio <Icon name="external" size={14} />
            </button>
          )}
          <button className={block === 'unknown' ? 'btn primary' : 'btn'} onClick={onRefresh}>
            <Icon name="refresh" size={14} /> Check again
          </button>
        </div>
      )}
      <div className="auth-foot">
        <span>Signed in as @{me.handle}</span>
        <button className="link" onClick={onSignOut}>Sign out</button>
      </div>
    </AuthShell>
  );
}
