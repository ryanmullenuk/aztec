import * as THREE from 'three';
import { COLORS } from '../config';
import { GeoBuilder, M, P, lumpy } from '../render/GeoBuilder';
import { RNG } from '../world/rng';

const c = (h: number) => new THREE.Color(h);
const K = {
  thatch: c(COLORS.thatch),
  thatchDark: c(0xb3843f),
  timber: c(COLORS.timber),
  timberDark: c(0x5e3b22),
  terracotta: c(COLORS.terracotta),
  stone: c(COLORS.stone),
  stoneDark: c(0x9d907f),
  gold: c(COLORS.gold),
  jade: c(COLORS.jade),
  adobe: c(0xe2c79c),
  plaster: c(0xefe2c6),
  door: c(0x3a2a20),
  red: c(0xc0392b),
  blue: c(0x3a7bbf),
  white: c(0xf4eee0),
  mud: c(0x6e5034),
  rope: c(0xc9a86a),
};

/** A finished model plus the points where torches stand (local space, door faces +z). */
export interface BuildingModel {
  finished: THREE.BufferGeometry;
  torches: THREE.Vector3[];
  /** Approximate height for scaffolding. */
  height: number;
}

/** Bands of darker thatch along height for texture. */
const thatchColor = (p: THREE.Vector3) => ((p.y * 7) % 1 < 0.3 ? K.thatchDark : K.thatch).clone().lerp(K.thatch, 0.3);

function torchPole(b: GeoBuilder, x: number, z: number, h = 0.75, y0 = 0): THREE.Vector3 {
  b.add(P.cyl(0.025, 0.035, h, 5), { color: K.timberDark }, M.t(x, y0 + h / 2, z));
  b.add(P.cyl(0.07, 0.04, 0.08, 7), { color: K.stoneDark }, M.t(x, y0 + h + 0.03, z));
  return new THREE.Vector3(x, y0 + h + 0.12, z);
}

/** The starting tribal fire: stone ring, crossed logs, seating and a painted totem. */
export function campfireModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(5);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    b.add(lumpy(P.sphere(0.11, 1), 0.2, 50 + k, 0.7), { color: K.stoneDark }, M.t(Math.cos(a) * 0.38, 0.05, Math.sin(a) * 0.38));
  }
  for (let k = 0; k < 3; k++) {
    b.add(P.cyl(0.04, 0.05, 0.55, 6), { color: K.timberDark }, M.t(0, 0.08, 0, Math.PI / 2, (k / 3) * Math.PI, 0.25));
  }
  // Seating logs.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    b.add(P.cyl(0.09, 0.09, 0.7, 7), { color: K.timber }, M.t(Math.cos(a) * 0.95, 0.09, Math.sin(a) * 0.95, Math.PI / 2, 0, a));
  }
  // Totem pole.
  const tx = -0.7, tz = -0.7;
  const bands = [K.terracotta, K.jade, K.gold, K.timber, K.terracotta];
  for (let k = 0; k < 5; k++) {
    b.add(P.cyl(0.12, 0.13, 0.28, 8), { color: bands[k] }, M.t(tx, 0.14 + k * 0.28, tz));
  }
  b.add(P.box(0.6, 0.08, 0.12), { color: K.jade }, M.t(tx, 1.2, tz));
  b.add(P.cone(0.14, 0.2, 8), { color: K.gold }, M.t(tx, 1.52, tz));
  // Pots.
  for (let k = 0; k < 2; k++) {
    b.add(P.uvSphere(0.1, 8, 6), { color: K.terracotta }, M.t(0.7 + k * 0.2, 0.1, -0.5 + rng.next() * 0.1, 0, 0, 0, 1, 0.9, 1));
  }
  return { finished: b.build(), torches: [new THREE.Vector3(0, 0.2, 0)], height: 1.6 };
}

// ---------------- Adobe houses (levels 1–5) ----------------

const AD = {
  wall: c(0xf2a164),
  wallLight: c(0xf9bd82),
  roof: c(0xe08f55),
  band: c(0xd9673f),
  door: c(0x1b8a9b),
  win: c(0x3a2721),
  red: c(0xc8342c),
  cream: c(0xf3e3c6),
  post: c(0x7a4a2a),
  pot: c(0xc4643a),
  leaf: c(0x4f9a3a),
  leafLight: c(0x7cc04a),
};

/** A plastered adobe block, lighter toward the top, with a low parapet around a flat roof. */
function adobeBlock(b: GeoBuilder, w: number, h: number, d: number, x: number, y: number, z: number, parapet = true): void {
  b.add(P.rbox(w, h, d, 0.035), { color: (p) => AD.wall.clone().lerp(AD.wallLight, Math.min(1, Math.max(0, (p.y - y) / h)) * 0.55) }, M.t(x, y + h / 2, z));
  if (!parapet) return;
  const t = 0.07, ph = 0.09;
  b.add(P.box(w, ph, t), { color: AD.wallLight }, M.t(x, y + h + ph / 2, z + d / 2 - t / 2));
  b.add(P.box(w, ph, t), { color: AD.wallLight }, M.t(x, y + h + ph / 2, z - d / 2 + t / 2));
  b.add(P.box(t, ph, d), { color: AD.wallLight }, M.t(x + w / 2 - t / 2, y + h + ph / 2, z));
  b.add(P.box(t, ph, d), { color: AD.wallLight }, M.t(x - w / 2 + t / 2, y + h + ph / 2, z));
  b.add(P.box(w - t * 2, 0.02, d - t * 2), { color: AD.roof }, M.t(x, y + h + 0.01, z));
}
/** Terracotta band around the foot of a wall. */
function baseBand(b: GeoBuilder, w: number, d: number, x: number, z: number, h = 0.16): void {
  b.add(P.box(w + 0.02, h, d + 0.02), { color: AD.band }, M.t(x, h / 2, z));
}
function tealDoor(b: GeoBuilder, x: number, y: number, z: number, w = 0.26, h = 0.46): void {
  b.add(P.box(w + 0.06, h + 0.04, 0.03), { color: AD.wallLight }, M.t(x, y + h / 2, z));
  b.add(P.box(w, h, 0.04), { color: AD.door }, M.t(x, y + h / 2, z + 0.01));
}
function adobeWindow(b: GeoBuilder, x: number, y: number, z: number, side = false, w = 0.12, h = 0.18): void {
  b.add(P.box(side ? 0.04 : w, h, side ? w : 0.04), { color: AD.win }, M.t(x, y, z));
}
/** Sloping cloth awning on two posts; striped red and cream, or plain red. */
function awning(b: GeoBuilder, x: number, y: number, z: number, w: number, d: number, striped: boolean): void {
  const n = striped ? 6 : 1;
  for (let k = 0; k < n; k++) {
    const sw = w / n;
    const col = striped ? (k % 2 ? AD.cream : AD.red) : AD.red;
    b.add(P.box(sw, 0.025, d), { color: col }, M.t(x - w / 2 + sw * (k + 0.5), y, z + d / 2, 0.22, 0, 0));
  }
  // Valance along the front edge.
  b.add(P.box(w, 0.07, 0.02), { color: AD.red }, M.t(x, y - 0.1, z + d * 0.97));
  for (const sx of [-1, 1]) b.add(P.cyl(0.025, 0.03, y, 5), { color: AD.post }, M.t(x + sx * (w / 2 - 0.03), y / 2, z + d * 0.95));
  b.add(P.box(w, 0.04, 0.04), { color: AD.post }, M.t(x, y - 0.03, z + d * 0.95));
}
function pottedPlant(b: GeoBuilder, x: number, y: number, z: number, s = 1): void {
  b.add(P.cyl(0.07 * s, 0.05 * s, 0.1 * s, 7), { color: AD.pot }, M.t(x, y + 0.05 * s, z));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.add(P.cone(0.035 * s, 0.2 * s, 4), { color: k % 2 ? AD.leaf : AD.leafLight, sway: 0.4, leaf: 1 }, M.t(x + Math.cos(a) * 0.03 * s, y + 0.18 * s, z + Math.sin(a) * 0.03 * s, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5));
  }
}
function stairs(b: GeoBuilder, x: number, z: number, n: number, stepH: number, stepD: number, width: number, dirX: number): void {
  for (let k = 0; k < n; k++) {
    const h = stepH * (k + 1);
    b.add(P.box(stepD, h, width), { color: AD.wallLight }, M.t(x + dirX * k * stepD, h / 2, z));
  }
}

/** Level 1 house: a small adobe hut with a thatched awning (2 people). */
export function hutModel(): BuildingModel {
  const b = new GeoBuilder();
  baseBand(b, 1.2, 1.1, 0, 0, 0.12);
  adobeBlock(b, 1.2, 0.72, 1.1, 0, 0, 0);
  adobeBlock(b, 0.55, 0.36, 0.55, -0.26, 0.72, -0.2);
  tealDoor(b, 0.1, 0.02, 0.56);
  adobeWindow(b, -0.36, 0.9, -0.2 + 0.28);
  adobeWindow(b, 0.61, 0.46, -0.1, true);
  // Thatched lean-to over the door.
  b.add(P.box(1.1, 0.05, 0.42), { color: thatchColor, leaf: 0.2 }, M.t(0.05, 0.66, 0.74, 0.3, 0, 0));
  for (const x of [-0.4, 0.5]) b.add(P.cyl(0.025, 0.03, 0.6, 5), { color: AD.post }, M.t(x, 0.3, 0.9));
  pottedPlant(b, 0.62, 0, 0.72, 0.9);
  const t = torchPole(b, -0.62, 0.78, 0.7);
  return { finished: b.build(), torches: [t], height: 1.4 };
}

/**
 * Home, levels 2–5 (tier 1–4): the adobe house grows with each upgrade.
 *  2: family home, two stacked blocks and a red awning (4 people)
 *  3: larger home, two wings and an upper room (7)
 *  4: village home, three storeys, outside stairs, courtyard wall (12)
 *  5: large house compound with a rooftop pergola (16)
 */
export function homeModel(tier = 1): BuildingModel {
  const b = new GeoBuilder();
  let height = 2;
  const torches: THREE.Vector3[] = [];
  if (tier <= 1) {
    baseBand(b, 1.9, 1.6, 0, -0.1);
    adobeBlock(b, 1.9, 1.0, 1.6, 0, 0, -0.1);
    adobeBlock(b, 1.0, 0.8, 0.95, -0.25, 1.0, -0.35);
    tealDoor(b, -0.35, 0.02, 0.71, 0.3, 0.55);
    adobeWindow(b, -0.45, 1.45, 0.14);
    adobeWindow(b, -0.05, 1.45, 0.14);
    adobeWindow(b, 0.96, 0.6, -0.2, true);
    awning(b, 0.45, 0.78, 0.7, 0.8, 0.5, false);
    pottedPlant(b, 0.2, 0, 0.95);
    pottedPlant(b, 0.8, 0, 1.0, 0.8);
    torches.push(torchPole(b, -1.05, 1.05));
    height = 2.2;
  } else if (tier === 2) {
    baseBand(b, 2.4, 1.7, 0, -0.1);
    adobeBlock(b, 1.4, 1.05, 1.7, -0.5, 0, -0.1);
    adobeBlock(b, 1.1, 1.3, 1.4, 0.65, 0, -0.25);
    adobeBlock(b, 0.9, 0.8, 0.9, -0.6, 1.05, -0.4);
    tealDoor(b, -0.45, 0.02, 0.76, 0.3, 0.55);
    for (const x of [-0.8, -0.4]) adobeWindow(b, x, 1.5, 0.06);
    adobeWindow(b, 0.9, 0.95, 0.46);
    adobeWindow(b, 0.4, 0.95, 0.46);
    awning(b, -0.45, 0.8, 0.76, 0.9, 0.5, false);
    pottedPlant(b, 0.3, 0, 0.8);
    pottedPlant(b, 1.1, 0, 0.75, 1.2);
    pottedPlant(b, -1.1, 0, 0.9, 0.9);
    torches.push(torchPole(b, -1.2, 1.1), torchPole(b, 1.2, 1.0));
    height = 2.3;
  } else if (tier === 3) {
    baseBand(b, 2.6, 2.0, 0, -0.15);
    adobeBlock(b, 1.5, 1.1, 1.8, -0.55, 0, -0.25);
    adobeBlock(b, 1.1, 1.1, 1.2, 0.75, 0, -0.45);
    adobeBlock(b, 1.0, 0.9, 1.0, -0.65, 1.1, -0.5);
    adobeBlock(b, 0.75, 0.8, 0.75, -0.65, 2.0, -0.55);
    // Outside stairs up to the first roof.
    stairs(b, 0.3, 0.4, 6, 0.18, 0.13, 0.36, 1);
    tealDoor(b, -0.7, 0.02, 0.66, 0.3, 0.55);
    for (const x of [-0.95, -0.4]) adobeWindow(b, x, 1.55, 0.01);
    adobeWindow(b, -0.65, 2.45, -0.17);
    adobeWindow(b, 0.8, 0.7, 0.16);
    awning(b, 0.55, 1.12, 0.15, 1.0, 0.6, true);
    // Courtyard wall.
    b.add(P.box(1.25, 0.35, 0.1), { color: AD.wallLight }, M.t(0.6, 0.18, 1.25));
    b.add(P.box(0.1, 0.35, 0.65), { color: AD.wallLight }, M.t(1.2, 0.18, 0.95));
    pottedPlant(b, 0.45, 0, 1.0);
    pottedPlant(b, 0.95, 0, 0.95, 1.2);
    pottedPlant(b, -0.95, 1.1, 0.25, 0.9);
    torches.push(torchPole(b, -1.25, 1.2), torchPole(b, 1.25, 1.3));
    height = 3.0;
  } else {
    baseBand(b, 2.8, 2.4, 0, -0.1);
    adobeBlock(b, 2.8, 1.0, 2.4, 0, 0, -0.1);
    adobeBlock(b, 1.9, 1.0, 1.6, -0.35, 1.0, -0.45);
    adobeBlock(b, 1.0, 0.9, 1.0, -0.6, 2.0, -0.6);
    adobeBlock(b, 0.8, 0.5, 0.8, 0.9, 1.0, 0.5);
    // Rooftop pergola with a striped canopy.
    for (const [px, pz] of [[-1.0, -0.2], [-0.2, -0.2], [-1.0, -1.0], [-0.2, -1.0]]) b.add(P.cyl(0.025, 0.03, 0.55, 5), { color: AD.post }, M.t(px, 2.9 + 0.27, pz));
    for (let k = 0; k < 6; k++) b.add(P.box(0.14, 0.025, 0.9), { color: k % 2 ? AD.cream : AD.red }, M.t(-1.0 + 0.07 + k * 0.134, 3.46, -0.6, 0, 0, 0.08));
    // Front door under a striped awning, stairs to the roof terrace.
    tealDoor(b, -0.4, 0.02, 1.11, 0.32, 0.6);
    awning(b, -0.4, 0.85, 1.11, 1.0, 0.45, true);
    stairs(b, 1.05, 1.2, 5, 0.2, 0.12, 0.34, -1);
    for (const x of [-1.05, 0.3]) adobeWindow(b, x, 0.6, 1.11);
    for (const x of [-0.9, 0.1]) adobeWindow(b, x, 1.55, 0.36);
    adobeWindow(b, -0.6, 2.45, -0.09);
    tealDoor(b, 0.9, 1.0, 0.91, 0.24, 0.36);
    // Front courtyard walls.
    b.add(P.box(1.0, 0.3, 0.1), { color: AD.wallLight }, M.t(-0.9, 0.15, 1.42));
    pottedPlant(b, 0.2, 0, 1.3);
    pottedPlant(b, -1.2, 0, 1.3, 1.2);
    pottedPlant(b, 0.4, 1.0, 0.9, 0.9);
    pottedPlant(b, -1.1, 2.0, 0.1, 0.8);
    torches.push(torchPole(b, -1.35, 1.35), torchPole(b, 1.35, 1.35, 0.6));
    height = 3.6;
  }
  return { finished: b.build(), torches, height };
}

/** Aztec stepped pyramid. Tier 1-3 (3 is the Great Pyramid with twin shrines). */
export function templeModel(tier: number): BuildingModel {
  const b = new GeoBuilder();
  const steps = tier === 1 ? 3 : tier === 2 ? 5 : 7;
  const base = tier === 3 ? 4.2 : 3.9;
  const top = tier === 3 ? 1.8 : 1.5;
  const sh = tier === 3 ? 0.52 : 0.46;
  for (let s = 0; s < steps; s++) {
    const t = s / Math.max(1, steps - 1);
    const size = base + (top - base) * t;
    const y = s * sh;
    b.add(P.rbox(size, sh, size, 0.05), { color: (p) => (p.y - y > sh * 0.35 ? K.stone : K.stoneDark) }, M.t(0, y + sh / 2, 0));
    // Decorative band on each tier.
    b.add(P.box(size + 0.02, 0.06, size + 0.02), { color: s % 2 ? K.terracotta : K.jade }, M.t(0, y + sh * 0.72, 0));
  }
  const H = steps * sh;
  // Staircase up the front face: solid stepped columns so the profile reads cleanly.
  const stairN = steps * 3;
  const run = (base - top) / 2;
  const zf = (k: number) => base / 2 + 0.06 - (k / stairN) * (run + 0.06);
  for (let k = 0; k < stairN; k++) {
    const yTop = ((k + 1) / stairN) * H;
    const z0 = zf(k), z1 = zf(k + 1);
    b.add(P.box(0.82, yTop, z0 - z1 + 0.02), { color: (p) => (p.y > yTop - 0.04 ? K.terracotta : K.terracotta.clone().multiplyScalar(0.8)) }, M.t(0, yTop / 2, (z0 + z1) / 2));
  }
  // Sloped balustrades either side of the stairs.
  const slope = Math.atan2(H, run + 0.06);
  const len = Math.hypot(H, run + 0.06);
  for (const x of [-0.47, 0.47]) {
    b.add(P.box(0.13, 0.16, len), { color: K.stoneDark }, M.t(x, H / 2 + 0.06, (zf(0) + zf(stairN)) / 2, slope, 0, 0));
  }
  const torches: THREE.Vector3[] = [];
  const shrine = (x: number, col: THREE.Color, w: number) => {
    b.add(P.rbox(w, 0.7, w * 0.8, 0.04), { color: col }, M.t(x, H + 0.35, -0.1));
    b.add(P.box(w * 0.4, 0.45, 0.06), { color: K.door }, M.t(x, H + 0.26, -0.1 + w * 0.4));
    b.add(P.rbox(w + 0.14, 0.14, w * 0.8 + 0.14, 0.03), { color: K.gold }, M.t(x, H + 0.76, -0.1));
    b.add(P.rbox(w * 0.8, 0.3, w * 0.64, 0.05), { color: col.clone().multiplyScalar(0.85) }, M.t(x, H + 0.98, -0.1));
    for (let k = 0; k < 5; k++) b.add(P.box(0.1, 0.16, 0.08), { color: K.white }, M.t(x - w * 0.36 + (k * w * 0.72) / 4, H + 1.2, -0.1 + w * 0.32));
  };
  if (tier < 3) shrine(0, tier === 1 ? K.plaster : K.terracotta, tier === 1 ? 0.9 : 1.1);
  else {
    shrine(-0.45, K.red, 0.78);
    shrine(0.45, K.blue, 0.78);
  }
  const tt = top / 2 - 0.12;
  torches.push(torchPole(b, -tt, tt, 0.5, H), torchPole(b, tt, tt, 0.5, H));
  // Braziers at the foot of the stairs.
  const bz = base / 2 + 0.35;
  for (const x of [-0.75, 0.75]) {
    b.add(P.cyl(0.12, 0.08, 0.4, 8), { color: K.stoneDark }, M.t(x, 0.2, bz));
    b.add(P.cyl(0.16, 0.1, 0.1, 8), { color: K.gold }, M.t(x, 0.44, bz));
    torches.push(new THREE.Vector3(x, 0.55, bz));
  }
  return { finished: b.build(), torches, height: H + 1.3 };
}

/** Farm: fence with a gate, a small shelter and a scarecrow. Crops are a separate mesh. */
export function farmModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  const post = (x: number, z: number) => b.add(P.cyl(0.035, 0.04, 0.42, 5), { color: K.timber }, M.t(x, 0.21, z));
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const a = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.18, 0.34]) b.add(P.box(0.03, 0.03, len), { color: K.timberDark }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
  };
  const pts: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = pts[k], [x1, z1] = pts[(k + 1) % 4];
    const n = Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.9);
    for (let s = 0; s <= n; s++) post(x0 + ((x1 - x0) * s) / n, z0 + ((z1 - z0) * s) / n);
    if (k === 2) {
      // Front side (z = +hd) with a gate gap in the middle.
      rail(x0, z0, 0.5, z1);
      rail(-0.5, z0, x1, z1);
    } else rail(x0, z0, x1, z1);
  }
  // Shelter in a corner.
  const sx = -hw + 0.45, sz = -hd + 0.45;
  for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.add(P.cyl(0.03, 0.03, 0.75, 5), { color: K.timber }, M.t(sx + ox, 0.37, sz + oz));
  b.add(P.cone(0.6, 0.4, 4), { color: thatchColor, leaf: 0.2 }, M.t(sx, 0.95, sz, 0, Math.PI / 4, 0));
  b.add(P.uvSphere(0.1, 8, 6), { color: K.terracotta }, M.t(sx + 0.1, 0.1, sz));
  // Scarecrow.
  const cx = hw - 0.5, cz = -hd + 0.6;
  b.add(P.cyl(0.02, 0.02, 0.8, 4), { color: K.timber }, M.t(cx, 0.4, cz));
  b.add(P.cyl(0.015, 0.015, 0.5, 4), { color: K.timber }, M.t(cx, 0.6, cz, 0, 0, Math.PI / 2));
  b.add(P.sphere(0.07, 1), { color: K.thatch }, M.t(cx, 0.85, cz));
  b.add(P.cone(0.12, 0.1, 8), { color: K.terracotta }, M.t(cx, 0.94, cz));
  return { finished: b.build(), torches: [], height: 1.1 };
}

/** Maize plants in neat rows (scaled vertically by growth). Cobs are coloured by `ripe`. */
export function cropModel(w: number, d: number, ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 7 : 8);
  const rows = Math.floor(w * 1.6);
  const cols = Math.floor(d * 2.4);
  const green = c(0x6fae3a), gold = c(0xd8b84a), tassel = c(0xe7d27a);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = -w / 2 + 0.55 + (r / Math.max(1, rows - 1)) * (w - 1.1);
      const z = -d / 2 + 0.55 + (k / Math.max(1, cols - 1)) * (d - 1.3);
      const h = rng.range(0.4, 0.55);
      const stalk = ripe ? gold : green;
      b.add(P.cyl(0.015, 0.02, h, 4), { color: stalk, sway: (p) => p.y * 0.4 }, M.t(x, h / 2, z));
      for (let l = 0; l < 2; l++) {
        const a = rng.range(0, Math.PI * 2);
        b.add(P.box(0.02, 0.2, 0.05), { color: stalk.clone().multiplyScalar(0.9), leaf: 1, sway: (p) => p.y * 0.4 }, M.t(x + Math.cos(a) * 0.06, h * 0.5 + l * 0.1, z + Math.sin(a) * 0.06, Math.cos(a) * 0.8, a, Math.sin(a) * 0.8));
      }
      if (ripe) b.add(P.cyl(0.025, 0.02, 0.1, 5), { color: tassel, sway: 0.3 }, M.t(x + 0.03, h * 0.65, z, 0, 0, 0.4));
      b.add(P.cone(0.02, 0.07, 4), { color: tassel, sway: 0.5 }, M.t(x, h + 0.03, z));
    }
  }
  return b.build();
}

/** Butcher: small workshop plus an animal pen with a mud wallow. Pen centre is at local (+w/4, 0). */
export function butcherModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hx = -w / 4 - 0.1;
  b.add(P.rbox(1.5, 0.75, 1.6, 0.05), { color: K.adobe }, M.t(hx, 0.38, 0));
  b.add(P.cone(1.25, 0.7, 4), { color: thatchColor, leaf: 0.2 }, M.t(hx, 1.08, 0, 0, Math.PI / 4, 0));
  b.add(P.box(0.32, 0.46, 0.06), { color: K.door }, M.t(hx, 0.3, 0.81));
  // Meat rack.
  b.add(P.box(0.9, 0.04, 0.04), { color: K.timber }, M.t(hx, 0.75, 1.1));
  for (const x of [-0.4, 0.4]) b.add(P.cyl(0.025, 0.025, 0.75, 5), { color: K.timber }, M.t(hx + x, 0.37, 1.1));
  for (let k = 0; k < 3; k++) b.add(P.uvSphere(0.07, 6, 5), { color: 0xb2503a }, M.t(hx - 0.25 + k * 0.25, 0.62, 1.1, 0, 0, 0, 0.8, 1.4, 0.8));
  // Pen.
  const px = w / 4 + 0.15, pw = w / 2 - 0.4, pd = d - 0.4;
  b.add(P.cyl(pw * 0.32, pw * 0.36, 0.02, 12), { color: K.mud }, M.t(px + 0.2, 0.01, 0.2));
  const corners: [number, number][] = [[px - pw / 2, -pd / 2], [px + pw / 2, -pd / 2], [px + pw / 2, pd / 2], [px - pw / 2, pd / 2]];
  for (let k = 0; k < 4; k++) {
    const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / 0.6);
    for (let s = 0; s <= n; s++) b.add(P.cyl(0.03, 0.035, 0.38, 5), { color: K.timber }, M.t(x0 + ((x1 - x0) * s) / n, 0.19, z0 + ((z1 - z0) * s) / n));
    const a = Math.atan2(x1 - x0, z1 - z0);
    for (const y of [0.16, 0.3]) b.add(P.box(0.03, 0.03, len), { color: K.timberDark }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, a, 0));
  }
  b.add(P.cyl(0.18, 0.16, 0.1, 8), { color: K.timberDark }, M.t(px - 0.3, 0.05, -0.5));
  const t = torchPole(b, hx + 0.8, 0.95);
  return { finished: b.build(), torches: [t], height: 1.5 };
}

/** Open wood store shed with a sloped thatch roof. Log/stone piles are separate fill meshes. */
export function woodstoreModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.2, hd = d / 2 - 0.2;
  b.add(P.rbox(w - 0.2, 0.08, d - 0.2, 0.03), { color: K.timberDark }, M.t(0, 0.04, 0));
  for (const [x, z, h] of [[-hw, -hd, 1.25], [hw, -hd, 1.25], [-hw, hd, 0.95], [hw, hd, 0.95]] as const) {
    b.add(P.cyl(0.05, 0.06, h, 6), { color: K.timber }, M.t(x, h / 2, z));
  }
  b.add(P.box(w, 0.08, d + 0.2), { color: thatchColor, leaf: 0.2 }, M.t(0, 1.14, 0, -0.14, 0, 0));
  b.add(P.box(0.06, 0.06, w), { color: K.timberDark }, M.t(0, 1.2, -hd, 0, Math.PI / 2, 0));
  // Chopping block with axe.
  b.add(P.cyl(0.14, 0.16, 0.22, 8), { color: K.timber }, M.t(hw + 0.1, 0.11, hd + 0.3));
  return { finished: b.build(), torches: [new THREE.Vector3(-hw - 0.1, 0.9, hd + 0.2)], height: 1.4 };
}

export function logPileGeometry(seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  const rows = [3, 2, 1];
  rows.forEach((n, r) => {
    for (let k = 0; k < n; k++) {
      const x = (k - (n - 1) / 2) * 0.17;
      b.add(P.cyl(0.08, 0.08, 0.6, 7), { color: (p) => (Math.abs(p.z) > 0.28 ? c(0xd9b88a) : K.timber) }, M.t(x, 0.08 + r * 0.14, rng.range(-0.03, 0.03), Math.PI / 2, 0, 0));
    }
  });
  return b.build();
}

export function stonePileGeometry(seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  for (let k = 0; k < 5; k++) b.add(lumpy(P.sphere(rng.range(0.09, 0.14), 1), 0.2, seed + k, 0.75), { color: k % 2 ? K.stone : K.stoneDark }, M.t(rng.range(-0.18, 0.18), 0.08 + (k > 2 ? 0.1 : 0), rng.range(-0.15, 0.15)));
  return b.build();
}

/** Raised round granary on stilts with a ladder. Baskets/sacks are separate fill meshes. */
export function grainstoreModel(): BuildingModel {
  const b = new GeoBuilder();
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    b.add(P.cyl(0.05, 0.05, 0.45, 6), { color: K.timber }, M.t(Math.cos(a) * 0.45, 0.22, Math.sin(a) * 0.45));
  }
  b.add(P.cyl(0.62, 0.62, 0.08, 12), { color: K.timberDark }, M.t(0, 0.48, 0));
  b.add(P.cyl(0.52, 0.56, 0.7, 12), { color: (p) => ((p.y * 6) % 1 < 0.2 ? K.terracotta : K.adobe) }, M.t(0, 0.87, 0));
  b.add(P.cone(0.78, 0.7, 12), { color: thatchColor, leaf: 0.2 }, M.t(0, 1.55, 0));
  b.add(P.box(0.24, 0.3, 0.06), { color: K.door }, M.t(0, 0.9, 0.53));
  // Ladder.
  for (const x of [-0.12, 0.12]) b.add(P.box(0.03, 0.8, 0.03), { color: K.timber }, M.t(x, 0.4, 0.78, 0.35, 0, 0));
  for (let k = 0; k < 4; k++) b.add(P.box(0.24, 0.025, 0.025), { color: K.timber }, M.t(0, 0.12 + k * 0.18, 0.86 - k * 0.065));
  return { finished: b.build(), torches: [new THREE.Vector3(0.6, 0.8, 0.7)], height: 1.9 };
}

export function basketGeometry(seed: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(seed);
  const kind = seed % 3;
  if (kind === 0) {
    b.add(P.cyl(0.13, 0.1, 0.16, 9), { color: K.rope }, M.t(0, 0.08, 0));
    for (let k = 0; k < 5; k++) b.add(P.sphere(0.05, 0), { color: [0xd8352a, 0xf2d33a, 0xe8a23a][k % 3] }, M.t(rng.range(-0.06, 0.06), 0.17, rng.range(-0.06, 0.06)));
  } else if (kind === 1) {
    b.add(P.uvSphere(0.14, 8, 6), { color: 0xd8c08a }, M.t(0, 0.12, 0, 0, 0, 0, 1, 1.1, 1));
    b.add(P.cyl(0.05, 0.08, 0.06, 6), { color: 0xc4a870 }, M.t(0, 0.27, 0));
  } else {
    b.add(P.cyl(0.12, 0.09, 0.2, 9), { color: K.terracotta }, M.t(0, 0.1, 0));
    b.add(P.cyl(0.09, 0.12, 0.04, 9), { color: K.terracotta }, M.t(0, 0.22, 0));
  }
  return b.build();
}

/** War room: stone hall with crenellations, jaguar and eagle banners, spear rack and shields. */
export function warroomModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(P.rbox(2.6, 0.16, 2.4, 0.04), { color: K.stoneDark }, M.t(0, 0.08, 0));
  b.add(P.rbox(2.2, 1.0, 1.9, 0.05), { color: K.stone }, M.t(0, 0.66, -0.1));
  b.add(P.box(2.26, 0.1, 1.96), { color: K.red }, M.t(0, 1.12, -0.1));
  for (let k = 0; k < 6; k++) {
    for (const z of [-1.03, 0.83]) b.add(P.box(0.2, 0.2, 0.14), { color: K.stone }, M.t(-0.95 + k * 0.38, 1.26, z));
  }
  b.add(P.box(0.5, 0.65, 0.06), { color: K.door }, M.t(0, 0.48, 0.86));
  b.add(P.box(0.62, 0.1, 0.1), { color: K.gold }, M.t(0, 0.84, 0.88));
  // Banners: jaguar (yellow spotted) and eagle (white/brown).
  const banner = (x: number, eagle: boolean) => {
    b.add(P.cyl(0.03, 0.03, 2.1, 5), { color: K.timberDark }, M.t(x, 1.05, 1.0));
    b.add(P.box(0.4, 0.55, 0.02), {
      color: (p) => {
        if (eagle) return p.y > 1.7 ? K.white : c(0x7a4a2a);
        return Math.sin(p.x * 40) * Math.sin(p.y * 40) > 0.5 ? c(0x3a2a1a) : c(0xe0a82e);
      },
      sway: (p) => Math.max(0, x - p.x + 0.2) * 0.3 + 0.1,
    }, M.t(x - 0.22, 1.72, 1.0));
    for (let k = 0; k < 3; k++) b.add(P.box(0.04, 0.16, 0.01), { color: [0x3fa27a, 0xc0392b, 0x3a7bbf][k], sway: 0.4 }, M.t(x - 0.35 + k * 0.12, 1.36, 1.0));
  };
  banner(-1.15, false);
  banner(1.35, true);
  // Spear rack and shields.
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.012, 0.012, 1.0, 4), { color: K.timber }, M.t(-0.75 + k * 0.1, 0.5, 1.02, 0.15, 0, 0));
  for (const [x, col] of [[0.6, K.red], [0.85, K.jade]] as const) {
    b.add(P.cyl(0.16, 0.16, 0.03, 12), { color: col }, M.t(x, 0.55, 0.87, Math.PI / 2, 0, 0));
    b.add(P.cyl(0.07, 0.07, 0.035, 10), { color: K.gold }, M.t(x, 0.55, 0.88, Math.PI / 2, 0, 0));
  }
  return { finished: b.build(), torches: [new THREE.Vector3(-0.5, 0.95, 1.05), new THREE.Vector3(0.5, 0.95, 1.05)], height: 1.6 };
}

/**
 * Jetty: small boat shed on land, deck on posts reaching into the shallows along +z.
 * @param landY height of the land the building sits on (deck is kept just above the sea).
 * @param length deck length in cells beyond the footprint.
 */
export function jettyModel(landY: number, length: number): BuildingModel {
  const b = new GeoBuilder();
  const deckY = 0.32 - landY;
  // Shed on land.
  for (const [x, z] of [[-0.7, -0.7], [0.1, -0.7], [-0.7, 0.1], [0.1, 0.1]]) b.add(P.cyl(0.04, 0.05, 0.9, 6), { color: K.timber }, M.t(x, 0.45, z));
  b.add(P.box(1.1, 0.07, 1.1), { color: thatchColor, leaf: 0.2 }, M.t(-0.3, 0.92, -0.3, 0.12, 0, 0));
  for (let k = 0; k < 3; k++) b.add(P.rbox(0.28, 0.24, 0.28, 0.03), { color: k % 2 ? K.timber : c(0xa87a4a) }, M.t(-0.55 + k * 0.3, 0.12, -0.55));
  // Ramp from land level down to the deck.
  const rampLen = 1.0;
  const rampDrop = Math.min(0, deckY);
  b.add(P.box(0.9, 0.06, rampLen), { color: c(0xa8784a) }, M.t(0.5, rampDrop / 2 + 0.03, 0.75, Math.atan2(-rampDrop, rampLen), 0, 0));
  // Deck.
  const z0 = 1.2, z1 = 1.2 + length;
  for (let z = z0; z < z1; z += 0.26) {
    b.add(P.box(0.95, 0.05, 0.22), { color: (Math.round(z * 4) % 2 ? c(0xa8784a) : c(0x94663c)) }, M.t(0.5, deckY, z + 0.11));
  }
  for (let z = z0; z <= z1; z += 1.2) {
    for (const x of [0.05, 0.95]) b.add(P.cyl(0.05, 0.05, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z));
  }
  // T-end platform.
  b.add(P.box(2.2, 0.05, 0.9), { color: c(0xa8784a) }, M.t(0.5, deckY, z1 + 0.3));
  for (const x of [-0.5, 1.5]) b.add(P.cyl(0.05, 0.05, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z1 + 0.3));
  // Crates and barrels.
  b.add(P.rbox(0.3, 0.28, 0.3, 0.03), { color: 0xa87a4a }, M.t(0.2, deckY + 0.16, z0 + 1.0));
  b.add(P.rbox(0.24, 0.22, 0.24, 0.03), { color: 0x94663c }, M.t(0.25, deckY + 0.41, z0 + 1.02, 0, 0.4, 0));
  b.add(P.cyl(0.13, 0.13, 0.32, 10), { color: (p) => (Math.abs(p.y - (deckY + 0.18)) > 0.1 ? K.timberDark : K.timber) }, M.t(0.8, deckY + 0.18, z0 + 2.2));
  b.add(P.cyl(0.13, 0.13, 0.32, 10), { color: K.timber }, M.t(-0.2, deckY + 0.18, z1 + 0.35));
  // Rope coil.
  b.add(P.torus(0.12, 0.035, 5, 12), { color: K.rope }, M.t(1.2, deckY + 0.04, z1 + 0.3, Math.PI / 2, 0, 0));
  const torches = [new THREE.Vector3(-0.5, deckY + 0.8, z1 + 0.6), new THREE.Vector3(1.5, deckY + 0.8, z1 + 0.6)];
  for (const t of torches) {
    b.add(P.cyl(0.025, 0.035, 0.75, 5), { color: K.timberDark }, M.t(t.x, t.y - 0.45, t.z));
    b.add(P.cyl(0.07, 0.04, 0.08, 7), { color: K.stoneDark }, M.t(t.x, t.y - 0.08, t.z));
  }
  return { finished: b.build(), torches, height: 1.2 };
}

/** Generic construction scaffolding sized to a footprint. */
export function scaffoldGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  for (const [x, z] of corners) b.add(P.cyl(0.03, 0.035, h, 5), { color: 0xa87a4a }, M.t(x, h / 2, z));
  for (let lvl = 1; lvl <= Math.max(1, Math.floor(h / 0.6)); lvl++) {
    const y = lvl * 0.6;
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = corners[k], [x1, z1] = corners[(k + 1) % 4];
      const len = Math.hypot(x1 - x0, z1 - z0);
      b.add(P.box(0.03, 0.03, len), { color: 0x8b5a34 }, M.t((x0 + x1) / 2, y, (z0 + z1) / 2, 0, Math.atan2(x1 - x0, z1 - z0), 0));
    }
  }
  // Diagonal braces and rope lashings.
  b.add(P.box(0.025, 0.025, Math.hypot(w, h) * 0.9), { color: 0x8b5a34 }, M.t(0, h / 2, hd, Math.atan2(w, h) - Math.PI / 2, Math.PI / 2, 0));
  return b.build();
}

/** Foundation: levelled stone slab with timber outline and stakes. */
export function foundationGeometry(w: number, d: number): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(P.rbox(w - 0.25, 0.1, d - 0.25, 0.03), { color: K.stoneDark }, M.t(0, 0.05, 0));
  const hw = w / 2 - 0.1, hd = d / 2 - 0.1;
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) b.add(P.cyl(0.025, 0.03, 0.35, 5), { color: K.timber }, M.t(x, 0.17, z));
  b.add(P.box(w - 0.1, 0.04, 0.04), { color: K.rope }, M.t(0, 0.28, hd));
  b.add(P.box(w - 0.1, 0.04, 0.04), { color: K.rope }, M.t(0, 0.28, -hd));
  // A pile of materials waiting.
  for (let k = 0; k < 3; k++) b.add(P.cyl(0.05, 0.05, 0.6, 6), { color: K.timber }, M.t(hw - 0.3, 0.16 + k * 0.08, hd + 0.25, 0, 0, Math.PI / 2));
  return b.build();
}

/** Torch flame (emissive, blooms at night). */
export function flameGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.06, 0.18, 7);
  g.translate(0, 0.09, 0);
  return g;
}
