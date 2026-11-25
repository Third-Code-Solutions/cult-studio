import { useEffect, useRef, useState } from 'react';
import { mixer } from '../lib/audio';
import { bridge } from '../lib/bridge';
import * as comp from '../lib/compositor';
import type { Phase } from '../lib/useLive';
import type { Health } from '../lib/whip';
import { Icon } from './Icon';

const clock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
};

function Timer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return <span className="timer">{clock(Math.max(0, (now - since) / 1000))}</span>;
}

function Meter() {
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (bar.current) bar.current.style.scale = `${mixer.level().toFixed(3)} 1`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <span className="meter" role="meter" aria-label="Mic level">
      <i ref={bar} />
    </span>
  );
}

type Props = {
  phase: Phase;
  liveAt: number | null;
  health: Health | null;
  canGoLive: boolean;
  onGoLive: () => void;
  onEnd: () => void;
  onAudioError: (msg: string) => void;
};

export function BottomBar({ phase, liveAt, health, canGoLive, onGoLive, onEnd, onAudioError }: Props) {
  const [muted, setMuted] = useState(false);
  const [micVol, setMicVol] = useState(1);
  const [micOk, setMicOk] = useState<boolean | null>(null);
  const [desk, setDesk] = useState(false);
  const [deskVol, setDeskVol] = useState(1);
  const [metrics, setMetrics] = useState<{ cpu: number; memoryMb: number } | null>(null);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    mixer.startMic().then(
      () => setMicOk(true),
      () => setMicOk(false),
    );
    const t = setInterval(() => {
      void bridge().metrics().then((r) => r.ok && setMetrics(r.data));
      setFps(comp.currentFps());
    }, 2000);
    return () => clearInterval(t);
  }, []);

  const toggleDesk = async () => {
    if (desk) {
      mixer.stopDesktop();
      return setDesk(false);
    }
    try {
      await mixer.startDesktop();
      setDesk(true);
    } catch {
      onAudioError('Couldn’t capture desktop audio on this computer.');
    }
  };

  const live = phase === 'live' || phase === 'ending';
  const shownFps = live && health ? health.fps : fps;
  return (
    <footer className="bottombar">
      <div className="audio">
        <div className="ch">
          <button className={`icon-btn${muted ? '' : ' on'}`} aria-label={muted ? 'Unmute mic' : 'Mute mic'} aria-pressed={muted} disabled={micOk === false} title={micOk === false ? 'No microphone found' : undefined} onClick={() => (mixer.setMicMuted(!muted), setMuted(!muted))}>
            <Icon name={muted || micOk === false ? 'micOff' : 'mic'} />
          </button>
          <span className="lab">{micOk === false ? 'No mic' : muted ? 'Muted' : 'Mic'}</span>
          <Meter />
          <input type="range" min={0} max={2} step={0.05} value={micVol} aria-label="Mic volume" disabled={micOk === false} onChange={(e) => (mixer.setMicVolume(Number(e.target.value)), setMicVol(Number(e.target.value)))} />
        </div>
        <div className="ch">
          <button className={`icon-btn${desk ? ' on' : ''}`} aria-label={desk ? 'Turn desktop audio off' : 'Turn desktop audio on'} aria-pressed={desk} onClick={() => void toggleDesk()}>
            <Icon name="speaker" />
          </button>
          <span className="lab">{desk ? 'Desktop' : 'Desktop off'}</span>
          <input type="range" min={0} max={2} step={0.05} value={deskVol} aria-label="Desktop audio volume" disabled={!desk} onChange={(e) => (mixer.setDesktopVolume(Number(e.target.value)), setDeskVol(Number(e.target.value)))} />
        </div>
      </div>
      {live ? (
        <button className="golive end" disabled={phase === 'ending'} onClick={onEnd}>
          {phase === 'ending' ? 'Ending…' : 'End LIVE'}
          {liveAt && <Timer since={liveAt} />}
        </button>
      ) : (
        <button className="golive" disabled={phase === 'starting' || !canGoLive} onClick={onGoLive}>
          {phase === 'starting' ? 'Starting…' : 'Go LIVE'}
        </button>
      )}
      <div className="statline" aria-label="Performance">
        <span>CPU <b>{metrics ? `${Math.round(metrics.cpu)}%` : '—'}</b></span>
        <span>Memory <b>{metrics ? `${metrics.memoryMb.toLocaleString('en')} MB` : '—'}</b></span>
        <span>Upload <b>{live && health ? `${health.bitrateKbps.toLocaleString('en')} kbps` : '—'}</b></span>
        <span className={live && health && health.framesDropped > 0 ? 'warn' : undefined}>Frame drops <b>{live && health ? health.framesDropped.toLocaleString('en') : '—'}</b></span>
        <span className={shownFps && shownFps < 25 ? 'warn' : undefined}>FPS <b>{shownFps || '—'}</b></span>
      </div>
    </footer>
  );
}
