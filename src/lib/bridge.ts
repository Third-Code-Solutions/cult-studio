/** Typed view of the preload bridge (`window.cult`). Every call resolves to a Result; `call()` unwraps it or throws ApiError. */

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; details?: unknown };

export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string | null;
}

export interface Settings {
  apiBase: string;
  studioUrl: string;
}

export interface Display { id: number; label: string; width: number; height: number; primary: boolean }

interface CultBridge {
  platform: string;
  login(b: { identifier: string; password: string; totp?: string }): Promise<Result<{ me?: Me; mfaRequired?: boolean }>>;
  session(): Promise<Result<Me>>;
  logout(): Promise<Result<null>>;
  api(method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<Result>;
  startBroadcast(streamId: string): Promise<Result<StartResult>>;
  whipOffer(streamId: string, sdp: string): Promise<Result<{ sdp: string }>>;
  whipStop(streamId: string): Promise<Result<null>>;
  rtSend(msg: unknown): Promise<Result<null>>;
  onRealtime(cb: (msg: unknown) => void): () => void;
  onRealtimeState(cb: (state: unknown) => void): () => void;
  captureSources(kind: 'window' | 'screen'): Promise<Result<CaptureSource[]>>;
  chooseCapture(sourceId: string, audio: boolean): Promise<Result<null>>;
  chooseDesktopAudio(): Promise<Result<null>>;
  metrics(): Promise<Result<{ cpu: number; memoryMb: number }>>;
  displays(): Promise<Result<Display[]>>;
  setLive(live: boolean): Promise<Result<null>>;
  getSettings(): Promise<Result<Settings>>;
  saveSettings(s: Settings): Promise<Result<null>>;
  openStudio(path: '' | '/live' | '/ingest'): Promise<Result<null>>;
  copy(text: string): Promise<Result<null>>;
  win: { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; onMaximized(cb: (max: unknown) => void): () => void };
}

declare global {
  interface Window {
    cult: CultBridge;
  }
}

export const bridge = (): CultBridge => window.cult;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function call<T>(p: Promise<Result<T>> | Promise<Result>): Promise<T> {
  const r = (await p) as Result<T>;
  if (!r.ok) throw new ApiError(r.code, r.message, r.status, r.details);
  return r.data;
}

export const api = <T = unknown>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: Record<string, unknown>) => call<T>(bridge().api(method, path, body));

// ── API shapes used by the studio ──
export interface Me {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  creatorStatus: string;
  studioIngestApproved: boolean;
  age: number | null;
}

export interface CreatorStatus {
  status: 'none' | 'pending' | 'approved' | 'rejected' | 'suspended';
  studioIngestApproved: boolean;
  guideCompleted: boolean;
  decisionReason: string | null;
  applicationsOpen: boolean;
}

export interface Category {
  slug: string;
  name: string;
  enabled: boolean;
  restricted: boolean;
  minAge: number;
  availableToViewer: boolean;
}

export interface Stream {
  id: string;
  title: string;
  category: string;
  tags: string[];
  orientation: 'portrait' | 'landscape';
  state: string;
  liveAt: string | null;
  endedAt: string | null;
  replay: { enabled: boolean; status: string };
}

export interface StartResult {
  stream: Stream;
  lease: { leaseId: string; expiresAt: string; heartbeatSec: number };
  ingest: { whipUrl: string };
}

export interface LiveStats {
  state: string;
  durationSec: number;
  viewers: { current: number; peak: number };
  reactions: number;
  gifts: { count: number; valueMinor: number; currency: string };
  estimatedEarningsMinor: number;
  newFollowers: number;
  chatMessages: number;
  topGifters: { handle: string; displayName: string; avatarUrl: string | null; valueMinor: number; gifts: number }[];
}

export interface ChatMessage {
  id: string;
  clientMsgId: string;
  seq: number;
  sender: { id: string; handle: string; displayName: string; avatarUrl: string | null; badges: string[] };
  body: string;
  createdAt: string | null;
}
