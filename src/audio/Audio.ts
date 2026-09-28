import { AUDIO } from '../config';

/**
 * Procedural audio with the Web Audio API. Every sound is synthesised at runtime (no files):
 *  - ambience: waves, wind in the palms, jungle insects, bird calls, positional waterfall roar
 *  - music: generative pentatonic flute over soft hand drums
 *  - effects: UI clicks, chopping, building, splashes, bird flaps and more
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private waves!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private insects!: GainNode;
  private fall!: GainNode;
  private fallPanner!: PannerNode;
  private last = new Map<string, number>();
  private nextBeat = 0;
  private beat = 0;
  private phrase: number[] = [];
  private birdTimer = 2;
  volume: number = AUDIO.masterVolume;
  music: number = 0.5;
  muted = false;
  /** Listener context set each frame by the game. */
  listener = { x: 0, y: 0, z: 0, zoom: 60, coast: 0, forest: 0, wind: 1, night: 0, rain: 0 };
  waterfall: { x: number; y: number; z: number } | null = null;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.4);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.35;
    this.reverb.connect(revGain).connect(this.master);
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.ambBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);
    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.startAmbience();
    this.nextBeat = ctx.currentTime + 0.5;
    this.applyVolumes();
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.1);
    this.musicBus.gain.setTargetAtTime(AUDIO.musicVolume * this.music * 2, t, 0.3);
    this.ambBus.gain.setTargetAtTime(AUDIO.ambientVolume, t, 0.3);
    this.sfxBus.gain.setTargetAtTime(AUDIO.sfxVolume, t, 0.1);
  }

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private impulse(sec: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    return buf;
  }

  private loopSource(buf: AudioBuffer): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 2);
    return s;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Waves: brown noise swelling slowly.
    const wv = this.loopSource(this.brown);
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 700;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.35;
    lfo.connect(lfoG).connect(swell.gain);
    lfo.start();
    this.waves = ctx.createGain();
    this.waves.gain.value = 0;
    wv.connect(wf).connect(swell).connect(this.waves).connect(this.ambBus);
    // Wind in the palms.
    const wn = this.loopSource(this.noise);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 900;
    this.windFilter.Q.value = 0.6;
    const gust = ctx.createGain();
    gust.gain.value = 0.5;
    const glfo = ctx.createOscillator();
    glfo.frequency.value = 0.07;
    const glfoG = ctx.createGain();
    glfoG.gain.value = 0.4;
    glfo.connect(glfoG).connect(gust.gain);
    glfo.start();
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    wn.connect(this.windFilter).connect(gust).connect(this.wind).connect(this.ambBus);
    // Insects: high trills with tremolo.
    this.insects = ctx.createGain();
    this.insects.gain.value = 0;
    this.insects.connect(this.ambBus);
    for (const [f, trem] of [[4300, 23], [5200, 31], [3700, 17]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const am = ctx.createGain();
      am.gain.value = 0;
      const t = ctx.createOscillator();
      t.type = 'square';
      t.frequency.value = trem;
      const tg = ctx.createGain();
      tg.gain.value = 0.012;
      t.connect(tg).connect(am.gain);
      o.connect(am).connect(this.insects);
      o.start();
      t.start();
    }
    // Waterfall roar, positioned in 3D.
    const fn = this.loopSource(this.noise);
    const ff = ctx.createBiquadFilter();
    ff.type = 'lowpass';
    ff.frequency.value = 1400;
    this.fall = ctx.createGain();
    this.fall.gain.value = 0;
    this.fallPanner = ctx.createPanner();
    this.fallPanner.panningModel = 'HRTF';
    this.fallPanner.distanceModel = 'inverse';
    this.fallPanner.refDistance = 5;
    this.fallPanner.rolloffFactor = 1.6;
    this.fallPanner.maxDistance = 200;
    fn.connect(ff).connect(this.fall).connect(this.fallPanner).connect(this.ambBus);
  }

  // ---------------- Music ----------------

  private scale = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 784.0]; // D minor pentatonic

  private flute(freq: number, t: number, dur: number, vel: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = freq * 0.006;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.12);
    g.gain.setTargetAtTime(0.06 * vel, t + 0.15, 0.3);
    g.gain.setTargetAtTime(0, t + dur, 0.35);
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    // Breathy noise on the attack.
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = freq * 2;
    nf.Q.value = 3;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.02 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(nf).connect(ng).connect(this.musicBus);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.musicBus);
    o.start(t);
    o2.start(t);
    vib.start(t);
    n.start(t, Math.random());
    const end = t + dur + 1.6;
    o.stop(end);
    o2.stop(end);
    vib.stop(end);
    n.stop(t + 0.3);
  }

  private drum(t: number, low: boolean, vel: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(low ? 95 : 180, t);
    o.frequency.exponentialRampToValueAtTime(low ? 48 : 110, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 0.5 : 0.25));
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.6);
  }

  private shaker(t: number, vel: number): void {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(f).connect(g).connect(this.musicBus);
    n.start(t, Math.random());
    n.stop(t + 0.1);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const spb = 60 / 74 / 2; // eighth notes at 74 bpm
    while (this.nextBeat < ctx.currentTime + 0.4) {
      const t = this.nextBeat;
      const b = this.beat % 32;
      const night = this.listener.night;
      if (b % 8 === 0) this.drum(t, true, 0.8);
      if (b % 8 === 3 || b % 8 === 6) this.drum(t, false, 0.45);
      if (b % 2 === 1) this.shaker(t, 0.6 + Math.random() * 0.3);
      if (b === 0) {
        // New phrase: a gentle walk through the scale.
        this.phrase = [];
        let idx = Math.floor(Math.random() * 4) + 1;
        for (let k = 0; k < 8; k++) {
          idx = Math.max(0, Math.min(this.scale.length - 1, idx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
          this.phrase.push(Math.random() < 0.3 ? -1 : idx);
        }
      }
      if (b % 4 === 0 && this.phrase.length) {
        const note = this.phrase[(b / 4) | 0];
        if (note >= 0 && Math.random() < 0.85) this.flute(this.scale[note] * (night > 0.5 ? 0.5 : 1), t, spb * (Math.random() < 0.4 ? 6 : 3), 0.9);
      }
      this.nextBeat += spb;
      this.beat++;
    }
  }

  // ---------------- Effects ----------------

  /** Play a named effect, optionally positioned in the world (quieter with distance and zoom). */
  sfx(name: string, x?: number, z?: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const minGap: Record<string, number> = { chop: 0.12, mine: 0.12, build: 0.1, sculpt: 0.09, drop: 0.1, flap: 0.15, mark: 0.05, splash: 0.2, bark: 0.12, growl: 0.5, yelp: 0.3 };
    const lastT = this.last.get(name) ?? 0;
    if (now - lastT < (minGap[name] ?? 0.03)) return;
    this.last.set(name, now);
    let vol = 1;
    if (x !== undefined && z !== undefined) {
      const d = Math.hypot(x - this.listener.x, z - this.listener.z);
      const hear = AUDIO.hearingRadius * (0.6 + this.listener.zoom / 120);
      vol = Math.max(0, 1 - d / hear) * Math.max(0.15, 1 - this.listener.zoom / 220);
      if (vol < 0.02) return;
    }
    const t = now + 0.005;
    const tone = (type: OscillatorType, f0: number, f1: number, dur: number, g0: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(g0 * vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.sfxBus);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    const burst = (type: BiquadFilterType, f: number, q: number, dur: number, g0: number, f1?: number, delay = 0) => {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.frequency.setValueAtTime(f, t + delay);
      if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
      fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + delay);
      g.gain.exponentialRampToValueAtTime(g0 * vol, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
      n.connect(fl).connect(g).connect(this.sfxBus);
      n.start(t + delay, Math.random() * 2);
      n.stop(t + delay + dur + 0.05);
    };
    switch (name) {
      case 'click': tone('sine', 900, 620, 0.07, 0.12); break;
      case 'select': tone('sine', 660, 660, 0.08, 0.1); setTimeout(() => this.ready && tone('sine', 990, 990, 0.1, 0.08), 60); break;
      case 'deny': tone('square', 160, 120, 0.18, 0.05); break;
      case 'place': tone('sine', 160, 70, 0.25, 0.35); burst('lowpass', 800, 1, 0.2, 0.2); break;
      case 'chop': burst('bandpass', 1400, 2, 0.09, 0.35); tone('triangle', 220, 140, 0.1, 0.25); break;
      case 'mine': tone('sine', 1900, 1700, 0.12, 0.12); tone('sine', 2750, 2600, 0.09, 0.07); burst('highpass', 3000, 1, 0.05, 0.1); break;
      case 'build': tone('triangle', 420, 300, 0.07, 0.22); burst('bandpass', 900, 3, 0.05, 0.12); break;
      case 'treefall': burst('lowpass', 500, 1, 0.9, 0.35, 120); tone('sine', 90, 45, 0.6, 0.4); break;
      case 'drop': tone('sine', 260, 160, 0.12, 0.18); break;
      case 'harvest': burst('bandpass', 2600, 1.5, 0.25, 0.12); break;
      case 'splash': burst('lowpass', 3000, 0.8, 0.5, 0.3, 300); burst('bandpass', 1500, 2, 0.3, 0.15, undefined, 0.08); break;
      case 'flap': for (let k = 0; k < 4; k++) burst('bandpass', 1100, 1.2, 0.05, 0.12, undefined, k * 0.06); break;
      case 'sculpt': burst('lowpass', 260, 1, 0.22, 0.28, 90); break;
      case 'mark': tone('sine', 1300, 1500, 0.05, 0.06); break;
      case 'complete':
        [0, 2, 4, 7].forEach((k, i) => setTimeout(() => this.ready && this.flute(this.scale[Math.min(7, k)] * 1, ctx.currentTime, 0.3, 0.8 * vol), i * 110));
        break;
      case 'milestone':
        [0, 2, 4, 5, 7].forEach((k, i) => setTimeout(() => this.ready && this.flute(this.scale[k] * 1, ctx.currentTime, 0.5, 1), i * 140));
        this.drum(t, true, 1);
        break;
      case 'bigsplash':
        burst('lowpass', 2500, 0.7, 1.6, 0.6, 180);
        tone('sine', 110, 40, 0.9, 0.5);
        burst('bandpass', 1200, 1.5, 1.1, 0.3, undefined, 0.12);
        break;
      case 'blow': burst('bandpass', 900, 0.8, 0.9, 0.25, 400); break;
      case 'whale': {
        // Low, gliding humpback call.
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(260, t);
        o.frequency.exponentialRampToValueAtTime(170, t + 1.4);
        o.frequency.exponentialRampToValueAtTime(230, t + 2.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12 * vol, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
        o.connect(g).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 2.7);
        break;
      }
      case 'thunder': burst('lowpass', 300, 0.7, 3.2, 0.9, 60); tone('sine', 55, 30, 2.5, 0.5); break;
      // A dog's short "ruff": a rasping bandpassed burst over a quick falling tone.
      case 'bark': tone('square', 480 + Math.random() * 120, 260, 0.09, 0.08); burst('bandpass', 950, 2.5, 0.09, 0.3); break;
      // Jaguar: a low rasping rumble.
      case 'growl': burst('lowpass', 280, 3, 0.75, 0.3, 160); tone('sawtooth', 82, 64, 0.7, 0.05); break;
      case 'yelp': tone('triangle', 1450, 650, 0.2, 0.12); break;
    }
  }

  // ---------------- Per frame ----------------

  update(dt: number): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const L = this.listener;
    const t = ctx.currentTime;
    const zoomFade = Math.max(0.25, 1 - L.zoom / 260);
    this.waves.gain.setTargetAtTime((0.12 + L.coast * 0.45) * zoomFade + L.rain * 0.1, t, 0.5);
    this.wind.gain.setTargetAtTime(Math.min(0.9, (0.05 + L.wind * 0.07 + L.zoom / 900) * (0.6 + L.forest * 0.5)), t, 0.6);
    this.windFilter.frequency.setTargetAtTime(700 + L.wind * 250, t, 0.8);
    const insect = (0.25 + L.forest * 0.8) * (0.5 + L.night * 1.2) * zoomFade * (1 - L.rain * 0.7);
    this.insects.gain.setTargetAtTime(insect * 0.6, t, 0.8);
    // Listener sits at the camera target so positional sounds pan naturally.
    const ls = ctx.listener;
    if (ls.positionX) {
      ls.positionX.setTargetAtTime(L.x, t, 0.1);
      ls.positionY.setTargetAtTime(L.y + L.zoom * 0.3, t, 0.1);
      ls.positionZ.setTargetAtTime(L.z, t, 0.1);
    } else ls.setPosition(L.x, L.y + L.zoom * 0.3, L.z);
    if (this.waterfall) {
      const f = this.waterfall;
      if (this.fallPanner.positionX) {
        this.fallPanner.positionX.value = f.x;
        this.fallPanner.positionY.value = f.y;
        this.fallPanner.positionZ.value = f.z;
      } else this.fallPanner.setPosition(f.x, f.y, f.z);
      this.fall.gain.setTargetAtTime(1.6, t, 0.5);
    }
    this.scheduleMusic();
    // Jungle birdsong during the day.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 0.8 + Math.random() * 3;
      if (L.night < 0.5 && L.rain < 0.5) this.birdCall(L.forest * zoomFade);
    }
  }

  private birdCall(vol: number): void {
    if (vol < 0.05) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.01;
    const base = 1800 + Math.random() * 1800;
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.ambBus);
    for (let k = 0; k < notes; k++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const s = t + k * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.3), s);
      o.frequency.exponentialRampToValueAtTime(base * (0.7 + Math.random() * 0.8), s + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05 * vol, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.08);
      o.connect(g).connect(pan);
      o.start(s);
      o.stop(s + 0.1);
    }
  }
}
