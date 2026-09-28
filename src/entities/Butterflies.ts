import * as THREE from 'three';
import { patchStylised } from '../render/materials';
import { View } from '../render/View';
import { Plant, PlantState } from '../vegetation/Vegetation';
import { SEA_SURFACE } from '../water/Water';
import { RNG } from '../world/rng';
import { World } from '../world/World';

/** Tuning for the butterflies. */
export const BUTTERFLIES = {
  /** Simulate and draw only butterflies this close to the camera. */
  drawDistance: 75,
  /** Beyond this camera distance they are drawn a little larger so they still read as specks of colour. */
  growFrom: 40,
  /** Scatter from the cursor within this ground distance. */
  fleeRadius: 1.1,
  /** Flight height above the ground. */
  altMin: 0.16,
  altMax: 0.8,
};

/** Species tints (the wing pattern darkens the tips and edges): blue morpho, monarch, sulphur, white, red. */
const SPECIES: { col: number; w: number; size: number }[] = [
  { col: 0x2f86ff, w: 1.1, size: 1.18 },
  { col: 0xff7a12, w: 1.3, size: 1.05 },
  { col: 0xffd21e, w: 1.2, size: 0.9 },
  { col: 0xf6f3ea, w: 0.9, size: 0.88 },
  { col: 0xe3222c, w: 0.8, size: 1.0 },
];

const enum S {
  Fly = 0,
  Approach = 1,
  Perched = 2,
}

interface Home {
  x: number;
  z: number;
  /** Loose radius they flutter within. */
  r: number;
  /** Bushes to land on (checked alive when landing). */
  bushes: Plant[];
  /** Ground spots (flowers, low plants) to land on. */
  spots: number[];
}

interface Fly {
  home: Home;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  turn: number;
  /** Noise phase (per butterfly) and wing-beat phase and rate. */
  ph: number;
  beat: number;
  rate: number;
  wing: number;
  state: S;
  timer: number;
  flee: number;
  px: number;
  py: number;
  pz: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function wrap(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/**
 * One butterfly in its own frame (body along +z, wings in the xz plane spreading along ±x, 0.1
 * wingspan). `aWing` marks wing vertices (±1 forewing, ±2 hindwing, 0 body) so the vertex shader
 * can hinge them about the body by the per-instance `aFlap` angle.
 */
function butterflyGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], wing: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: number, w: number) => {
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    col.push(c, c, c);
    wing.push(w);
  };
  // Wing outlines [x, z, shade] from the root round to the root, with an inner centre vertex.
  const fore: [number, number, number][] = [[0.003, 0.006, 0.7], [0.02, 0.024, 0.85], [0.046, 0.026, 0.12], [0.05, 0.012, 0.2], [0.034, -0.002, 0.75], [0.004, -0.001, 0.7]];
  const hind: [number, number, number][] = [[0.003, -0.001, 0.7], [0.03, -0.002, 0.85], [0.036, -0.016, 0.6], [0.024, -0.03, 0.22], [0.01, -0.028, 0.7], [0.003, -0.012, 0.7]];
  const wingFan = (o: [number, number, number][], cx: number, cz: number, side: number, id: number) => {
    for (let k = 0; k < o.length; k++) {
      const a = o[k], b = o[(k + 1) % o.length];
      push(cx * side, 0, cz, 0, 1, 0, 1, id * side);
      push(a[0] * side, 0, a[1], 0, 1, 0, a[2], id * side);
      push(b[0] * side, 0, b[1], 0, 1, 0, b[2], id * side);
    }
  };
  for (const side of [1, -1]) {
    wingFan(fore, 0.024, 0.012, side, 1);
    wingFan(hind, 0.018, -0.014, side, 2);
  }
  // Slim body and a small head.
  const body = new THREE.OctahedronGeometry(1, 0);
  body.applyMatrix4(new THREE.Matrix4().makeScale(0.0045, 0.0045, 0.021).setPosition(0, 0.001, -0.005));
  const head = new THREE.OctahedronGeometry(0.0042, 0);
  head.translate(0, 0.002, 0.018);
  for (const g of [body, head]) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let k = 0; k < p.count; k++) push(p.getX(k), p.getY(k), p.getZ(k), n.getX(k), n.getY(k), n.getZ(k), 0.1, 0);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  return geo;
}

function butterflyMaterial(): THREE.MeshStandardMaterial {
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }), 0.5);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWing;\nattribute float aFlap;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float bfA = aFlap * (abs(aWing) > 1.5 ? 0.86 : 1.0);
        float bfS = sign(aWing);
        if (aWing != 0.0) objectNormal = vec3(-bfS * sin(bfA), cos(bfA), 0.0);`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        if (aWing != 0.0) transformed = vec3(position.x * cos(bfA), abs(position.x) * sin(bfA) + position.y, position.z);`
      );
    // A touch of self-glow so the colours stay vivid in shade (none at night).
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.14 * (1.0 - uNight);');
  };
  mat.customProgramCacheKey = () => 'butterfly';
  return mat;
}

/**
 * Low-poly butterflies (blue morphos, monarchs, sulphurs, whites and reds) fluttering in erratic
 * loops round flowering bushes, forest edges and the meadow rim, now and then settling on a bush
 * or a flower with their wings slowly opening and closing. They scatter from the cursor, and
 * vanish at night and in the rain. One instanced mesh draws them all; the wings hinge in the
 * vertex shader from a per-instance flap angle. Only those near the camera simulate, and only
 * those on screen are drawn.
 */
export class Butterflies {
  readonly mesh: THREE.InstancedMesh;
  private list: Fly[] = [];
  private flap: Float32Array;
  private flapAttr: THREE.InstancedBufferAttribute;
  private colors: Float32Array;
  private rng: RNG;
  private t = 0;
  /** 0..1: how many are out (daylight, no rain), eased. */
  private presence = 1;

  constructor(private world: World, bushes: Plant[], count: number) {
    this.rng = new RNG(world.seed * 977 + 311);
    this.spawn(bushes, count);
    const n = Math.max(1, this.list.length);
    const geo = butterflyGeometry();
    this.flap = new Float32Array(n);
    this.flapAttr = new THREE.InstancedBufferAttribute(this.flap, 1);
    this.flapAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', this.flapAttr);
    this.mesh = new THREE.InstancedMesh(geo, butterflyMaterial(), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new Float32Array(n * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = 0;
  }

  get count(): number {
    return this.list.length;
  }

  private groundOk(i: number): boolean {
    const w = this.world;
    return i >= 0 && w.isLandCell(i) && w.sandy[i] < 0.45 && w.rocky[i] < 0.5 && w.swamp[i] < 0.4 && !w.occ[i] && !w.blocked(i);
  }

  private spawn(bushes: Plant[], count: number): void {
    const w = this.world, rng = this.rng, N = w.N;
    const alive = bushes.filter((p) => p.state === PlantState.Alive && this.groundOk(p.cell));
    const flowering = alive.filter((p) => p.kind === 'flowerbush');
    // Open ground at woodland edges and round the meadow rim.
    const edge: number[] = [];
    const m = w.meadow;
    for (let cz = 2; cz < N - 2; cz++) {
      for (let cx = 2; cx < N - 2; cx++) {
        const i = cz * N + cx;
        if (!this.groundOk(i)) continue;
        const f = w.forest[i];
        const dm = Math.hypot(w.centerX(cx) - m.x, w.centerZ(cz) - m.z);
        if ((f > 0.15 && f < 0.6) || (dm > m.r - 3 && dm < m.r + 5)) edge.push(i);
      }
    }
    const homes: Home[] = [];
    const tooClose = (x: number, z: number) => homes.some((h) => (h.x - x) * (h.x - x) + (h.z - z) * (h.z - z) < 9);
    let placed = 0;
    for (let tries = 0; tries < 4000 && placed < count; tries++) {
      let x: number, z: number;
      const r = rng.next();
      if (r < 0.5 && flowering.length) {
        const p = rng.pick(flowering);
        x = p.x;
        z = p.z;
      } else if (r < 0.65 && alive.length) {
        const p = rng.pick(alive);
        x = p.x;
        z = p.z;
      } else if (edge.length) {
        const i = rng.pick(edge);
        x = w.centerX(i % N) + rng.range(-0.4, 0.4);
        z = w.centerZ(Math.floor(i / N)) + rng.range(-0.4, 0.4);
      } else break;
      if (tooClose(x, z)) continue;
      const home: Home = { x, z, r: rng.range(1.2, 2.6), bushes: [], spots: [] };
      for (const p of alive) {
        if (home.bushes.length >= 4) break;
        if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < 12) home.bushes.push(p);
      }
      for (let k = 0; k < 8 && home.spots.length < 6; k++) {
        const a = rng.range(0, Math.PI * 2), d = rng.range(0, home.r);
        const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
        if (this.groundOk(w.cellIndexAt(sx, sz))) home.spots.push(sx, sz);
      }
      homes.push(home);
      // A few per patch, often of one kind.
      const n = Math.min(count - placed, rng.int(1, 3));
      let sp = this.pickSpecies();
      for (let k = 0; k < n; k++) {
        if (k > 0 && rng.chance(0.4)) sp = this.pickSpecies();
        this.add(home, sp);
        placed++;
      }
    }
  }

  private pickSpecies(): number {
    const tot = SPECIES.reduce((s, k) => s + k.w, 0);
    let r = this.rng.next() * tot;
    for (let k = 0; k < SPECIES.length; k++) if ((r -= SPECIES[k].w) <= 0) return k;
    return 0;
  }

  private add(home: Home, sp: number): void {
    const rng = this.rng, w = this.world;
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, home.r);
    const x = home.x + Math.cos(a) * d, z = home.z + Math.sin(a) * d;
    const c = new THREE.Color(SPECIES[sp].col).offsetHSL(rng.range(-0.015, 0.015), 0, rng.range(-0.05, 0.04));
    this.list.push({
      home, x, z, y: w.heightAt(x, z) + rng.range(0.2, 0.6), heading: rng.range(0, Math.PI * 2), speed: rng.range(0.45, 0.75), turn: 0,
      ph: rng.range(0, 100), beat: rng.range(0, 6.28), rate: rng.range(16, 22), wing: 0.5,
      state: S.Fly, timer: rng.range(1, 10), flee: 0, px: 0, py: 0, pz: 0,
      size: SPECIES[sp].size * rng.range(0.88, 1.12), r: c.r, g: c.g, b: c.b,
    });
  }

  /** Choose somewhere to land near home: the top of a bush, or a flower at ground level. */
  private pickPerch(f: Fly): boolean {
    const h = f.home, w = this.world, rng = this.rng;
    if (h.bushes.length && rng.chance(0.55)) {
      const p = h.bushes[Math.floor(rng.next() * h.bushes.length)];
      if (p.state === PlantState.Alive && !w.occ[p.cell]) {
        const a = rng.range(0, Math.PI * 2), d = rng.range(0, 0.18) * p.scale;
        f.px = p.x + Math.cos(a) * d;
        f.pz = p.z + Math.sin(a) * d;
        f.py = p.y + (0.86 - d * 0.8) * p.scale;
        return true;
      }
    }
    if (h.spots.length) {
      const k = Math.floor(rng.next() * (h.spots.length / 2)) * 2;
      const x = h.spots[k], z = h.spots[k + 1];
      const i = w.cellIndexAt(x, z);
      if (this.groundOk(i) && !w.path[i] && w.soil[i] < 0.05 && w.wear[i] < 0.3) {
        f.px = x;
        f.pz = z;
        f.py = w.heightAt(x, z) + rng.range(0.1, 0.17);
        return true;
      }
    }
    return false;
  }

  /**
   * dt: game step (frozen while paused); realDt: wall-clock step (for fading); day: 0 night .. 1
   * daylight; cursor: the ground point under the pointer, or null.
   */
  update(dt: number, realDt: number, day: number, raining: boolean, cursor: THREE.Vector3 | null): void {
    const want = raining ? 0 : THREE.MathUtils.smoothstep(day, 0.3, 0.6);
    this.presence += (want - this.presence) * Math.min(1, realDt * 0.5);
    if (this.presence < 0.02) {
      this.mesh.visible = false;
      this.mesh.count = 0;
      return;
    }
    this.mesh.visible = true;
    const step = Math.min(dt, realDt * 1.2, 0.1);
    this.t += step;
    const t = this.t, rng = this.rng;
    const far2 = BUTTERFLIES.drawDistance * BUTTERFLIES.drawDistance;
    const fr2 = BUTTERFLIES.fleeRadius * BUTTERFLIES.fleeRadius;
    const arr = this.mesh.instanceMatrix.array as Float32Array;
    const cols = this.colors, flap = this.flap;
    // Fade in and out by shrinking, staggered so they come and go one by one.
    const pres = this.presence;
    let n = 0;
    for (let k = 0; k < this.list.length; k++) {
      const f = this.list[k];
      const d2 = View.dist2(f.x, f.y, f.z);
      if (d2 > far2) continue;
      const out = THREE.MathUtils.clamp(pres * 2.2 - ((k * 0.618) % 1) * 1.2, 0, 1);
      if (out <= 0) continue;
      if (step > 0) this.step(f, step, t, rng, cursor, fr2);
      if (!View.sees(f.x, f.y, f.z, 0.1)) continue;
      // Pose.
      const perched = f.state === S.Perched;
      const bob = perched ? 0 : Math.sin(f.beat) * 0.012;
      _p.set(f.x, f.y + bob, f.z);
      const pitch = perched ? -0.08 : -0.3 + Math.cos(f.beat) * 0.08;
      const roll = perched ? 0 : THREE.MathUtils.clamp(-f.turn * 0.07, -0.55, 0.55);
      _e.set(pitch, f.heading, roll);
      _q.setFromEuler(_e);
      const grow = Math.min(1.8, Math.max(1, Math.sqrt(d2) / BUTTERFLIES.growFrom));
      _s.setScalar(f.size * grow * out);
      _m.compose(_p, _q, _s);
      _m.toArray(arr, n * 16);
      cols[n * 3] = f.r;
      cols[n * 3 + 1] = f.g;
      cols[n * 3 + 2] = f.b;
      flap[n] = f.wing;
      n++;
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor!.needsUpdate = true;
      this.flapAttr.needsUpdate = true;
    }
  }

  private step(f: Fly, dt: number, t: number, rng: RNG, cursor: THREE.Vector3 | null, fr2: number): void {
    const w = this.world, h = f.home;
    // Scatter from the cursor.
    if (cursor && f.flee <= 0) {
      const cx = f.x - cursor.x, cz = f.z - cursor.z;
      if (cx * cx + cz * cz < fr2) {
        f.flee = rng.range(1.2, 1.8);
        f.heading = Math.atan2(cx, cz) + rng.range(-0.5, 0.5);
        f.state = S.Fly;
        f.timer = rng.range(3, 7);
      }
    }
    if (f.state === S.Perched) {
      // Wings slowly opening and closing; now and then a shuffle round.
      const target = Math.min(1.5, 0.85 + 0.65 * Math.sin(t * 1.1 + f.ph));
      f.wing += (target - f.wing) * Math.min(1, dt * 6);
      f.turn = 0;
      if (Math.sin(t * 0.3 + f.ph * 1.7) > 0.995) f.heading += dt * 2;
      f.timer -= dt;
      if (f.timer <= 0) {
        f.state = S.Fly;
        f.timer = rng.range(4, 12);
        f.y += 0.02;
      }
      return;
    }
    const ph = f.ph;
    f.beat += dt * f.rate * (f.flee > 0 ? 1.4 : 1);
    // Erratic loops: a wandering turn rate built from a few sines.
    let turn = (Math.sin(t * 1.1 + ph) * 1.8 + Math.sin(t * 2.9 + ph * 1.7) * 1.3 + Math.sin(t * 0.37 + ph * 3.1) * 1.4) * 1.3;
    const i = w.cellIndexAt(f.x, f.z);
    const overLand = i >= 0 && w.isLandCell(i);
    let targetY: number;
    const ground = Math.max(w.heightAt(f.x, f.z), SEA_SURFACE);
    if (f.state === S.Approach) {
      const dx = f.px - f.x, dz = f.pz - f.z, d = Math.hypot(dx, dz);
      turn = turn * 0.25 + wrap(Math.atan2(dx, dz) - f.heading) * 5;
      const k = Math.min(1, d / 1.2);
      targetY = f.py + (ground + 0.35 - f.py) * k * k;
      f.timer -= dt;
      if (d < 0.05 && Math.abs(f.y - f.py) < 0.06) {
        f.state = S.Perched;
        f.x = f.px;
        f.y = f.py;
        f.z = f.pz;
        f.timer = rng.range(3, 10);
        return;
      }
      if (f.timer <= 0) {
        f.state = S.Fly;
        f.timer = rng.range(3, 8);
      }
      f.speed = 0.35 + 0.35 * k;
    } else {
      // Stay round home, and never wander out over the sea.
      const dx = h.x - f.x, dz = h.z - f.z, d = Math.hypot(dx, dz);
      if (d > h.r || !overLand) turn += wrap(Math.atan2(dx, dz) - f.heading) * Math.min(4, (d - h.r) * 1.5 + (overLand ? 0 : 4));
      if (f.flee > 0) {
        f.flee -= dt;
        turn *= 0.3;
      }
      const alt = BUTTERFLIES.altMin + (BUTTERFLIES.altMax - BUTTERFLIES.altMin) * (0.5 + 0.3 * Math.sin(t * 0.53 + ph * 2.3) + 0.2 * Math.sin(t * 1.7 + ph));
      targetY = ground + alt + (f.flee > 0 ? 0.5 : 0) + (i >= 0 && w.occ[i] ? 0.9 : 0);
      f.timer -= dt;
      if (f.timer <= 0) {
        if (f.flee <= 0 && rng.chance(0.6) && this.pickPerch(f)) {
          f.state = S.Approach;
          f.timer = 7;
        } else f.timer = rng.range(3, 8);
      }
      f.speed = (0.45 + 0.25 * Math.sin(ph * 3.3)) * (f.flee > 0 ? 2.4 : 1);
    }
    f.heading = wrap(f.heading + turn * dt);
    f.turn = turn;
    // Short surges on each downstroke.
    const surge = 0.7 + 0.5 * Math.max(0, Math.sin(f.beat));
    f.x += Math.sin(f.heading) * f.speed * surge * dt;
    f.z += Math.cos(f.heading) * f.speed * surge * dt;
    f.y += (targetY - f.y) * Math.min(1, dt * (f.state === S.Approach ? 4 : 2.2));
    if (f.y < ground + 0.05) f.y = ground + 0.05;
    // Wing beat, with the odd short glide on flat wings.
    const glide = f.flee <= 0 && f.state === S.Fly && Math.sin(t * 0.8 + ph * 1.9) > 0.85;
    f.wing = glide ? 0.2 + 0.08 * Math.sin(f.beat * 0.3) : 0.45 + 0.95 * Math.sin(f.beat);
  }
}
