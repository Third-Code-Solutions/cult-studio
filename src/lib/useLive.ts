import { useCallback, useEffect, useRef, useState } from 'react';
import { mixer } from './audio';
import { api, ApiError, bridge, call, type ChatMessage, type LiveStats, type StartResult, type Stream } from './bridge';
import * as comp from './compositor';
import { errorCode, errorText } from './errors';
import type { Orientation } from './scene';
import { healthReader, publish, type Health } from './whip';

/** One LIVE session: create/reuse broadcast → start (WHIP) → publish main canvas + mixed audio → heartbeats → end. */

export interface Setup {
  title: string;
  category: string;
  tags: string[];
  orientation: Orientation;
  replay: boolean;
  rights: boolean;
  betting: 'commentary' | 'promotion' | null;
}

export type Phase = 'idle' | 'starting' | 'live' | 'ending';
export type ChatItem =
  | { kind: 'msg'; key: string; seq: number; name: string; body: string; mine: boolean; pending?: boolean }
  | { kind: 'gift'; key: string; name: string; gift: string };

export interface Summary {
  title: string;
  durationSec: number;
  peak: number;
  gifts: number;
  earningsMinor: number;
  currency: string;
  followers: number;
  reason: string | null;
}

export interface LiveError {
  message: string;
  resumeId?: string; // ALREADY_LIVE → offer to resume that stream here
}

const STATS_MS = 5000;
const HEALTH_MS = 2000;
const MAX_REPUBLISH = 3;

export function useLive(meId: string | null) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stream, setStream] = useState<Stream | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [error, setError] = useState<LiveError | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [viewers, setViewers] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);

  const s = useRef<{
    id: string | null;
    leaseId: string | null;
    pc: RTCPeerConnection | null;
    media: MediaStream | null;
    timers: number[];
    draftId: string | null;
    followers: number;
    title: string;
    republishes: number;
  }>({ id: null, leaseId: null, pc: null, media: null, timers: [], draftId: null, followers: 0, title: '', republishes: 0 });

  const teardown = useCallback(async () => {
    const st = s.current;
    st.timers.forEach((t) => clearInterval(t));
    st.timers = [];
    st.pc?.close();
    st.pc = null;
    st.media?.getVideoTracks().forEach((t) => t.stop()); // canvas capture track only; the mixer track stays alive
    st.media = null;
    if (st.id) {
      await bridge().whipStop(st.id);
      void bridge().rtSend({ t: 'unsubscribe', channel: `stream:${st.id}` });
    }
    comp.widgets.live = false;
    void bridge().setLive(false);
    setHealth(null);
  }, []);

  const finish = useCallback(
    async (reason: string | null) => {
      const st = s.current;
      const id = st.id;
      await teardown();
      let final: LiveStats | null = null;
      if (id) final = await api<LiveStats>('GET', `/v1/broadcasts/${id}/live-stats`).catch(() => null);
      setSummary({
        title: st.title,
        durationSec: final?.durationSec ?? 0,
        peak: final?.viewers.peak ?? 0,
        gifts: final?.gifts.count ?? 0,
        earningsMinor: final?.estimatedEarningsMinor ?? 0,
        currency: final?.gifts.currency ?? 'PHP',
        followers: final?.newFollowers ?? 0,
        reason,
      });
      st.id = null;
      st.leaseId = null;
      setStream(null);
      setLiveAt(null);
      setPhase('idle');
    },
    [teardown],
  );

  const pollStats = useCallback(async () => {
    const id = s.current.id;
    if (!id) return;
    const r = await api<LiveStats>('GET', `/v1/broadcasts/${id}/live-stats`).catch(() => null);
    if (!r) return;
    setStats(r);
    setViewers(r.viewers.current);
    const w = comp.widgets;
    w.likes = r.reactions;
    w.gifts = r.gifts.count;
    w.goalCurrent = r.gifts.count;
    if (r.newFollowers > s.current.followers) comp.pushAlert('New follower', r.newFollowers - s.current.followers > 1 ? `+${r.newFollowers - s.current.followers} followers` : 'Thanks for the follow');
    s.current.followers = r.newFollowers;
    w.followers = r.newFollowers;
    w.ranking = r.topGifters.map((g) => ({ name: g.displayName, value: money(g.valueMinor, r.gifts.currency) }));
  }, []);

  const startPublishing = useCallback(
    async (id: string, canvas: HTMLCanvasElement) => {
      const video = canvas.captureStream(30).getVideoTracks()[0]!;
      video.contentHint = 'motion';
      const media = new MediaStream([video, mixer.track]);
      s.current.media = media;
      const pc = await publish(id, media);
      s.current.pc = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed' || s.current.pc !== pc || s.current.republishes >= MAX_REPUBLISH) return;
        s.current.republishes++;
        pc.close();
        void publish(id, media).then(
          (next) => {
            s.current.pc = next;
          },
          () => setError({ message: 'Lost the connection to the media server. End LIVE and go LIVE again.' }),
        );
      };
    },
    [],
  );

  const run = useCallback(
    async (start: StartResult, canvas: HTMLCanvasElement) => {
      const st = s.current;
      st.id = start.stream.id;
      st.leaseId = start.lease.leaseId;
      st.title = start.stream.title;
      st.followers = 0;
      st.republishes = 0;
      setStream(start.stream);
      await startPublishing(start.stream.id, canvas);
      comp.widgets.live = true;
      comp.widgets.chat = [];
      comp.widgets.ranking = [];
      comp.widgets.alerts = [];
      setChat([]);
      setStats(null);
      setLiveAt(start.stream.liveAt ? Date.parse(start.stream.liveAt) : Date.now());
      setPhase('live');
      void bridge().setLive(true);
      void bridge().rtSend({ t: 'subscribe', channel: `stream:${start.stream.id}` });

      // Encoder health every 2 s for the stats line; the heartbeat reports the latest sample.
      let reader = { pc: s.current.pc, read: healthReader(s.current.pc!) };
      let last: Health | null = null;
      const sample = async () => {
        const pc = s.current.pc;
        if (!pc) return;
        if (reader.pc !== pc) reader = { pc, read: healthReader(pc) }; // re-published after a failure
        last = await reader.read().catch(() => last);
        if (last) setHealth(last);
      };
      const beat = async () => {
        const h = last;
        try {
          const r = await api<{ state: string; viewerCount: number; elapsedSec: number }>('POST', `/v1/broadcasts/${st.id}/heartbeat`, {
            leaseId: st.leaseId,
            ...(h ? { health: { bitrateKbps: h.bitrateKbps, fps: h.fps, rttMs: h.rttMs, backgrounded: h.backgrounded } } : {}),
          });
          setViewers(r.viewerCount);
          if (r.state === 'ended') void finish('CULT ended this broadcast.');
        } catch (e) {
          if (errorCode(e) === 'STALE_LEASE') void finish('Another device took over this broadcast, so this app stopped publishing.');
          // network blips: keep going, the lease survives ~90 s of missed heartbeats
        }
      };
      st.timers.push(window.setInterval(beat, start.lease.heartbeatSec * 1000));
      st.timers.push(window.setInterval(() => void pollStats(), STATS_MS));
      st.timers.push(window.setInterval(() => void sample(), HEALTH_MS));
      void sample();
      void beat();
      void pollStats();
    },
    [finish, pollStats, startPublishing],
  );

  const goLive = useCallback(
    async (setup: Setup, canvas: HTMLCanvasElement, resumeId?: string) => {
      setError(null);
      setSummary(null);
      setPhase('starting');
      try {
        let id = resumeId;
        if (!id) {
          const meta = {
            title: setup.title.trim(),
            category: setup.category,
            tags: setup.tags,
            orientation: setup.orientation,
            replayEnabled: setup.replay,
            language: 'en',
            ...(setup.category === 'sports-betting' ? { bettingClassification: setup.betting } : {}),
          };
          const draft = s.current.draftId;
          const b = draft
            ? await api<Stream>('PATCH', `/v1/broadcasts/${draft}`, meta).catch(() => null)
            : null;
          const created = b ?? (await api<Stream>('POST', '/v1/broadcasts', { ...meta, rightsAttestation: true }));
          s.current.draftId = created.id;
          id = created.id;
        }
        const start = await call<StartResult>(bridge().startBroadcast(id));
        await run(start, canvas);
        s.current.draftId = null;
      } catch (e) {
        const st = s.current;
        // Started but publishing failed: end it so nothing is left "starting" on the server.
        if (st.id && st.leaseId) await api('POST', `/v1/broadcasts/${st.id}/end`, { leaseId: st.leaseId, confirm: true }).catch(() => undefined);
        await teardown();
        st.id = null;
        st.leaseId = null;
        setStream(null);
        setPhase('idle');
        const details = e instanceof ApiError ? (e.details as { streamId?: string } | undefined) : undefined;
        setError({ message: errorText(e), resumeId: errorCode(e) === 'ALREADY_LIVE' ? details?.streamId : undefined });
      }
    },
    [run, teardown],
  );

  const end = useCallback(async () => {
    const st = s.current;
    if (!st.id) return;
    setPhase('ending');
    try {
      await api('POST', `/v1/broadcasts/${st.id}/end`, { leaseId: st.leaseId ?? undefined, confirm: true });
      await finish(null);
    } catch (e) {
      if (errorCode(e) === 'STALE_LEASE') return void finish('Another device holds this broadcast now.');
      setPhase('live');
      setError({ message: `Couldn’t end LIVE: ${errorText(e)} Try again.` });
    }
  }, [finish]);

  // Realtime: chat, gifts, viewer counts and server-side state changes for the current stream.
  useEffect(() => {
    const off = bridge().onRealtime((raw) => {
      const m = raw as { t?: string; channel?: string; streamId?: string } & Record<string, any>;
      const id = s.current.id;
      if (!id) return;
      if (m.channel && m.channel !== `stream:${id}`) return;
      if (m.streamId && m.streamId !== id) return;
      switch (m.t) {
        case 'chat.history':
          return setChat((c) => mergeMessages(c, m.messages as ChatMessage[], meId));
        case 'chat.message':
        case 'chat.ack':
          return setChat((c) => mergeMessages(c, [m.message as ChatMessage], meId));
        case 'chat.deleted':
          return setChat((c) => c.filter((i) => i.key !== m.messageId));
        case 'chat.reject':
          setChat((c) => c.filter((i) => i.key !== m.clientMsgId));
          return setChatError(m.code as string);
        case 'gift': {
          const name = m.sender?.displayName ?? m.sender?.handle ?? 'Someone';
          const gift = m.gift?.name ?? 'a gift';
          comp.pushAlert(name, `sent ${gift}`);
          return setChat((c) => [...c, { kind: 'gift' as const, key: `g${Date.now()}${Math.random()}`, name, gift }].slice(-200));
        }
        case 'stream.viewers':
          return setViewers(Number(m.count) || 0);
        case 'stream.state':
          if (m.state === 'ended' || m.state === 'canceled') void finish(m.accessState === 'removed' ? 'CULT moderation removed this broadcast.' : null);
          return;
      }
    });
    return off;
  }, [finish, meId]);

  // Mirror chat into the chatbox widget.
  useEffect(() => {
    comp.widgets.chat = chat.flatMap((i) => (i.kind === 'msg' ? [{ name: i.name, body: i.body }] : i.kind === 'gift' ? [{ name: i.name, body: `sent ${i.gift}` }] : [])).slice(-30);
  }, [chat]);

  const sendChat = useCallback(
    (body: string) => {
      const id = s.current.id;
      if (!id) return;
      const clientMsgId = `cm_${crypto.randomUUID()}`;
      setChatError(null);
      setChat((c) => [...c, { kind: 'msg', key: clientMsgId, seq: Infinity, name: 'You', body, mine: true, pending: true }]);
      void bridge().rtSend({ t: 'chat.send', channel: `stream:${id}`, clientMsgId, body });
    },
    [],
  );

  useEffect(() => () => void teardown(), [teardown]);

  return { phase, stream, liveAt, error, setError, summary, setSummary, stats, viewers, health, chat, chatError, goLive, end, sendChat };
}

function mergeMessages(items: ChatItem[], msgs: ChatMessage[], meId: string | null): ChatItem[] {
  let next = items;
  for (const msg of [...msgs].sort((a, b) => a.seq - b.seq)) {
    next = next.filter((i) => i.key !== msg.clientMsgId && i.key !== msg.id); // ack replaces the pending copy
    next = [...next, { kind: 'msg', key: msg.id, seq: msg.seq, name: msg.sender.displayName, body: msg.body, mine: msg.sender.id === meId }];
  }
  return next.slice(-200);
}

export function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
}
