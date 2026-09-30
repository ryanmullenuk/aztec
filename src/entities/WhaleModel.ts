import * as THREE from 'three';

// ---------------- Humpback whale: one skinned mesh (length 1 along +z, head at +z) ----------------
// The body is a lofted shell (superelliptic sections: a flat-topped rostrum, a deep pleated throat,
// a keeled tail stock), with the flippers, flukes and dorsal fin lofted as airfoils and knobs,
// eyes and barnacles set into the skin. It is skinned to an articulated skeleton:
//   torso (root) → neck → head, and torso → seven tail joints → fluke → left / right lobes,
//   and each flipper: shoulder → elbow → wrist (on the neck joint).
// Everything bends with the spine, so fins and flukes never come apart from the body.

/** Joint positions along the body (model z). */
const Z = { head: 0.36, neck: 0.2, torso: 0.04, tail: [-0.06, -0.15, -0.24, -0.32, -0.39, -0.445, -0.485], fluke: -0.5 };
/** Bone indices in the skeleton. */
const B = { torso: 0, neck: 1, head: 2, tail0: 3, fluke: 10, lobeL: 11, lobeR: 12, finL: 13, finR: 16 };
/** The spine as one chain, head to tail: [bone, z]. */
const CHAIN: [number, number][] = [[B.head, Z.head], [B.neck, Z.neck], [B.torso, Z.torso], ...Z.tail.map((z, i): [number, number] => [B.tail0 + i, z])];
/** Flipper root (on the lower flank), span and elbow / wrist positions along it. */
const FIN = { t: 0.7, v: -0.4, span: 0.31, elbow: 0.1, wrist: 0.205 };
/** Rest (bind) direction of the left flipper: out, down and swept back (the right is its mirror). */
const FIN_DIR = new THREE.Vector3(0.8, -0.34, -0.5).normalize();
const FLUKE_SPAN = 0.165;

export interface WhaleRig {
  mesh: THREE.SkinnedMesh;
  torso: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  /** Tail joints, front to back. */
  tail: THREE.Bone[];
  fluke: THREE.Bone;
  lobeL: THREE.Bone;
  lobeR: THREE.Bone;
  /** Shoulder, elbow, wrist; left (+x) and right. */
  finL: THREE.Bone[];
  finR: THREE.Bone[];
  /** Rest rotations of the flipper joints (poses are applied on top of them). */
  finRestL: THREE.Quaternion[];
  finRestR: THREE.Quaternion[];
  /** Points that ride on the skeleton: flipper tips, fluke tips, the blowholes. */
  finTipL: THREE.Object3D;
  finTipR: THREE.Object3D;
  lobeTipL: THREE.Object3D;
  lobeTipR: THREE.Object3D;
  blowhole: THREE.Object3D;
}

// ---------------- Profiles ----------------

/** Smooth curve through [t, value] knots (time-aware Hermite, like the breach keys). */
function curve(k: [number, number][], t: number): number {
  if (t <= k[0][0]) return k[0][1];
  const n = k.length;
  if (t >= k[n - 1][0]) return k[n - 1][1];
  let i = 0;
  while (t > k[i + 1][0]) i++;
  const a = k[Math.max(0, i - 1)], b = k[i], c = k[i + 1], d = k[Math.min(n - 1, i + 2)];
  const h = c[0] - b[0], f = (t - b[0]) / h;
  const m0 = ((c[1] - a[1]) / (c[0] - a[0] || 1)) * h, m1 = ((d[1] - b[1]) / (d[0] - b[0] || 1)) * h;
  const f2 = f * f, f3 = f2 * f;
  return (2 * f3 - 3 * f2 + 1) * b[1] + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * c[1] + (f3 - f2) * m1;
}

// Half-width, height of the back above the body line, depth of the belly below it (t: 0 tail → 1 snout).
const WIDTH: [number, number][] = [[0, 0.016], [0.04, 0.014], [0.1, 0.022], [0.2, 0.042], [0.3, 0.068], [0.4, 0.092], [0.5, 0.108], [0.6, 0.117], [0.7, 0.118], [0.78, 0.113], [0.86, 0.1], [0.93, 0.08], [0.97, 0.058], [1, 0.018]];
const TOP: [number, number][] = [[0, 0.006], [0.04, 0.018], [0.1, 0.034], [0.2, 0.052], [0.3, 0.07], [0.36, 0.08], [0.45, 0.09], [0.55, 0.095], [0.65, 0.093], [0.75, 0.082], [0.82, 0.068], [0.9, 0.05], [0.96, 0.032], [1, 0.012]];
const BELLY: [number, number][] = [[0, 0.006], [0.04, 0.016], [0.1, 0.03], [0.2, 0.05], [0.3, 0.07], [0.45, 0.098], [0.55, 0.108], [0.65, 0.114], [0.75, 0.116], [0.83, 0.11], [0.9, 0.095], [0.95, 0.074], [0.985, 0.042], [1, 0.014]];

const clamp = THREE.MathUtils.clamp;
/** Smoothstep from a to b (either way round: a > b gives a falling edge). */
function sstep(x: number, a: number, b: number): number {
  const f = clamp((x - a) / (b - a), 0, 1);
  return f * f * (3 - 2 * f);
}

function h1(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
/** Smooth value noise. */
function vn(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h1(xi, yi), b = h1(xi + 1, yi), c = h1(xi, yi + 1), d = h1(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Height of the lip line on the side of the head (sine of the section angle), from the gape's corner to the snout. */
const mouthV = (t: number) => -0.36 + 0.42 * sstep(t, 0.75, 0.99);
const EYE = { t: 0.766, v: mouthV(0.766) + 0.12 };

// Throat pleats: grooves along the belly from the chin to the navel, two vertices per pleat.
const PLEATS = 22;
const VENTRAL = 0.95;

/** Section angles: fine across the pleated belly (a groove vertex, then a ridge), coarser elsewhere. */
function sectionAngles(): { a: number; groove: boolean }[] {
  const out: { a: number; groove: boolean }[] = [];
  const v0 = Math.PI * 1.5 - VENTRAL, v1 = Math.PI * 1.5 + VENTRAL;
  const rest = 40;
  // From the right end of the belly strip, over the right side, back, left side, to the left end.
  for (let j = 0; j < rest; j++) out.push({ a: v1 + ((Math.PI * 2 - (v1 - v0)) * j) / rest, groove: false });
  for (let j = 0; j < PLEATS * 2; j++) out.push({ a: v0 + ((v1 - v0) * j) / (PLEATS * 2), groove: j % 2 === 1 });
  return out.map((s) => ({ a: s.a % (Math.PI * 2), groove: s.groove }));
}

/** Rings: close together at the tail stock (knuckles) and the head (jaw, eye, knobs). */
function ringStations(): number[] {
  const out: number[] = [];
  for (let t = 0; t < 0.35; t += 0.0075) out.push(t);
  for (let t = 0.35; t < 0.75; t += 0.012) out.push(t);
  for (let t = 0.75; t < 1; t += 0.006) out.push(t);
  out.push(1);
  return out;
}

/** A point on the skin (before the fine details), at station t and section angle a. */
function shellAt(t: number, a: number, groove = false, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(a), s = Math.sin(a);
  const keel = sstep(t, 0.02, 0.07) * (1 - sstep(t, 0.16, 0.3));
  const nTop = 2 - 0.45 * keel + 0.7 * sstep(t, 0.8, 0.93);
  const nBot = 2 - 0.4 * keel + 0.35 * sstep(t, 0.55, 0.7) * (1 - sstep(t, 0.9, 0.99));
  const n = s >= 0 ? nTop : nBot;
  // The lower jaw is broader than the rostrum.
  const jaw = sstep(t, 0.76, 0.86) * (1 - sstep(t, 0.95, 1));
  const W = curve(WIDTH, t) * (1 + 0.08 * jaw * sstep(s, 0, -0.6));
  const H = s >= 0 ? curve(TOP, t) : curve(BELLY, t);
  let x = W * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  let y = H * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  const side = Math.pow(Math.abs(c), 0.6);
  let k = 1 + (vn(t * 13, a * 2.4) - 0.5) * 0.012;
  // Lip line: a groove along the side of the head.
  if (t > 0.74) k -= 0.009 * Math.exp(-(((s - mouthV(t)) / 0.05) ** 2)) * side * sstep(t, 0.745, 0.77);
  // Swelling round the eye.
  k += 0.05 * Math.exp(-(((t - EYE.t) / 0.012) ** 2) - (((s - EYE.v) / 0.1) ** 2)) * side;
  // Throat pleats.
  if (groove) {
    const across = Math.abs(((a - Math.PI * 1.5 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    k -= 0.011 * sstep(t, 0.47, 0.56) * (1 - sstep(t, 0.93, 0.975)) * (1 - sstep(across, VENTRAL * 0.75, VENTRAL));
  }
  x *= k;
  y *= k;
  if (s > 0) {
    const ridge = Math.exp(-(((a - Math.PI / 2) / 0.3) ** 2));
    // The hump the dorsal fin sits on, and the knuckles along the ridge of the tail stock.
    let bump = 0.009 * Math.exp(-(((t - 0.35) / 0.035) ** 2));
    for (let j = 0; j < 7; j++) bump += 0.0048 * (1 - j * 0.08) * Math.exp(-(((t - (0.095 + j * 0.031)) / 0.011) ** 2));
    // Splashguard: the raised ridge in front of the blowholes.
    bump += 0.006 * Math.exp(-(((t - 0.79) / 0.014) ** 2));
    y += bump * ridge;
  }
  return out.set(x, y, t - 0.5);
}

/** Outward skin normal at (t, a), by finite differences. */
function shellNormal(t: number, a: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.002;
  const pa = shellAt(t, a + e), pb = shellAt(t, a - e), pc = shellAt(Math.min(1, t + e), a), pd = shellAt(Math.max(0, t - e), a);
  const da = pa.sub(pb), dt = pc.sub(pd);
  return out.crossVectors(da, dt).normalize();
}

// ---------------- Colours ----------------

const C = {
  top: new THREE.Color(0x1f262d),
  flank: new THREE.Color(0x3a4550),
  belly: new THREE.Color(0xe8ecee),
  pleat: new THREE.Color(0x98a4ac),
  mottle: new THREE.Color(0x4a5560),
  scar: new THREE.Color(0x8793a0),
  mouth: new THREE.Color(0x0c0f12),
  barnacle: new THREE.Color(0xcfd0c4),
  eye: new THREE.Color(0x07090b),
  finTop: new THREE.Color(0x2a323b),
};
const _c = new THREE.Color();
const _w = new THREE.Color();

function skinColor(t: number, a: number, groove: boolean): THREE.Color {
  const s = Math.sin(a);
  const c = _c.copy(C.top).lerp(C.flank, sstep(s, 0.72, 0.02));
  // Pale scratches and round scars on the back and flanks.
  if (s > -0.2 && s < 0.65) {
    if (Math.abs(vn(t * 9 + 5, a * 3.1) - 0.5) < 0.007 && t > 0.2 && t < 0.62) c.lerp(C.scar, 0.45);
    const sp = vn(t * 110, a * 16);
    if (sp > 0.93) c.lerp(C.scar, Math.min(0.35, (sp - 0.93) * 5));
  }
  // White belly and throat, reaching up the flanks in ragged patches; the tail stock stays dark.
  const edge = -0.12 - 0.22 * sstep(t, 0.55, 0.35) + (vn(t * 6 + 3, a * 1.7) - 0.5) * 0.5 - 0.1 * sstep(t, 0.84, 0.97) - 0.7 * sstep(t, 0.3, 0.12);
  const white = sstep(s, edge + 0.07, edge - 0.07);
  if (white > 0) {
    _w.copy(C.belly);
    // Grey grooves in the pleats, mottling toward the edge of the white and on the rear belly.
    if (groove && t > 0.47 && t < 0.975) _w.lerp(C.pleat, 0.7 * sstep(t, 0.47, 0.55) * (1 - sstep(t, 0.94, 0.975)));
    const m = vn(t * 26 + 1, a * 6);
    if (m > 0.62) _w.lerp(C.mottle, Math.min(1, (m - 0.62) * 3) * (0.35 + 0.65 * sstep(s, edge - 0.4, edge)));
    if (t < 0.45) _w.lerp(C.flank, (0.45 - t) * 1.8 * vn(t * 18, a * 4));
    c.lerp(_w, white);
  }
  // Lip line, and a paler lid round the eye.
  if (t > 0.745) {
    const d = Math.abs(s - mouthV(t));
    if (d < 0.035) c.lerp(C.mouth, 0.85 * (1 - d / 0.035) * sstep(t, 0.745, 0.76));
  }
  const eye = Math.exp(-(((t - EYE.t) / 0.011) ** 2) - (((s - EYE.v) / 0.09) ** 2)) * Math.abs(Math.cos(a));
  if (eye > 0.3) c.lerp(C.scar, (eye - 0.3) * 0.6);
  // Blowholes: two dark slits on top of the head.
  if (t > 0.772 && t < 0.782 && Math.abs(a - Math.PI / 2) > 0.05 && Math.abs(a - Math.PI / 2) < 0.2) c.lerp(C.mouth, 0.8);
  // Barnacles clustered on the chin.
  if (t > 0.9 && s < -0.15) {
    const bn = vn(t * 90, a * 14);
    if (bn > 0.64) c.lerp(C.barnacle, Math.min(1, (bn - 0.64) * 4));
  }
  return c;
}

// ---------------- Mesh assembly with skin weights ----------------

type Skin = [number, number][];

class SkinBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];

  vert(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color, skin: Skin): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    const s = skin.filter((w) => w[1] > 1e-4).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const total = s.reduce((sum, w) => sum + w[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      this.si.push(s[k]?.[0] ?? 0);
      this.sw.push((s[k]?.[1] ?? 0) / total);
    }
    return this.pos.length / 3 - 1;
  }

  /** Add an indexed geometry (positions in model space after `matrix`), colouring and skinning each vertex. */
  addGeometry(g: THREE.BufferGeometry, color: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, skin: (p: THREE.Vector3) => Skin, matrix?: THREE.Matrix4): void {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const P = g.getAttribute('position'), N = g.getAttribute('normal');
    const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
    const base = this.pos.length / 3;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      n.fromBufferAttribute(N, i);
      if (matrix) {
        p.applyMatrix4(matrix);
        n.applyMatrix3(nm!).normalize();
      }
      this.vert(p, n, color(p, n), skin(p));
    }
    const I = g.index;
    if (I) for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Weights along the spine for a point at model z: a soft tent over the nearest joints (smooth bends). */
function spineSkin(z: number): Skin {
  let u = CHAIN.length - 1;
  for (let i = 0; i < CHAIN.length - 1; i++) {
    if (z >= CHAIN[i + 1][1]) {
      u = i + clamp((CHAIN[i][1] - z) / (CHAIN[i][1] - CHAIN[i + 1][1]), 0, 1);
      break;
    }
  }
  if (z >= CHAIN[0][1]) u = 0;
  const out: Skin = [];
  for (let j = 0; j < CHAIN.length; j++) {
    const w = 1 - Math.abs(u - j) / 1.4;
    if (w > 0) out.push([CHAIN[j][0], w]);
  }
  return out;
}

/** Closed, indexed mesh from rings of points (each ring the same size), capped at the ends if asked. */
function loft(rings: THREE.Vector3[][], capStart: THREE.Vector3 | null, capEnd: THREE.Vector3 | null): THREE.BufferGeometry {
  const M2 = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < M2; j++) {
      const a = i * M2 + j, b = i * M2 + ((j + 1) % M2), c = a + M2, d = b + M2;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capStart) {
    const k = pos.length / 3;
    pos.push(capStart.x, capStart.y, capStart.z);
    for (let j = 0; j < M2; j++) idx.push(k, (j + 1) % M2, j);
  }
  if (capEnd) {
    const k = pos.length / 3, o = (rings.length - 1) * M2;
    pos.push(capEnd.x, capEnd.y, capEnd.z);
    for (let j = 0; j < M2; j++) idx.push(k, o + j, o + ((j + 1) % M2));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * An airfoil section loop in a local frame: chord along -z from the leading edge at `le`, thickness
 * along y. `u` runs 0..1 round the loop (0 = trailing edge, 0.5 = leading edge).
 */
function foilSection(le: THREE.Vector3, chord: number, thick: number, n: number, camber = 0): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let j = 0; j < n; j++) {
    const th = (j / n) * Math.PI * 2;
    const x = (1 + Math.cos(th)) / 2; // chord fraction from the leading edge (cosine spaced)
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = camber * 4 * x * (1 - x) * chord;
    out.push(new THREE.Vector3(le.x, le.y + yc + Math.sign(Math.sin(th)) * yt * chord * (th === 0 ? 0 : 1), le.z - x * chord));
  }
  return out;
}

/** Humpback flipper (left side, local frame: span +x, normal +y, chord +z = leading edge). */
function flipperGeometry(): { geo: THREE.BufferGeometry; span: number[] } {
  const L = FIN.span;
  const chordK: [number, number][] = [[-0.05, 0.066], [0, 0.07], [0.12, 0.078], [0.35, 0.072], [0.6, 0.058], [0.8, 0.042], [0.92, 0.026], [0.98, 0.012], [1, 0.004]];
  const rings: THREE.Vector3[][] = [];
  const span: number[] = [];
  const N = 24;
  for (let i = 0; i <= 44; i++) {
    const s = -0.05 + (1.05 * i) / 44;
    const u = Math.max(0, s);
    // Knobbly leading edge (the tubercles), swept back along its length and drooping a little.
    const knob = u > 0.05 && u < 0.94 ? 0.0055 * (1 - 0.4 * u) * Math.pow(Math.max(0, Math.sin((Math.PI * (u - 0.05) * 10) / 0.89)), 1.4) : 0;
    const le = new THREE.Vector3(s * L, -0.014 * u * u, 0.03 - 0.02 * u - 0.03 * u * u + knob);
    const chord = curve(chordK, s) + knob * 0.6;
    const thick = Math.max(0.05, 0.21 * (1 - 0.35 * u));
    const ring = foilSection(le, chord, thick, N, 0.02);
    // Slight washout: the outer flipper twists leading-edge down.
    const tw = -0.1 * u, pivot = le.clone().setZ(le.z - chord * 0.3);
    for (const p of ring) {
      const dy = p.y - pivot.y, dz = p.z - pivot.z;
      p.y = pivot.y + dy * Math.cos(tw) - dz * Math.sin(tw);
      p.z = pivot.z + dy * Math.sin(tw) + dz * Math.cos(tw);
    }
    rings.push(ring);
    span.push(s * L);
  }
  const tip = new THREE.Vector3(L * 1.004, -0.014, rings[rings.length - 1][N / 2].z - 0.002);
  const root = new THREE.Vector3(-0.05 * L, 0, 0.0);
  return { geo: loft(rings, root, tip), span };
}

/** One fluke lobe (the right, +x): swept, pointed tip, scalloped trailing edge; the notch at the middle. */
function flukeLobeGeometry(): THREE.BufferGeometry {
  const chordK: [number, number][] = [[0, 0.05], [0.07, 0.066], [0.2, 0.072], [0.45, 0.064], [0.7, 0.047], [0.88, 0.028], [0.97, 0.012], [1, 0.003]];
  const rings: THREE.Vector3[][] = [];
  const N = 22;
  for (let i = 0; i <= 40; i++) {
    const s = i / 40;
    const chord = curve(chordK, s);
    const le = new THREE.Vector3(s * FLUKE_SPAN, 0, -0.482 - 0.07 * Math.pow(s, 1.6));
    const thick = clamp(0.012 / Math.max(chord, 1e-3), 0.1, 0.2) * (1 - 0.3 * s);
    // Scallops cut into the trailing edge only (the rest of the section keeps its smooth shape).
    const scallop = s < 0.93 ? 0.0035 * Math.sin(s * Math.PI * 11) ** 2 : 0;
    const ring = foilSection(le, chord, thick, N);
    for (const p of ring) p.z += scallop * sstep((le.z - p.z) / chord, 0.6, 1);
    rings.push(ring);
  }
  const tip = new THREE.Vector3(FLUKE_SPAN * 1.005, 0, rings[rings.length - 1][N / 2].z - 0.003);
  return loft(rings, null, tip);
}

/** Small, swept dorsal fin standing on the hump (local frame: height +y, chord -z from the leading edge). */
function dorsalFinGeometry(): THREE.BufferGeometry {
  const t0 = 0.345, z0 = t0 - 0.5;
  const base = curve(TOP, t0) + 0.009 - 0.008;
  const rings: THREE.Vector3[][] = [];
  const N = 16;
  for (let i = 0; i <= 14; i++) {
    const s = i / 14;
    const fillet = s < 0.2 ? 0.024 * (1 - s / 0.2) ** 2 : 0;
    const chord = 0.058 * Math.pow(1 - s, 1.1) + 0.006 + fillet;
    const le = new THREE.Vector3(0, base + s * 0.034, z0 + 0.032 - 0.042 * Math.pow(s, 1.2) + fillet * 0.4);
    // An airfoil section standing upright: its thickness across the body (x).
    const ring = foilSection(new THREE.Vector3(0, 0, le.z), chord, 0.3, N).map((p) => new THREE.Vector3(-p.y, le.y, p.z));
    rings.push(ring);
  }
  const top = rings[rings.length - 1];
  const tip = new THREE.Vector3(0, top[0].y + 0.003, top[N / 2].z - 0.004);
  return loft(rings, null, tip);
}

// ---------------- Building the whale ----------------

let cached: { geo: THREE.BufferGeometry; finL: THREE.Quaternion; finR: THREE.Quaternion; finRootL: THREE.Vector3; finRootR: THREE.Vector3 } | null = null;

/** Flipper rest frame: x along the span, z toward the leading edge, y the upper-surface normal (mirrored for the right). */
function finFrame(side: 1 | -1): THREE.Quaternion {
  const s = FIN_DIR.clone().setX(FIN_DIR.x * side);
  const c = new THREE.Vector3(0, 0.15, 1);
  c.addScaledVector(s, -c.dot(s)).normalize();
  const n = new THREE.Vector3().crossVectors(c, s);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(s, n, c));
}

function whaleGeometry(): NonNullable<typeof cached> {
  if (cached) return cached;
  const sb = new SkinBuilder();
  const tmp = new THREE.Vector3(), nrm = new THREE.Vector3();

  // Body shell.
  const angles = sectionAngles(), rings = ringStations();
  const S2 = angles.length;
  const shellPos: number[] = [];
  const shellIdx: number[] = [];
  for (const t of rings) for (const { a, groove } of angles) {
    shellAt(t, a, groove, tmp);
    shellPos.push(tmp.x, tmp.y, tmp.z);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < S2; j++) {
      const a = i * S2 + j, b = i * S2 + ((j + 1) % S2), c = a + S2, d = b + S2;
      shellIdx.push(a, b, c, b, d, c);
    }
  }
  const tailTip = shellPos.length / 3;
  shellPos.push(0, 0, -0.503);
  const snout = tailTip + 1;
  shellPos.push(0, -0.006, 0.503);
  const last = (rings.length - 1) * S2;
  for (let j = 0; j < S2; j++) {
    shellIdx.push(tailTip, (j + 1) % S2, j);
    shellIdx.push(snout, last + j, last + ((j + 1) % S2));
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(shellPos, 3));
  shell.setIndex(shellIdx);
  shell.computeVertexNormals();
  // Colour from the section coordinates of each vertex (the caps take their ring's first colour).
  const shellCol: THREE.Color[] = [];
  for (const t of rings) for (const { a, groove } of angles) shellCol.push(skinColor(t, a, groove).clone());
  shellCol.push(shellCol[0].clone(), shellCol[last].clone());
  let vi = 0;
  sb.addGeometry(shell, () => shellCol[vi++], (p) => spineSkin(p.z));

  // Knobs (tubercles) on the rostrum and along the lower jaw, the big knob cluster on the chin,
  // and the eyes. Each is set into the skin so only its cap shows.
  const knob = new THREE.IcosahedronGeometry(1, 1);
  const setIn = (t: number, a: number, r: number, color: THREE.Color, sink = 0.45, squash = 1) => {
    shellAt(t, a, false, tmp);
    shellNormal(t, a, nrm);
    const m = new THREE.Matrix4().compose(
      tmp.clone().addScaledVector(nrm, -r * sink),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm),
      new THREE.Vector3(r, r * squash, r),
    );
    sb.addGeometry(knob, () => color, (p) => spineSkin(p.z), m);
  };
  const skinAt = (t: number, a: number) => skinColor(t, a, false).clone();
  for (const side of [1, -1]) {
    const A = (a: number) => (side > 0 ? a : Math.PI - a);
    // Rows on the upper jaw, beside the midline.
    for (let k = 0; k < 6; k++) {
      const t = 0.83 + k * 0.027 + h1(k, side) * 0.006, a = A(0.95 + h1(k, 3) * 0.12);
      setIn(t, a, 0.0052, skinAt(t, a).lerp(C.scar, 0.08), 0.55, 0.6);
    }
    for (let k = 0; k < 5; k++) {
      const t = 0.85 + k * 0.028 + h1(k, side * 2) * 0.006, a = A(0.55 + h1(k, 5) * 0.1);
      setIn(t, a, 0.0048, skinAt(t, a).lerp(C.scar, 0.08), 0.55, 0.6);
    }
    // Along the lower jaw, just under the lip line.
    for (let k = 0; k < 7; k++) {
      const t = 0.8 + k * 0.026;
      const a = A(Math.asin(clamp(mouthV(t) - 0.11, -1, 1)));
      setIn(t, a, 0.0046 + h1(k, 9) * 0.0012, skinAt(t, a).lerp(C.barnacle, 0.1), 0.55, 0.6);
    }
    // The eye.
    const ea = A(Math.asin(EYE.v));
    setIn(EYE.t, ea, 0.0068, C.eye, 0.35, 0.75);
  }
  // Midline row on the rostrum.
  for (let k = 0; k < 7; k++) {
    const t = 0.845 + k * 0.021, a = Math.PI / 2 + (h1(k, 11) - 0.5) * 0.12;
    setIn(t, a, 0.0055, skinAt(t, a).lerp(C.scar, 0.06), 0.55, 0.6);
  }
  // Chin: a knobbly boss crusted with barnacles.
  for (let k = 0; k < 9; k++) {
    const t = 0.968 + h1(k, 21) * 0.02, a = Math.PI * 1.5 + (h1(k, 23) - 0.5) * 0.9;
    setIn(t, a, 0.004 + h1(k, 25) * 0.004, k % 3 ? C.barnacle : skinAt(t, a).lerp(C.barnacle, 0.5), 0.4, 0.7);
  }

  // Dorsal fin on its hump.
  sb.addGeometry(dorsalFinGeometry(), (p) => _c.copy(C.top).lerp(C.flank, vn(p.y * 90, p.z * 90) * 0.25).clone(), (p) => spineSkin(p.z));

  // Flippers: skinned to shoulder, elbow and wrist, fused to the body at the root.
  const { geo: finGeo } = flipperGeometry();
  const finSkin = (side: 1 | -1, local: THREE.Vector3): Skin => {
    const d = local.x, f0 = side > 0 ? B.finL : B.finR;
    const u = d < FIN.elbow ? d / FIN.elbow : 1 + (d - FIN.elbow) / (FIN.wrist - FIN.elbow);
    const out: Skin = [];
    for (let j = 0; j < 3; j++) {
      const w = 1 - Math.abs(clamp(u, 0, 2) - j) / 1.3;
      if (w > 0) out.push([f0 + j, w]);
    }
    // The root stays with the body.
    const body = 1 - sstep(d, -0.004, 0.03);
    return [...out.map(([b, w]): [number, number] => [b, w * (1 - body)]), [B.neck, body]];
  };
  const finColor = (local: THREE.Vector3, n: THREE.Vector3) => {
    const u = clamp(local.x / FIN.span, 0, 1);
    if (n.y < -0.15) {
      // Underside: white, a few grey mottles.
      return _c.copy(C.belly).lerp(C.pleat, vn(local.x * 60, local.z * 60) > 0.78 ? 0.6 : 0).clone();
    }
    // Upper side: slate near the root, white toward the tip and along the knobbly leading edge.
    const m = sstep(u, 0.15, 0.55) * 0.75 + (local.z > 0.015 - 0.05 * u * u ? 0.35 : 0) + (vn(local.x * 40, local.z * 40) - 0.5) * 0.6;
    _c.copy(C.finTop).lerp(C.belly, clamp(m, 0, 1));
    if (vn(local.x * 120 + 7, local.z * 120) > 0.86 && local.z > 0.0) _c.lerp(C.barnacle, 0.7);
    return _c.clone();
  };
  const rootL = new THREE.Vector3(), rootR = new THREE.Vector3();
  const qL = finFrame(1), qR = finFrame(-1);
  for (const side of [1, -1] as const) {
    const a = side > 0 ? Math.asin(FIN.v) : Math.PI - Math.asin(FIN.v);
    const root = shellAt(FIN.t, a, false, side > 0 ? rootL : rootR);
    root.addScaledVector(shellNormal(FIN.t, a, nrm), -0.006);
    const q = side > 0 ? qL : qR;
    const g = finGeo.clone();
    if (side < 0) {
      // Mirror the left flipper: local y flips (the right frame's y points down), so flip the winding.
      g.scale(1, -1, 1);
      const I = g.index!;
      for (let i = 0; i < I.count; i += 3) {
        const b = I.getX(i + 1);
        I.setX(i + 1, I.getX(i + 2));
        I.setX(i + 2, b);
      }
      g.computeVertexNormals();
    }
    const m = new THREE.Matrix4().compose(root, q, new THREE.Vector3(1, 1, 1));
    const inv = m.clone().invert();
    const loc = new THREE.Vector3(), ln = new THREE.Vector3();
    const qi = q.clone().invert();
    sb.addGeometry(g, (p, n) => {
      loc.copy(p).applyMatrix4(inv);
      ln.copy(n).applyQuaternion(qi);
      if (side < 0) ln.y = -ln.y;
      return finColor(loc, ln);
    }, (p) => finSkin(side, loc.copy(p).applyMatrix4(inv)), m);
  }

  // Flukes: black above, white with dark marks beneath, a dark trailing edge.
  const lobe = flukeLobeGeometry();
  const flukeSkin = (p: THREE.Vector3): Skin => {
    const ax = Math.abs(p.x);
    const lw = sstep(ax, 0.02, 0.085);
    const stock = (1 - sstep(ax, 0, 0.03)) * sstep(p.z, -0.51, -0.486) * 0.7;
    return [[p.x > 0 ? B.lobeL : B.lobeR, lw * (1 - stock)], [B.fluke, (1 - lw) * (1 - stock)], [B.tail0 + 6, stock]];
  };
  const flukeColor = (p: THREE.Vector3, n: THREE.Vector3) => {
    if (n.y > -0.2) return _c.copy(C.top).lerp(C.flank, vn(p.x * 70, p.z * 70) * 0.3).clone();
    const s = Math.abs(p.x) / FLUKE_SPAN;
    const te = -0.482 - 0.07 * Math.pow(s, 1.6) - curve([[0, 0.05], [0.07, 0.066], [0.2, 0.072], [0.45, 0.064], [0.7, 0.047], [0.88, 0.028], [0.97, 0.012], [1, 0.003]], s);
    const nearTE = p.z - te < 0.007;
    const pat = vn(p.x * 32 + 3, p.z * 32);
    if (nearTE || pat > 0.64 || s > 0.92) return C.top.clone().lerp(C.belly, 0.08);
    return _c.copy(C.belly).lerp(C.mottle, pat > 0.55 ? 0.5 : 0).clone();
  };
  sb.addGeometry(lobe, flukeColor, flukeSkin);
  const lobeLeft = lobe.clone().scale(-1, 1, 1);
  {
    const I = lobeLeft.index!;
    for (let i = 0; i < I.count; i += 3) {
      const b = I.getX(i + 1);
      I.setX(i + 1, I.getX(i + 2));
      I.setX(i + 2, b);
    }
    lobeLeft.computeVertexNormals();
  }
  sb.addGeometry(lobeLeft, flukeColor, flukeSkin);

  cached = { geo: sb.build(), finL: qL, finR: qR, finRootL: rootL.clone(), finRootR: rootR.clone() };
  return cached;
}

/** A new whale: the shared skinned geometry on its own skeleton. */
export function createWhale(material: THREE.Material): WhaleRig {
  const w = whaleGeometry();
  const bones: THREE.Bone[] = [];
  const world: THREE.Vector3[] = [];
  const worldQ: THREE.Quaternion[] = [];
  const add = (name: string, parent: number, pos: THREE.Vector3, quat = new THREE.Quaternion()) => {
    const b = new THREE.Bone();
    b.name = `whale-${name}`;
    const pq = parent >= 0 ? worldQ[parent] : new THREE.Quaternion();
    const pp = parent >= 0 ? world[parent] : new THREE.Vector3();
    b.position.copy(pos).sub(pp).applyQuaternion(pq.clone().invert());
    b.quaternion.copy(pq.clone().invert().multiply(quat));
    if (parent >= 0) bones[parent].add(b);
    bones.push(b);
    world.push(pos.clone());
    worldQ.push(quat.clone());
    return bones.length - 1;
  };
  add('torso', -1, new THREE.Vector3(0, 0, Z.torso));
  add('neck', B.torso, new THREE.Vector3(0, 0.004, Z.neck));
  add('head', B.neck, new THREE.Vector3(0, 0.006, Z.head));
  Z.tail.forEach((z, i) => add(`tail${i}`, i === 0 ? B.torso : B.tail0 + i - 1, new THREE.Vector3(0, i < 3 ? 0.002 * i : 0.004, z)));
  add('fluke', B.tail0 + 6, new THREE.Vector3(0, 0, Z.fluke));
  add('lobeL', B.fluke, new THREE.Vector3(0.055, 0, -0.52));
  add('lobeR', B.fluke, new THREE.Vector3(-0.055, 0, -0.52));
  for (const side of [1, -1] as const) {
    const root = side > 0 ? w.finRootL : w.finRootR, q = side > 0 ? w.finL : w.finR;
    const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const s0 = add(`fin${side > 0 ? 'L' : 'R'}0`, B.neck, root, q);
    const s1 = add(`fin${side > 0 ? 'L' : 'R'}1`, s0, root.clone().addScaledVector(dir, FIN.elbow), q);
    add(`fin${side > 0 ? 'L' : 'R'}2`, s1, root.clone().addScaledVector(dir, FIN.wrist), q);
  }
  const mesh = new THREE.SkinnedMesh(w.geo, material);
  mesh.add(bones[B.torso]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // The animated body can reach outside the rest-pose bounds.
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const point = (bone: number, x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    bones[bone].add(o);
    return o;
  };
  const finTip = (bone: number) => point(bone, FIN.span - FIN.wrist, 0, -0.01);
  return {
    mesh,
    torso: bones[B.torso],
    neck: bones[B.neck],
    head: bones[B.head],
    tail: bones.slice(B.tail0, B.tail0 + 7),
    fluke: bones[B.fluke],
    lobeL: bones[B.lobeL],
    lobeR: bones[B.lobeR],
    finL: bones.slice(B.finL, B.finL + 3),
    finR: bones.slice(B.finR, B.finR + 3),
    finRestL: bones.slice(B.finL, B.finL + 3).map((b) => b.quaternion.clone()),
    finRestR: bones.slice(B.finR, B.finR + 3).map((b) => b.quaternion.clone()),
    finTipL: finTip(B.finL + 2),
    finTipR: finTip(B.finR + 2),
    lobeTipL: point(B.lobeL, FLUKE_SPAN - 0.055, 0, -0.035),
    lobeTipR: point(B.lobeR, -(FLUKE_SPAN - 0.055), 0, -0.035),
    // Blowholes, relative to the head joint.
    blowhole: point(B.head, 0, curve(TOP, 0.777) + 0.004 - 0.006, 0.277 - Z.head),
  };
}
