import * as THREE from 'three';
import { JELLYFISH } from '../config';
import { View } from '../render/View';
import { Water } from '../water/Water';
import { landDistance } from '../world/mapEdge';
import { RNG } from '../world/rng';
import { World } from '../world/World';

// ---------------- Model (bell radius 1, bell up along +y) ----------------
// A moon-jelly: a scalloped, translucent dome with four horseshoe gonads showing through it, four
// frilly oral arms hanging from its middle and a fringe of fine tentacles round the rim. Parts are
// tagged (aPart: 0 bell, 1 arm, 2 tentacle) with how far along they are (aAlong: bell crown to rim,
// or root to tip) and their angle round the bell (aAng), so the shader can pulse and wave them.

function jellyGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], part: number[] = [], along: number[] = [], ang: number[] = [], idx: number[] = [];
  const vert = (x: number, y: number, z: number, p: number, s: number, a: number) => {
    pos.push(x, y, z);
    part.push(p);
    along.push(s);
    ang.push(a);
    return pos.length / 3 - 1;
  };
  // Bell: a flattened dome with a scalloped, slightly in-curled margin.
  const SEG = 24, RINGS = 9, TH = 1.34;
  const bell: number[][] = [];
  for (let i = 0; i <= RINGS; i++) {
    const s = i / RINGS, th = s * TH;
    const row: number[] = [];
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const scallop = 1 - 0.06 * (0.5 - 0.5 * Math.cos(a * 16)) * s ** 4;
      const curl = s > 0.85 ? (s - 0.85) * 0.5 : 0;
      const r = (Math.sin(th) - curl) * scallop;
      row.push(vert(Math.cos(a) * r, 0.56 * Math.cos(th) - 0.08, Math.sin(a) * r, 0, s, a));
    }
    bell.push(row);
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = bell[i][j], b = bell[i][(j + 1) % SEG], c = bell[i + 1][j], d = bell[i + 1][(j + 1) % SEG];
      idx.push(a, c, b, b, c, d);
    }
  }
  // A ribbon hanging from (x, y, z): `len` long, `w0`→`w1` wide, facing outward along angle a0.
  const ribbon = (x0: number, y0: number, z0: number, a0: number, len: number, w0: number, w1: number, segs: number, p: number, frill: number) => {
    const px = -Math.sin(a0), pz = Math.cos(a0);
    let prev: [number, number] | null = null;
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      const y = y0 - s * len;
      // Oral arms spiral a little and flare out below the bell; tentacles hang straight.
      const out = p === 1 ? 0.08 * Math.sin(s * Math.PI) : 0;
      const sw = (w0 + (w1 - w0) * s) * (1 + frill * Math.sin(s * 22 + a0 * 3));
      const cx = x0 + Math.cos(a0) * out, cz = z0 + Math.sin(a0) * out;
      const l = vert(cx - px * sw, y, cz - pz * sw, p, s, a0);
      const r = vert(cx + px * sw, y, cz + pz * sw, p, s, a0);
      if (prev) idx.push(prev[0], l, prev[1], prev[1], l, r);
      prev = [l, r];
    }
  };
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    ribbon(Math.cos(a) * 0.1, -0.02, Math.sin(a) * 0.1, a, 1.35, 0.14, 0.04, 12, 1, 0.35);
  }
  for (let k = 0; k < 16; k++) {
    const a = ((k + 0.5) / 16) * Math.PI * 2;
    ribbon(Math.cos(a) * 0.9, -0.02, Math.sin(a) * 0.9, a + Math.PI / 2, 1.5 + (k % 3) * 0.25, 0.018, 0.008, 7, 2, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('aAng', new THREE.Float32BufferAttribute(ang, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const vert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute float aPart;
  attribute float aAlong;
  attribute float aAng;
  /** x: bell contraction 0..1, y: pulse phase, z: tint, w: fade (0 hidden .. 1). */
  attribute vec4 iAnim;
  /** Its velocity in its own frame: the arms and tentacles trail behind. */
  attribute vec3 iDrift;
  varying float vPart;
  varying float vAlong;
  varying float vAng;
  varying vec4 vAnim;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 p = position;
    vec3 nrm = normal;
    float c = iAnim.x;
    if (aPart < 0.5) {
      // The bell contracts: the rim pulls in (much more than the crown) and the dome grows taller.
      float rimW = aAlong * aAlong;
      p.xz *= 1.0 - c * (0.06 + 0.26 * rimW);
      p.y += c * (0.1 * (1.0 - aAlong) - 0.08 * rimW);
    } else {
      // Arms and tentacles: drawn in with the rim, a wave running down them after each pulse, and
      // streaming behind as it swims.
      float s = aAlong;
      float tent = step(1.5, aPart);
      p.xz *= 1.0 - c * mix(0.08, 0.26, tent) * (1.0 - 0.5 * s);
      float wave = sin(iAnim.y - s * 4.5 + aAng * 2.0);
      p.x += wave * s * mix(0.08, 0.14, tent);
      p.z += cos(iAnim.y * 0.7 - s * 3.2 + aAng * 1.3) * s * mix(0.07, 0.12, tent);
      p.y += c * 0.12 * s;
      p -= iDrift * s * s;
    }
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * nrm);
    vV = cameraPosition - wp.xyz;
    vPart = aPart;
    vAlong = aAlong;
    vAng = aAng;
    vAnim = iAnim;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uSunDir;
  uniform float uDay;
  varying float vPart;
  varying float vAlong;
  varying float vAng;
  varying vec4 vAnim;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec3 N = normalize(vN), V = normalize(vV);
    float facing = abs(dot(N, V));
    float fres = pow(1.0 - facing, 2.0);
    vec3 pink = mix(vec3(1.0, 0.3, 0.68), vec3(0.95, 0.18, 0.56), vAnim.z);
    vec3 col;
    float a;
    if (vPart < 0.5) {
      // Four horseshoe gonads showing through the crown, a paler scalloped rim.
      float gon = smoothstep(0.55, 0.95, cos(4.0 * vAng)) * smoothstep(0.16, 0.3, vAlong) * (1.0 - smoothstep(0.42, 0.58, vAlong));
      col = mix(pink, vec3(0.86, 0.1, 0.48), gon * 0.85);
      float rim = smoothstep(0.78, 1.0, vAlong);
      col = mix(col, vec3(1.0, 0.72, 0.88), rim * 0.4);
      a = 0.46 + 0.45 * fres + gon * 0.3 + rim * 0.15;
    } else if (vPart < 1.5) {
      // Frilly oral arms, a deeper pink.
      col = pink * vec3(0.95, 0.7, 0.85);
      a = 0.66 * (1.0 - vAlong * 0.5);
    } else {
      // Fine tentacles, faint.
      col = mix(pink, vec3(1.0), 0.25);
      a = 0.4 * (1.0 - vAlong * 0.7);
    }
    // Sunlit from above, with light glowing through the jelly (so the pink holds up under the water's tint).
    float lit = 0.7 + 0.45 * abs(dot(N, normalize(uSunDir)));
    col *= lit * mix(0.3, 1.0, uDay);
    col += pink * 0.18 * uDay;
    // At night they glow soft pink, flaring with each pulse.
    float night = 1.0 - smoothstep(0.28, 0.58, uDay);
    col += vec3(1.0, 0.32, 0.72) * night * (0.22 + 0.7 * vAnim.x) * mix(1.0, 0.55, step(0.5, vPart));
    a = min(0.95, a + night * 0.12);
    gl_FragColor = vec4(col, a * vAnim.w);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ---------------- Behaviour ----------------

interface Swarm {
  hx: number;
  hz: number;
  x: number;
  z: number;
  /** Along its slow loop, the loop's size and turn, and which way round. */
  a: number;
  rx: number;
  rz: number;
  rot: number;
  dir: number;
}

interface Jelly {
  swarm: number;
  /** Its place in the swarm (drifting), and depth below the surface. */
  ox: number;
  oz: number;
  oy: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Bell tilt (the way its crown leans), pulse phase and rate, size, tint. */
  tx: number;
  tz: number;
  phase: number;
  rate: number;
  size: number;
  tint: number;
  /** Seconds left scattering from the pointer, and the way away. */
  flee: number;
  fx: number;
  fz: number;
  seed: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

/** Bell contraction through one pulse: a quick squeeze, then a slow, soft relaxing. */
function contraction(ph: number): number {
  const f = (ph / (Math.PI * 2)) % 1;
  return f < 0.3 ? Math.sin((f / 0.3) * Math.PI * 0.5) : Math.pow(1 - (f - 0.3) / 0.7, 2.2);
}

/**
 * Swarms of pink moon jellies drifting in the shallows off the beaches: each swarm wanders slowly
 * along its stretch of shore, every jelly pulsing its bell (rising a little on each squeeze, sinking
 * gently between) with its arms and tentacles waving behind. They scatter from the pointer, pulsing
 * hard and diving away, then drift back into the swarm. At night they glow.
 */
export class Jellyfish {
  readonly mesh: THREE.InstancedMesh;
  private swarms: Swarm[] = [];
  private jellies: Jelly[] = [];
  private anim: THREE.InstancedBufferAttribute;
  private drift: THREE.InstancedBufferAttribute;
  private t = 0;

  constructor(private world: World, water: Water) {
    const rng = new RNG(world.seed * 29 + 41);
    this.place(rng);
    const n = Math.max(1, this.jellies.length);
    const geo = jellyGeometry();
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.drift = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    this.drift.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', this.anim);
    geo.setAttribute('iDrift', this.drift);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uSunDir: water.shared.uSunDir, uDay: water.shared.uDay },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    // Under the sea surface: drawn before it, so the water tints them.
    this.mesh.renderOrder = 9;
    this.mesh.name = 'jellyfish';
    this.mesh.count = this.jellies.length;
    this.update(0.001, null);
  }

  /** Swarm homes: open sea water a few cells off a beach, well apart and away from the map's edge. */
  private place(rng: RNG): void {
    const w = this.world, N = w.N, C = JELLYFISH;
    const dl = landDistance(w);
    const cands: number[] = [];
    for (let cz = 16; cz < N - 16; cz++) {
      for (let cx = 16; cx < N - 16; cx++) {
        const i = cz * N + cx;
        const L = w.layer[i];
        if (L > -2 || L < -5 || dl[i] < C.shore[0] || dl[i] > C.shore[1] || w.canal[i] || !Number.isNaN(w.riverY[i])) continue;
        cands.push(i);
      }
    }
    for (let k = cands.length - 1; k > 0; k--) {
      const j = rng.int(0, k);
      [cands[k], cands[j]] = [cands[j], cands[k]];
    }
    for (const i of cands) {
      if (this.swarms.length >= C.swarms) break;
      const x = w.centerX(i % N), z = w.centerZ((i / N) | 0);
      if (this.swarms.some((s) => Math.hypot(s.hx - x, s.hz - z) < C.spacing)) continue;
      if (w.lagoon && Math.hypot(x - w.lagoon.x, z - w.lagoon.z) < w.lagoon.r) continue;
      const s: Swarm = { hx: x, hz: z, x, z, a: rng.range(0, 6.28), rx: rng.range(2, 4.5), rz: rng.range(1.2, 2.5), rot: rng.range(0, 6.28), dir: rng.chance(0.5) ? 1 : -1 };
      const k = this.swarms.push(s) - 1;
      const count = rng.int(C.perSwarm[0], C.perSwarm[1]);
      for (let m = 0; m < count; m++) {
        const size = rng.range(C.size[0], C.size[1]) * 0.5;
        // A place in the swarm with water deep enough under it (else right in the middle).
        let ox = 0, oz = 0;
        for (let tries = 0; tries < 12; tries++) {
          const a = rng.range(0, 6.28), r = Math.sqrt(rng.next()) * rng.range(1.6, 3.2);
          if (this.bed(x + Math.cos(a) * r, z + Math.sin(a) * r * 0.7) < this.shallowest(size) - 0.1) {
            ox = Math.cos(a) * r;
            oz = Math.sin(a) * r * 0.7;
            break;
          }
        }
        this.jellies.push({
          swarm: k, ox, oz, oy: -rng.range(0.12, 0.6),
          x: x + ox, y: -0.4, z: z + oz, vx: 0, vy: 0, vz: 0,
          tx: 0, tz: 0, phase: rng.range(0, 6.28), rate: rng.range(3.4, 5.2), size, tint: rng.next(),
          flee: 0, fx: 0, fz: 0, seed: rng.range(0, 100),
        });
      }
    }
  }

  /** The shallowest sea floor a jelly of this size will swim over. */
  private shallowest(size: number): number {
    return -0.35 - size * 2;
  }

  /** Sea floor under a point (the map's own seabed; deep beyond it). */
  private bed(x: number, z: number): number {
    const w = this.world;
    return Math.abs(x) < w.half && Math.abs(z) < w.half ? w.heightAt(x, z) : -7;
  }

  /** Move on by dt seconds; `cursor` is the point on the ground or sea under the pointer (or null). */
  update(dt: number, cursor: THREE.Vector3 | null): void {
    if (dt <= 0) return;
    this.t += dt;
    const C = JELLYFISH, far2 = C.drawDistance * C.drawDistance;
    // Each swarm drifts slowly round its stretch of shore (turning back from shallows and land).
    for (const s of this.swarms) {
      const na = s.a + (dt * 0.05 * s.dir) / Math.max(s.rx, s.rz) * 3;
      const lx = Math.cos(na) * s.rx, lz = Math.sin(na) * s.rz;
      const nx = s.hx + lx * Math.cos(s.rot) - lz * Math.sin(s.rot), nz = s.hz + lx * Math.sin(s.rot) + lz * Math.cos(s.rot);
      if (this.bed(nx, nz) < -0.9) {
        s.a = na;
        s.x = nx;
        s.z = nz;
      } else s.dir = -s.dir;
    }
    const arr = this.anim.array as Float32Array, dr = this.drift.array as Float32Array;
    const R2 = C.fleeRadius * C.fleeRadius;
    this.jellies.forEach((j, i) => {
      const s = this.swarms[j.swarm];
      // Scatter from the pointer.
      if (cursor) {
        const dx = j.x - cursor.x, dz = j.z - cursor.z, d2 = dx * dx + dz * dz;
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1;
          j.flee = C.fleeSeconds * (0.8 + 0.4 * Math.sin(j.seed));
          j.fx = dx / d;
          j.fz = dz / d;
        }
      }
      const fleeing = j.flee > 0;
      if (fleeing) j.flee -= dt;
      // Pulse: faster when fleeing.
      j.phase += dt * j.rate * (fleeing ? 2.6 : 1);
      const c = contraction(j.phase);
      // Power stroke while the bell squeezes.
      const f = (j.phase / (Math.PI * 2)) % 1;
      const thrust = f < 0.3 ? Math.sin((f / 0.3) * Math.PI) : 0;
      // Where it wants to be: its place in the swarm (wandering slowly), or away from the pointer and deeper.
      const wob = this.t * 0.07 + j.seed;
      let gx = s.x + j.ox + Math.sin(wob) * 0.8, gz = s.z + j.oz + Math.cos(wob * 1.3) * 0.6, gy = j.oy + Math.sin(wob * 0.8) * 0.12;
      if (fleeing) {
        gx = j.x + j.fx * 3;
        gz = j.z + j.fz * 3;
        gy = -0.9;
      }
      // Lean the bell the way it's going, and swim along its axis on each stroke.
      const hx = gx - j.x, hz = gz - j.z, hl = Math.hypot(hx, hz);
      const lean = Math.min(1, hl / 1.5) * (fleeing ? 0.75 : 0.45);
      const wx = hl > 1e-3 ? (hx / hl) * lean : 0, wz = hl > 1e-3 ? (hz / hl) * lean : 0;
      const k = Math.min(1, dt * 2);
      j.tx += (wx - j.tx) * k;
      j.tz += (wz - j.tz) * k;
      const up = gy > j.y ? 1 : 0.35;
      _ax.set(j.tx, up, j.tz).normalize();
      const sp = (fleeing ? 1.3 : 0.32) * thrust * (0.6 + j.size * 2);
      j.vx += _ax.x * sp * dt * 6;
      j.vy += (_ax.y * sp * 6 * (gy > j.y ? 1 : 0.2) - 0.12) * dt;
      j.vz += _ax.z * sp * dt * 6;
      // Water drags it to a stop between strokes.
      const drag = Math.exp(-dt * 2.2);
      j.vx *= drag;
      j.vy *= drag;
      j.vz *= drag;
      let nx = j.x + j.vx * dt, nz = j.z + j.vz * dt;
      // Never into the shallows or onto land: turned back toward the swarm (one stranded in the
      // shallows, e.g. by a reshaped coast, may still swim back toward it).
      let bed = this.bed(nx, nz);
      if (bed > this.shallowest(j.size) && bed > this.bed(j.x, j.z) - 1e-3) {
        nx = j.x;
        nz = j.z;
        j.vx = (s.x - j.x) * 0.3;
        j.vz = (s.z - j.z) * 0.3;
        j.flee = 0;
      }
      j.x = nx;
      j.z = nz;
      bed = this.bed(nx, nz);
      // Below the surface, and clear of the sea floor where there's room (the surface wins where there isn't).
      j.y = Math.min(Math.max(j.y + j.vy * dt, bed + j.size * 1.6, -1.6), -0.06 - j.size * 0.6);
      // Pose: bell axis tilted, spinning slowly about it.
      _q.setFromUnitVectors(_up, _ax.set(j.tx * 0.9, 1, j.tz * 0.9).normalize());
      _q.multiply(_q2.setFromAxisAngle(_up, j.seed + this.t * 0.1));
      _p.set(j.x, j.y, j.z);
      _s.setScalar(j.size);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      // Tentacles trail against its motion (in its own frame, scaled to its size).
      _v.set(j.vx, j.vy, j.vz).applyQuaternion(_q.invert()).multiplyScalar(0.9 / j.size);
      dr[i * 3] = THREE.MathUtils.clamp(_v.x, -0.8, 0.8);
      dr[i * 3 + 1] = THREE.MathUtils.clamp(_v.y, -0.8, 0.8);
      dr[i * 3 + 2] = THREE.MathUtils.clamp(_v.z, -0.8, 0.8);
      // Faded out far from the camera (and hidden entirely beyond the draw distance).
      const d2 = View.dist2(j.x, j.y, j.z);
      arr[i * 4] = c;
      arr[i * 4 + 1] = j.phase;
      arr[i * 4 + 2] = j.tint;
      arr[i * 4 + 3] = 1 - THREE.MathUtils.smoothstep(d2, far2 * 0.6, far2);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.drift.needsUpdate = true;
  }

  /** Swarm centres (for tests and the minimap). */
  positions(): { x: number; z: number }[] {
    return this.swarms.map((s) => ({ x: s.x, z: s.z }));
  }
}
