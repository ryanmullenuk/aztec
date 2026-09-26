import * as THREE from 'three';
import { POWERS } from '../config';
import { BuildingSystem } from '../buildings/Buildings';
import { FX } from '../render/materials';
import { Lighting } from '../render/Lighting';
import { Water } from '../water/Water';
import { GameTime } from '../world/Time';
import { Economy } from './Economy';

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
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainN = 1400;
  private sparkles: THREE.Points;
  private sparkPos: Float32Array;
  private sparkLife: Float32Array;
  private sparkVel: Float32Array;
  private nextSpark = 0;
  private lastDay = -1;
  private flash = 0;
  private flashTimer = 5;
  onThunder: () => void = () => {};
  notify: (t: string, kind?: 'info' | 'warn') => void = () => {};

  constructor(private eco: Economy, private bld: BuildingSystem, private lighting: Lighting, private water: Water, private time: GameTime, private rnd: () => number) {
    // Rain: short falling streaks around the camera target.
    const g = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(this.rainN * 6);
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfe4f5, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 16;
    this.group.add(this.rain);
    for (let i = 0; i < this.rainN; i++) this.resetDrop(i, 0, 0, 0, true);

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
  }

  private resetDrop(i: number, cx: number, cy: number, cz: number, randomY: boolean): void {
    const r = 40;
    const x = cx + (this.rnd() - 0.5) * r * 2, z = cz + (this.rnd() - 0.5) * r * 2;
    const y = cy + (randomY ? this.rnd() * 30 : 30);
    this.rainPos.set([x, y, z, x + 0.15, y + 0.9, z + 0.05], i * 6);
  }

  get raining(): boolean {
    return this.state !== 'clear';
  }

  // ---------------- Powers ----------------

  bless(x: number, z: number): void {
    const farms = this.bld.of('farm').filter((f) => Math.hypot(f.x - x, f.z - z) < POWERS.bless.radius + 2);
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
    this.state = 'clear';
    this.timer = 0;
    this.notify('The storm is calmed. The sun returns.');
  }

  startStorm(): void {
    this.state = 'storm';
    this.timer = POWERS.stormDuration[0] + this.rnd() * (POWERS.stormDuration[1] - POWERS.stormDuration[0]);
    this.notify('A storm rolls in from the sea. Use Calm (9) to settle it.', 'warn');
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
    // New day: roll for weather.
    if (this.time.day !== this.lastDay) {
      if (this.lastDay >= 0 && this.state === 'clear' && this.randomWeather) {
        const r = this.rnd();
        if (r < POWERS.stormChancePerDay * (this.time.seasonIndex === 2 ? 1.5 : 1)) this.startStorm();
        else if (r < POWERS.stormChancePerDay + POWERS.rainChancePerDay[this.time.seasonIndex]) {
          this.state = 'rain';
          this.timer = 60 + this.rnd() * 90;
        }
      }
      this.lastDay = this.time.day;
    }
    if (this.state !== 'clear') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'clear';
    }
    const k = Math.min(1, realDt * 0.8);
    this.rainAmt += ((this.state === 'clear' ? 0 : this.state === 'rain' ? 0.6 : 1) - this.rainAmt) * k;
    this.stormAmt += ((this.state === 'storm' ? 1 : 0) - this.stormAmt) * k;
    this.lighting.overcast = Math.min(1, this.rainAmt * 0.5 + this.stormAmt * 0.45);
    FX.uWind.value = 1 + this.rainAmt * 0.6 + this.stormAmt * 2.2;
    this.water.shared.uStorm.value = this.stormAmt;

    // Lightning during storms.
    if (this.stormAmt > 0.5) {
      this.flashTimer -= realDt;
      if (this.flashTimer <= 0) {
        this.flashTimer = 9 + this.rnd() * 14;
        this.flash = 1;
        setTimeout(() => this.onThunder(), 300 + this.rnd() * 900);
      }
    }
    this.flash = Math.max(0, this.flash - realDt * 4);
    // A soft brightening, not a full-screen white flash.
    this.lighting.ambient.intensity += this.flash * 0.9;

    // Rain streaks follow the camera.
    const mat = this.rain.material as THREE.LineBasicMaterial;
    mat.opacity = this.rainAmt * 0.7;
    this.rain.visible = this.rainAmt > 0.02;
    if (this.rain.visible) {
      const fall = (14 + this.stormAmt * 8) * realDt;
      const wind = (1 + this.stormAmt * 4) * realDt;
      for (let i = 0; i < this.rainN; i++) {
        const o = i * 6;
        this.rainPos[o + 1] -= fall;
        this.rainPos[o + 4] -= fall;
        this.rainPos[o] += wind;
        this.rainPos[o + 3] += wind;
        if (this.rainPos[o + 1] < camTarget.y - 2 || Math.abs(this.rainPos[o] - camTarget.x) > 45 || Math.abs(this.rainPos[o + 2] - camTarget.z) > 45) this.resetDrop(i, camTarget.x, camTarget.y, camTarget.z, false);
      }
      (this.rain.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // Blessing sparkles; blessed farms keep twinkling.
    for (const f of this.bld.of('farm')) {
      if (f.blessTimer > 0 && this.rnd() < realDt * 6) this.spark(f.x + (this.rnd() - 0.5) * f.w, f.y + 0.3, f.z + (this.rnd() - 0.5) * f.d);
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
