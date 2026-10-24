import { buildKorobeiniki, midiToFreq, type NoteEvent, type Song } from './KorobeinikiArrangement';

export type SfxName =
  | 'move'
  | 'rotate'
  | 'lock'
  | 'hardDrop'
  | 'hold'
  | 'clear'
  | 'tspin'
  | 'tetris'
  | 'mega'
  | 'perfect'
  | 'giant'
  | 'levelUp'
  | 'gameOver';

export interface AudioSettings {
  bgmVolume: number;
  sfxVolume: number;
  bgmMuted: boolean;
  sfxMuted: boolean;
}

const LOOKAHEAD_S = 0.15;
const SCHEDULER_MS = 25;
/** 同じ効果音を連打したときの最小間隔（ARR 移動音の重なり防止） */
const SFX_MIN_GAP_S: Partial<Record<SfxName, number>> = { move: 0.025, rotate: 0.02 };

/**
 * Web Audio API による BGM / 効果音。すべてその場で合成し、音源ファイルは使わない。
 * AudioContext はユーザー操作後の ensure() で初めて生成する（自動再生制限対応）。
 * 生成に失敗してもゲームは無音で動作する。
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bgmGain!: GainNode;
  private sfxGain!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private bgmBus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextStepTime = 0;
  private bpm: number;
  private readonly song: Song = buildKorobeiniki();
  private lastPlayed: Partial<Record<SfxName, number>> = {};
  private pulseWave: PeriodicWave | null = null;
  private suspendedByGame = false;

  constructor(private settings: AudioSettings) {
    this.bpm = this.song.baseBpm;
  }

  get available(): boolean {
    return this.ctx !== null;
  }

  /** ユーザー操作のハンドラ内から呼ぶ。 */
  ensure(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.suspendedByGame) void this.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.bgmGain = ctx.createGain();
      this.sfxGain = ctx.createGain();
      this.bgmGain.connect(this.master);
      this.sfxGain.connect(this.master);
      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      // 25% デューティのパルス波（A2 パートの音色）
      const n = 32;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
      this.pulseWave = ctx.createPeriodicWave(real, imag);
      this.applySettings(this.settings);
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  applySettings(s: AudioSettings): void {
    this.settings = { ...s };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.setTargetAtTime(s.bgmMuted ? 0 : s.bgmVolume * 0.45, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(s.sfxMuted ? 0 : s.sfxVolume * 0.7, t, 0.02);
  }

  /** レベルに応じて少しずつテンポを上げる */
  setLevel(level: number): void {
    this.bpm = Math.min(this.song.baseBpm + (level - 1) * 4, 200);
  }

  // ---- BGM ----

  startBgm(): void {
    if (!this.ensure() || !this.ctx) return;
    this.stopBgm();
    const bus = this.ctx.createGain();
    bus.connect(this.bgmGain);
    this.bgmBus = bus;
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), SCHEDULER_MS);
    this.schedule();
  }

  stopBgm(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const bus = this.bgmBus;
    this.bgmBus = null;
    if (bus && this.ctx) {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      setTimeout(() => bus.disconnect(), 400);
    }
  }

  /** ポーズ: 予約済みの音も含めて止める */
  suspend(): void {
    if (!this.ctx) return;
    this.suspendedByGame = true;
    void this.ctx.suspend().catch(() => {});
  }

  resume(): void {
    if (!this.ctx) return;
    this.suspendedByGame = false;
    void this.ctx.resume().catch(() => {});
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bgmBus || ctx.state !== 'running') return;
    // 処理が遅れて過去の時刻に溜まった場合は追いかけずに今から再開
    if (this.nextStepTime < ctx.currentTime - 0.05) this.nextStepTime = ctx.currentTime + 0.02;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      const stepDur = 60 / this.bpm / 2;
      for (const ev of this.song.byStep[this.step]) this.playNote(ev, this.nextStepTime, stepDur);
      this.nextStepTime += stepDur;
      this.step = (this.step + 1) % this.song.length;
    }
  }

  private playNote(ev: NoteEvent, t: number, stepDur: number): void {
    const ctx = this.ctx!;
    const out = this.bgmBus!;
    const dur = ev.len * stepDur;
    switch (ev.voice) {
      case 'lead':
      case 'lead2': {
        const f = midiToFreq(ev.midi);
        const g = this.env(t, 0.005, dur * 0.88, 0.13 * ev.vel, 0.05, out);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = ev.voice === 'lead' ? 3200 : 4200;
        lp.connect(g);
        const o1 = ctx.createOscillator();
        if (ev.voice === 'lead2' && this.pulseWave) o1.setPeriodicWave(this.pulseWave);
        else o1.type = 'square';
        o1.frequency.value = f;
        const o2 = ctx.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.value = f;
        o2.detune.value = 8;
        const g2 = ctx.createGain();
        g2.gain.value = 0.35;
        o1.connect(lp);
        o2.connect(g2).connect(lp);
        // ほんのりビブラート
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 5.5;
        const lfoGain = ctx.createGain();
        lfoGain.gain.setValueAtTime(0, t);
        lfoGain.gain.linearRampToValueAtTime(dur > 0.4 ? 6 : 0, t + Math.min(dur, 0.3));
        lfo.connect(lfoGain);
        lfoGain.connect(o1.detune);
        lfoGain.connect(o2.detune);
        for (const o of [o1, o2, lfo]) {
          o.start(t);
          o.stop(t + dur + 0.1);
        }
        break;
      }
      case 'harm':
        this.osc('triangle', midiToFreq(ev.midi), t, dur * 0.85, 0.12 * ev.vel, out);
        break;
      case 'bass': {
        const g = this.env(t, 0.004, dur * 0.8, 0.22 * ev.vel, 0.03, out);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        lp.connect(g);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midiToFreq(ev.midi);
        const o2 = ctx.createOscillator();
        o2.type = 'square';
        o2.frequency.value = midiToFreq(ev.midi);
        const g2 = ctx.createGain();
        g2.gain.value = 0.18;
        o.connect(lp);
        o2.connect(g2).connect(lp);
        o.start(t);
        o2.start(t);
        o.stop(t + dur + 0.05);
        o2.stop(t + dur + 0.05);
        break;
      }
      case 'arp':
        this.osc('sine', midiToFreq(ev.midi + 12), t, Math.min(dur, 0.12), 0.07 * ev.vel, out);
        break;
      case 'kick': {
        const g = this.env(t, 0.002, 0.08, 0.5 * ev.vel, 0.08, out);
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        o.connect(g);
        o.start(t);
        o.stop(t + 0.2);
        break;
      }
      case 'snare':
        this.noise(t, 0.12, 0.22 * ev.vel, 'bandpass', 1900, out);
        this.osc('triangle', 210, t, 0.05, 0.08 * ev.vel, out);
        break;
      case 'hat':
        this.noise(t, 0.035, 0.1 * ev.vel, 'highpass', 7500, out);
        break;
    }
  }

  // ---- 合成ヘルパー ----

  private env(t: number, attack: number, hold: number, peak: number, release: number, out: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, hold * 0.3));
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.5, 0.0002), t + Math.max(attack + 0.001, hold));
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold + release);
    g.connect(out);
    return g;
  }

  private osc(
    type: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    gain: number,
    out: AudioNode,
    endFreq?: number,
  ): void {
    const ctx = this.ctx!;
    const g = this.env(t, 0.004, dur, gain, 0.04, out);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.08);
  }

  private noise(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private arpeggio(notes: number[], t: number, gap: number, dur: number, gain: number, type: OscillatorType): void {
    notes.forEach((m, i) => this.osc(type, midiToFreq(m), t + i * gap, dur, gain, this.sfxGain));
  }

  // ---- 効果音 ----

  play(name: SfxName, arg = 0): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.settings.sfxMuted) return;
    const t = ctx.currentTime + 0.005;
    const gap = SFX_MIN_GAP_S[name];
    if (gap && t - (this.lastPlayed[name] ?? -1) < gap) return;
    this.lastPlayed[name] = t;
    const out = this.sfxGain;

    switch (name) {
      case 'move':
        this.osc('square', 1250, t, 0.018, 0.05, out);
        break;
      case 'rotate':
        this.osc('triangle', 700, t, 0.045, 0.12, out, 1100);
        break;
      case 'lock':
        this.osc('sine', 190, t, 0.06, 0.25, out, 90);
        this.noise(t, 0.04, 0.08, 'lowpass', 1800, out);
        break;
      case 'hardDrop':
        this.osc('sine', 160, t, 0.11, 0.45, out, 45);
        this.noise(t, 0.08, 0.2, 'lowpass', 2500, out);
        break;
      case 'hold':
        this.osc('triangle', 520, t, 0.05, 0.14, out);
        this.osc('triangle', 780, t + 0.05, 0.06, 0.14, out);
        break;
      case 'clear': {
        const n = Math.max(1, Math.min(arg, 3));
        this.arpeggio([76, 79, 83, 88].slice(0, n + 1), t, 0.045, 0.1, 0.13, 'square');
        this.noise(t, 0.18, 0.06, 'highpass', 5000, out);
        break;
      }
      case 'tetris':
        this.arpeggio([72, 76, 79, 84, 88, 91], t, 0.04, 0.14, 0.13, 'square');
        this.noise(t, 0.3, 0.08, 'highpass', 4000, out);
        break;
      case 'mega':
        this.arpeggio([60, 64, 67, 72, 76, 79, 84, 88, 91, 96], t, 0.035, 0.18, 0.13, 'sawtooth');
        this.osc('sine', 80, t, 0.5, 0.4, out, 40);
        this.noise(t, 0.5, 0.12, 'bandpass', 3000, out);
        break;
      case 'tspin':
        this.osc('sawtooth', 300, t, 0.18, 0.12, out, 1400);
        this.arpeggio([79, 83, 86, 91], t + 0.12, 0.05, 0.12, 0.12, 'square');
        break;
      case 'perfect':
        this.arpeggio([72, 76, 79, 84, 79, 84, 88, 91, 96], t, 0.07, 0.25, 0.12, 'triangle');
        this.arpeggio([84, 88, 91, 96], t + 0.63, 0.0, 0.6, 0.06, 'square');
        break;
      case 'giant':
        this.osc('sawtooth', 70, t, 0.35, 0.22, out, 280);
        this.osc('square', 140, t + 0.05, 0.3, 0.08, out, 560);
        this.arpeggio([57, 64, 69], t + 0.18, 0.0, 0.35, 0.08, 'square');
        this.noise(t, 0.35, 0.1, 'bandpass', 900, out);
        break;
      case 'levelUp':
        this.arpeggio([69, 73, 76, 81], t, 0.06, 0.1, 0.12, 'square');
        break;
      case 'gameOver':
        this.arpeggio([76, 72, 69, 64, 60, 57, 52], t, 0.12, 0.2, 0.14, 'triangle');
        this.osc('sawtooth', 220, t, 1.0, 0.08, out, 55);
        break;
    }
  }
}
