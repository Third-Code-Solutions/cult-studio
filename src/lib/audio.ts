import { bridge, call } from './bridge';

/**
 * Audio mixer: mic and desktop (system loopback) through their own gain nodes into one MediaStream track.
 * The output track always exists, so publishing never waits on a device; with nothing connected it is silence.
 * shortcut: video-file and capture-window audio are not mixed in; add a gain per source if creators ask.
 */
class Mixer {
  private ctx = new AudioContext({ latencyHint: 'interactive' });
  private dest = this.ctx.createMediaStreamDestination();
  private micGain = this.ctx.createGain();
  private deskGain = this.ctx.createGain();
  private analyser = this.ctx.createAnalyser();
  private buf = new Float32Array(1024);
  private mic: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
  private desk: { stream: MediaStream; node: MediaStreamAudioSourceNode } | null = null;
  private micVolume = 1;
  private muted = false;

  constructor() {
    this.analyser.fftSize = 1024;
    this.micGain.connect(this.dest);
    this.micGain.connect(this.analyser);
    this.deskGain.connect(this.dest);
  }

  get track(): MediaStreamTrack {
    void this.ctx.resume();
    return this.dest.stream.getAudioTracks()[0]!;
  }

  get hasMic() {
    return !!this.mic;
  }
  get hasDesktop() {
    return !!this.desk;
  }

  async startMic(): Promise<void> {
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.micGain);
    this.mic = { stream, node };
    void this.ctx.resume();
  }

  setMicMuted(m: boolean): void {
    this.muted = m;
    this.micGain.gain.value = m ? 0 : this.micVolume;
  }

  setMicVolume(v: number): void {
    this.micVolume = v;
    if (!this.muted) this.micGain.gain.value = v;
  }

  setDesktopVolume(v: number): void {
    this.deskGain.gain.value = v;
  }

  /** System audio via Windows loopback. Main process answers this one getDisplayMedia call with audio:'loopback'. */
  async startDesktop(): Promise<void> {
    if (this.desk) return;
    await call(bridge().chooseDesktopAudio());
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => t.stop()); // only the audio is used
    if (!stream.getAudioTracks().length) throw new Error('Desktop audio isn’t available on this computer.');
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.deskGain);
    this.desk = { stream, node };
    void this.ctx.resume();
  }

  stopDesktop(): void {
    this.desk?.node.disconnect();
    this.desk?.stream.getTracks().forEach((t) => t.stop());
    this.desk = null;
  }

  /** Mic level 0..1 (RMS after mute/volume), for the meter. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.buf.length) * 4);
  }
}

export const mixer = new Mixer();
