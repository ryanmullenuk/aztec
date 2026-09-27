import * as THREE from 'three';
import { GeoBuilder, M, P, doubleSide, facet } from '../render/GeoBuilder';

export type FishType = 'blueYellow' | 'yellow' | 'clown' | 'idol' | 'silver' | 'tang';

type Col = (p: THREE.Vector3) => THREE.Color;
type V2 = [number, number];

const col = (hex: number) => new THREE.Color(hex);

/**
 * A fish body: elliptical rings along z from the nose (+len/2) back to a slim tail stalk,
 * heights and widths set by the profile. Returns the geometry and a helper giving the
 * body's top/bottom/side at any z, so fins can grow straight out of the skin.
 */
function body(len: number, h: number, w: number, opts: { hump?: number; snout?: number; peduncle?: number } = {}) {
  const rings = 18, seg = 12;
  const pd = opts.peduncle ?? 0.16;
  const prof = (t: number) => {
    // t: 0 at the nose, 1 at the tail stalk. Blunt round front, long taper behind.
    const a = Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.62) * 0.94 + 0.03));
    return Math.max(pd, a) * (t > 0.85 ? 1 - (t - 0.85) * 0.4 : 1);
  };
  const z0 = len / 2, z1 = -len / 2;
  const zAt = (t: number) => z0 + (z1 - z0) * t;
  const hump = opts.hump ?? 0;
  const snout = opts.snout ?? 0;
  // Centre line: a hump pushes the back up; a snout drops the nose a little.
  const cy = (t: number) => hump * h * 0.18 * Math.sin(Math.PI * t) - snout * h * 0.15 * Math.max(0, 0.25 - t) * 4;
  const hh = (t: number) => (h / 2) * prof(t) * (1 + hump * 0.25 * Math.sin(Math.PI * Math.min(1, t * 1.6)));
  const ww = (t: number) => (w / 2) * prof(t);
  const pos: number[] = [];
  const idx: number[] = [];
  // Nose tip vertex (pushed forward for snouted fish).
  pos.push(0, cy(0) - snout * h * 0.1, z0 + snout * len * 0.12);
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      // Slightly flatter belly than back.
      const sy = Math.cos(a);
      pos.push(Math.sin(a) * ww(t), cy(t) + sy * hh(t) * (sy < 0 ? 0.92 : 1), zAt(t));
    }
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < seg; s++) {
      const a = 1 + r * seg + s, b = 1 + r * seg + ((s + 1) % seg);
      const c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Cap the tail stalk.
  const last = 1 + (rings - 1) * seg;
  pos.push(0, cy(1), z1);
  const cap = pos.length / 3 - 1;
  for (let s = 0; s < seg; s++) idx.push(cap, last + ((s + 1) % seg), last + s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tOf = (z: number) => THREE.MathUtils.clamp((z0 - z) / len, 0, 1);
  return {
    geo: g,
    len,
    z0,
    z1,
    top: (z: number) => cy(tOf(z)) + hh(tOf(z)),
    bot: (z: number) => cy(tOf(z)) - hh(tOf(z)) * 0.92,
    mid: (z: number) => cy(tOf(z)),
    side: (z: number) => ww(tOf(z)),
    half: (z: number) => hh(tOf(z)),
  };
}

/** A thin sheet joining two polylines (a fin's base along the body and its outer edge). */
function sheet(base: THREE.Vector3[], edge: THREE.Vector3[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = base.length;
  for (const p of base) pos.push(p.x, p.y, p.z);
  for (const p of edge) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < n - 1; i++) {
    const a = i, b = i + 1, c = n + i, d = n + i + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return doubleSide(g);
}

interface FinSpec {
  /** From and to z along the back/belly. */
  z: V2;
  /** Height of the fin along its length (t 0 → 1, front → back). */
  height: (t: number) => number;
  /** How far the outer edge sweeps back (fraction of the fin's own length). */
  rake?: number;
}

/**
 * Builds a fish: body + dorsal, anal, pectoral, pelvic and caudal fins, all rooted in the
 * skin so they flex with it, plus eyes with a pale ring and a gill line.
 */
class FishBuilder {
  readonly b = new GeoBuilder();
  readonly B: ReturnType<typeof body>;

  constructor(len: number, h: number, w: number, bodyCol: Col, opts: { hump?: number; snout?: number; peduncle?: number } = {}) {
    this.B = body(len, h, w, opts);
    this.b.add(this.B.geo, { color: bodyCol });
  }

  /** Fin along the back (up = 1) or belly (up = -1). */
  private ridge(spec: FinSpec, up: 1 | -1, c: Col): void {
    const n = 7;
    const base: THREE.Vector3[] = [], edge: THREE.Vector3[] = [];
    const [za, zb] = spec.z;
    const span = za - zb;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const z = za - span * t;
      const y = (up > 0 ? this.B.top(z) : this.B.bot(z)) - up * 0.002;
      base.push(new THREE.Vector3(0, y, z));
      edge.push(new THREE.Vector3(0, y + up * spec.height(t), z - span * (spec.rake ?? 0.35) * Math.sin(t * Math.PI * 0.5)));
    }
    this.b.add(sheet(base, edge), { color: c, leaf: 0.6 });
  }

  dorsal(spec: FinSpec, c: Col): this {
    this.ridge(spec, 1, c);
    return this;
  }

  anal(spec: FinSpec, c: Col): this {
    this.ridge(spec, -1, c);
    return this;
  }

  /** Caudal fin: grows from the tail stalk; fork 0 = rounded fan, 1 = deep swallow-tail. */
  tail(length: number, spread: number, fork: number, c: Col): this {
    const z = this.B.z1 + 0.004;
    const y0 = this.B.mid(this.B.z1);
    const hs = Math.max(this.B.half(this.B.z1) * 1.05, 0.004);
    const n = 7;
    const base: THREE.Vector3[] = [], edge: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const s = t * 2 - 1; // +1 top lobe … -1 bottom lobe
      base.push(new THREE.Vector3(0, y0 + s * hs, z));
      // Outer edge: lobe tips reach furthest back; the middle is pulled in by the fork.
      const reach = length * (1 - fork * 0.65 * (1 - Math.abs(s)) ** 1.4) * (fork < 0.2 ? 1 - 0.25 * Math.abs(s) ** 2 : 1);
      edge.push(new THREE.Vector3(0, y0 + s * spread * (0.7 + 0.3 * Math.abs(s)), z - reach));
    }
    this.b.add(sheet(base, edge), { color: c, leaf: 0.7 });
    return this;
  }

  /** Pair of side fins behind the gills (sway weight marks them for flapping). */
  pectoral(at: number, size: number, c: Col, low = 0.2): this {
    for (const sx of [-1, 1]) {
      const z = this.B.z0 - this.B.len * at;
      const y = this.B.mid(z) - this.B.half(z) * low;
      const x = sx * this.B.side(z) * 0.92;
      const base = [new THREE.Vector3(x, y + size * 0.22, z), new THREE.Vector3(x, y - size * 0.22, z - size * 0.1)];
      const edge = [
        new THREE.Vector3(x + sx * size * 0.45, y + size * 0.12, z - size * 0.95),
        new THREE.Vector3(x + sx * size * 0.4, y - size * 0.3, z - size * 0.8),
      ];
      this.b.add(sheet(base, edge), { color: c, leaf: 0.8, sway: (p) => Math.abs(p.x - x) / (size * 0.45) });
    }
    return this;
  }

  /** Small paired fins under the belly. */
  pelvic(at: number, size: number, c: Col): this {
    for (const sx of [-1, 1]) {
      const z = this.B.z0 - this.B.len * at;
      const y = this.B.bot(z) + 0.002;
      const x = sx * this.B.side(z) * 0.35;
      const base = [new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 0.001, z - size * 0.5)];
      const edge = [new THREE.Vector3(x + sx * size * 0.25, y - size * 0.7, z - size * 0.7), new THREE.Vector3(x + sx * size * 0.1, y - size * 0.35, z - size * 0.95)];
      this.b.add(sheet(base, edge), { color: c, leaf: 0.6, sway: (p) => Math.abs(p.y - y) / size * 0.5 });
    }
    return this;
  }

  /** Eyes: pale iris ring, dark pupil, set into the side of the head. */
  eyes(at: number, r: number, iris = 0xe8e0c0, up = 0.28): this {
    const z = this.B.z0 - this.B.len * at;
    const y = this.B.mid(z) + this.B.half(z) * up;
    const sx = this.B.side(z) * 0.86;
    for (const s of [-1, 1]) {
      this.b.add(P.sphere(r, 1), { color: iris }, M.t(s * sx, y, z, 0, 0, 0, 0.55, 1, 1));
      this.b.add(P.sphere(r * 0.62, 1), { color: 0x08080a }, M.t(s * (sx + r * 0.32), y, z + r * 0.05, 0, 0, 0, 0.5, 1, 1));
      // A tiny catchlight.
      this.b.add(P.sphere(r * 0.18, 0), { color: 0xffffff }, M.t(s * (sx + r * 0.5), y + r * 0.3, z + r * 0.2));
    }
    return this;
  }

  /**
   * Builds the geometry, faceted for the game's low-poly look, and adds the swim attribute
   * `aFish` = (sideways bend amplitude, fin flap weight, travelling-wave phase).
   */
  build(): THREE.BufferGeometry {
    const g = facet(this.b.build());
    const P2 = g.getAttribute('position');
    const V = g.getAttribute('aVeg');
    const n = P2.count;
    const fish = new Float32Array(n * 3);
    const tailTip = Math.min(...Array.from({ length: n }, (_, i) => P2.getZ(i)));
    const L = this.B.z0 - tailTip;
    for (let i = 0; i < n; i++) {
      const u = THREE.MathUtils.clamp((this.B.z0 - P2.getZ(i)) / L, 0, 1);
      // The head barely moves; the swing builds toward the tail (carangiform swimming).
      fish[i * 3] = L * (0.012 + 0.2 * Math.pow(u, 2.2));
      fish[i * 3 + 1] = V.getX(i);
      fish[i * 3 + 2] = u * 3.4;
      V.setX(i, 0);
    }
    g.setAttribute('aFish', new THREE.BufferAttribute(fish, 3));
    return g;
  }
}

/** Countershading: darker back, paler belly, with an optional stripe band. */
function shade(back: number, belly: number, split = 0): Col {
  const a = col(back), b = col(belly);
  return (p) => a.clone().lerp(b, THREE.MathUtils.smoothstep(-p.y + split, -0.012, 0.014));
}

export function fishGeometry(t: FishType): THREE.BufferGeometry {
  switch (t) {
    case 'blueYellow': {
      // Royal gramma: violet-blue front fading into a golden rear half.
      const blue = col(0x4a2fc0), gold = col(0xf2c630);
      const c: Col = (p) => blue.clone().lerp(gold, THREE.MathUtils.smoothstep(-p.z, -0.01, 0.025));
      const f = new FishBuilder(0.16, 0.062, 0.03, c);
      f.dorsal({ z: [0.045, -0.07], height: (s) => 0.016 + s * 0.01, rake: 0.2 }, (p) => (p.z > 0 ? col(0x5a40d0) : col(0xf0c838)));
      f.anal({ z: [-0.01, -0.07], height: (s) => 0.012 + s * 0.008, rake: 0.25 }, () => gold);
      f.tail(0.05, 0.028, 0.15, () => col(0xf6d040)).pectoral(0.28, 0.022, () => col(0x8a78e0)).pelvic(0.3, 0.018, () => col(0x6a50d8));
      return f.eyes(0.13, 0.009, 0xd8c050).build();
    }
    case 'yellow': {
      // Yellow tang: tall bright disc with a pointed snout and a white tail spine.
      const y = col(0xf6d62a), y2 = col(0xe8c21c);
      const f = new FishBuilder(0.13, 0.1, 0.03, (p) => y.clone().lerp(y2, THREE.MathUtils.smoothstep(p.y, -0.01, 0.04)), { snout: 1, hump: 0.3, peduncle: 0.2 });
      f.dorsal({ z: [0.035, -0.055], height: (s) => 0.022 + Math.sin(s * Math.PI) * 0.01, rake: 0.25 }, () => col(0xf0cc20));
      f.anal({ z: [0.0, -0.055], height: (s) => 0.02 + Math.sin(s * Math.PI) * 0.008, rake: 0.25 }, () => col(0xf0cc20));
      f.tail(0.04, 0.03, 0.2, () => col(0xf2d028)).pectoral(0.3, 0.02, () => col(0xfae070)).pelvic(0.32, 0.016, () => y);
      f.b.add(P.box(0.004, 0.004, 0.012), { color: 0xffffff }, M.t(0.012, f.B.mid(-0.052), -0.052));
      f.b.add(P.box(0.004, 0.004, 0.012), { color: 0xffffff }, M.t(-0.012, f.B.mid(-0.052), -0.052));
      return f.eyes(0.16, 0.009, 0x303020).build();
    }
    case 'clown': {
      // Clownfish: orange with three white bands edged in black; rounded fins with dark rims.
      const o = col(0xf06a1c), w = col(0xfaf6f0), k = col(0x141414);
      const bands = [0.035, -0.005, -0.045];
      const c: Col = (p) => {
        for (const bz of bands) {
          const d = Math.abs(p.z - bz);
          if (d < 0.009) return w;
          if (d < 0.012) return k;
        }
        return o.clone().lerp(col(0xf88a3a), THREE.MathUtils.smoothstep(-p.y, -0.01, 0.02));
      };
      const rim = (edgeY: number) => (p: THREE.Vector3) => (Math.abs(p.y) > edgeY ? k : o);
      const f = new FishBuilder(0.12, 0.062, 0.034, c, { peduncle: 0.22 });
      f.dorsal({ z: [0.03, -0.05], height: (s) => 0.012 + Math.sin(s * Math.PI) * 0.012, rake: 0.3 }, rim(0.048));
      f.anal({ z: [-0.012, -0.052], height: () => 0.014, rake: 0.3 }, rim(0.042));
      f.tail(0.034, 0.022, 0, (p) => (p.z < -0.085 ? k : o)).pectoral(0.28, 0.02, () => o).pelvic(0.3, 0.016, (p) => (p.y < -0.04 ? k : o));
      return f.eyes(0.12, 0.009, 0xf07a30).build();
    }
    case 'idol': {
      // Moorish idol: tall disc, black–white–yellow bands, long trailing dorsal streamer.
      const W = col(0xf4f0e0), K = col(0x121212), Y = col(0xf2d030);
      const c: Col = (p) => (p.z > 0.028 ? (p.z > 0.04 && p.y < 0.0 ? col(0xe89030) : W) : p.z > 0.005 ? K : p.z > -0.02 ? (p.y > 0.02 ? Y : W) : p.z > -0.03 ? K : W);
      const f = new FishBuilder(0.095, 0.12, 0.024, c, { snout: 1.5, hump: 0.5, peduncle: 0.2 });
      f.dorsal({ z: [0.02, -0.02], height: (s) => 0.03 + s * 0.012, rake: 0.8 }, (p) => (p.z > 0.0 ? K : W));
      f.anal({ z: [0.01, -0.035], height: (s) => 0.034 - s * 0.012, rake: 0.6 }, (p) => (p.z > -0.015 ? K : W));
      // The long white streamer sweeping back off the dorsal fin.
      const top = f.B.top(0.0) + 0.04;
      const pts = [new THREE.Vector3(0, top - 0.006, 0.0), new THREE.Vector3(0, top + 0.012, -0.03), new THREE.Vector3(0, top + 0.016, -0.07), new THREE.Vector3(0, top + 0.01, -0.11)];
      const base = pts.map((p) => p.clone()), edge = pts.map((p, i) => p.clone().add(new THREE.Vector3(0, -0.005 + i * 0.001, -0.004)));
      f.b.add(sheet(base, edge), { color: 0xf8f6ec, leaf: 0.8 });
      f.tail(0.03, 0.022, 0.25, () => K).pectoral(0.3, 0.018, () => col(0xf0ecd8)).pelvic(0.3, 0.018, () => K);
      return f.eyes(0.22, 0.008, 0xd8d0b0, 0.1).build();
    }
    case 'silver': {
      // Jack / sardine: streamlined, blue-green back, mirror belly, lateral line, deep forked tail.
      const back = col(0x4a7f8a), belly = col(0xe4ecea), line = col(0x9ad0d8);
      const c: Col = (p) => (Math.abs(p.y - 0.002) < 0.002 ? line : back.clone().lerp(belly, THREE.MathUtils.smoothstep(-p.y, -0.008, 0.01)));
      const f = new FishBuilder(0.17, 0.05, 0.028, c, { peduncle: 0.12 });
      f.dorsal({ z: [0.025, -0.02], height: (s) => 0.02 * (1 - s * 0.8), rake: 0.6 }, () => col(0x5a8f98));
      f.dorsal({ z: [-0.035, -0.07], height: () => 0.007, rake: 0.2 }, () => col(0x5a8f98));
      f.anal({ z: [-0.03, -0.07], height: () => 0.007, rake: 0.2 }, () => col(0xc8d8d4));
      f.tail(0.055, 0.04, 1, (p) => col(p.y > 0 ? 0x5a8f98 : 0x9ab8b4)).pectoral(0.26, 0.022, () => col(0xb8d0cc), 0.1).pelvic(0.34, 0.012, () => belly);
      return f.eyes(0.1, 0.009, 0xe8e4c8, 0.15).build();
    }
    case 'tang': {
      // Blue tang: royal blue with the black "palette" swirl and a bright yellow tail.
      const blue = col(0x2a62e0), K = col(0x0e1846), Y = col(0xf6d030);
      const c: Col = (p) => {
        if (p.z < -0.078) return Y;
        // The black "palette": a band arching from behind the eye over the upper flank down to
        // the tail, looping round an oval of blue, plus a dark top edge along the back.
        const u = (0.06 - p.z) / 0.14;
        const arch = 0.006 + 0.014 * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
        const inLoop = Math.hypot((p.z + 0.022) / 0.024, (p.y - 0.03) / 0.008) < 1;
        if (u > 0 && u < 1.05 && p.y > arch - 0.01 && p.y < 0.058 && !inLoop) return K;
        return blue.clone().lerp(col(0x1a3aa8), THREE.MathUtils.smoothstep(p.y, 0.03, 0.05));
      };
      const f = new FishBuilder(0.18, 0.11, 0.03, c, { hump: 0.25, peduncle: 0.18 });
      f.dorsal({ z: [0.055, -0.075], height: (s) => 0.016 + Math.sin(s * Math.PI) * 0.006, rake: 0.2 }, (p) => (p.y > f.B.top(p.z) + 0.012 ? K : blue));
      f.anal({ z: [0.0, -0.075], height: () => 0.014, rake: 0.2 }, (p) => (p.y < f.B.bot(p.z) - 0.01 ? K : blue));
      f.tail(0.05, 0.04, 0.3, (p) => (p.y > 0.03 || p.y < -0.03 ? K : Y)).pectoral(0.28, 0.026, () => Y).pelvic(0.3, 0.02, () => blue);
      return f.eyes(0.13, 0.011, 0x303848).build();
    }
  }
}
