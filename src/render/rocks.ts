import * as THREE from 'three';
import { RNG } from '../world/rng';
import { ColorFn } from './GeoBuilder';

/**
 * Chunky faceted rocks in the style of the island's cliffs: angular prisms with a chamfered,
 * tilted top, flat-shaded, warm grey with lighter sunlit tops, moss on the flatter crowns and a
 * darker wet band where water washes them. Used for the waterfall's rock columns and the coastal
 * rocks the waves break on.
 */

const c = (h: number) => new THREE.Color(h);
export const ROCK_PAL = {
  dark: c(0x7c7570),
  side: c(0x9a928b),
  light: c(0xb3aba2),
  top: c(0xc6beb2),
  moss: c(0x6a8d35),
  mossLight: c(0x8aab45),
  wet: c(0x4a4a4e),
};

const hash = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * One rock: a 5-7 sided prism, base ring slightly below y = 0 (so it sits embedded), a waist
 * ring, and a smaller, tilted top ring with a low peak. Unit size: about 2 across and 1 tall
 * (scale it with a matrix). Non-indexed with flat normals.
 */
export function angularRockGeometry(seed: number, opts: { sides?: number; taper?: number; tilt?: number } = {}): THREE.BufferGeometry {
  const r = new RNG(seed);
  const n = opts.sides ?? r.int(5, 7);
  const taper = opts.taper ?? r.range(0.55, 0.78);
  const tilt = opts.tilt ?? 0.14;
  const a0 = r.range(0, Math.PI * 2);
  const ring = (y: number, rad: number, jy: number) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + r.range(-0.25, 0.25);
      const rr = rad * r.range(0.82, 1.12);
      pts.push(new THREE.Vector3(Math.cos(a) * rr, y + r.range(-jy, jy), Math.sin(a) * rr));
    }
    return pts;
  };
  const base = ring(-0.25, 1.0, 0.02);
  const waist = ring(r.range(0.5, 0.72), r.range(0.92, 1.02), 0.06);
  // Tilted top: one side higher than the other, like a broken column.
  const tx = r.range(-1, 1), tz = r.range(-1, 1);
  const top = ring(1, taper, 0.05).map((p) => p.setY(p.y + (p.x * tx + p.z * tz) * tilt));
  const peak = new THREE.Vector3(r.range(-0.12, 0.12), 1.04 + r.range(0, 0.06), r.range(-0.12, 0.12));
  const pos: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c2: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c2.x, c2.y, c2.z);
  for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n;
    // Sides (two bands), wound so faces point outward.
    tri(base[k], waist[k2], base[k2]);
    tri(base[k], waist[k], waist[k2]);
    tri(waist[k], top[k2], waist[k2]);
    tri(waist[k], top[k], top[k2]);
    // Top facets up to the low peak.
    tri(top[k], peak, top[k2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Colour for faceted rocks (world-space position and normal): warm grey sides, lighter tops,
 * moss on the flatter crowns (amount 0..1), darker below `wetY`.
 */
export function rockColor(moss = 0.5, wetY = -Infinity): ColorFn {
  return (p, n) => {
    const up = n.y * 0.5 + 0.5;
    const v = hash(Math.floor(p.x * 3), Math.floor(p.y * 3), Math.floor(p.z * 3));
    let col = ROCK_PAL.dark.clone().lerp(ROCK_PAL.side, Math.min(1, up * 1.3)).lerp(ROCK_PAL.light, Math.max(0, up - 0.6) * 1.6);
    if (n.y > 0.8) col.lerp(ROCK_PAL.top, 0.5);
    col.multiplyScalar(0.92 + v * 0.14);
    if (moss > 0 && n.y > 0.62 && hash(Math.round(p.x * 1.7), 0, Math.round(p.z * 1.7)) < moss) col = ROCK_PAL.moss.clone().lerp(ROCK_PAL.mossLight, v);
    if (p.y < wetY) col.lerp(ROCK_PAL.wet, 0.55);
    return col;
  };
}
