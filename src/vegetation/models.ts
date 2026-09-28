import * as THREE from 'three';
import { COLORS } from '../config';
import { GeoBuilder, M, P, lumpy, ribbon, tube } from '../render/GeoBuilder';
import { RNG } from '../world/rng';
import { BARK, FINE, barkTrunk, barkColor, branch, foliage, hangingVine, leafGeometry, liana, roots, trunkVine } from './detail';

const c = (h: number) => new THREE.Color(h);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));

const PAL = {
  trunk: c(0x9c7a52),
  trunkDark: c(0x6e5236),
  frondBase: c(0x33602c),
  frondMid: c(0x557f38),
  frondTip: c(COLORS.frondTip),
  jungleDark: c(COLORS.jungleDark),
  jungleBright: c(COLORS.jungleBright),
  jungleSun: c(0x82a04a),
  bark: c(0x6b4a2e),
  fern: c(0x3e6d30),
  fernTip: c(0x7c9a46),
  bushDark: c(0x31592b),
  bushLight: c(0x63853c),
  apple: c(0xd8352a),
  banana: c(0xf2d33a),
  bananaLeaf: c(0x4d8038),
  bananaTip: c(0x8ca84a),
  rockTop: c(0xb3a39c),
  rock: c(COLORS.rock),
  rockLight: c(COLORS.rockLight),
  rockLav: c(0x6f6782),
  moss: c(0x6b8538),
  reef1: c(COLORS.reef1),
  reef2: c(COLORS.reef2),
  coral: c(0xe0766a),
  stumpTop: c(0xdcbb8c),
};

/** Palm: curved trunk with ring bands and drooping fronds. variant 0 straight, 1 leaning, 2 curved. */
export function palmGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const b = new GeoBuilder();
  const H = 3.1 + variant * 0.2;
  const pts: THREE.Vector3[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let x = 0;
    if (variant === 1) x = t * t * H * 0.38;
    if (variant === 2) x = Math.sin(t * Math.PI * 0.9) * 0.45 + t * t * 0.5;
    pts.push(new THREE.Vector3(x, t * H, 0));
  }
  const top = pts[n].clone();
  b.add(tube(pts, (t) => 0.13 - t * 0.055, lo ? 5 : 7, lo ? 4 : 9), {
    color: (p) => {
      const band = (p.y * 4.2) % 1 < 0.22 ? 0.78 : 1;
      return mix(PAL.trunkDark, PAL.trunk, 0.5 + p.y / H / 2).multiplyScalar(band);
    },
    sway: (p) => (p.y / H) * 0.45,
    ao: { y0: 0, y1: 0.8, min: 0.72 },
  });
  const fronds = lo ? 6 : 9;
  const segs = lo ? 3 : 6;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const L = rng.range(1.5, 1.9);
    const lift = rng.range(0.25, 0.55);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const g = ribbon(
      (t) => top.clone().addScaledVector(dir, L * t).add(new THREE.Vector3(0, lift * t - 1.25 * t * t, 0)),
      (t) => 0.26 * Math.sin(Math.PI * Math.pow(t, 0.75)) + 0.02,
      segs,
      side,
      0.55
    );
    const frondCol = (p: THREE.Vector3) => {
      const d = Math.hypot(p.x - top.x, p.z - top.z) / L;
      return d < 0.5 ? mix(PAL.frondBase, PAL.frondMid, d * 2) : mix(PAL.frondMid, PAL.frondTip, (d - 0.5) * 1.6);
    };
    const frondSway = (p: THREE.Vector3) => 0.5 + (Math.hypot(p.x - top.x, p.z - top.z) / L) * 0.9;
    if (lo || !FINE.on) {
      b.add(g, { color: frondCol, leaf: 1, sway: frondSway });
      continue;
    }
    // Close up: a thin midrib with separate leaflets fanning out on both sides.
    const spine = (t: number) => top.clone().addScaledVector(dir, L * t).add(new THREE.Vector3(0, lift * t - 1.25 * t * t, 0));
    b.add(ribbon(spine, (t) => 0.025 * (1 - t) + 0.006, segs, side, 0.2), { color: (p) => frondCol(p).multiplyScalar(0.8), leaf: 1, sway: frondSway });
    const nl = 12;
    for (let k = 0; k < nl; k++) {
      const t = 0.1 + (k / (nl - 1)) * 0.86;
      const p0 = spine(t);
      const tan = spine(Math.min(1, t + 0.02)).sub(spine(Math.max(0, t - 0.02))).normalize();
      const len = 0.42 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.08;
      for (const sd of [1, -1]) {
        const ax = side.clone().multiplyScalar(sd).addScaledVector(tan, 0.75).add(new THREE.Vector3(0, -0.45 - t * 0.3, 0)).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
        const roll = new THREE.Quaternion().setFromAxisAngle(ax, sd * 0.5);
        b.add(leafGeometry(len, 0.045, 0.5), { color: frondCol(p0).multiplyScalar(0.92 + dr.next() * 0.16), leaf: 1, sway: frondSway(p0) + 0.15 }, new THREE.Matrix4().compose(p0, roll.multiply(q), new THREE.Vector3(1, 1, 1)));
      }
    }
  }
  if (!lo) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.add(P.sphere(0.1, 0), { color: 0x6b4a26, sway: 0.45 }, M.t(top.x + Math.cos(a) * 0.12, top.y - 0.12, top.z + Math.sin(a) * 0.12));
    }
  }
  return b.build();
}

/** Tall jungle broadleaf: flared trunk with roots, branches and a clustered, sunlit, leafy canopy. */
export function broadleafGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const b = new GeoBuilder();
  const trunkH = variant === 0 ? 1.9 : 2.5;
  const top = trunk(b, trunkH, 0.2, 0.11, lo, rng);
  if (!lo) {
    if (variant === 1) trunkVine(b, trunkH + 0.3, 0.16, dr, TREE.vine, TREE.lime);
  }
  const blobs = variant === 0 ? 4 : 5;
  const cy = trunkH + 0.7;
  const br = new RNG(seed * 53 + 1);
  const tips: THREE.Vector3[] = [];
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + rng.next();
    const r = k === 0 ? 0 : rng.range(0.55, 0.85);
    const rad = k === 0 ? 1.05 : rng.range(0.6, 0.85);
    const y = cy + (k === 0 ? 0.45 : rng.range(-0.25, 0.35));
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!lo && k > 0) branch(b, new THREE.Vector3(top.x * 0.7, trunkH * br.range(0.72, 0.92), top.z * 0.7), new THREE.Vector3(x * 0.8, y - rad * 0.3, z * 0.8), 0.06, br, trunkH);
    foliage(b, x, y, z, rad, 0.8, seed * 13 + k, lo, {
      dark: PAL.jungleDark,
      light: PAL.jungleBright,
      sun: PAL.jungleSun,
      len: 0.34,
      w: 0.13,
      sway: 0.15 + Math.max(0, y - trunkH) * 0.18,
    });
    if (k > 0) tips.push(new THREE.Vector3(x * 0.8, y - rad * 0.35, z * 0.8));
  }
  if (!lo) {
    // Hanging vines under the crown and lianas slung between its limbs.
    const vr = new RNG(seed * 59 + 3);
    const nv = variant === 1 ? 5 : 2;
    for (let v = 0; v < nv; v++) hangingVine(b, new THREE.Vector3(vr.range(-0.9, 0.9), cy - 0.35, vr.range(-0.9, 0.9)), vr.range(0.6, variant === 1 ? 1.8 : 1.1), vr, TREE.vine, TREE.lime);
    for (let v = 0; v + 1 < tips.length; v += 2) liana(b, tips[v], tips[v + 1], vr.range(0.3, 0.7), vr, TREE.vine, TREE.lime);
  }
  return b.build();
}
/** Forest-floor fern: arching fronds from a single point. */
export function fernGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const n = lo ? 4 : 6;
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const L = rng.range(0.5, 0.7);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    b.add(
      ribbon(
        (t) => new THREE.Vector3(0, 0.02, 0).addScaledVector(dir, L * t).add(new THREE.Vector3(0, 0.5 * t - 0.42 * t * t, 0)),
        (t) => 0.1 * Math.sin(Math.PI * t) + 0.01,
        lo ? 2 : 3,
        side,
        0.4
      ),
      { color: (p) => mix(PAL.fern, PAL.fernTip, Math.hypot(p.x, p.z) / L), leaf: 1, sway: (p) => Math.hypot(p.x, p.z) * 0.9 }
    );
  }
  return b.build();
}

/** Rounded bush, optionally with red/orange/coral flowers. */
export function bushGeometry(flowers: boolean, lo: boolean, seed: number, apple = false): THREE.BufferGeometry {
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const b = new GeoBuilder();
  const blobs = 3 + (seed % 2);
  const light = apple ? c(0x5a8739) : PAL.bushLight;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2;
    const r = k === 0 ? 0 : 0.28;
    const rad = k === 0 ? 0.48 : rng.range(0.3, 0.4);
    const bx = Math.cos(a) * r, by = rad * 0.75 + (k === 0 ? 0.08 : 0), bz = Math.sin(a) * r;
    foliage(b, bx, by, bz, rad, 0.85, seed + k * 7, lo, {
      dark: PAL.bushDark,
      light,
      sun: mix(light, c(0x93ab58), 0.5),
      len: 0.2,
      w: 0.085,
      sway: 0.12 + by * 0.25,
      density: 34,
      core: 0.66,
    });
  }
  if (!lo) {
    // Woody stems at the base, showing between the leaves.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rng.next();
      b.add(tube([new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(Math.cos(a) * 0.12, 0.14, Math.sin(a) * 0.12), new THREE.Vector3(Math.cos(a) * 0.26, 0.3, Math.sin(a) * 0.26)], (t) => 0.03 * (1 - 0.6 * t), FINE.on ? 4 : 3, FINE.on ? 3 : 2), { color: BARK.mid, sway: (p) => p.y * 0.2 });
    }
  }
  if (flowers && !lo) {
    const cols = [c(COLORS.flowerRed), c(COLORS.flowerOrange), c(0xf2735e), c(0xffd0d8)];
    for (let k = 0; k < 12; k++) {
      const th = rng.range(0, Math.PI * 2), ph = rng.range(0.2, 1.2);
      const r = 0.5;
      b.add(P.sphere(0.065, 0), { color: rng.pick(cols), sway: 0.2 }, M.t(Math.cos(th) * Math.sin(ph) * r, 0.45 + Math.cos(ph) * r * 0.75, Math.sin(th) * Math.sin(ph) * r));
    }
  }
  return b.build();
}

/** Red apples dotted over the apple bush surface (separate mesh so they can be harvested). */
export function appleFruitGeometry(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  for (let k = 0; k < 8; k++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.4, 1.35);
    const r = 0.52;
    b.add(P.uvSphere(0.075, 7, 5), { color: (_p, nn) => mix(PAL.apple, c(0xff8a6a), Math.max(0, nn.y) * 0.5), sway: 0.2 }, M.t(Math.cos(th) * Math.sin(ph) * r, 0.42 + Math.cos(ph) * r * 0.75, Math.sin(th) * Math.sin(ph) * r));
  }
  return b.build();
}

/** Banana plant: pseudostem and broad drooping leaves. */
export function bananaGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const h = 1.55;
  b.add(P.cyl(0.07, 0.11, h, lo ? 5 : 7), { color: (p) => mix(c(0x6f7a34), c(0x8a9a44), p.y / h), sway: (p) => p.y * 0.12, ao: { y0: 0, y1: 1, min: 0.7 } }, M.t(0, h / 2, 0));
  const n = lo ? 4 : 6;
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const L = rng.range(1.1, 1.4);
    b.add(
      ribbon(
        (t) => new THREE.Vector3(0, h - 0.05, 0).addScaledVector(dir, L * t).add(new THREE.Vector3(0, 0.7 * t - 0.95 * t * t, 0)),
        (t) => 0.24 * Math.sin(Math.PI * Math.pow(t, 0.7)) + 0.02,
        lo ? 3 : 5,
        side,
        0.25
      ),
      { color: (p) => mix(PAL.bananaLeaf, PAL.bananaTip, Math.hypot(p.x, p.z) / L), leaf: 1, sway: (p) => 0.3 + Math.hypot(p.x, p.z) * 0.6 }
    );
  }
  return b.build();
}

/** Hanging yellow banana bunch (separate mesh, harvestable). */
export function bananaBunchGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.02, 0.02, 0.35, 5), { color: 0x6f7a34, sway: 0.2 }, M.t(0.16, 1.28, 0));
  for (let tier = 0; tier < 3; tier++) {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + tier * 0.6;
      const g = P.cyl(0.028, 0.035, 0.2, 4);
      b.add(g, { color: mix(PAL.banana, c(0xc8d44a), tier * 0.2), sway: 0.2 }, M.t(0.16 + Math.cos(a) * 0.07, 1.22 - tier * 0.09, Math.sin(a) * 0.07, Math.sin(a) * -0.6, 0, Math.cos(a) * 0.6));
    }
  }
  b.add(P.cone(0.05, 0.12, 6), { color: 0x7a2a4a, sway: 0.2 }, M.t(0.16, 0.9, 0, Math.PI, 0, 0));
  return b.build();
}

/** Tree stump with a pale cut top. */
export function stumpGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.cyl(0.15, 0.2, 0.26, 8), { color: (p) => (p.y > 0.12 ? PAL.stumpTop : PAL.bark) }, M.t(0, 0.13, 0));
  b.add(P.cyl(0.04, 0.04, 0.12, 5), { color: 0x7ab04a, sway: 0.4 }, M.t(0.09, 0.3, 0.02, 0.3, 0, 0.3));
  return b.build();
}

/** Rounded chunky rock cluster: warm sunlit top, lavender underside, a little moss. */
export function rockGeometry(variant: number, seed: number, reef = false): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const count = variant === 0 ? 1 : variant === 1 ? 2 : 3;
  for (let k = 0; k < count; k++) {
    const rad = k === 0 ? 0.62 : rng.range(0.28, 0.42);
    const a = rng.range(0, Math.PI * 2);
    const off = k === 0 ? 0 : 0.55;
    const g = lumpy(P.sphere(rad, 1), 0.22, seed * 31 + k, rng.range(0.55, 0.75));
    b.add(g, {
      color: (p, nn) => {
        if (reef) return mix(PAL.reef2, PAL.reef1, nn.y * 0.5 + 0.5 + Math.sin(p.x * 9) * 0.15);
        let col = mix(PAL.rockLav, PAL.rock, nn.y * 0.6 + 0.5);
        col = mix(col, PAL.rockTop, Math.max(0, nn.y - 0.2) * 1.1);
        const mossy = nn.y > 0.7 && Math.sin(p.x * 11 + p.z * 7) > 0.25;
        return mossy ? mix(col, PAL.moss, 0.65) : col;
      },
      ao: { y0: -0.1, y1: 0.35, min: 0.72 },
    }, M.t(Math.cos(a) * off, rad * 0.3, Math.sin(a) * off, rng.next(), rng.next() * 3, rng.next()));
  }
  if (reef) {
    for (let k = 0; k < 4; k++) {
      const a = rng.range(0, Math.PI * 2);
      b.add(P.cone(0.07, 0.35, 5), { color: rng.chance(0.5) ? PAL.coral : c(0x3f9a8a), sway: 0.15 }, M.t(Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.5, rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
    }
  }
  return b.build();
}

/** Soft dark disc used as a fake contact shadow / ambient occlusion under objects. */
export function contactTexture(): THREE.Texture {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(20,30,40,0.55)');
  grd.addColorStop(0.55, 'rgba(20,30,40,0.25)');
  grd.addColorStop(1, 'rgba(20,30,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------- Tree catalogue (broadleaf variants 2–7, fruit tree) ----------------

const TREE = {
  lime: c(0x789a42),
  limeDark: c(0x4a7230),
  yellowGreen: c(0x93a34a),
  olive: c(0x667f35),
  deep: c(0x224823),
  deepLight: c(0x3c6831),
  pink: c(0xcf78a6),
  pinkLight: c(0xe6a6c6),
  vine: c(0x4c702f),
};

function canopyBlob(b: GeoBuilder, x: number, y: number, z: number, r: number, lo: boolean, seed: number, dark: THREE.Color, light: THREE.Color, squash = 0.8): void {
  foliage(b, x, y, z, r, squash, seed, lo, { dark, light, sun: mix(light, c(0xa6b566), 0.35), len: 0.3, w: 0.12, sway: 0.12 + Math.max(0, y - 1) * 0.12 });
}

/** Trunk (bark ridges, flared base) plus buttress roots when close. Returns the top point. */
function trunk(b: GeoBuilder, h: number, r0: number, r1: number, lo: boolean, rng = new RNG(Math.round(h * 1000 + r0 * 7919))): THREE.Vector3 {
  if (lo) {
    b.add(P.cyl(r1, r0, h, 5), { color: (p) => barkColor(p, h), sway: 0.04, ao: { y0: 0, y1: h * 0.6, min: 0.6 } }, M.t(0, h / 2, 0));
    return new THREE.Vector3(0, h, 0);
  }
  const top = barkTrunk(b, h, r0, r1, lo, rng);
  roots(b, r0 > 0.17 ? 5 : 4, r0, r0 * 3.6, new RNG(Math.round(h * 977 + r0 * 1000)));
  return top;
}

/** Branches from the upper trunk out to each canopy blob. */
function branchesTo(b: GeoBuilder, lo: boolean, seed: number, h: number, r: number, targets: [number, number, number][]): void {
  if (lo) return;
  const rng = new RNG(seed * 53 + 1);
  for (const [x, y, z] of targets) branch(b, new THREE.Vector3(0, h * rng.range(0.7, 0.95), 0), new THREE.Vector3(x * 0.85, y - 0.15, z * 0.85), r, rng, h);
}

/** Canopy height (centre, top) and radius per broadleaf variant, unscaled, for perching birds and monkeys. */
export const CANOPY: { mid: number; top: number; r: number }[] = [
  { mid: 2.6, top: 3.7, r: 1.4 },
  { mid: 3.2, top: 4.4, r: 1.5 },
  { mid: 1.8, top: 2.6, r: 0.9 },
  { mid: 3.2, top: 4.9, r: 0.6 },
  { mid: 3.0, top: 3.4, r: 2.0 },
  { mid: 4.3, top: 5.6, r: 2.0 },
  { mid: 3.0, top: 3.4, r: 2.0 },
  { mid: 1.9, top: 2.7, r: 1.0 },
];

export function treeGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  if (variant < 2) return broadleafGeometry(variant, lo, seed);
  const rng = new RNG(seed);
  /** Separate stream for fine detail, so leaving it out (mid LOD) never moves the main shapes. */
  const dr = new RNG(seed * 31 + 7);
  const b = new GeoBuilder();
  switch (variant) {
    case 2: {
      // small rounded, light green
      trunk(b, 1.2, 0.13, 0.09, lo, rng);
      canopyBlob(b, 0, 1.8, 0, 0.8, lo, seed, TREE.limeDark, TREE.lime, 0.9);
      const pts: [number, number, number][] = [];
      if (!lo) for (let k = 0; k < 3; k++) {
        const p: [number, number, number] = [Math.cos(k * 2.1) * 0.45, 1.6 + rng.next() * 0.3, Math.sin(k * 2.1) * 0.45];
        pts.push(p);
        canopyBlob(b, p[0], p[1], p[2], 0.5, lo, seed + k, TREE.limeDark, TREE.lime);
      }
      branchesTo(b, lo, seed, 1.2, 0.05, pts);
      break;
    }
    case 3: // tall narrow, yellow-green, stacked
      trunk(b, 1.8, 0.12, 0.08, lo, rng);
      for (let k = 0; k < (lo ? 3 : 5); k++) {
        const y = 2.0 + k * (lo ? 0.9 : 0.6);
        canopyBlob(b, rng.range(-0.1, 0.1), y, rng.range(-0.1, 0.1), 0.62 - k * 0.06, lo, seed + k, TREE.olive, TREE.yellowGreen, 0.85);
      }
      if (!lo) b.add(P.cyl(0.05, 0.08, 2.4, 5), { color: BARK.mid, sway: 0.08 }, M.t(0, 2.9, 0));
      break;
    case 4: // wide spreading: forked trunk and flat, layered canopy
    case 6: {
      // (6 = the same with hanging vines)
      const top = trunk(b, 1.6, 0.2, 0.14, lo, rng);
      if (!lo && variant === 6) trunkVine(b, 1.8, 0.15, dr, TREE.vine, TREE.lime);
      const arms = lo ? 2 : 3;
      const arms3: THREE.Vector3[] = [];
      for (let k = 0; k < arms; k++) {
        const a = (k / arms) * Math.PI * 2 + rng.next();
        const px = Math.cos(a) * 1.1, pz = Math.sin(a) * 1.1;
        if (lo) b.add(P.cyl(0.06, 0.11, 1.5, 5), { color: PAL.bark, sway: 0.1 }, M.t(Math.cos(a) * 0.4, 2.1, Math.sin(a) * 0.4, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6));
        else branch(b, new THREE.Vector3(top.x, 1.45, top.z), new THREE.Vector3(px * 0.9, 2.75, pz * 0.9), 0.1, new RNG(seed * 53 + k), 1.6);
        if (!lo) arms3.push(new THREE.Vector3(px * 0.8, 2.6, pz * 0.8));
        canopyBlob(b, px, 2.9 + rng.next() * 0.4, pz, 0.95, lo, seed + k, TREE.deepLight, TREE.lime, 0.42);
        if (variant === 6 && !lo) {
          for (let v = 0; v < 3; v++) hangingVine(b, new THREE.Vector3(px + dr.range(-0.5, 0.5), 2.75, pz + dr.range(-0.5, 0.5)), dr.range(0.6, 1.3), dr, TREE.vine, TREE.lime);
        }
      }
      canopyBlob(b, 0, 3.3, 0, 0.9, lo, seed + 9, TREE.deepLight, TREE.lime, 0.4);
      if (variant === 6 && !lo) for (let v = 0; v < arms3.length; v++) liana(b, arms3[v], arms3[(v + 1) % arms3.length], 0.55, dr, TREE.vine, TREE.lime);
      break;
    }
    case 5: {
      // jungle giant: tall trunk, big buttress roots, dense dark canopy, vines
      trunk(b, 3.3, 0.3, 0.18, lo, rng);
      if (!lo) {
        roots(b, 4, 0.34, 1.3, new RNG(seed * 17 + 5));
        trunkVine(b, 3.4, 0.24, dr, TREE.vine, TREE.deepLight);
      }
      const pts: [number, number, number][] = [];
      for (let k = 0; k < (lo ? 3 : 7); k++) {
        const a = (k / 7) * Math.PI * 2 + rng.next();
        const r = k === 0 ? 0 : rng.range(0.7, 1.2);
        const p: [number, number, number] = [Math.cos(a) * r, 4.2 + rng.range(-0.3, 0.6), Math.sin(a) * r];
        if (k > 0) pts.push(p);
        canopyBlob(b, p[0], p[1], p[2], k === 0 ? 1.2 : rng.range(0.7, 0.95), lo, seed + k, TREE.deep, TREE.deepLight, 0.8);
      }
      branchesTo(b, lo, seed, 3.3, 0.09, pts);
      if (!lo) for (let v = 0; v < 6; v++) {
        const p = pts[v % pts.length];
        hangingVine(b, new THREE.Vector3(p[0] * 1.1, p[1] - 0.5, p[2] * 1.1), dr.range(0.8, 1.8), dr, TREE.vine, TREE.deepLight);
      }
      if (!lo) for (let v = 0; v + 2 < pts.length; v += 2) {
        const a = pts[v], z = pts[v + 2];
        liana(b, new THREE.Vector3(a[0] * 0.8, a[1] - 0.45, a[2] * 0.8), new THREE.Vector3(z[0] * 0.8, z[1] - 0.45, z[2] * 0.8), dr.range(0.5, 1.0), dr, TREE.vine, TREE.deepLight);
      }
      break;
    }
    case 7: {
      // blossom tree, pink
      trunk(b, 1.3, 0.12, 0.08, lo, rng);
      canopyBlob(b, 0, 1.95, 0, 0.8, lo, seed, TREE.pink, TREE.pinkLight, 0.85);
      const pts: [number, number, number][] = [];
      if (!lo) for (let k = 0; k < 3; k++) {
        const p: [number, number, number] = [Math.cos(k * 2.1) * 0.5, 1.8, Math.sin(k * 2.1) * 0.5];
        pts.push(p);
        canopyBlob(b, p[0], p[1], p[2], 0.52, lo, seed + k, TREE.pink, TREE.pinkLight);
      }
      branchesTo(b, lo, seed, 1.3, 0.05, pts);
      break;
    }
  }
  return b.build();
}

/** Fruit tree (apple variant 1): a rounded tree whose oranges are a separate, harvestable mesh. */
export function fruitTreeGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  const dr = new RNG(seed * 31 + 7);
  trunk(b, 1.1, 0.12, 0.08, lo, rng);
  if (!lo) for (let k = 0; k < 3; k++) branch(b, new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(Math.cos(k * 2.1) * 0.5, 1.55, Math.sin(k * 2.1) * 0.5), 0.05, dr, 1.1);
  canopyBlob(b, 0, 1.75, 0, 0.85, lo, seed, c(0x2e5c2b), c(0x537e37), 0.9);
  return b.build();
}

export function orangeFruitGeometry(seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  for (let k = 0; k < 10; k++) {
    const th = rng.range(0, Math.PI * 2), ph = rng.range(0.3, 1.6);
    b.add(P.uvSphere(0.075, 7, 5), { color: (_p, nn) => mix(c(0xe8701e), c(0xf6a040), Math.max(0, nn.y) * 0.5), sway: 0.15 }, M.t(Math.cos(th) * Math.sin(ph) * 0.8, 1.75 + Math.cos(ph) * 0.72, Math.sin(th) * Math.sin(ph) * 0.8));
  }
  return b.build();
}
