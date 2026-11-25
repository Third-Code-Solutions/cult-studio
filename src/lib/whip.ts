import { bridge, call } from './bridge';

/**
 * WHIP publishing (RFC 9725), adapted from the web Studio. The SDP exchange runs in the main process so the publish
 * token never reaches this page; here we only own the RTCPeerConnection.
 */

export type Health = { bitrateKbps: number; fps: number; rttMs: number; framesDropped: number; backgrounded: boolean };

const ICE_GATHER_TIMEOUT_MS = 2500;
const MAX_VIDEO_BPS = 6_000_000;

function waitIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(t);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const t = setTimeout(done, ICE_GATHER_TIMEOUT_MS); // send whatever candidates we have
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export async function publish(streamId: string, media: MediaStream): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  try {
    for (const track of media.getTracks()) {
      const t = pc.addTransceiver(track, { direction: 'sendonly', streams: [media] });
      if (track.kind !== 'video') continue;
      // H.264 first: the media server repackages to HLS without transcoding.
      const codecs = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
      const h264 = codecs.filter((c) => c.mimeType === 'video/H264');
      if (h264.length) t.setCodecPreferences([...h264, ...codecs.filter((c) => c.mimeType !== 'video/H264')]);
      const p = t.sender.getParameters();
      p.encodings = [{ ...(p.encodings?.[0] ?? {}), maxBitrate: MAX_VIDEO_BPS, maxFramerate: 30 }];
      await t.sender.setParameters(p).catch(() => undefined);
    }
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    const { sdp } = await call<{ sdp: string }>(bridge().whipOffer(streamId, pc.localDescription!.sdp));
    await pc.setRemoteDescription({ type: 'answer', sdp });
    return pc;
  } catch (e) {
    pc.close();
    throw e;
  }
}

/** Outbound video bitrate (delta since last call), fps, frame drops and RTT from getStats. */
export function healthReader(pc: RTCPeerConnection) {
  let lastBytes = 0;
  let lastTs = 0;
  return async (): Promise<Health> => {
    const stats = await pc.getStats();
    let bitrateKbps = 0;
    let fps = 0;
    let rttMs = 0;
    let framesDropped = 0;
    stats.forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'video') {
        if (lastTs && r.timestamp > lastTs) bitrateKbps = Math.round(((r.bytesSent - lastBytes) * 8) / (r.timestamp - lastTs));
        lastBytes = r.bytesSent;
        lastTs = r.timestamp;
        fps = Math.round(r.framesPerSecond ?? 0);
      }
      if (r.type === 'candidate-pair' && (r.nominated || r.selected) && typeof r.currentRoundTripTime === 'number') rttMs = Math.round(r.currentRoundTripTime * 1000);
    });
    // Frames the encoder skipped: captured by the track but never sent.
    stats.forEach((r) => {
      if (r.type === 'media-source' && r.kind === 'video') {
        const sent = [...stats.values()].find((o) => o.type === 'outbound-rtp' && o.kind === 'video');
        if (sent && typeof r.frames === 'number' && typeof sent.framesSent === 'number') framesDropped = Math.max(0, r.frames - sent.framesSent);
      }
    });
    return { bitrateKbps, fps, rttMs, framesDropped, backgrounded: document.visibilityState === 'hidden' };
  };
}
