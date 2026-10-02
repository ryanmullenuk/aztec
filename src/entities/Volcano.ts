import * as THREE from 'three';
import { World } from '../world/World';
import { RNG } from '../world/rng';

export type VolcanoPhase = 'dormant' | 'smoking' | 'erupting' | 'cooling';
export interface VolcanoSave { x: number; z: number; phase: VolcanoPhase; remaining: number; cycle: number; coolingHot?: boolean }
export const VOLCANO_COST = 50;
export const VOLCANO_HAPPINESS = 0.15;

/** Simulation timer is persisted; decorative animation never consumes the game's random stream. */
export class VolcanoCycle {
  phase: VolcanoPhase = 'dormant';
  remaining = 150;
  cycle = 0;
  coolingHot = false;
  constructor(private seed: number, saved?: VolcanoSave) {
    if (saved && ['dormant', 'smoking', 'erupting', 'cooling'].includes(saved.phase)
      && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= 900) {
      this.phase = saved.phase; this.remaining = saved.remaining;
      this.coolingHot = saved.coolingHot === true;
      this.cycle = Number.isSafeInteger(saved.cycle) && saved.cycle >= 0 ? saved.cycle : 0;
    }
  }
  get active(): boolean { return this.phase === 'smoking' || this.phase === 'erupting'; }
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.remaining -= dt;
    while (this.remaining <= 0) {
      if (this.phase === 'dormant') { this.phase = 'smoking'; this.remaining += 35; }
      else if (this.phase === 'smoking') { this.phase = 'erupting'; this.remaining += 65; }
      else if (this.phase === 'erupting') { this.coolingHot = true; this.phase = 'cooling'; this.remaining += 25; }
      else {
        this.phase = 'dormant'; this.cycle++;
        this.remaining += new RNG(this.seed + this.cycle * 7919).range(240, 480);
      }
    }
  }
  calm(pay: (cost: number) => boolean): boolean {
    if (!this.active || !pay(VOLCANO_COST)) return false;
    this.coolingHot = this.phase === 'erupting';
    this.phase = 'cooling'; this.remaining = 25;
    return true;
  }
}

export class Volcano {
  readonly group = new THREE.Group();
  readonly state: VolcanoCycle;
  readonly x: number;
  readonly z: number;
  readonly radius = 8;
  private age = 0;
  private lava: THREE.Group;
  private pool: THREE.Mesh;
  private smoke: THREE.Mesh[] = [];
  private streams: THREE.Mesh[] = [];
  private bubbles: THREE.Mesh[] = [];
  private readonly glow = new THREE.MeshStandardMaterial({ color: 0xff6b13, emissive: 0xff3800, emissiveIntensity: 2.7, roughness: 0.7 });
  notify: (message: string) => void = () => {};

  constructor(w: World, saved?: VolcanoSave) {
    this.state = new VolcanoCycle(w.seed, saved);
    // Prefer the broad inland crown of island two, clear of existing buildings and landmarks.
    let best = -Infinity, site = -1;
    for (let i = 0; i < w.layer.length; i++) {
      if (w.isle[i] !== 2 || w.layer[i] < 2 || w.distWater[i] < 9) continue;
      const cx = i % w.N, cz = Math.floor(i / w.N);
      let clear = true;
      for (let dz = -9; dz <= 9 && clear; dz++) for (let dx = -9; dx <= 9; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) { clear = false; break; }
        const j = w.idx(cx + dx, cz + dz);
        if (w.occ[j] || w.blockFixed[j] || w.layer[j] < 1) { clear = false; break; }
      }
      const score = w.layer[i] * 2 + w.distWater[i];
      if (clear && score > best) { best = score; site = i; }
    }
    const savedSite = saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) ? w.cellIndexAt(saved.x, saved.z) : -1;
    if (savedSite >= 0 && w.isle[savedSite] === 2 && w.layer[savedSite] >= 1) site = savedSite;
    this.x = site >= 0 ? w.centerX(site % w.N) : 0;
    this.z = site >= 0 ? w.centerZ(Math.floor(site / w.N)) : 0;
    this.group.visible = site >= 0;
    this.group.name = 'Second island volcano';
    let y = site >= 0 ? w.heightAt(this.x, this.z) : 0;
    if (site >= 0) for (let n = 0; n < 24; n++) {
      const a = n * Math.PI / 12;
      y = Math.min(y, w.heightAt(this.x + Math.cos(a) * 8, this.z + Math.sin(a) * 8));
    }
    this.group.position.set(this.x, y, this.z);
    if (site >= 0) w.blockCircle(this.x, this.z, this.radius + 0.8);
    const stone = new THREE.MeshStandardMaterial({ color: 0x514841, roughness: 1, flatShading: true });
    // Open tapered cone with a thick crater rim and a recessed glowing lake.
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 8, 10, 15, 4, true), stone);
    cone.position.y = 4.6; cone.castShadow = true; cone.receiveShadow = true;
    this.group.add(cone);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.48, 4, 15), stone);
    rim.rotation.x = Math.PI / 2; rim.position.y = 9.55; rim.castShadow = true;
    this.group.add(rim);
    const interior = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.35, 1.4, 15, 1, true), new THREE.MeshStandardMaterial({ color: 0x261a17, side: THREE.DoubleSide, roughness: 1 }));
    interior.position.y = 8.9; this.group.add(interior);
    this.lava = new THREE.Group(); this.group.add(this.lava);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(1.85, 24).rotateX(-Math.PI / 2), this.glow);
    this.pool.position.y = 9.08; this.lava.add(this.pool);
    const bubbleGeo = new THREE.IcosahedronGeometry(0.22, 1);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(bubbleGeo, this.glow); this.bubbles.push(b); this.lava.add(b);
    }
    for (let k = 0; k < 4; k++) {
      const angle = k * Math.PI / 2 + 0.35;
      const pts: THREE.Vector3[] = [];
      for (let n = 0; n <= 12; n++) {
        const f = n / 12, r = 2.2 + f * 5.8, a = angle + Math.sin(f * 9 + k) * 0.045;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 9.68 - f * 9.7, Math.sin(a) * r));
      }
      const stream = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.16 + k * 0.025, 5, false), this.glow);
      this.streams.push(stream); this.lava.add(stream);
    }
    const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: 0x777777, transparent: true, opacity: 0, depthWrite: false, roughness: 1 }));
      this.smoke.push(m); this.group.add(m);
    }
    this.animate(0);
  }
  save(): VolcanoSave | undefined {
    return this.group.visible ? { x: this.x, z: this.z, phase: this.state.phase, remaining: this.state.remaining, cycle: this.state.cycle, coolingHot: this.state.coolingHot } : undefined;
  }
  update(dt: number): void {
    if (!this.group.visible) return;
    const previous = this.state.phase;
    this.state.update(dt); this.age += dt;
    if (previous !== this.state.phase && this.state.phase === 'smoking')
      this.notify('Grey smoke rises from the volcano. Use Calm on the volcano for 50 Belief to reassure your people.');
    if (previous !== this.state.phase && this.state.phase === 'erupting')
      this.notify('The volcano is erupting! Lava is spilling down its slopes. Use Calm for 50 Belief.');
    this.animate(dt);
  }
  private animate(_dt: number): void {
    const phase = this.state.phase, t = this.age;
    const cooling = phase === 'cooling' ? Math.min(1, this.state.remaining / 25) : 0;
    const strength = phase === 'erupting' ? 1 : this.state.coolingHot ? cooling : 0;
    this.lava.visible = strength > 0;
    this.glow.emissiveIntensity = strength * (2.4 + Math.sin(t * 4) * 0.3);
    this.glow.color.setRGB(0.12 + strength * 0.88, 0.035 + strength * 0.3, 0.015);
    this.pool.position.y = 9.08 + Math.sin(t * 2) * 0.07 * strength;
    this.bubbles.forEach((b, i) => {
      const a = i * 2.4, r = 0.5 + (i % 3) * 0.4;
      b.position.set(Math.cos(a) * r, 9.04 + Math.max(0, Math.sin(t * 2.5 + i)) * 0.35 * strength, Math.sin(a) * r);
      b.scale.setScalar(0.6 + Math.max(0, Math.sin(t * 2.5 + i)) * 0.65);
    });
    this.streams.forEach((m, i) => {
      // Fill each ribbon downhill as the overflow begins.
      const progress = phase === 'erupting' ? Math.min(1, (65 - this.state.remaining) / 15) : cooling;
      m.geometry.setDrawRange(0, Math.floor(progress * 24) * 5 * 6);
      m.visible = progress > 0 && (i === 0 || strength > 0.3);
    });
    this.smoke.forEach((m, i) => {
      const f = ((t * 0.07 + i / 18) % 1);
      m.position.set(f * 3 + Math.sin(i * 2) * f, 9.7 + f * 12, Math.cos(i * 3) * f * 1.5);
      m.scale.setScalar(0.45 + f * 2.3);
      const material = m.material as THREE.MeshStandardMaterial;
      material.opacity = (this.state.active ? 0.48 : cooling * 0.25) * Math.sin(Math.PI * f);
      m.visible = material.opacity > 0.01;
    });
  }
}
