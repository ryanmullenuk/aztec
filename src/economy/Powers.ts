import * as THREE from 'three';
import { POWERS, isFarm } from '../config';
import { BuildingSystem } from '../buildings/Buildings';
import { FX } from '../render/materials';
import { Lighting } from '../render/Lighting';
import { Lightning } from '../render/Lightning';
import { SEA_SURFACE, Water } from '../water/Water';
import { GameTime } from '../world/Time';
import { Economy } from './Economy';
import { RainField } from '../render/RainField';

const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();

export type WeatherState = 'clear' | 'rain' | 'storm';

/**
 * Weather (clear / rain / storm) and the god powers that use Belief:
 * bless crops, summon rain and calm storms.
 */
export class Powers {
  readonly group = new THREE.Group();
  state: WeatherState = 'clear';
  /** Random rain and storms (the player's own rain still works when this is off). */
  randomWeather = true;
  private timer = 0;
  /** Smoothed 0..1 intensities. */
  rainAmt = 0;
  stormAmt = 0;
  private rain = new RainField();
  private sparkles: THREE.Points;
  private sparkPos: Float32Array;
  private sparkLife: Float32Array;
  private sparkVel: Float32Array;
  private nextSpark = 0;
  /** Soft sheet lightning inside the clouds (no bolt). */
  private flash = 0;
  private flashTarget = 0;
  /** Real seconds to the next lightning strike during a storm. */
  private strikeTimer = 3;
  private bolt = new Lightning();
  /** Thunder on its way after a flash: seconds left (0 = empty slot), and near or far. */
  private thunderT = new Float32Array(4);
  private thunderNear = new Uint8Array(4);
  /** Night at the last update (null before the first), for the dusk and dawn weather rolls. */
  private wasNight: boolean | null = null;
  /** Game seconds until a storm that has been rolled for arrives (-1 = none coming). */
  private stormDelay = -1;
  /** The camera: lightning strikes where it can be seen. */
  camera: THREE.Camera | null = null;
  /** Is (x, z) open, deep sea well away from any coast? Lightning only ever strikes there. */
  isOpenSea: (x: number, z: number) => boolean = () => false;
  /** A new storm has begun: return true if the village was told (else the default warning shows). */
  onStormStart: () => boolean = () => false;
  /** The storm is over: it blew itself out, the weather was switched off, or the player calmed it. */
  onStormEnd: (calmed: boolean) => void = () => {};
  /** Thunder reaches the listener (a sharp crack when the strike was near). */
  onThunder: (near: boolean) => void = () => {};
  notify: (t: string, kind?: 'info' | 'warn') => void = () => {};

  constructor(private eco: Economy, private bld: BuildingSystem, private lighting: Lighting, private water: Water, private time: GameTime, private rnd: () => number) {
    this.group.add(this.rain.lines);

    const n = 300;
    const sg = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(n * 3);
    this.sparkLife = new Float32Array(n);
    this.sparkVel = new Float32Array(n * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,250,210,1)');
      gr.addColorStop(0.4, 'rgba(255,215,120,0.8)');
      gr.addColorStop(1, 'rgba(255,200,80,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 32, 32);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.sparkles = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.5, map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2, 1.6, 0.8) }));
    this.sparkles.frustumCulled = false;
    this.group.add(this.sparkles);
    this.group.add(this.bolt.group);
  }

  get raining(): boolean {
    return this.state !== 'clear';
  }

  // ---------------- Powers ----------------

  bless(x: number, z: number): void {
    const farms = this.bld.list.filter((f) => f.complete && isFarm(f.key)).filter((f) => Math.hypot(f.x - x, f.z - z) < POWERS.bless.radius + 2);
    if (!farms.length) return this.notify('No farms here to bless.', 'warn');
    if (!this.eco.spend({ wood: 0, stone: 0, belief: POWERS.bless.cost })) return this.notify('Not enough Belief.', 'warn');
    for (const f of farms) {
      f.blessTimer = POWERS.bless.duration;
      for (let k = 0; k < 40; k++) this.spark(f.x + (this.rnd() - 0.5) * f.w, f.y + 0.2, f.z + (this.rnd() - 0.5) * f.d);
    }
    this.notify(`${farms.length} farm${farms.length > 1 ? 's' : ''} blessed: crops grow faster.`);
  }

  summonRain(): void {
    if (this.state !== 'clear') return this.notify('It is already raining.', 'warn');
    if (!this.eco.spend({ wood: 0, stone: 0, belief: POWERS.rain.cost })) return this.notify('Not enough Belief.', 'warn');
    this.state = 'rain';
    this.timer = POWERS.rain.duration;
    this.notify('Rain falls on the island.');
  }

  calm(): void {
    if (this.state !== 'storm') return this.notify('There is no storm to calm.', 'warn');
    if (!this.eco.spend({ wood: 0, stone: 0, belief: POWERS.calm.cost })) return this.notify('Not enough Belief.', 'warn');
    this.notify('The storm is calmed. The people rejoice.');
    this.endWeather(true);
  }

  /** A storm rolls in (or, if one is already raging, it lasts a while longer). */
  startStorm(): void {
    const fresh = this.state !== 'storm';
    this.state = 'storm';
    this.stormDelay = -1;
    this.timer = POWERS.stormDuration[0] + this.rnd() * (POWERS.stormDuration[1] - POWERS.stormDuration[0]);
    if (!fresh) return;
    this.strikeTimer = 2 + this.rnd() * 2;
    if (!this.onStormStart()) this.notify('A storm rolls in from the sea. Use Calm (7) to settle it.', 'warn');
  }

  /** Clear skies at once (random weather was switched off). */
  clearWeather(): void {
    this.stormDelay = -1;
    if (this.state !== 'clear') this.endWeather(false);
  }

  private endWeather(calmed: boolean): void {
    const was = this.state;
    this.state = 'clear';
    this.timer = 0;
    if (was === 'storm') this.onStormEnd(calmed);
  }

  /** Random weather: storms mostly roll in after dusk; by day rain is likelier and storms are rare. */
  private rollWeather(dusk: boolean): void {
    const wet = this.time.seasonIndex === 2 ? 1.4 : 1;
    const [d0, d1] = dusk ? POWERS.nightStormDelay : POWERS.dayStormDelay;
    if (this.state !== 'storm' && this.rnd() < (dusk ? POWERS.stormChancePerNight : POWERS.stormChancePerDay) * wet) {
      this.stormDelay = d0 + this.rnd() * (d1 - d0);
    } else if (!dusk && this.state === 'clear' && this.rnd() < POWERS.rainChancePerDay[this.time.seasonIndex]) {
      this.state = 'rain';
      this.timer = 60 + this.rnd() * 90;
    }
  }

  /** A lightning strike on open sea in view (or, failing that, a flicker inside the clouds). */
  private lightning(camTarget: THREE.Vector3): void {
    const cam = this.camera;
    if (cam && this.rnd() > 0.18) {
      _fwd.set(camTarget.x - cam.position.x, 0, camTarget.z - cam.position.z);
      const base = Math.atan2(_fwd.z, _fwd.x);
      for (let k = 0; k < 16; k++) {
        // Mostly out ahead of the view (beyond the camera target), 15-60 units off; then wider.
        const a = base + (this.rnd() - 0.5) * (k < 10 ? 2.4 : 4.4);
        const d = k < 10 ? 15 + this.rnd() * 45 : 40 + this.rnd() * 50;
        const x = camTarget.x + Math.cos(a) * d, z = camTarget.z + Math.sin(a) * d;
        if (!this.isOpenSea(x, z)) continue;
        _p.set(x, SEA_SURFACE, z).project(cam);
        const inView = Math.abs(_p.x) < 0.92 && _p.y > -0.95 && _p.y < 0.85 && _p.z < 1;
        if (!inView && k < 14) continue;
        const y = SEA_SURFACE + this.water.waveHeight(x, z, this.time.elapsed);
        const dist = cam.position.distanceTo(_p.set(x, y + 10, z));
        this.bolt.strike(x, y, z, 25 + this.rnd() * 10, cam.position, this.rnd, THREE.MathUtils.clamp(1.25 - dist / 160, 0.45, 1));
        // Thunder follows the flash, later the further off it struck.
        this.queueThunder(0.2 + dist / 75 + this.rnd() * 0.2, dist < 55);
        return;
      }
    }
    // Sheet lightning: a soft glow swelling inside the clouds, and a distant rumble.
    this.flashTarget = 0.3 + this.rnd() * 0.35;
    this.queueThunder(1.2 + this.rnd() * 1.8, false);
  }

  private queueThunder(delay: number, near: boolean): void {
    for (let i = 0; i < this.thunderT.length; i++) {
      if (this.thunderT[i] > 0) continue;
      this.thunderT[i] = delay;
      this.thunderNear[i] = near ? 1 : 0;
      return;
    }
  }

  private spark(x: number, y: number, z: number): void {
    const i = this.nextSpark;
    this.nextSpark = (this.nextSpark + 1) % this.sparkLife.length;
    this.sparkPos.set([x, y, z], i * 3);
    this.sparkVel.set([(this.rnd() - 0.5) * 0.4, 0.6 + this.rnd() * 0.8, (this.rnd() - 0.5) * 0.4], i * 3);
    this.sparkLife[i] = 1.5 + this.rnd();
  }

  // ---------------- Update ----------------

  update(dt: number, realDt: number, camTarget: THREE.Vector3): void {
    // Dusk and dawn: roll for the night's (or the day's) weather.
    const night = this.time.isNight;
    if (this.wasNight !== null && night !== this.wasNight && this.randomWeather) this.rollWeather(night);
    this.wasNight = night;
    if (!this.randomWeather) this.stormDelay = -1;
    if (this.stormDelay >= 0) {
      this.stormDelay -= dt;
      if (this.stormDelay < 0 && this.state !== 'storm') this.startStorm();
    }
    if (this.state !== 'clear') {
      this.timer -= dt;
      if (this.timer <= 0) this.endWeather(false);
    }
    const k = Math.min(1, realDt * 0.8);
    this.rainAmt += ((this.state === 'clear' ? 0 : this.state === 'rain' ? 0.6 : 1) - this.rainAmt) * k;
    this.stormAmt += ((this.state === 'storm' ? 1 : 0) - this.stormAmt) * k;
    this.lighting.overcast = Math.min(1, this.rainAmt * 0.5 + this.stormAmt * 0.45);
    FX.uWind.value = 1 + this.rainAmt * 0.6 + this.stormAmt * 2.2;
    this.water.shared.uStorm.value = this.stormAmt;

    // Lightning during storms: a forked bolt on the open sea every few seconds.
    if (this.state === 'storm' && this.stormAmt > 0.6 && !this.time.paused) {
      this.strikeTimer -= realDt;
      if (this.strikeTimer <= 0) {
        this.strikeTimer = 2.5 + this.rnd() * 5;
        this.lightning(camTarget);
      }
    }
    for (let i = 0; i < this.thunderT.length; i++) {
      if (this.thunderT[i] <= 0) continue;
      this.thunderT[i] -= realDt;
      if (this.thunderT[i] <= 0) {
        this.thunderT[i] = 0;
        this.onThunder(this.thunderNear[i] === 1);
      }
    }
    // Sheet lightning swells over a fraction of a second and fades; a bolt flickers sharply.
    this.flash += (this.flashTarget - this.flash) * Math.min(1, realDt * 7);
    this.flashTarget = Math.max(0, this.flashTarget - realDt * 3.5);
    const boltLight = this.bolt.update(realDt, this.lighting.state.day, this.lighting.flash);
    this.lighting.flash = Math.min(1.4, this.flash + boltLight);

    this.rain.update(realDt, this.rainAmt, this.stormAmt);
    // Blessing sparkles; blessed farms keep twinkling.
    for (const f of this.bld.list) {
      if (f.complete && f.blessTimer > 0 && isFarm(f.key) && this.rnd() < realDt * 6) this.spark(f.x + (this.rnd() - 0.5) * f.w, f.y + 0.3, f.z + (this.rnd() - 0.5) * f.d);
    }
    for (let i = 0; i < this.sparkLife.length; i++) {
      if (this.sparkLife[i] <= 0) {
        this.sparkPos[i * 3 + 1] = -100;
        continue;
      }
      this.sparkLife[i] -= realDt;
      for (let a = 0; a < 3; a++) this.sparkPos[i * 3 + a] += this.sparkVel[i * 3 + a] * realDt;
    }
    (this.sparkles.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}
