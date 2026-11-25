import { ApiError } from './bridge';

/** Plain-words copy for API error codes. Unknown codes fall back to the server's own message. */
const COPY: Record<string, string> = {
  NETWORK: 'Can’t reach CULT. Check your connection, or the server address in Settings.',
  INVALID_CREDENTIALS: 'That email/username and password don’t match.',
  INVALID_TOTP: 'That code didn’t work. Use the newest 6-digit code from your authenticator app.',
  ACCOUNT_SUSPENDED: 'This account is suspended.',
  RATE_LIMITED: 'Too many tries. Wait a minute and try again.',
  SIGN_IN_REQUIRED: 'Your session ended. Sign in again.',
  UNAUTHENTICATED: 'Your session ended. Sign in again.',
  CREATOR_APPROVAL_REQUIRED: 'Your channel isn’t approved for broadcasting yet.',
  GUIDE_REQUIRED: 'Finish the first-stream guide in Creator Studio before your first LIVE.',
  ALREADY_LIVE: 'You’re already LIVE on another broadcast. End it first, or resume it here.',
  CATEGORY_RESTRICTED: 'This category is 21+ or not available in your country. Choose another category.',
  CATEGORY_UNAVAILABLE: 'That category isn’t available right now. Choose another.',
  FILTERED: 'Your title or tags contain wording CULT doesn’t allow. Edit them and try again.',
  LINK_BLOCKED: 'Links aren’t allowed in the title or tags.',
  BETTING_CLASSIFICATION_REQUIRED: 'Sports Betting streams must be classified as commentary or promotion.',
  BETTING_NOT_PERMITTED: 'Betting functionality can’t be streamed on CULT.',
  FEATURE_DISABLED: 'Broadcasting is switched off on CULT right now. Try again later.',
  STREAM_REMOVED: 'This broadcast was removed by CULT moderation.',
  STREAM_CANCELED: 'This broadcast was canceled. Start a new one.',
  SESSION_ENDED: 'That broadcast already ended. Go LIVE again to start a new one.',
  STALE_LEASE: 'Another device took over this broadcast.',
  ORIENTATION_LOCKED: 'Orientation can’t change after the broadcast starts.',
  REPLAY_LOCKED: 'Replay can’t change after the broadcast starts.',
  NOT_EDITABLE: 'This broadcast can no longer be edited.',
  VALIDATION_FAILED: 'Some details aren’t valid. Check the LIVE setup.',
  STUDIO_NOT_APPROVED: 'Streaming with OBS isn’t enabled for your channel yet. Ask for studio ingest in Creator Studio.',
  INGEST_KEY_REQUIRED: 'Create a stream key first.',
  WHIP_REFUSED: 'The media server refused this session. Go LIVE again.',
  WHIP_FAILED: 'The media server didn’t accept the stream.',
  MEDIA_UNREACHABLE: 'Can’t reach the media server. Check your connection and retry.',
  NOT_ALLOWED: 'This request isn’t available in the desktop app.',
  NOT_FOUND: 'Not found.',
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return COPY[e.code] ?? e.message ?? 'Something went wrong.';
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

export const errorCode = (e: unknown): string | null => (e instanceof ApiError ? e.code : null);

/** Chat send rejections (copied from the web chat). */
export const CHAT_REJECT: Record<string, string> = {
  SIGN_IN_REQUIRED: 'Sign in to chat.',
  TOO_LONG: 'Messages are limited to 300 characters.',
  EMPTY: 'Type a message first.',
  RATE_LIMITED: 'You’re sending messages too fast.',
  SLOW_MODE: 'Slow mode is on. Wait a moment.',
  MUTED: 'You’re muted in this chat.',
  BANNED: 'You can’t chat in this channel.',
  SUSPENDED: 'Your account is suspended.',
  FILTERED: 'That message contains wording CULT doesn’t allow.',
  LINK_BLOCKED: 'Links aren’t allowed in chat.',
  CHAT_CLOSED: 'Chat is closed.',
  UNAVAILABLE: 'Chat isn’t available.',
};
