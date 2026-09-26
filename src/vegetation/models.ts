import * as THREE from 'three';
import { COLORS } from '../config';
import { GeoBuilder, M, P, lumpy, ribbon, tube } from '../render/GeoBuilder';
import { RNG } from '../world/rng';

const c = (h: number) => new THREE.Color(h);
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));

const PAL = {
  trunk: c(0x9c7a52),
  trunkDark: c(0x6e5236),
  frondBase: c(0x2d7a32),
  frondMid: c(0x4fa83a),
  frondTip: c(COLORS.frondTip),
  jungleDark: c(COLORS.jungleDark),
  jungleBright: c(COLORS.jungleBright),
  jungleSun: c(0x8cc43e),
  bark: c(0x6b4a2e),
  fern: c(0x3b8a34),
  fernTip: c(0x86c44a),
  bushDark: c(0x2f7a33),
  bushLight: c(0x6db043),
  apple: c(0xd8352a),
  banana: c(0xf2d33a),
  bananaLeaf: c(0x4f9a38),
  bananaTip: c(0x9ccd4c),
  rockTop: c(0xb3a39c),
  rock: c(COLORS.rock),
  rockLight: c(COLORS.rockLight),
  rockLav: c(0x6f6782),
  moss: c(0x7a9a3a),
  reef1: c(COLORS.reef1),
  reef2: c(COLORS.reef2),
  coral: c(0xe0766a),
  stumpTop: c(0xdcbb8c),
};

/** Palm: curved trunk with ring bands and drooping fronds. variant 0 straight, 1 leaning, 2 curved. */
export function palmGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
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
    b.add(g, {
      color: (p) => {
        const d = Math.hypot(p.x - top.x, p.z - top.z) / L;
        return d < 0.5 ? mix(PAL.frondBase, PAL.frondMid, d * 2) : mix(PAL.frondMid, PAL.frondTip, (d - 0.5) * 1.6);
      },
      leaf: 1,
      sway: (p) => 0.5 + (Math.hypot(p.x - top.x, p.z - top.z) / L) * 0.9,
    });
  }
  if (!lo) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.add(P.sphere(0.1, 0), { color: 0x6b4a26, sway: 0.45 }, M.t(top.x + Math.cos(a) * 0.12, top.y - 0.12, top.z + Math.sin(a) * 0.12));
    }
  }
  return b.build();
}

/** Tall jungle broadleaf: tapered trunk, branches and a clustered, sunlit canopy. */
export function broadleafGeometry(variant: number, lo: boolean, seed: number): THREE.BufferGeometry {
  const rng = new RNG(seed);
  const b = new GeoBuilder();
  const trunkH = variant === 0 ? 1.9 : 2.5;
  b.add(P.cyl(0.11, 0.2, trunkH, lo ? 5 : 7), { color: PAL.bark, sway: 0.05, ao: { y0: 0, y1: 1.2, min: 0.6 } }, M.t(0, trunkH / 2, 0));
  if (!lo) {
    for (let k = 0; k < 2; k++) {
      const a = rng.range(0, Math.PI * 2);
      b.add(P.cyl(0.04, 0.07, 0.9, 5), { color: PAL.bark, sway: 0.2 }, M.t(Math.cos(a) * 0.25, trunkH * 0.8, Math.sin(a) * 0.25, Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7));
    }
  }
  const blobs = variant === 0 ? 4 : 5;
  const cy = trunkH + 0.7;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + rng.next();
    const r = k === 0 ? 0 : rng.range(0.55, 0.85);
    const rad = k === 0 ? 1.05 : rng.range(0.6, 0.85);
    const y = cy + (k === 0 ? 0.45 : rng.range(-0.25, 0.35));
    const geo = lumpy(P.sphere(rad, lo ? 0 : 1), 0.12, seed * 13 + k, 0.8);
    b.add(geo, {
      color: (p, nn) => {
        const up = nn.y * 0.5 + 0.5;
        const hgt = (p.y - (cy - 0.8)) / 2.2;
        let col = mix(PAL.jungleDark, PAL.jungleBright, up * 0.7 + hgt * 0.4);
        if (nn.y > 0.55) col = mix(col, PAL.jungleSun, (nn.y - 0.55) * 1.4);
        return col;
      },
      leaf: 1,
      sway: (p) => 0.15 + Math.max(0, p.y - trunkH) * 0.18,
      ao: { y0: cy - 1.0, y1: cy + 0.6, min: 0.55 },
    }, M.t(Math.cos(a) * r, y, Math.sin(a) * r));
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
  const b = new GeoBuilder();
  const blobs = 3 + (seed % 2);
  const light = apple ? c(0x5da33e) : PAL.bushLight;
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2;
    const r = k === 0 ? 0 : 0.28;
    const rad = k === 0 ? 0.48 : rng.range(0.3, 0.4);
    b.add(lumpy(P.sphere(rad, lo ? 0 : 1), 0.1, seed + k * 7, 0.85), {
      color: (p, nn) => mix(PAL.bushDark, light, nn.y * 0.45 + 0.35 + p.y * 0.3),
      leaf: 0.6,
      sway: (p) => p.y * 0.25,
      ao: { y0: 0, y1: 0.6, min: 0.6 },
    }, M.t(Math.cos(a) * r, rad * 0.75 + (k === 0 ? 0.08 : 0), Math.sin(a) * r));
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
  lime: c(0x8cc43e),
  limeDark: c(0x5a9a30),
  yellowGreen: c(0xb8c83a),
  olive: c(0x7a9a2e),
  deep: c(0x1f5a2a),
  deepLight: c(0x3a7f36),
  pink: c(0xe070b0),
  pinkLight: c(0xf4a8d0),
  vine: c(0x5a8a2a),
};

function canopyBlob(b: GeoBuilder, x: number, y: number, z: number, r: number, lo: boolean, seed: number, dark: THREE.Color, light: THREE.Color, squash = 0.8): void {
  const geo = lumpy(P.sphere(r, lo ? 0 : 1), 0.12, seed, squash);
  b.add(geo, {
    color: (p, nn) => mix(dark, light, nn.y * 0.45 + 0.4 + (p.y - y) / (r * 3)),
    leaf: 1,
    sway: (p) => 0.12 + Math.max(0, p.y - 1) * 0.12,
    ao: { y0: y - r, y1: y + r * 0.6, min: 0.6 },
  }, M.t(x, y, z));
}

function trunk(b: GeoBuilder, h: number, r0: number, r1: number, lo: boolean): void {
  b.add(P.cyl(r1, r0, h, lo ? 5 : 7), { color: PAL.bark, sway: 0.04, ao: { y0: 0, y1: h * 0.6, min: 0.6 } }, M.t(0, h / 2, 0));
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
  const b = new GeoBuilder();
  switch (variant) {
    case 2: // small rounded, light green
      trunk(b, 1.2, 0.13, 0.09, lo);
      canopyBlob(b, 0, 1.8, 0, 0.8, lo, seed, TREE.limeDark, TREE.lime, 0.9);
      if (!lo) for (let k = 0; k < 3; k++) canopyBlob(b, Math.cos(k * 2.1) * 0.45, 1.6 + rng.next() * 0.3, Math.sin(k * 2.1) * 0.45, 0.5, lo, seed + k, TREE.limeDark, TREE.lime);
      break;
    case 3: // tall narrow, yellow-green, stacked
      trunk(b, 1.8, 0.12, 0.08, lo);
      for (let k = 0; k < (lo ? 3 : 5); k++) {
        const y = 2.0 + k * (lo ? 0.9 : 0.6);
        canopyBlob(b, rng.range(-0.1, 0.1), y, rng.range(-0.1, 0.1), 0.62 - k * 0.06, lo, seed + k, TREE.olive, TREE.yellowGreen, 0.85);
      }
      break;
    case 4: // wide spreading: forked trunk and flat, layered canopy
    case 6: {
      // (6 = the same with hanging vines)
      trunk(b, 1.6, 0.2, 0.14, lo);
      const arms = lo ? 2 : 3;
      for (let k = 0; k < arms; k++) {
        const a = (k / arms) * Math.PI * 2 + rng.next();
        b.add(P.cyl(0.06, 0.11, 1.5, 5), { color: PAL.bark, sway: 0.1 }, M.t(Math.cos(a) * 0.4, 2.1, Math.sin(a) * 0.4, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6));
        const px = Math.cos(a) * 1.1, pz = Math.sin(a) * 1.1;
        canopyBlob(b, px, 2.9 + rng.next() * 0.4, pz, 0.95, lo, seed + k, TREE.deepLight, TREE.lime, 0.42);
        if (variant === 6 && !lo) {
          for (let v = 0; v < 3; v++) {
            const len = rng.range(0.6, 1.3);
            b.add(P.cyl(0.015, 0.015, len, 3), { color: TREE.vine, sway: 0.6 }, M.t(px + rng.range(-0.5, 0.5), 2.7 - len / 2, pz + rng.range(-0.5, 0.5)));
          }
        }
      }
      canopyBlob(b, 0, 3.3, 0, 0.9, lo, seed + 9, TREE.deepLight, TREE.lime, 0.4);
      break;
    }
    case 5: // jungle giant: tall trunk, dense dark canopy
      trunk(b, 3.3, 0.3, 0.18, lo);
      for (let k = 0; k < (lo ? 3 : 7); k++) {
        const a = (k / 7) * Math.PI * 2 + rng.next();
        const r = k === 0 ? 0 : rng.range(0.7, 1.2);
        canopyBlob(b, Math.cos(a) * r, 4.2 + rng.range(-0.3, 0.6), Math.sin(a) * r, k === 0 ? 1.2 : rng.range(0.7, 0.95), lo, seed + k, TREE.deep, TREE.deepLight, 0.8);
      }
      break;
    case 7: // blossom tree, pink
      trunk(b, 1.3, 0.12, 0.08, lo);
      canopyBlob(b, 0, 1.95, 0, 0.8, lo, seed, TREE.pink, TREE.pinkLight, 0.85);
      if (!lo) for (let k = 0; k < 3; k++) canopyBlob(b, Math.cos(k * 2.1) * 0.5, 1.8, Math.sin(k * 2.1) * 0.5, 0.52, lo, seed + k, TREE.pink, TREE.pinkLight);
      break;
  }
  return b.build();
}

/** Fruit tree (apple variant 1): a rounded tree whose oranges are a separate, harvestable mesh. */
export function fruitTreeGeometry(lo: boolean, seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  trunk(b, 1.1, 0.12, 0.08, lo);
  canopyBlob(b, 0, 1.75, 0, 0.85, lo, seed, c(0x2e7a2e), c(0x5aa83a), 0.9);
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
