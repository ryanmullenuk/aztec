import * as THREE from 'three';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { stylisedMaterial, stylisedMaterialDouble } from '../render/materials';
import { RNG } from '../world/rng';
import { SWAMP_WATER_DROP, World } from '../world/World';

const swampVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute float aDepth;
  varying vec3 vW;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vDepth = aDepth;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/** Murky swamp water: dark tea-brown/green, slow ripples, a dull sheen and bubbles rising. */
const swampFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uDay;
  uniform vec3 uSky;
  varying vec3 vW;
  varying float vDepth;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y); }
  void main() {
    vec2 p = vW.xz;
    float t = uTime;
    // Colour by depth: muddy olive at the edges, near-black tea in the middle of the pools.
    vec3 shallow = vec3(0.1, 0.15, 0.08), deep = vec3(0.025, 0.05, 0.035);
    vec3 col = mix(shallow, deep, smoothstep(0.02, 0.3, vDepth));
    // Slow wandering ripples and a floating film of scum.
    float rip = vn(p * 2.2 + vec2(t * 0.12, t * 0.08)) * 0.6 + vn(p * 5.0 - vec2(t * 0.2, 0.0)) * 0.4;
    float scum = smoothstep(0.55, 0.8, vn(p * 0.9 + vec2(t * 0.01, 0.0)));
    col = mix(col, vec3(0.2, 0.24, 0.1), scum * 0.35);
    vec3 V = normalize(cameraPosition - vW);
    vec3 n = normalize(vec3((rip - 0.5) * 0.25, 1.0, (vn(p * 2.2 + 7.0 + t * 0.1) - 0.5) * 0.25));
    float F = 0.04 + 0.5 * pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 4.0);
    col = mix(col, uSky * 0.55, F * 0.5);
    col += vec3(0.05, 0.06, 0.04) * smoothstep(0.62, 0.9, rip) * 0.6;
    // Bubbles: here and there a little bead of air rises and pops, leaving a ring.
    vec2 cell = floor(p * 1.6);
    float h = hsh(cell);
    float cyc = fract(t * (0.12 + h * 0.2) + h * 7.0);
    vec2 c = (cell + 0.25 + vec2(hsh(cell + 3.1), hsh(cell + 5.7)) * 0.5) / 1.6;
    float d = length(p - c);
    float bead = step(0.9, h) * smoothstep(0.035, 0.0, d) * step(cyc, 0.3);
    float ring = step(0.9, h) * smoothstep(0.012, 0.0, abs(d - cyc * 0.3)) * (1.0 - cyc) * step(0.3, cyc);
    col += vec3(0.5, 0.52, 0.42) * (bead * 0.7 + ring * 0.4);
    // Fade in from the muddy edge.
    float a = mix(0.72, 0.93, smoothstep(0.0, 0.12, vDepth));
    gl_FragColor = vec4(col * mix(0.35, 1.0, uDay), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// ---------------- Swamp plants and debris ----------------

function reeds(rng: RNG): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let k = 0; k < 7; k++) {
    const a = rng.range(0, 6.28), r = rng.range(0, 0.08), h = rng.range(0.35, 0.6);
    const lean = rng.range(-0.2, 0.2);
    const col = k % 3 ? 0x5a6a2e : 0x74803a;
    b.add(P.cone(0.012, h, 3), { color: col, sway: (p) => p.y * 0.5, leaf: 1 }, M.t(Math.cos(a) * r, h / 2, Math.sin(a) * r, lean, a, 0));
    // Cattail heads on some stems.
    if (k % 3 === 0) b.add(P.cyl(0.014, 0.014, 0.07, 5), { color: 0x5a3a20, sway: 0.4 }, M.t(Math.cos(a) * r + lean * h * 0.4, h * 0.8, Math.sin(a) * r, lean, a, 0));
  }
  return facet(b.build());
}

function tallGrass(rng: RNG): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let k = 0; k < 9; k++) {
    const a = rng.range(0, 6.28), h = rng.range(0.18, 0.32);
    b.add(P.box(0.02, h, 0.004), { color: k % 2 ? 0x6a7a34 : 0x566a2c, sway: (p) => p.y * 0.8, leaf: 1 }, M.t(Math.cos(a) * 0.05, h / 2, Math.sin(a) * 0.05, rng.range(-0.35, 0.35), a, rng.range(-0.3, 0.3)));
  }
  return facet(b.build());
}

function fern(rng: RNG): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 6.28 + rng.range(-0.2, 0.2);
    // A frond: a flat tapered blade arching up and out.
    b.add(P.box(0.24, 0.004, 0.06), { color: k % 2 ? 0x3e6a2a : 0x4a7a30, sway: (p) => Math.abs(p.x) * 1.2, leaf: 1 }, M.t(Math.cos(a) * 0.11, 0.07, Math.sin(a) * 0.11, 0, -a, 0.45));
  }
  return facet(b.build());
}

function log(rng: RNG): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const L = rng.range(0.9, 1.5);
  b.add(P.cyl(0.07, 0.085, L, 7), { color: (p) => new THREE.Color(Math.sin(p.y * 40) > 0.3 ? 0x4a3a28 : 0x5a4630) }, M.t(0, 0, 0, 0, 0, Math.PI / 2));
  // Broken stubs and a mossy top.
  b.add(P.cyl(0.02, 0.03, 0.14, 5), { color: 0x4a3a28 }, M.t(L * 0.2, 0.08, 0.02, 0.3, 0, -0.3));
  b.add(P.box(L * 0.7, 0.02, 0.09), { color: 0x4a6a2a }, M.t(0, 0.07, 0));
  return facet(b.build());
}

function snag(rng: RNG): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const h = rng.range(0.8, 1.4);
  b.add(P.cyl(0.035, 0.07, h, 6), { color: 0x6a5e50 }, M.t(0, h / 2, 0));
  for (let k = 0; k < 3; k++) {
    const y = h * rng.range(0.45, 0.9), a = rng.range(0, 6.28), len = rng.range(0.2, 0.4);
    b.add(P.cyl(0.01, 0.022, len, 4), { color: 0x6a5e50 }, M.t(Math.cos(a) * len * 0.4, y + len * 0.3, Math.sin(a) * len * 0.4, 0, -a, 0.9));
  }
  // Moss hanging from the broken top.
  b.add(P.cone(0.05, 0.18, 4), { color: 0x6a7a44, sway: 0.4, leaf: 1 }, M.t(0.03, h - 0.1, 0, Math.PI, 0, 0));
  return facet(b.build());
}

function roots(rng: RNG): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, 6.28);
    b.add(new THREE.TorusGeometry(0.16, 0.022, 4, 8, Math.PI), { color: 0x5a4632 }, M.t(Math.cos(a) * 0.1, -0.02, Math.sin(a) * 0.1, 0, a, 0));
  }
  return facet(b.build());
}

function lily(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.006, 9, 1, false, 0.4, Math.PI * 1.8), { color: 0x4a7a34 }, M.t(0, 0, 0));
  return b.build();
}

/**
 * The look of the swamps: murky pools (one merged surface each, depth-tinted), and reeds and
 * cattails along the banks, tall grass and ferns on the wet ground, fallen logs half in the
 * water, dead snags standing in the pools, exposed roots and a few lily pads.
 */
export class SwampView {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;

  constructor(private world: World, shared: { uTime: { value: number }; uDay: { value: number } }) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: shared.uTime, uDay: shared.uDay, uSky: { value: new THREE.Color(0x9ab8c8) } },
      vertexShader: swampVert,
      fragmentShader: swampFrag,
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    for (const sw of world.swamps) this.buildWater(sw);
    this.buildPlants();
  }

  private buildWater(sw: { x: number; z: number; r: number }): void {
    const w = this.world;
    const R = sw.r + 4, step = 0.5;
    const n = Math.ceil((R * 2) / step) + 1;
    const pos: number[] = [], dep: number[] = [], idx: number[] = [];
    const x0 = sw.x - R, z0 = sw.z - R;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      const y = w.heightNoSwamp(x, z) - SWAMP_WATER_DROP;
      pos.push(x, y, z);
      dep.push(Math.max(0, y - w.heightAt(x, z)));
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Only where there's water (the terrain hides the edges of the surface under the banks).
      if (Math.max(dep[a], dep[b], dep[c], dep[d]) < 0.01) continue;
      idx.push(a, c, b, b, c, d);
    }
    if (!idx.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.renderOrder = 9;
    m.name = 'swampWater';
    this.group.add(m);
  }

  private buildPlants(): void {
    const w = this.world;
    const rng = new RNG(w.seed * 211 + 3);
    const kinds = { reeds: reeds(rng), grass: tallGrass(rng), fern: fern(rng), log: log(rng), snag: snag(rng), roots: roots(rng), lily: lily() };
    const items: Record<keyof typeof kinds, THREE.Matrix4[]> = { reeds: [], grass: [], fern: [], log: [], snag: [], roots: [], lily: [] };
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const put = (k: keyof typeof kinds, x: number, y: number, z: number, ry: number, sc: number, rx = 0, rz = 0) => {
      e.set(rx, ry, rz);
      q.setFromEuler(e);
      items[k].push(new THREE.Matrix4().compose(p.set(x, y, z), q, s.setScalar(sc)));
    };
    const N = w.N;
    for (let i = 0; i < N * N; i++) {
      const sv = w.swamp[i];
      if (sv < 0.08) continue;
      const cx = i % N, cz = (i / N) | 0;
      if (w.occ[i]) continue;
      const carve = w.swampCarve[i];
      for (let k = 0; k < 3; k++) {
        const x = w.centerX(cx) + rng.range(-0.5, 0.5), z = w.centerZ(cz) + rng.range(-0.5, 0.5);
        const y = w.heightAt(x, z), wy = w.swampWaterY(x, z);
        const inPool = !Number.isNaN(wy) && wy - y > 0.12;
        const r = rng.next();
        if (!inPool && carve > 0.1 && sv > 0.3 && r < 0.6) put('reeds', x, Math.max(y, Number.isNaN(wy) ? y : wy - 0.12), z, rng.range(0, 6.28), rng.range(0.8, 1.3));
        else if (!inPool && sv < 0.7 && r < 0.3) put(r < 0.18 ? 'grass' : 'fern', x, y, z, rng.range(0, 6.28), rng.range(0.8, 1.3));
        else if (inPool && r < 0.03) put('lily', x, wy + 0.004, z, rng.range(0, 6.28), rng.range(0.7, 1.4));
        else if (inPool && r < 0.05) put('snag', x, y, z, rng.range(0, 6.28), rng.range(0.8, 1.2));
        else if (!inPool && carve > 0.08 && r < 0.012) put('roots', x, y, z, rng.range(0, 6.28), rng.range(0.9, 1.4));
        else if (r > 0.994) put('log', x, Number.isNaN(wy) ? y + 0.04 : Math.max(y + 0.04, wy - 0.03), z, rng.range(0, 6.28), rng.range(0.8, 1.2), 0, rng.range(-0.08, 0.08));
      }
    }
    for (const k of Object.keys(kinds) as (keyof typeof kinds)[]) {
      const list = items[k];
      if (!list.length) continue;
      const mat = k === 'lily' || k === 'grass' || k === 'fern' ? stylisedMaterialDouble() : stylisedMaterial();
      // Chunked so off-screen parts of the swamp are culled.
      const chunks = new Map<string, THREE.Matrix4[]>();
      for (const m of list) {
        p.setFromMatrixPosition(m);
        const key = `${Math.floor(p.x / 12)},${Math.floor(p.z / 12)}`;
        let c = chunks.get(key);
        if (!c) chunks.set(key, (c = []));
        c.push(m);
      }
      for (const c of chunks.values()) {
        const mesh = new THREE.InstancedMesh(kinds[k], mat, c.length);
        c.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.castShadow = k === 'snag' || k === 'log' || k === 'reeds';
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
    }
  }
}
