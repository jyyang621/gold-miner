type Scene = 'menu' | 'game' | 'shop' | 'silent';
type SoundName = 'launch' | 'grab' | 'coin' | 'rock' | 'bomb' | 'win' | 'lose' | 'click' | 'tick';

interface PlayingVoice {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
}

/** Small synthesized soundtrack: no downloads and no autoplay before a user gesture. */
export class GameAudio {
  private soundEnabled: boolean;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private scene: Scene = 'menu';
  private musicTimer: number | null = null;
  private beat = 0;
  private voices = new Set<PlayingVoice>();
  private disposed = false;

  constructor(enabled = true) {
    this.soundEnabled = enabled;
  }

  get enabled(): boolean {
    return this.soundEnabled;
  }

  set enabled(value: boolean) {
    this.setEnabled(value);
  }

  /** Call directly from a pointer/key handler. This is the only place that resumes audio. */
  unlock(): void {
    if (this.disposed || !this.soundEnabled) return;
    try {
      if (!this.context) {
        const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
        const AudioContextClass = window.AudioContext ?? audioWindow.webkitAudioContext;
        if (!AudioContextClass) return;
        this.context = new AudioContextClass();
        this.master = this.context.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(this.context.destination);
        this.context.onstatechange = () => {
          if (this.context?.state === 'running') this.startMusic();
          else this.stopAll();
        };
      }
      const context = this.context;
      if (context.state === 'suspended') {
        void context.resume().then(() => {
          if (!this.disposed) this.startMusic();
        }).catch(() => { /* Audio remains optional if the browser blocks it. */ });
      } else if (context.state === 'running') {
        this.startMusic();
      }
    } catch {
      // Browsers without usable audio still have a fully playable game.
    }
  }

  setEnabled(value: boolean): void {
    this.soundEnabled = value;
    if (!value) this.stopAll();
    else this.startMusic();
  }

  setScene(scene: Scene): void {
    if (this.scene === scene) {
      this.startMusic();
      return;
    }
    this.stopAll();
    this.scene = scene;
    this.beat = 0;
    this.startMusic();
  }

  play(name: SoundName): void {
    if (!this.canPlay()) return;
    switch (name) {
      case 'launch':
        this.tone(410, 0.14, 'triangle', 0.28, 0, 175);
        this.noise(0.09, 0.13, 2400);
        break;
      case 'grab':
        this.tone(190, 0.075, 'triangle', 0.38, 0, 110);
        this.tone(510, 0.08, 'sine', 0.2, 0.03);
        break;
      case 'coin':
        [784, 1047, 1568].forEach((frequency, index) => {
          this.tone(frequency, 0.18, 'sine', 0.28, index * 0.055);
        });
        break;
      case 'rock':
        this.noise(0.15, 0.35, 900);
        this.tone(100, 0.13, 'triangle', 0.32, 0, 64);
        break;
      case 'bomb':
        this.noise(0.48, 0.7, 1350);
        this.tone(135, 0.4, 'sine', 0.8, 0, 34);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((frequency, index) => {
          this.tone(frequency, 0.32, 'triangle', 0.28, index * 0.11);
        });
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((frequency, index) => {
          this.tone(frequency, 0.28, 'triangle', 0.25, index * 0.13);
        });
        break;
      case 'click':
        this.tone(660, 0.055, 'sine', 0.19, 0, 880);
        break;
      case 'tick':
        this.tone(880, 0.045, 'sine', 0.15);
        break;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAll();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => { /* Already closed by the browser. */ });
    }
    this.master?.disconnect();
    this.context = null;
    this.master = null;
  }

  private canPlay(): boolean {
    return !this.disposed && this.soundEnabled && this.scene !== 'silent'
      && this.context?.state === 'running' && this.master !== null;
  }

  private startMusic(): void {
    if (!this.canPlay() || this.musicTimer !== null) return;
    // Gentle pentatonic phrases stay under the sound effects.
    this.musicTimer = window.setInterval(() => this.musicBeat(), this.scene === 'shop' ? 320 : 390);
  }

  private musicBeat(): void {
    if (!this.canPlay()) {
      this.stopAll();
      return;
    }
    const phrases: Record<Exclude<Scene, 'silent'>, number[]> = {
      menu: [0, 4, 7, 9, 7, 4, 2, -1, 0, 4, 7, 12, 9, 7, 4, -1],
      game: [0, -1, 7, 9, 7, -1, 4, 2, 0, -1, 4, 7, 9, 7, 4, -1],
      shop: [7, 9, 12, -1, 9, 7, 4, -1, 4, 7, 9, 12, 9, 7, 4, -1],
    };
    if (this.scene === 'silent') return;
    const phrase = phrases[this.scene];
    const note = phrase[this.beat % phrase.length];
    if (note !== -1) this.tone(261.63 * 2 ** (note / 12), 0.26, 'triangle', 0.047);
    if (this.beat % 4 === 0) {
      const bass = this.beat % 16 < 8 ? 130.81 : 98;
      this.tone(bass, 0.48, 'sine', 0.07);
      this.tone(bass * 1.5, 0.4, 'sine', 0.025);
    }
    this.beat += 1;
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number,
    delay = 0, endFrequency?: number): void {
    if (!this.canPlay()) return;
    const context = this.context!;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.012, duration / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master!);
    this.track(oscillator, [envelope]);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(duration: number, volume: number, cutoff: number): void {
    if (!this.canPlay()) return;
    const context = this.context!;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const envelope = context.createGain();
    const start = context.currentTime;
    envelope.gain.setValueAtTime(volume, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master!);
    this.track(source, [filter, envelope]);
    source.start(start);
    source.stop(start + duration);
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    const voice = { source, nodes };
    this.voices.add(voice);
    source.onended = () => {
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
      this.voices.delete(voice);
    };
  }

  private stopAll(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* A source may have just ended. */ }
      voice.source.disconnect();
      voice.nodes.forEach((node) => node.disconnect());
    }
    this.voices.clear();
  }
}
