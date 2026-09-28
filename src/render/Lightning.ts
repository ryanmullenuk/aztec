import * as THREE from 'three';
import { Particles } from './Particles';

/** Main channel: 2^5 segments; branches: 2^4 segments each. */
const MAIN_LVL = 5;
const BR_LVL = 4;
const MAIN_PTS = (1 << MAIN_LVL) + 1;
const BR_PTS = (1 << BR_LVL) + 1;
const MAX_BR = 5;
const MAX_PTS = MAIN_PTS + MAX_BR * BR_PTS;

const _t = new THREE.Vector3();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Forked lightning over the sea: one jagged main channel from the clouds to the water with a few
 * thinner branches (midpoint displacement), drawn as camera-facing additive ribbons bright enough
 * to bloom. The buffers are allocated once; a strike rewrites them in place. It flickers two or
 * three times over a fraction of a second, and the sea throws up spray and steam where it hits.
 */
export class Lightning {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX_PTS * 2 * 3);
  private side = new Float32Array(MAX_PTS * 2);
  private bright = new Float32Array(MAX_PTS * 2);
  /** Ping-pong buffers for midpoint displacement, and the finished main channel. */
  private bufA = new Float32Array(MAIN_PTS * 3);
  private bufB = new Float32Array(MAIN_PTS * 3);
  private main = new Float32Array(MAIN_PTS * 3);
  private pulseT = new Float32Array(3);
  private pulseA = new Float32Array(3);
  private pulses = 0;
  private age = 0;
  private life = 0;
  /** Strength of the current strike's light on the scene (nearer is brighter). */
  private power = 1;
  private spray: Particles;
  private steam: Particles;
  private fxTime = 0;
  private sprayCol = new THREE.Color(0xeaf3ff);
  private steamCol = new THREE.Color(0xb4c0cc);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(this.side, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aBright', new THREE.BufferAttribute(this.bright, 1).setUsage(THREE.DynamicDrawUsage));
    // Static triangle strips: the main channel, then each branch.
    const idx: number[] = [];
    const strip = (v0: number, n: number) => {
      for (let i = 0; i < n - 1; i++) {
        const a = v0 + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };
    strip(0, MAIN_PTS);
    for (let k = 0; k < MAX_BR; k++) strip((MAIN_PTS + k * BR_PTS) * 2, BR_PTS);
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uBranch: { value: 1 }, uColor: { value: new THREE.Color(0.78, 0.86, 1.0) } },
      vertexShader: `attribute float aSide; attribute float aBright; varying float vSide; varying float vB;
        void main(){ vSide = aSide; vB = aBright; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uI; uniform float uBranch; uniform vec3 uColor; varying float vSide; varying float vB;
        void main(){
          float e = vSide * vSide;
          float core = exp(-e * 30.0);
          float glow = exp(-e * 4.0) * 0.3;
          float k = (core * 3.2 + glow) * vB * uI * mix(uBranch, 1.0, step(0.95, vB));
          if (k < 0.004) discard;
          gl_FragColor = vec4(uColor * k + vec3(core * k * 0.4), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 18;
    this.mesh.visible = false;
    this.group.add(this.mesh);

    this.spray = new Particles(140, 0xeaf3ff);
    this.steam = new Particles(48, 0xb4c0cc, 0.5);
    this.spray.points.visible = this.steam.points.visible = false;
    this.group.add(this.spray.points, this.steam.points);
  }

  /** Is a bolt showing right now? */
  get active(): boolean {
    return this.mesh.visible;
  }

  /**
   * Strike the sea at (x, y, z). `cloud` is the height of the cloud base above the sea, `cam` the
   * camera position (the ribbons face it), `power` the strength of its light on the scene.
   */
  strike(x: number, y: number, z: number, cloud: number, cam: THREE.Vector3, rnd: () => number, power = 1): void {
    const width = THREE.MathUtils.clamp(cam.distanceTo(_v.set(x, y + cloud * 0.5, z)) * 0.017, 0.55, 2.8);
    // Main channel: from the cloud (a little off to one side) down to the water.
    const a = rnd() * Math.PI * 2, off = 2 + rnd() * 8;
    const tx = x + Math.cos(a) * off, ty = y + cloud, tz = z + Math.sin(a) * off;
    this.displace(tx, ty, tz, x, y, z, MAIN_LVL, 0.42, rnd, this.main);
    let v = this.emit(this.main, MAIN_PTS, 0, width, width * 0.7, 1, 1, cam);
    // Branches fork off the upper two-thirds and wander outward and down.
    const nb = 2 + Math.floor(rnd() * (MAX_BR - 1));
    const len = Math.hypot(tx - x, ty - y, tz - z);
    const M = this.main;
    for (let k = 0; k < nb; k++) {
      const i = 2 + Math.floor(rnd() * (MAIN_PTS * 0.62));
      const sx = M[i * 3], sy = M[i * 3 + 1], sz = M[i * 3 + 2];
      _t.set(M[i * 3 + 3] - sx, M[i * 3 + 4] - sy, M[i * 3 + 5] - sz).normalize();
      const ba = rnd() * Math.PI * 2;
      _t.x += Math.cos(ba) * (0.8 + rnd() * 0.8);
      _t.z += Math.sin(ba) * (0.8 + rnd() * 0.8);
      _t.y -= 0.3;
      _t.normalize();
      const bl = len * (0.16 + rnd() * 0.26);
      const ex = sx + _t.x * bl, ez = sz + _t.z * bl;
      const ey = Math.max(y + 1.5, sy + _t.y * bl);
      this.displace(sx, sy, sz, ex, ey, ez, BR_LVL, 0.5, rnd, this.bufA);
      const b0 = 0.5 + rnd() * 0.3;
      v = this.emit(this.bufA, BR_PTS, v, width * 0.5, width * 0.12, b0, b0 * 0.25, cam);
    }
    const g = this.mesh.geometry;
    g.setDrawRange(0, ((MAIN_PTS - 1) + nb * (BR_PTS - 1)) * 6);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSide') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aBright') as THREE.BufferAttribute).needsUpdate = true;

    // Two or three flashes over a fraction of a second.
    this.pulses = rnd() < 0.55 ? 3 : 2;
    let t = 0;
    for (let p = 0; p < this.pulses; p++) {
      this.pulseT[p] = t;
      this.pulseA[p] = p === 0 ? 1 : 0.55 + rnd() * 0.45;
      t += 0.05 + rnd() * 0.08;
    }
    this.life = this.pulseT[this.pulses - 1] + 0.14;
    this.age = 0;
    this.power = power;
    this.mesh.visible = true;

    // Spray and steam where it hits the water.
    for (let k = 0; k < 44; k++) {
      const d = rnd() * Math.PI * 2, s = 1 + rnd() * 3.5;
      this.spray.spawn(x + Math.cos(d) * 0.4, y + 0.1, z + Math.sin(d) * 0.4, Math.cos(d) * s, 3 + rnd() * 6, Math.sin(d) * s, 0.6 + rnd() * 0.7, 0.18 + rnd() * 0.22);
    }
    for (let k = 0; k < 14; k++) {
      const d = rnd() * Math.PI * 2, r = rnd() * 1.4;
      this.steam.spawn(x + Math.cos(d) * r, y + 0.3 + rnd() * 0.6, z + Math.sin(d) * r, Math.cos(d) * 0.4, 0.6 + rnd() * 0.9, Math.sin(d) * 0.4, 2 + rnd() * 1.6, 1.2 + rnd() * 1.4, 1.1);
    }
    this.fxTime = 4;
  }

  /** Advance the flicker and the splash; returns the bolt's light on the scene (0..~1). */
  update(realDt: number, day: number, flash: number): number {
    let light = 0;
    if (this.mesh.visible) {
      this.age += realDt;
      let I = 0;
      for (let p = 0; p < this.pulses; p++) {
        const dt = this.age - this.pulseT[p];
        if (dt >= 0) I += this.pulseA[p] * Math.exp(-dt * 22);
      }
      I = Math.min(1.25, I) * (1 - THREE.MathUtils.smoothstep(this.age, this.life * 0.75, this.life));
      this.mat.uniforms.uI.value = I;
      this.mat.uniforms.uBranch.value = Math.exp(-this.age * 7);
      light = I * this.power;
      if (this.age >= this.life) this.mesh.visible = false;
    }
    if (this.fxTime > 0) {
      this.fxTime -= realDt;
      const vis = this.fxTime > 0;
      this.spray.points.visible = this.steam.points.visible = vis;
      if (vis) {
        // Lit by the flash itself, dim in the dark otherwise.
        const k = Math.min(1.6, 0.25 + 0.75 * day + flash * 1.4);
        const su = (this.spray.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
        su.copy(this.sprayCol).multiplyScalar(k);
        const tu = (this.steam.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
        tu.copy(this.steamCol).multiplyScalar(Math.min(1.3, k));
        this.spray.update(realDt, 9);
        this.steam.update(realDt, -0.25);
      }
    }
    return light;
  }

  /** Midpoint displacement from A to B, `lvl` times: writes 2^lvl + 1 points into `out`. */
  private displace(ax: number, ay: number, az: number, bx: number, by: number, bz: number, lvl: number, rough: number, rnd: () => number, out: Float32Array): void {
    // Ping-pong between `out` and a scratch buffer, starting so the last level lands in `out`.
    const tmp = out === this.bufA ? this.bufB : this.bufA;
    let cur = lvl % 2 === 0 ? out : tmp;
    let nxt = lvl % 2 === 0 ? tmp : out;
    cur[0] = ax; cur[1] = ay; cur[2] = az;
    cur[3] = bx; cur[4] = by; cur[5] = bz;
    let n = 2;
    for (let l = 0; l < lvl; l++) {
      let w = 0;
      for (let i = 0; i < n - 1; i++) {
        const o = i * 3;
        const x0 = cur[o], y0 = cur[o + 1], z0 = cur[o + 2];
        const x1 = cur[o + 3], y1 = cur[o + 4], z1 = cur[o + 5];
        const amp = Math.hypot(x1 - x0, y1 - y0, z1 - z0) * rough;
        nxt[w++] = x0; nxt[w++] = y0; nxt[w++] = z0;
        nxt[w++] = (x0 + x1) * 0.5 + (rnd() - 0.5) * amp;
        nxt[w++] = (y0 + y1) * 0.5 + (rnd() - 0.5) * amp * 0.35;
        nxt[w++] = (z0 + z1) * 0.5 + (rnd() - 0.5) * amp;
      }
      const o = (n - 1) * 3;
      nxt[w++] = cur[o]; nxt[w++] = cur[o + 1]; nxt[w++] = cur[o + 2];
      n = n * 2 - 1;
      const t = cur;
      cur = nxt;
      nxt = t;
    }
  }

  /** Write a polyline as a camera-facing ribbon strip starting at vertex `v`; returns the next vertex. */
  private emit(p: Float32Array, n: number, v: number, w0: number, w1: number, b0: number, b1: number, cam: THREE.Vector3): number {
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      _t.set(p[i1 * 3] - p[i0 * 3], p[i1 * 3 + 1] - p[i0 * 3 + 1], p[i1 * 3 + 2] - p[i0 * 3 + 2]);
      _v.set(cam.x - p[i * 3], cam.y - p[i * 3 + 1], cam.z - p[i * 3 + 2]);
      _s.crossVectors(_t, _v).normalize();
      const f = i / (n - 1);
      const hw = (w0 + (w1 - w0) * f) * 0.5;
      const br = b0 + (b1 - b0) * f;
      for (let e = 0; e < 2; e++) {
        const sg = e === 0 ? -1 : 1;
        const o = (v + e) * 3;
        this.pos[o] = p[i * 3] + _s.x * hw * sg;
        this.pos[o + 1] = p[i * 3 + 1] + _s.y * hw * sg;
        this.pos[o + 2] = p[i * 3 + 2] + _s.z * hw * sg;
        this.side[v + e] = sg;
        this.bright[v + e] = br;
      }
      v += 2;
    }
    return v;
  }
}
