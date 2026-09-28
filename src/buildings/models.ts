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
  /** A roof drawn with the see-through canopy material (so people under it show when zoomed in). */
  canopy?: THREE.BufferGeometry;
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

// ---------------- Village comforts ----------------

/** Torch: a tall post with a woven basket of burning pitch pine at the top. */
export function torchModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(lumpy(P.sphere(0.12, 0), 0.2, 71, 0.5), { color: K.stoneDark }, M.t(0, 0.03, 0));
  b.add(P.cyl(0.03, 0.045, 1.25, 6), { color: K.timber }, M.t(0, 0.62, 0));
  b.add(P.cyl(0.035, 0.035, 0.06, 6), { color: K.rope }, M.t(0, 0.9, 0));
  b.add(P.cyl(0.085, 0.05, 0.14, 7), { color: (p) => ((p.y * 40) % 1 < 0.5 ? K.timberDark : K.rope).clone() }, M.t(0, 1.28, 0));
  b.add(P.sphere(0.06, 0), { color: c(0x2a1c14) }, M.t(0, 1.35, 0, 0, 0, 0, 1, 0.5, 1));
  return { finished: b.build(), torches: [new THREE.Vector3(0, 1.42, 0)], height: 1.5 };
}

/** Bonfire: a big stone-ringed fire of stacked logs with log benches all round. */
export function bonfireModel(): BuildingModel {
  const b = new GeoBuilder();
  // Beaten earth circle.
  b.add(P.cyl(1.35, 1.4, 0.03, 18), { color: c(0x9a7a52) }, M.t(0, 0.015, 0));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.add(lumpy(P.sphere(0.14, 1), 0.22, 90 + k, 0.7), { color: K.stoneDark }, M.t(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55));
  }
  // A teepee of logs.
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    b.add(P.cyl(0.045, 0.06, 0.95, 6), { color: k % 2 ? K.timberDark : c(0x3a2820) }, M.t(Math.cos(a) * 0.18, 0.36, Math.sin(a) * 0.18, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45));
  }
  b.add(P.sphere(0.2, 0), { color: c(0xe8702a) }, M.t(0, 0.1, 0, 0, 0, 0, 1.4, 0.45, 1.4));
  // Log benches.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    b.add(P.cyl(0.11, 0.11, 0.95, 7), { color: K.timber }, M.t(Math.cos(a) * 1.15, 0.11, Math.sin(a) * 1.15, 0, Math.PI / 2 - a, Math.PI / 2));
  }
  const fire = [new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0.12, 0.2, 0.08), new THREE.Vector3(-0.1, 0.2, -0.06)];
  return { finished: b.build(), torches: fire, height: 1.2 };
}

/** Firepit: a stone-lined pit with a whole pig roasting on a spit between forked posts. */
export function firepitModel(): BuildingModel {
  const b = new GeoBuilder();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    b.add(lumpy(P.sphere(0.12, 1), 0.2, 120 + k, 0.65), { color: K.stoneDark }, M.t(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.36));
  }
  b.add(P.cyl(0.45, 0.48, 0.03, 12), { color: c(0x3a2a22) }, M.t(0, 0.015, 0, 0, 0, 0, 1, 1, 0.72));
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.035, 0.035, 0.5, 5), { color: c(0x2e2018) }, M.t(0, 0.06, 0, Math.PI / 2, (k / 4) * Math.PI, 0));
  b.add(P.sphere(0.14, 0), { color: c(0xe8702a) }, M.t(0, 0.08, 0, 0, 0, 0, 1.6, 0.4, 1.1));
  // Forked posts and the spit.
  for (const x of [-0.72, 0.72]) {
    b.add(P.cyl(0.03, 0.035, 0.75, 5), { color: K.timber }, M.t(x, 0.37, 0));
    b.add(P.cyl(0.02, 0.02, 0.16, 4), { color: K.timber }, M.t(x - 0.04, 0.78, 0, 0, 0, 0.5));
    b.add(P.cyl(0.02, 0.02, 0.16, 4), { color: K.timber }, M.t(x + 0.04, 0.78, 0, 0, 0, -0.5));
  }
  b.add(P.cyl(0.015, 0.015, 1.6, 5), { color: K.timberDark }, M.t(0, 0.72, 0, 0, 0, Math.PI / 2));
  b.add(P.box(0.03, 0.18, 0.03), { color: K.timberDark }, M.t(0.84, 0.64, 0));
  // Roast pig: golden-brown body, head, snout, ears and trotters.
  const pig = (p: THREE.Vector3, n: THREE.Vector3) => c(0xb86a32).lerp(c(0xe0a060), Math.max(0, n.y) * 0.6).lerp(c(0x6e3418), Math.max(0, -n.y) * 0.4 + (Math.sin(p.x * 30) > 0.8 ? 0.2 : 0));
  b.add(P.sphere(0.2, 1), { color: pig }, M.t(0, 0.72, 0, 0, 0, 0, 1.6, 0.85, 0.9));
  b.add(P.sphere(0.12, 1), { color: pig }, M.t(0.34, 0.74, 0, 0, 0, 0, 1.1, 0.95, 0.95));
  b.add(P.cyl(0.05, 0.06, 0.07, 6), { color: c(0x9a5028) }, M.t(0.47, 0.73, 0, 0, 0, Math.PI / 2));
  for (const z of [-1, 1]) b.add(P.cone(0.04, 0.07, 4), { color: c(0x8a4a24) }, M.t(0.32, 0.85, z * 0.06, 0, 0, -0.4));
  for (const [x, z] of [[0.18, 1], [0.18, -1], [-0.2, 1], [-0.2, -1]]) b.add(P.cyl(0.025, 0.02, 0.14, 5), { color: c(0x7a3e1e) }, M.t(x, 0.6, z * 0.09, z * 0.5, 0, 0));
  // A basket and a pot beside it.
  b.add(P.cyl(0.14, 0.11, 0.14, 8), { color: K.rope }, M.t(-0.75, 0.07, 0.6));
  b.add(P.uvSphere(0.11, 8, 6), { color: K.terracotta }, M.t(0.8, 0.1, 0.6, 0, 0, 0, 1, 0.9, 1));
  return { finished: b.build(), torches: [new THREE.Vector3(0, 0.18, 0)], height: 1.0 };
}

/** Well: a round stone well with a timber frame, rope and bucket under a little tiled roof. */
export function wellModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(P.cyl(1.0, 1.0, 0.03, 16), { color: c(0xb8a890) }, M.t(0, 0.015, 0));
  b.add(P.cyl(0.46, 0.5, 0.5, 12), { color: (p) => ((Math.floor(p.y * 8) + Math.floor(Math.atan2(p.z, p.x) * 3)) % 2 ? K.stone : K.stoneDark).clone() }, M.t(0, 0.25, 0));
  b.add(P.cyl(0.5, 0.5, 0.06, 12), { color: K.stoneDark }, M.t(0, 0.52, 0));
  b.add(P.cyl(0.36, 0.36, 0.02, 12), { color: c(0x1f5a78) }, M.t(0, 0.4, 0));
  for (const x of [-0.52, 0.52]) b.add(P.cyl(0.035, 0.04, 1.05, 6), { color: K.timber }, M.t(x, 0.8, 0));
  b.add(P.cyl(0.04, 0.04, 1.14, 6), { color: K.timberDark }, M.t(0, 1.12, 0, 0, 0, Math.PI / 2));
  b.add(P.cyl(0.07, 0.07, 0.22, 8), { color: K.rope }, M.t(0, 1.12, 0, 0, 0, Math.PI / 2));
  b.add(P.cyl(0.008, 0.008, 0.36, 3), { color: K.rope }, M.t(0, 0.92, 0));
  b.add(P.cyl(0.08, 0.065, 0.12, 8), { color: K.timber }, M.t(0, 0.7, 0));
  b.add(P.box(0.04, 0.04, 0.2), { color: K.timberDark }, M.t(0.62, 1.12, 0.1));
  // Little roof.
  for (const s of [-1, 1]) b.add(P.box(1.3, 0.05, 0.62), { color: (p) => ((p.x * 8) % 1 < 0.5 ? K.terracotta : c(0x9a3a26)).clone() }, M.t(0, 1.42, s * 0.24, s * 0.62, 0, 0));
  b.add(P.box(1.34, 0.06, 0.06), { color: K.timberDark }, M.t(0, 1.58, 0));
  // A flower pot and a trough.
  b.add(P.uvSphere(0.1, 8, 6), { color: K.terracotta }, M.t(0.7, 0.08, 0.55));
  b.add(P.sphere(0.1, 0), { color: c(0x4f8038), leaf: 1 }, M.t(0.7, 0.2, 0.55));
  b.add(P.box(0.5, 0.14, 0.2), { color: K.stone }, M.t(-0.55, 0.07, 0.62));
  b.add(P.box(0.44, 0.02, 0.14), { color: c(0x2f7fa0) }, M.t(-0.55, 0.13, 0.62));
  return { finished: b.build(), torches: [], height: 1.7 };
}

/**
 * Kennel: a low flat-roofed adobe dog house with a round-topped doorway, a timber-railed run
 * shaded by a small palm-thatch awning, a water bowl, a food trough and a gnawed bone.
 * Faces +z (the run is in front).
 */
export function kennelModel(): BuildingModel {
  const b = new GeoBuilder();
  // Packed-earth yard.
  b.add(P.box(1.9, 0.03, 1.9), { color: c(0xb99a72) }, M.t(0, 0.015, 0));
  // Dog house at the back.
  baseBand(b, 1.1, 0.75, 0, -0.5, 0.1);
  adobeBlock(b, 1.1, 0.5, 0.75, 0, 0.08, -0.5);
  // Vigas poking through below the parapet.
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.025, 0.025, 0.14, 5), { color: AD.post }, M.t(-0.38 + k * 0.25, 0.52, -0.08, Math.PI / 2, 0, 0));
  // Round-topped doorway (dark opening under a light arch) and a red lintel band.
  b.add(P.box(0.34, 0.26, 0.04), { color: AD.win }, M.t(0, 0.21, -0.11));
  b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 10, 1, false, 0, Math.PI), { color: AD.win }, M.t(0, 0.34, -0.11, Math.PI / 2, Math.PI / 2, 0));
  b.add(P.box(1.12, 0.05, 0.02), { color: AD.red }, M.t(0, 0.47, -0.12));
  // Run: rail fence of posts and two rails on three sides.
  const posts: [number, number][] = [[-0.9, -0.12], [-0.9, 0.4], [-0.9, 0.88], [-0.3, 0.88], [0.3, 0.88], [0.9, 0.88], [0.9, 0.4], [0.9, -0.12]];
  for (const [x, z] of posts) b.add(P.cyl(0.028, 0.034, 0.42, 5), { color: K.timberDark }, M.t(x, 0.21, z));
  for (const y of [0.16, 0.34]) {
    b.add(P.box(0.03, 0.03, 1.0), { color: K.timber }, M.t(-0.9, y, 0.38));
    b.add(P.box(0.03, 0.03, 1.0), { color: K.timber }, M.t(0.9, y, 0.38));
    // Front rails either side of the gap.
    b.add(P.box(0.62, 0.03, 0.03), { color: K.timber }, M.t(-0.6, y, 0.88));
    b.add(P.box(0.62, 0.03, 0.03), { color: K.timber }, M.t(0.6, y, 0.88));
  }
  // Shade awning of palm thatch on two poles.
  for (const x of [-0.75, 0.75]) b.add(P.cyl(0.03, 0.035, 0.7, 5), { color: K.timberDark }, M.t(x, 0.35, 0.55));
  // Palm-thatch shade: overlapping frond bundles laid on a pole frame, ragged along the front edge.
  b.add(P.cyl(0.02, 0.02, 1.62, 5), { color: K.timberDark }, M.t(0, 0.7, 0.55, 0, 0, Math.PI / 2));
  for (let k = 0; k < 9; k++) {
    const x = -0.76 + k * 0.19;
    b.add(P.box(0.2, 0.035, 0.72), { color: k % 2 ? K.thatch : K.thatchDark }, M.t(x, 0.73 + (k % 2) * 0.012, 0.3, -0.2, (k % 3 - 1) * 0.04, 0));
    b.add(P.cone(0.06, 0.12, 4), { color: K.thatchDark }, M.t(x, 0.64, 0.68, -1.9, 0, 0));
  }
  // Water bowl, food trough, a bone.
  b.add(P.cyl(0.1, 0.08, 0.06, 10), { color: K.terracotta }, M.t(0.55, 0.06, 0.25));
  b.add(P.cyl(0.08, 0.08, 0.01, 10), { color: c(0x2f7fa0) }, M.t(0.55, 0.09, 0.25));
  b.add(P.box(0.4, 0.08, 0.14), { color: K.timber }, M.t(-0.5, 0.06, 0.3));
  b.add(P.cyl(0.018, 0.018, 0.16, 5), { color: c(0xefe6d4) }, M.t(0.15, 0.04, 0.55, 0, 0.6, Math.PI / 2));
  for (const s2 of [-1, 1]) b.add(P.sphere(0.025, 0), { color: c(0xefe6d4) }, M.t(0.15 + Math.cos(0.6) * 0.08 * s2, 0.04, 0.55 - Math.sin(0.6) * 0.08 * s2));
  const torch = torchPole(b, -0.85, -0.85, 0.7);
  return { finished: b.build(), torches: [torch], height: 0.9 };
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
export function farmModel(w: number, d: number, kind: 'veg' | 'maize' = 'veg'): BuildingModel {
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
  if (kind === 'maize') {
    // Cuexcomatl: a raised maize crib of woven cane on a stone base, with a thatched cap.
    const gx = -hw + 0.6, gz = -hd + 0.6;
    b.add(P.cyl(0.36, 0.4, 0.2, 8), { color: K.stone }, M.t(gx, 0.1, gz));
    b.add(P.cyl(0.33, 0.36, 0.62, 10), { color: (p) => ((p.y * 12) % 1 < 0.5 ? K.thatchDark : K.adobe).clone() }, M.t(gx, 0.51, gz));
    b.add(P.cone(0.46, 0.38, 10), { color: thatchColor, leaf: 0.2 }, M.t(gx, 1.0, gz));
    for (let k = 0; k < 5; k++) b.add(P.cyl(0.035, 0.03, 0.12, 5), { color: k % 2 ? K.gold : c(0xd88a2a) }, M.t(gx + 0.36 + (k % 3) * 0.07, 0.07, gz + 0.1 + Math.floor(k / 3) * 0.08, Math.PI / 2, k, 0));
  }
  // Shelter in a corner.
  const sx = kind === 'maize' ? hw - 0.45 : -hw + 0.45, sz = -hd + 0.45;
  for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.add(P.cyl(0.03, 0.03, 0.75, 5), { color: K.timber }, M.t(sx + ox, 0.37, sz + oz));
  b.add(P.cone(0.6, 0.4, 4), { color: thatchColor, leaf: 0.2 }, M.t(sx, 0.95, sz, 0, Math.PI / 4, 0));
  b.add(P.uvSphere(0.1, 8, 6), { color: K.terracotta }, M.t(sx + 0.1, 0.1, sz));
  // Scarecrow.
  const cx = kind === 'maize' ? 0 : hw - 0.5, cz = -hd + 0.6;
  b.add(P.cyl(0.02, 0.02, 0.8, 4), { color: K.timber }, M.t(cx, 0.4, cz));
  b.add(P.cyl(0.015, 0.015, 0.5, 4), { color: K.timber }, M.t(cx, 0.6, cz, 0, 0, Math.PI / 2));
  b.add(P.sphere(0.07, 1), { color: K.thatch }, M.t(cx, 0.85, cz));
  b.add(P.cone(0.12, 0.1, 8), { color: K.terracotta }, M.t(cx, 0.94, cz));
  return { finished: b.build(), torches: [], height: 1.1 };
}

/** Crops for each farm type (scaled vertically by growth); `ripe` colours the harvest. */
export function cropModel(w: number, d: number, ripe: boolean, crop: 'veg' | 'maize' | 'chinampa' = 'maize'): THREE.BufferGeometry {
  if (crop === 'veg') return vegCrops(w, d, ripe);
  if (crop === 'chinampa') return chinampaCrops(w, d, ripe);
  return maizeCrops(w, d, ripe, 1.55);
}

/** Beans twining up pole tripods, rows of squash vines with fruit, and chilli bushes. */
function vegCrops(w: number, d: number, ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 17 : 18);
  const leaf = c(0x5fa83a), leafDark = c(0x3f8a2e), pole = c(0x8a6a44);
  const rows = Math.max(3, Math.floor(w * 1.5));
  for (let r = 0; r < rows; r++) {
    const x = -w / 2 + 0.6 + (r / Math.max(1, rows - 1)) * (w - 1.2);
    const n = Math.floor((d - 1.2) / 0.42);
    const kind = r % 3;
    for (let k = 0; k <= n; k++) {
      const z = -d / 2 + 0.6 + k * 0.42 + (kind === 1 ? 0.12 : 0);
      if (z > d / 2 - 0.5) continue;
      if (kind === 0) {
        // Bean tripod, the vines climbing it.
        for (let l = 0; l < 3; l++) {
          const a = (l / 3) * Math.PI * 2 + r;
          b.add(P.cyl(0.01, 0.014, 0.78, 3), { color: pole, sway: (p) => p.y * 0.2 }, M.t(x + Math.cos(a) * 0.09, 0.38, z + Math.sin(a) * 0.09, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2));
        }
        for (let l = 0; l < 6; l++) {
          const a = rng.range(0, Math.PI * 2), y = 0.12 + l * 0.11;
          b.add(P.sphere(0.075 - l * 0.005, 0), { color: (l % 2 ? leaf : leafDark).clone(), leaf: 1, sway: (p) => p.y * 0.5 }, M.t(x + Math.cos(a) * 0.07, y, z + Math.sin(a) * 0.07, 0, a, 0, 1, 0.65, 1));
          if (ripe && l % 2 === 0) b.add(P.cyl(0.01, 0.007, 0.1, 3), { color: c(0x9fc85a), sway: 0.4 }, M.t(x + Math.cos(a) * 0.11, y - 0.04, z + Math.sin(a) * 0.11));
        }
      } else if (kind === 1) {
        // Squash: sprawling broad leaves with fruit among them.
        for (let l = 0; l < 4; l++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(P.sphere(0.12, 0), { color: (l % 2 ? leaf : leafDark).clone(), leaf: 1, sway: 0.15 }, M.t(x + Math.cos(a) * 0.13, 0.06, z + Math.sin(a) * 0.13, 0, a, 0, 1.35, 0.4, 1.1));
        }
        if (ripe || rng.next() < 0.35) b.add(P.uvSphere(0.1, 8, 6), { color: ripe ? (rng.next() < 0.5 ? c(0xe8902a) : c(0xe8c24a)) : c(0x7fae4a) }, M.t(x + 0.09, 0.08, z - 0.06, 0, 0, 0, 1.25, 0.85, 1));
      } else {
        // Chilli bushes with red (ripe) or green pods.
        b.add(P.sphere(0.13, 1), { color: leafDark, leaf: 1, sway: (p) => p.y * 0.4 }, M.t(x, 0.15, z, 0, 0, 0, 1, 0.95, 1));
        for (let l = 0; l < 7; l++) {
          const a = rng.range(0, Math.PI * 2);
          b.add(P.cone(0.018, 0.065, 4), { color: ripe ? c(0xd8342a) : c(0x6fae3a), sway: 0.4 }, M.t(x + Math.cos(a) * 0.12, 0.12 + rng.next() * 0.1, z + Math.sin(a) * 0.12, Math.PI, 0, 0));
        }
      }
    }
  }
  return b.build();
}

/** Raised chinampa beds (three strips along z): maize, marigolds, beans and greens. */
function chinampaCrops(w: number, d: number, ripe: boolean): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 27 : 28);
  const bedY = CHINAMPA_BED_Y;
  for (const bx of chinampaBeds(w)) {
    const n = Math.floor((d - 1.0) / 0.34);
    for (let k = 0; k <= n; k++) {
      const z = -d / 2 + 0.5 + k * 0.34;
      for (const ox of [-0.18, 0.18]) {
        const x = bx + ox;
        const pick = (k + (ox > 0 ? 1 : 0)) % 4;
        if (pick === 0) {
          const h = rng.range(0.38, 0.5);
          b.add(P.cyl(0.013, 0.017, h, 4), { color: ripe ? c(0xc8b04a) : c(0x6fae3a), sway: (p) => (p.y - bedY) * 0.4 }, M.t(x, bedY + h / 2, z));
          b.add(P.box(0.02, 0.18, 0.045), { color: c(0x5f9a34), leaf: 1, sway: (p) => (p.y - bedY) * 0.4 }, M.t(x + 0.04, bedY + h * 0.5, z, 0.5, 0, 0.6));
          if (ripe) b.add(P.cyl(0.022, 0.018, 0.09, 5), { color: K.gold, sway: 0.3 }, M.t(x + 0.03, bedY + h * 0.62, z, 0, 0, 0.4));
        } else if (pick === 1) {
          // Cempasuchil marigolds.
          b.add(P.sphere(0.07, 0), { color: c(0x4f8f30), leaf: 1, sway: 0.2 }, M.t(x, bedY + 0.07, z, 0, 0, 0, 1, 0.7, 1));
          if (ripe || k % 2) b.add(P.sphere(0.045, 0), { color: rng.next() < 0.6 ? c(0xf29a2e) : c(0xf2c230), sway: 0.3 }, M.t(x, bedY + 0.14, z));
        } else {
          // Leafy greens and beans.
          b.add(P.sphere(0.075, 0), { color: pick === 2 ? c(0x6fb84a) : c(0x3f8a2e), leaf: 1, sway: 0.2 }, M.t(x, bedY + 0.05, z, 0, rng.next() * 3, 0, 1.2, 0.55, 1.2));
        }
      }
    }
  }
  return b.build();
}

export const CHINAMPA_BED_Y = 0.14;
/** Centre x of each raised bed (three beds with two channels between them). */
export function chinampaBeds(w: number): number[] {
  const bw = (w - 0.6) / 3;
  return [-bw - 0.1, 0, bw + 0.1].map((x) => x * 1);
}

/**
 * Chinampa: three raised beds of dark lake mud edged with woven reed wattle, separated by water
 * channels, tall slim ahuejote willows at the corners and a canoe moored in a channel.
 */
export function chinampaModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.05, hd = d / 2 - 0.05;
  const bw = (w - 0.6) / 3 - 0.12;
  // Water between and around the beds.
  b.add(P.box(w - 0.1, 0.04, d - 0.1), { color: (p) => c(0x2f9fac).lerp(c(0x56c4c8), Math.sin(p.x * 5 + p.z * 3) * 0.25 + 0.3) }, M.t(0, 0.02, 0));
  for (const bx of chinampaBeds(w)) {
    b.add(P.rbox(bw, CHINAMPA_BED_Y, d - 0.5, 0.03), { color: (p) => (p.y > CHINAMPA_BED_Y - 0.02 ? c(0x4a3322) : c(0x5e4630)) }, M.t(bx, CHINAMPA_BED_Y / 2, 0));
    // Woven wattle edging with stakes.
    for (const side of [-1, 1]) {
      b.add(P.box(0.03, 0.1, d - 0.45), { color: (p) => ((p.z * 10) % 1 < 0.5 ? K.timber : K.rope).clone() }, M.t(bx + side * (bw / 2 + 0.01), CHINAMPA_BED_Y - 0.03, 0));
      for (let k = 0; k <= 5; k++) b.add(P.cyl(0.012, 0.012, 0.22, 4), { color: K.timberDark }, M.t(bx + side * (bw / 2 + 0.02), 0.1, -hd + 0.3 + (k / 5) * (d - 0.8)));
    }
  }
  // Ahuejote willows: tall, slim columns of foliage anchoring the corners.
  for (const [x, z] of [[-hw + 0.12, -hd + 0.12], [hw - 0.12, -hd + 0.12], [-hw + 0.12, hd - 0.12], [hw - 0.12, hd - 0.12]]) {
    b.add(P.cyl(0.035, 0.05, 1.2, 5), { color: K.timberDark, sway: (p) => p.y * 0.05 }, M.t(x, 0.6, z));
    for (let k = 0; k < 4; k++) b.add(P.sphere(0.16 - k * 0.02, 1), { color: c(0x4f8f38).lerp(c(0x8cbf4a), k * 0.25), leaf: 1, sway: (p) => 0.1 + p.y * 0.08 }, M.t(x, 1.05 + k * 0.28, z, 0, k, 0, 1, 1.5, 1));
  }
  // Canoe in a channel.
  const cx = (chinampaBeds(w)[0] + chinampaBeds(w)[1]) / 2;
  b.add(P.sphere(0.5, 1), { color: K.timber }, M.t(cx, 0.06, hd * 0.35, 0, 0, 0, 0.12, 0.08, 0.7));
  b.add(P.cyl(0.008, 0.008, 0.7, 3), { color: K.timberDark }, M.t(cx + 0.05, 0.2, hd * 0.35, 0.9, 0, 0));
  return { finished: b.build(), torches: [], height: 0.6 };
}

/**
 * Smokehouse: a flat-roofed adobe house with a smoke hole on the roof, two drying racks hung
 * with fish and strips of meat over a smouldering fire, and a stack of firewood.
 */
export function smokehouseModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hx = -w / 2 + 0.95, hz = -0.15;
  baseBand(b, 1.5, 1.5, hx, hz, 0.14);
  adobeBlock(b, 1.5, 0.85, 1.5, hx, 0, hz);
  // Soot-darkened chimney on the flat roof.
  b.add(P.rbox(0.34, 0.34, 0.34, 0.03), { color: (p) => AD.wall.clone().lerp(c(0x5a4a40), Math.max(0, p.y - 1.05) * 2.5) }, M.t(hx + 0.35, 1.1, hz - 0.3));
  b.add(P.box(0.2, 0.02, 0.2), { color: c(0x2a2220) }, M.t(hx + 0.35, 1.28, hz - 0.3));
  tealDoor(b, hx, 0.02, hz + 0.76, 0.28, 0.48);
  adobeWindow(b, hx - 0.5, 0.6, hz + 0.76);
  adobeWindow(b, hx + 0.76, 0.6, hz - 0.2, true);
  awning(b, hx, 0.66, hz + 0.72, 0.9, 0.34, false);
  // Drying racks: A-frame ends with two cross poles hung with fish and strips of meat.
  const rx = w / 2 - 0.7;
  for (const rz of [-0.55, 0.5]) {
    for (const ox of [-0.5, 0.5]) {
      for (const lean of [-0.28, 0.28]) b.add(P.cyl(0.022, 0.028, 1.05, 5), { color: K.timber }, M.t(rx + ox, 0.5, rz + lean * 0.5, lean, 0, 0));
    }
    for (const y of [0.72, 0.92]) {
      b.add(P.cyl(0.018, 0.018, 1.1, 4), { color: K.timberDark }, M.t(rx, y, rz, 0, 0, Math.PI / 2));
      for (let k = 0; k < 7; k++) {
        const x = rx - 0.42 + k * 0.14;
        if ((k + (y > 0.8 ? 1 : 0)) % 2 === 0) {
          b.add(P.sphere(0.06, 0), { color: c(0xc8a46a).lerp(c(0x8a5a30), (k % 3) * 0.2), sway: 0.1 }, M.t(x, y - 0.13, rz, 0, 0, 0, 0.42, 1.55, 0.75));
          b.add(P.cone(0.04, 0.05, 3), { color: c(0x7a4a28), sway: 0.1 }, M.t(x, y - 0.03, rz, Math.PI, 0, 0, 1, 1, 0.4));
        } else b.add(P.box(0.05, 0.17, 0.018), { color: c(0x9a3a22).lerp(c(0x5a2a1a), (k % 2) * 0.4), sway: 0.1 }, M.t(x, y - 0.1, rz, 0, 0, (k % 3 - 1) * 0.08));
      }
    }
  }
  // Smouldering fire pit under the racks.
  b.add(P.cyl(0.26, 0.3, 0.06, 8), { color: K.stoneDark }, M.t(rx, 0.03, 0));
  for (let k = 0; k < 3; k++) b.add(P.cyl(0.03, 0.03, 0.4, 5), { color: c(0x3a2820) }, M.t(rx, 0.08, 0, 0, (k / 3) * Math.PI, Math.PI / 2));
  b.add(P.sphere(0.09, 0), { color: c(0xe8702a) }, M.t(rx, 0.1, 0, 0, 0, 0, 1.3, 0.5, 1.3));
  // Firewood stacked against the house.
  for (let k = 0; k < 6; k++) b.add(P.cyl(0.045, 0.045, 0.55, 6), { color: K.timber }, M.t(hx - 0.3 + (k % 3) * 0.1, 0.05 + Math.floor(k / 3) * 0.09, d / 2 - 0.3, 0, 0, Math.PI / 2));
  pottedPlant(b, hx + 0.62, 0, hz + 0.95, 0.8);
  return { finished: b.build(), torches: [new THREE.Vector3(hx + 0.55, 0, hz + 0.9)], height: 1.35 };
}

/** Maize plants in neat rows (scaled vertically by growth). Cobs are coloured by `ripe`. */
function maizeCrops(w: number, d: number, ripe: boolean, tall = 1): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const rng = new RNG(ripe ? 7 : 8);
  const rows = Math.floor(w * 1.6);
  const cols = Math.floor(d * 2.4);
  const green = c(0x6fae3a), gold = c(0xd8b84a), tassel = c(0xe7d27a);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = -w / 2 + 0.55 + (r / Math.max(1, rows - 1)) * (w - 1.1);
      const z = -d / 2 + 0.55 + (k / Math.max(1, cols - 1)) * (d - 1.3);
      // Leave room for the crib and shelter in the back corners of the big maize field.
      if (tall > 1 && z < -d / 2 + 1.15 && (x < -w / 2 + 1.25 || x > w / 2 - 1.05)) continue;
      const h = rng.range(0.4, 0.55) * tall;
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

/** Butcher: an adobe workshop with a striped awning over the meat counter, beside the animal pen (pen centre at local +w/4). */
export function butcherModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hx = -w / 4 - 0.1;
  baseBand(b, 1.5, 1.5, hx, -0.05, 0.14);
  adobeBlock(b, 1.5, 0.82, 1.5, hx, 0, -0.05);
  adobeBlock(b, 0.7, 0.34, 0.7, hx - 0.3, 0.82, -0.3);
  tealDoor(b, hx + 0.35, 0.02, 0.71, 0.26, 0.46);
  adobeWindow(b, hx - 0.45, 0.58, 0.71, false, 0.3, 0.12);
  // Meat counter under a red and cream awning, with cuts hanging from the rail.
  awning(b, hx - 0.2, 0.7, 0.68, 1.05, 0.4, true);
  b.add(P.rbox(0.8, 0.32, 0.3, 0.03), { color: AD.wallLight }, M.t(hx - 0.3, 0.16, 0.9));
  b.add(P.box(0.7, 0.03, 0.22), { color: K.timber }, M.t(hx - 0.3, 0.33, 0.9));
  for (let k = 0; k < 4; k++) b.add(P.uvSphere(0.06, 6, 5), { color: k % 2 ? 0xb2503a : 0x9a3a2a }, M.t(hx - 0.6 + k * 0.2, 0.52, 1.02, 0, 0, 0, 0.8, 1.5, 0.8));
  b.add(P.cyl(0.12, 0.1, 0.1, 8), { color: K.terracotta }, M.t(hx - 0.05, 0.39, 0.88));
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
  const t = torchPole(b, hx + 0.85, 0.95);
  return { finished: b.build(), torches: [t], height: 1.5 };
}

/** Wood store: an open-fronted adobe shed with a flat roof on timber beams. Log/stone piles are separate fill meshes. */
export function woodstoreModel(w: number, d: number): BuildingModel {
  const b = new GeoBuilder();
  const hw = w / 2 - 0.12, hd = d / 2 - 0.12;
  const H = 0.95;
  b.add(P.rbox(w - 0.2, 0.06, d - 0.2, 0.03), { color: c(0xb8905e) }, M.t(0, 0.03, 0));
  // Back and side walls (open at the front).
  baseBand(b, w - 0.24, 0.2, 0, -hd + 0.1, 0.12);
  adobeBlock(b, w - 0.24, H, 0.2, 0, 0, -hd + 0.1, false);
  for (const sx of [-1, 1]) adobeBlock(b, 0.2, H, d - 0.35, sx * (hw - 0.1), 0, 0.05, false);
  // Flat roof slab with a parapet, resting on vigas whose ends poke out at the front.
  adobeBlock(b, w - 0.1, 0.1, d - 0.15, 0, H, 0.02);
  for (let k = 0; k < 5; k++) b.add(P.cyl(0.035, 0.035, d - 0.05, 6), { color: K.timber }, M.t(-hw + 0.2 + k * ((w - 0.64) / 4), H - 0.02, 0.08, Math.PI / 2, 0, 0));
  for (const sx of [-1, 1]) b.add(P.cyl(0.05, 0.06, H, 6), { color: K.timber }, M.t(sx * (hw - 0.1), H / 2, hd - 0.02));
  b.add(P.box(w - 0.3, 0.08, 0.08), { color: K.timberDark }, M.t(0, H - 0.05, hd - 0.02));
  // Chopping block with an axe, and a potted plant.
  b.add(P.cyl(0.14, 0.16, 0.22, 8), { color: K.timber }, M.t(hw + 0.05, 0.11, hd + 0.3));
  b.add(P.box(0.03, 0.26, 0.03), { color: K.timberDark }, M.t(hw + 0.05, 0.32, hd + 0.3, 0, 0, 0.5));
  b.add(P.box(0.1, 0.06, 0.02), { color: K.stoneDark }, M.t(hw - 0.02, 0.44, hd + 0.3, 0, 0, 0.5));
  pottedPlant(b, -hw - 0.05, 0, hd + 0.25, 0.8);
  return { finished: b.build(), torches: [new THREE.Vector3(-hw - 0.1, 0.9, hd + 0.2)], height: 1.2 };
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

/** Grain store: a two-storey adobe storehouse with a maize-yellow frieze and flat roof. Baskets/sacks are separate fill meshes. */
export function grainstoreModel(): BuildingModel {
  const b = new GeoBuilder();
  baseBand(b, 1.15, 1.15, 0, 0, 0.16);
  adobeBlock(b, 1.15, 0.95, 1.15, 0, 0, 0);
  adobeBlock(b, 0.7, 0.42, 0.7, 0.1, 0.95, -0.1);
  // Painted frieze of maize cobs around the walls.
  b.add(P.box(1.17, 0.08, 1.17), { color: K.gold }, M.t(0, 0.74, 0));
  for (let k = 0; k < 4; k++) b.add(P.cyl(0.03, 0.025, 0.1, 5), { color: c(0xe8c24a) }, M.t(-0.36 + k * 0.24, 0.74, 0.59, Math.PI / 2, 0, 0));
  tealDoor(b, 0, 0.02, 0.58, 0.28, 0.5);
  adobeWindow(b, 0.1, 1.18, 0.26);
  adobeWindow(b, 0.59, 0.5, 0.1, true);
  // Sacks drying on the roof.
  for (const [x, z] of [[-0.35, 0.3], [-0.3, 0.05]]) b.add(P.uvSphere(0.1, 7, 5), { color: c(0xd8c08a) }, M.t(x, 1.06, z, 0, 0, 0, 1.2, 0.8, 1));
  pottedPlant(b, 0.42, 0, 0.66, 0.8);
  return { finished: b.build(), torches: [new THREE.Vector3(0.6, 0.8, 0.7)], height: 1.6 };
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

/** War room: a fortified adobe hall with crenellated flat roofs, a red frieze, jaguar and eagle banners, spears and shields. */
export function warroomModel(): BuildingModel {
  const b = new GeoBuilder();
  b.add(P.rbox(2.6, 0.16, 2.4, 0.04), { color: K.stoneDark }, M.t(0, 0.08, 0));
  baseBand(b, 2.2, 1.9, 0, -0.1, 0.34);
  adobeBlock(b, 2.2, 1.05, 1.9, 0, 0.16, -0.1);
  adobeBlock(b, 1.0, 0.45, 0.9, -0.4, 1.21, -0.4);
  // Red frieze and merlons along the parapet.
  b.add(P.box(2.22, 0.1, 1.92), { color: AD.red }, M.t(0, 1.0, -0.1));
  for (let k = 0; k < 7; k++) for (const z of [-1.03, 0.83]) b.add(P.box(0.16, 0.16, 0.1), { color: AD.wallLight }, M.t(-0.99 + k * 0.33, 1.38, z));
  for (let k = 0; k < 5; k++) for (const x of [-1.08, 1.08]) b.add(P.box(0.1, 0.16, 0.16), { color: AD.wallLight }, M.t(x, 1.38, -0.85 + k * 0.33));
  tealDoor(b, 0, 0.16, 0.86, 0.46, 0.62);
  b.add(P.box(0.62, 0.1, 0.08), { color: K.gold }, M.t(0, 0.86, 0.88));
  for (const x of [-0.7, 0.7]) adobeWindow(b, x, 0.72, 0.86, false, 0.1, 0.22);
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
  return { finished: b.build(), torches: [new THREE.Vector3(-0.5, 0.95, 1.05), new THREE.Vector3(0.5, 0.95, 1.05)], height: 1.7 };
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

/**
 * Trade Dock: an adobe trading house with a striped awning over crates of goods, and a wide pier
 * on posts with a big T-end where the trade boats moor. Deck along +z like the jetty.
 */
export function tradeDockModel(landY: number, length: number): BuildingModel {
  const b = new GeoBuilder();
  const deckY = 0.32 - landY;
  // Trading house on land (flat roof, parapet, teal door, awning over the goods).
  baseBand(b, 1.2, 1.0, -0.35, -0.4, 0.12);
  adobeBlock(b, 1.2, 0.8, 1.0, -0.35, 0, -0.4);
  adobeBlock(b, 0.55, 0.3, 0.5, -0.55, 0.8, -0.55);
  tealDoor(b, -0.2, 0.02, 0.11, 0.26, 0.46);
  adobeWindow(b, -0.7, 0.55, 0.11);
  awning(b, 0.35, 0.62, 0.05, 0.7, 0.34, true);
  for (let k = 0; k < 3; k++) b.add(P.rbox(0.22, 0.2, 0.22, 0.03), { color: k % 2 ? K.timber : c(0xa87a4a) }, M.t(0.15 + k * 0.24, 0.1, 0.25, 0, k * 0.3, 0));
  b.add(P.uvSphere(0.1, 7, 5), { color: c(0xd8c08a) }, M.t(0.55, 0.3, 0.2, 0, 0, 0, 1.1, 0.8, 1));
  b.add(P.cyl(0.09, 0.08, 0.2, 8), { color: K.terracotta }, M.t(0.72, 0.1, 0.42));
  // Ramp from land level down to the deck.
  const rampLen = 1.0;
  const rampDrop = Math.min(0, deckY);
  b.add(P.box(1.1, 0.06, rampLen), { color: c(0xa8784a) }, M.t(0.5, rampDrop / 2 + 0.03, 0.75, Math.atan2(-rampDrop, rampLen), 0, 0));
  // Wide pier.
  const z0 = 1.2, z1 = 1.2 + length;
  for (let z = z0; z < z1; z += 0.26) b.add(P.box(1.15, 0.05, 0.22), { color: Math.round(z * 4) % 2 ? c(0xa8784a) : c(0x94663c) }, M.t(0.5, deckY, z + 0.11));
  for (let z = z0; z <= z1; z += 1.2) for (const x of [-0.05, 1.05]) b.add(P.cyl(0.055, 0.055, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z));
  // Big T-end with mooring posts, bales and a flag.
  b.add(P.box(3.4, 0.05, 1.1), { color: c(0xa8784a) }, M.t(0.5, deckY, z1 + 0.4));
  for (const x of [-1.1, 0.5, 2.1]) b.add(P.cyl(0.055, 0.055, 2.6, 6), { color: K.timberDark }, M.t(x, deckY - 1.2, z1 + 0.4));
  for (const x of [-1.05, 2.05]) {
    b.add(P.cyl(0.05, 0.06, 0.35, 6), { color: K.timberDark }, M.t(x, deckY + 0.17, z1 + 0.85));
    b.add(P.torus(0.07, 0.02, 4, 10), { color: K.rope }, M.t(x, deckY + 0.3, z1 + 0.85, Math.PI / 2, 0, 0));
  }
  b.add(P.rbox(0.32, 0.28, 0.32, 0.03), { color: 0xa87a4a }, M.t(0.0, deckY + 0.16, z1 + 0.25));
  b.add(P.rbox(0.26, 0.22, 0.26, 0.03), { color: 0x94663c }, M.t(0.05, deckY + 0.41, z1 + 0.27, 0, 0.4, 0));
  b.add(P.uvSphere(0.14, 7, 5), { color: c(0xd8c08a) }, M.t(1.1, deckY + 0.12, z1 + 0.3, 0, 0, 0, 1.2, 0.8, 1));
  b.add(P.cyl(0.03, 0.035, 1.9, 5), { color: K.timberDark }, M.t(1.7, deckY + 0.95, z1 + 0.2));
  b.add(P.box(0.02, 0.36, 0.55), { color: (p) => ((p.y * 10) % 1 < 0.33 ? AD.red : (p.y * 10) % 1 < 0.66 ? K.gold : K.jade).clone(), sway: 0.5 }, M.t(1.7, deckY + 1.66, z1 - 0.08));
  const torches = [new THREE.Vector3(-1.1, deckY + 0.8, z1 + 0.85), new THREE.Vector3(2.1, deckY + 0.8, z1 + 0.85)];
  for (const t of torches) {
    b.add(P.cyl(0.025, 0.035, 0.75, 5), { color: K.timberDark }, M.t(t.x, t.y - 0.45, t.z));
    b.add(P.cyl(0.07, 0.04, 0.08, 7), { color: K.stoneDark }, M.t(t.x, t.y - 0.08, t.z));
  }
  return { finished: b.build(), torches, height: 1.3 };
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

// ---------------- Great Hall ----------------

/**
 * Layout of the Great Hall (model-local, door faces +z): a raised stone platform reached by a
 * wide front stair, benches in rows under a striped canopy facing a sun-disc dais at the back,
 * and standing room round the edges. Shared by the model and the villagers who use it.
 */
export const HALL = {
  /** Platform height and half-extent; the front stair's half-width and the foot of the stair. */
  h: 0.5,
  edge: 2.75,
  stairHalf: 0.7,
  stairFoot: 3.5,
  /** Seats (hip position; seated villagers face -z, toward the dais). */
  seats: [-1.05, -0.35, 0.35, 1.05].flatMap((z) => [-1.25, -0.85, -0.45, 0.45, 0.85, 1.25].map((x) => ({ x, z }))),
  /** Standing room along the front terrace and the sides (facing the middle). */
  stands: [
    ...[-1.6, -0.95, 0.95, 1.6].map((x) => ({ x, z: 2.2 })),
    ...[-1.6, -0.55, 0.55, 1.6].flatMap((z) => [{ x: -2.25, z }, { x: 2.25, z }]),
  ],
  /** Where the bell hangs from the front canopy beam (its pivot). */
  bell: new THREE.Vector3(0, 0.5 + 1.24, 1.95),
  /** Floor height at a local point: the platform top, the stair, else the ground. */
  floorY(lx: number, lz: number): number {
    const H = HALL.h, E = HALL.edge;
    if (Math.abs(lx) <= E && Math.abs(lz) <= E) return H;
    if (Math.abs(lx) <= HALL.stairHalf && lz > E && lz < HALL.stairFoot) return (H * (HALL.stairFoot - lz)) / (HALL.stairFoot - E);
    return 0;
  },
};

/** A fern: a fan of long drooping fronds. */
function fern(b: GeoBuilder, x: number, y: number, z: number, s: number, seed: number): void {
  const r = new RNG(seed);
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.range(-0.3, 0.3);
    const col = c(0x3f8a34).lerp(c(0x7cbc4c), r.next());
    // Each frond: two segments, rising from the crown then arching over and down.
    const lift = r.range(0.5, 0.9);
    const L = 0.26 * s * r.range(0.85, 1.15);
    const base = M.t(x, y, z).multiply(M.t(0, 0, 0, 0, a, 0));
    b.add(P.box(0.09 * s, 0.014, L), { color: col, leaf: 1, sway: 0.4 }, base.clone().multiply(M.t(0, 0, 0, -lift, 0, 0)).multiply(M.t(0, 0, L / 2)));
    const tip = base.clone().multiply(M.t(0, 0, 0, -lift, 0, 0)).multiply(M.t(0, 0, L)).multiply(M.t(0, 0, 0, lift + 0.45, 0, 0));
    b.add(P.box(0.075 * s, 0.012, L * 0.9), { color: col.clone().multiplyScalar(1.08), leaf: 1, sway: 0.7 }, tip.multiply(M.t(0, 0, L * 0.45)));
  }
}

/** A broad-leaved tropical plant (like a young banana or elephant ear). */
function broadLeaf(b: GeoBuilder, x: number, y: number, z: number, s: number, seed: number): void {
  const r = new RNG(seed);
  const n = 5;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r.range(-0.4, 0.4);
    const col = c(0x2f7a2e).lerp(c(0x5ea43c), r.next());
    const lift = r.range(0.35, 0.7);
    const m = M.t(x, y, z).multiply(M.t(0, 0, 0, 0, a, 0)).multiply(M.t(0, 0, 0, -lift - 0.4, 0, 0));
    b.add(P.cyl(0.01, 0.014, 0.22 * s, 3), { color: c(0x4c8a34) }, m.clone().multiply(M.t(0, 0.11 * s, 0)));
    const leaf = m.clone().multiply(M.t(0, 0.22 * s, 0)).multiply(M.t(0, 0, 0, 0.9, 0, 0));
    b.add(new THREE.OctahedronGeometry(0.1 * s, 0), { color: col, leaf: 1, sway: 0.6 }, leaf.multiply(M.t(0, 0, 0.1 * s, 0, 0, 0, 0.75, 0.12, 1.4)));
  }
}

/** A grid of slabs (w × d cells of size `cell`), each coloured on its own. */
function slabs(b: GeoBuilder, x0: number, z0: number, w: number, d: number, cell: number, y: number, h: number, color: (i: number, j: number) => THREE.Color, skip?: (x: number, z: number) => boolean): void {
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const x = x0 + (i + 0.5) * cell, z = z0 + (j + 0.5) * cell;
      if (skip?.(x, z)) continue;
      b.add(P.box(cell - 0.012, h, cell - 0.012), { color: color(i, j) }, M.t(x, y + h / 2, z));
    }
  }
}

/** A cheap flower head (8 faces). */
const FLOWER = new THREE.OctahedronGeometry(0.045, 0);

/** A clump of red (and a few orange) tropical flowers on short stems. */
function blooms(b: GeoBuilder, x: number, y: number, z: number, n: number, sx: number, sz: number, seed: number): void {
  const r = new RNG(seed);
  for (let k = 0; k < n; k++) {
    const px = x + r.range(-sx, sx), pz = z + r.range(-sz, sz);
    const h = r.range(0.1, 0.2);
    b.add(P.cyl(0.008, 0.01, h, 3), { color: c(0x3c7a2e) }, M.t(px, y + h / 2, pz));
    const petal = r.next() < 0.75 ? c(0xd8322a) : c(0xef7a22);
    b.add(FLOWER, { color: (q) => (q.y > y + h + 0.035 ? c(0xf2d04a) : petal.clone()), leaf: 1 }, M.t(px, y + h + 0.02, pz, 0, r.next() * 3, 0, 1, 0.6, 1));
  }
}

/** A long red banner with a golden sun, hung flat against a face (facing +z before rotation). */
function sunBanner(b: GeoBuilder, m: THREE.Matrix4, w: number, h: number): void {
  const at = (x: number, y: number, z: number) => m.clone().multiply(M.t(x, y, z));
  b.add(P.box(w, h, 0.02), { color: K.red }, m);
  b.add(P.box(w * 1.08, 0.035, 0.03), { color: K.gold }, at(0, h / 2, 0.005));
  b.add(P.box(w * 0.9, 0.02, 0.022), { color: K.gold }, at(0, -h / 2 + 0.03, 0.006));
  b.add(P.cyl(w * 0.24, w * 0.24, 0.012, 10), { color: K.gold }, at(0, h * 0.12, 0.014).multiply(M.t(0, 0, 0, Math.PI / 2, 0, 0)));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.add(P.box(0.018, w * 0.13, 0.01), { color: K.gold }, at(Math.cos(a) * w * 0.33, h * 0.12 + Math.sin(a) * w * 0.33, 0.016).multiply(M.t(0, 0, 0, 0, 0, a - Math.PI / 2)));
  }
}

/** The Great Hall's bronze bell with its clapper (pivot at the top, hanging down -y). */
export function hallBellGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const pts = [
    [0.0, 0], [0.035, 0], [0.05, -0.02], [0.06, -0.07], [0.075, -0.13], [0.11, -0.19], [0.12, -0.2], [0.0, -0.2],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const bronze = c(0xb5832e);
  // Hung on a short rope below the beam, bigger than life so it reads from the usual camera.
  const S = 1.6, drop = 0.1;
  b.add(P.cyl(0.012, 0.012, drop, 4), { color: K.rope }, M.t(0, -drop / 2, 0));
  b.add(new THREE.LatheGeometry(pts, 12), { color: bronze }, M.t(0, -drop, 0, 0, 0, 0, S));
  b.add(P.cyl(0.12 * S, 0.12 * S, 0.02, 12), { color: c(0xd9a54a) }, M.t(0, -drop - 0.19 * S, 0));
  b.add(P.box(0.05, 0.05, 0.05), { color: K.timberDark }, M.t(0, -drop + 0.01, 0));
  b.add(P.sphere(0.04, 0), { color: c(0x5a4630) }, M.t(0, -drop - 0.21 * S, 0));
  return b.build();
}

/**
 * Great Hall: a two-stepped sandstone platform with red key-pattern panels, a wide front stair
 * with a red runner between stone cheeks, four corner pillars hung with sun banners and topped
 * with fire braziers, and a red-and-white striped canopy on timber posts sheltering rows of
 * benches that face a sun-disc dais. Ferns and red flowers fill planters beside the stair and
 * along the sides. The bell under the front beam is a separate mesh (it swings when rung).
 */
export function greatHallModel(): BuildingModel {
  const b = new GeoBuilder();
  const rng = new RNG(707);
  const H = HALL.h, E = HALL.edge;
  const sand = c(0xdcb57c), sandDark = c(0xc39a62), cream = c(0xf1e2c0);
  const pave = (i: number, j: number) => c(0xcfc5b3).lerp(c(0xa39683), ((i * 7 + j * 13) % 5) / 6 + rng.range(0, 0.15));
  // Paved court round the platform.
  b.add(P.box(6.95, 0.012, 6.95), { color: c(0x9c917f) }, M.t(0, 0.006, 0));
  slabs(b, -3.45, -3.45, 14, 14, 6.9 / 14, 0.004, 0.022, pave, (x, z) => Math.abs(x) < E + 0.15 && Math.abs(z) < E + 0.15);
  // Lower step: a course of blocks; then the platform proper under a sand-coloured coping.
  b.add(P.box(2 * E + 0.4, 0.2, 2 * E + 0.4), { color: K.stoneDark }, M.t(0, 0.1, 0));
  for (let side = 0; side < 4; side++) {
    const ry = (side * Math.PI) / 2;
    for (let k = 0; k < 10; k++) {
      const u = -E - 0.2 + ((2 * E + 0.4) / 10) * (k + 0.5);
      b.add(P.box((2 * E + 0.4) / 10 - 0.02, 0.17, 0.03), { color: k % 2 ? K.stone : c(0xb4a894) }, M.t(Math.sin(ry) * (E + 0.2) + Math.cos(ry) * u, 0.1, Math.cos(ry) * (E + 0.2) - Math.sin(ry) * u, 0, ry, 0));
    }
  }
  b.add(P.box(2 * E, H - 0.2, 2 * E), { color: sand }, M.t(0, 0.2 + (H - 0.2) / 2, 0));
  b.add(P.box(2 * E + 0.06, 0.05, 2 * E + 0.06), { color: sandDark }, M.t(0, H - 0.025, 0));
  // Red key-pattern panels round the sides (not across the stair).
  const panel = (m: THREE.Matrix4) => {
    b.add(P.box(0.46, 0.17, 0.02), { color: K.red }, m);
    b.add(P.box(0.3, 0.09, 0.024), { color: cream }, m.clone().multiply(M.t(0, 0, 0.002)));
    b.add(P.box(0.18, 0.035, 0.028), { color: K.red }, m.clone().multiply(M.t(-0.02, 0.012, 0.002)));
    b.add(P.box(0.035, 0.07, 0.028), { color: K.red }, m.clone().multiply(M.t(0.08, 0, 0.002)));
  };
  for (let side = 0; side < 4; side++) {
    const ry = (side * Math.PI) / 2;
    for (let k = -2; k <= 2; k++) {
      if (side === 0 && Math.abs(k) < 1) continue;
      const u = k * 1.0;
      const m = M.t(Math.sin(ry) * (E + 0.011) + Math.cos(ry) * u, 0.33, Math.cos(ry) * (E + 0.011) - Math.sin(ry) * u, 0, ry, 0);
      panel(m);
    }
  }
  // Floor: pale stone slabs, a red border inlay and a red runner up the aisle to the dais.
  slabs(b, -E + 0.05, -E + 0.05, 9, 9, (2 * E - 0.1) / 9, H, 0.02, (i, j) => ((i + j) % 2 ? cream.clone() : c(0xe4d0a8)));
  for (const s of [-1, 1]) {
    b.add(P.box(2 * E - 0.5, 0.012, 0.08), { color: K.red }, M.t(0, H + 0.022, s * (E - 0.3)));
    b.add(P.box(0.08, 0.012, 2 * E - 0.5), { color: K.red }, M.t(s * (E - 0.3), H + 0.022, 0));
  }
  b.add(P.box(0.42, 0.014, 4.6), { color: c(0xa92c22) }, M.t(0, H + 0.024, 0.3));
  // Front stair: red risers, cream treads, stone cheeks either side.
  const steps = 5, run = (HALL.stairFoot - E) / steps, rise = H / steps;
  for (let k = 0; k < steps; k++) {
    const top = H - k * rise, z = E + run * (k + 0.5);
    b.add(P.box(HALL.stairHalf * 2, top - 0.025, run), { color: K.red }, M.t(0, (top - 0.025) / 2, z));
    b.add(P.box(HALL.stairHalf * 2 + 0.02, 0.025, run + 0.02), { color: cream }, M.t(0, top - 0.0125, z));
  }
  // Sloped stone cheeks either side of the stair.
  const cheekShape = new THREE.Shape([
    new THREE.Vector2(E - 0.05, 0), new THREE.Vector2(HALL.stairFoot + 0.06, 0), new THREE.Vector2(HALL.stairFoot + 0.06, 0.1), new THREE.Vector2(E - 0.05, H + 0.08),
  ]);
  const cheekGeo = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.2, bevelEnabled: false });
  for (const sx of [-1, 1]) {
    b.add(cheekGeo, { color: K.stone }, M.t(sx * (HALL.stairHalf + 0.1) + 0.1, 0, 0, 0, -Math.PI / 2, 0));
  }
  // Corner pillars: plinth, banded shaft, sun banners on the outer faces, a brazier on top.
  const torches: THREE.Vector3[] = [];
  const PC = 2.3, PH = 1.45;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * PC, z = sz * PC;
      b.add(P.box(0.7, 0.14, 0.7), { color: sandDark }, M.t(x, H + 0.07, z));
      b.add(P.box(0.55, PH, 0.55), { color: sand }, M.t(x, H + 0.14 + PH / 2, z));
      b.add(P.box(0.57, 0.09, 0.57), { color: K.red }, M.t(x, H + 0.14 + PH * 0.86, z));
      b.add(P.box(0.575, 0.03, 0.575), { color: K.gold }, M.t(x, H + 0.14 + PH * 0.86 + 0.06, z));
      b.add(P.box(0.575, 0.03, 0.575), { color: K.gold }, M.t(x, H + 0.14 + PH * 0.86 - 0.06, z));
      b.add(P.box(0.64, 0.08, 0.64), { color: cream }, M.t(x, H + 0.14 + PH + 0.04, z));
      b.add(P.box(0.08, 0.08, 0.08), { color: K.gold }, M.t(x + sx * 0.28, H + 0.14 + PH + 0.12, z + sz * 0.28));
      // Banners on the two outward faces.
      sunBanner(b, M.t(x, H + 0.14 + PH * 0.42, z + sz * 0.286, 0, sz > 0 ? 0 : Math.PI, 0), 0.34, 0.62);
      sunBanner(b, M.t(x + sx * 0.286, H + 0.14 + PH * 0.42, z, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2, 0), 0.34, 0.62);
      // Brazier: a stone bowl on a short stem.
      const top = H + 0.14 + PH + 0.08;
      b.add(P.cyl(0.07, 0.1, 0.1, 8), { color: K.stoneDark }, M.t(x, top + 0.05, z));
      b.add(P.cyl(0.24, 0.12, 0.14, 10), { color: c(0x7d746c) }, M.t(x, top + 0.17, z));
      b.add(P.cyl(0.2, 0.2, 0.02, 10), { color: c(0x2a1c14) }, M.t(x, top + 0.23, z));
      torches.push(new THREE.Vector3(x, top + 0.3, z));
    }
  }
  // Canopy: six timber posts, beams, and a low striped gable roof with a red fascia and gold studs.
  const PX = 1.75, PZ = [-1.9, 0, 1.9], CH = H + 1.3;
  for (const sx of [-1, 1]) {
    for (const z of PZ) {
      b.add(P.box(0.13, 1.3, 0.13), { color: K.timberDark }, M.t(sx * PX, H + 0.65, z));
      b.add(P.box(0.18, 0.08, 0.18), { color: K.timber }, M.t(sx * PX, H + 0.04, z));
    }
    b.add(P.box(0.14, 0.12, 4.2), { color: K.timber }, M.t(sx * PX, CH, 0));
  }
  for (const z of PZ) b.add(P.box(3.7, 0.1, 0.12), { color: K.timber }, M.t(0, CH - 0.02, z));
  const roof = new GeoBuilder();
  const RW = 2.25, RL = 4.8, rise2 = 0.32, slope = Math.atan2(rise2, RW);
  const bands = 12;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < bands; k++) {
      const z = -RL / 2 + (RL / bands) * (k + 0.5);
      const m = M.t(sx * RW / 2, CH + 0.1 + rise2 / 2, z, 0, 0, -sx * slope);
      roof.add(P.box(Math.hypot(RW, rise2) + 0.02, 0.05, RL / bands + 0.002), { color: k % 2 ? K.white : K.red }, m);
    }
    // Fascia board along the eave, studded with gold blocks.
    roof.add(P.box(0.06, 0.12, RL + 0.04), { color: c(0x9e2c22) }, M.t(sx * (RW + 0.01), CH + 0.08, 0));
    for (let k = 0; k <= 4; k++) roof.add(P.box(0.1, 0.1, 0.1), { color: K.gold }, M.t(sx * (RW + 0.05), CH + 0.08, -RL / 2 + (RL / 4) * k));
  }
  roof.add(P.box(0.12, 0.1, RL + 0.1), { color: K.gold }, M.t(0, CH + 0.1 + rise2 + 0.03, 0));
  for (const sz of [-1, 1]) roof.add(P.box(2 * RW + 0.1, 0.1, 0.06), { color: c(0x9e2c22) }, M.t(0, CH + 0.06, sz * (RL / 2 + 0.01)));
  // Benches in rows (facing the dais), each a plank on two legs.
  for (const z of [-1.05, -0.35, 0.35, 1.05]) {
    for (const sx of [-1, 1]) {
      b.add(P.box(1.25, 0.04, 0.17), { color: K.timber }, M.t(sx * 0.85, H + 0.12, z - 0.03));
      for (const lx of [0.32, 1.38]) b.add(P.box(0.05, 0.11, 0.13), { color: K.timberDark }, M.t(sx * lx, H + 0.055, z - 0.03));
    }
  }
  // Dais at the back: a low step, a carved stela with a great golden sun, and two pots of ferns.
  b.add(P.box(2.4, 0.09, 0.8), { color: sandDark }, M.t(0, H + 0.045, -2.15));
  b.add(P.box(1.0, 0.95, 0.18), { color: sand }, M.t(0, H + 0.09 + 0.475, -2.4));
  b.add(P.box(1.06, 0.07, 0.22), { color: K.red }, M.t(0, H + 0.09 + 0.98, -2.4));
  b.add(P.cyl(0.34, 0.34, 0.04, 16), { color: K.gold }, M.t(0, H + 0.62, -2.3, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.2, 0.2, 0.05, 12), { color: K.red }, M.t(0, H + 0.62, -2.29, Math.PI / 2, 0, 0));
  b.add(P.cyl(0.1, 0.1, 0.06, 10), { color: K.gold }, M.t(0, H + 0.62, -2.28, Math.PI / 2, 0, 0));
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.add(P.cone(0.05, 0.12, 4), { color: K.gold }, M.t(Math.cos(a) * 0.42, H + 0.62 + Math.sin(a) * 0.42, -2.3, 0, 0, a - Math.PI / 2));
  }
  for (const sx of [-1, 1]) {
    b.add(P.cyl(0.13, 0.1, 0.2, 8), { color: K.terracotta }, M.t(sx * 0.85, H + 0.19, -2.25));
    fern(b, sx * 0.85, H + 0.22, -2.25, 0.8, 30 + sx);
  }
  // Planters: beside the stair and along the sides, full of ferns and red flowers.
  const planter = (x: number, z: number, w: number, d: number, seed: number) => {
    b.add(P.box(w, 0.22, d), { color: sand }, M.t(x, 0.11, z));
    b.add(P.box(w + 0.03, 0.05, d + 0.03), { color: K.red }, M.t(x, 0.245, z));
    b.add(P.box(w - 0.08, 0.02, d - 0.08), { color: c(0x4a3624) }, M.t(x, 0.26, z));
    const long = Math.max(w, d), along = w >= d;
    const n = Math.max(1, Math.round(long / 0.4));
    for (let k = 0; k < n; k++) {
      const u = -long / 2 + (long / n) * (k + 0.5);
      const px = along ? x + u : x + rng.range(-0.04, 0.04), pz = along ? z + rng.range(-0.06, 0.06) : z + u;
      if (k % 2) broadLeaf(b, px, 0.27, pz, 1.3 + rng.range(-0.2, 0.25), seed + k);
      else fern(b, px, 0.27, pz, 1.25 + rng.range(-0.15, 0.25), seed + k);
    }
    blooms(b, x, 0.26, z, Math.round(long * 9), w / 2 - 0.08, d / 2 - 0.08, seed + 50);
  };
  for (const s of [-1, 1]) {
    planter(s * 1.75, 3.15, 1.6, 0.55, 400 + s);
    planter(s * 3.2, 0, 0.45, 2.4, 500 + s);
  }
  // Banner poles at the front corners of the court.
  for (const s of [-1, 1]) {
    const x = s * 3.1, z = 3.1;
    b.add(P.cyl(0.035, 0.045, 1.6, 6), { color: K.timberDark }, M.t(x, 0.8, z));
    b.add(P.box(0.4, 0.035, 0.035), { color: K.timberDark }, M.t(x, 1.52, z + 0.0));
    sunBanner(b, M.t(x, 1.2, z + 0.03), 0.3, 0.6);
  }
  // Bell frame under the front beam (the bell itself swings separately).
  b.add(P.box(0.05, 0.1, 0.05), { color: K.timberDark }, M.t(0, HALL.bell.y + 0.04, HALL.bell.z));
  return { finished: b.build(), torches, height: 2.4, canopy: roof.build() };
}
