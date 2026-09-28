import * as THREE from 'three';
import { MARINE } from '../config';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { patchStylised, stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { Water } from '../water/Water';
import { Particles } from './Boats';
import { rigWhale, poseWhaleSpine, sampleBreach, IMPACT_T, BREACH_END, FLUKE_T, DIVE_T } from './WhaleMotion';

// ---------------- Models (length 1 along +z, head at +z) ----------------


/** Radius profile along the body: t = 0 tail stock → 1 snout. */
function whaleRadius(t: number): number {
  const k: [number, number][] = [[0, 0.018], [0.12, 0.04], [0.3, 0.085], [0.5, 0.112], [0.68, 0.118], [0.82, 0.1], [0.93, 0.07], [1, 0.022]];
  for (let i = 0; i < k.length - 1; i++) {
    if (t <= k[i + 1][0]) {
      const f = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
      const s = f * f * (3 - 2 * f);
      return k[i][1] + (k[i + 1][1] - k[i][1]) * s;
    }
  }
  return 0.02;
}

/** Lathe-like faceted body with an elliptical, flat-bellied cross-section. */
function bodyShell(radius: (t: number) => number, rings: number, seg: number, ySquash: (t: number) => number, color: (t: number, a: number, y: number) => THREE.Color): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const z = t - 0.5;
    const r = radius(t);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const s = Math.sin(a);
      const x = Math.cos(a) * r;
      const y = s * r * ySquash(t) * (s < 0 ? 0.82 : 1);
      pos.push(x, y, z);
      const c = color(t, a, s);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  // Caps.
  const tail = pos.length / 3;
  pos.push(0, 0, -0.5);
  col.push(col[0], col[1], col[2]);
  const nose = tail + 1;
  pos.push(0, 0, 0.5);
  col.push(col[col.length - 3], col[col.length - 2], col[col.length - 1]);
  for (let j = 0; j < seg; j++) {
    idx.push(tail, (j + 1) % seg, j);
    idx.push(nose, rings * seg + j, rings * seg + ((j + 1) % seg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Concatenate flat-shaded geometries (position, normal, colour) into one. */
function mergeFlat(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const g0 of geos) {
    const g = facet(g0);
    const P2 = g.getAttribute('position'), N2 = g.getAttribute('normal'), C2 = g.getAttribute('color');
    for (let i = 0; i < P2.count; i++) {
      pos.push(P2.getX(i), P2.getY(i), P2.getZ(i));
      nor.push(N2.getX(i), N2.getY(i), N2.getZ(i));
      col.push(C2.getX(i), C2.getY(i), C2.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// Smooth-shaded humpback: countershaded dark slate back, irregular white belly and flanks,
// ventral throat pleats, tubercles on the head, barnacled chin, knuckled tail stock.
const W_TOP = new THREE.Color(0x2b3540);
const W_FLANK = new THREE.Color(0x4b5866);
const W_BELLY = new THREE.Color(0xe7ebed);
const W_PLEAT = new THREE.Color(0x9aa6ae);
const W_MOUTH = new THREE.Color(0x0e1115);
const W_BARN = new THREE.Color(0xc9ccc2);
const W_SPOT = new THREE.Color(0x5d6974);

function h1(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
/** Smooth value noise for colour patterns. */
function vn(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h1(xi, yi), b = h1(xi + 1, yi), c = h1(xi, yi + 1), d = h1(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const PLEATS = 26;
/** 0..1 closeness to a throat-pleat groove line around the body angle. */
function pleat(a: number): number {
  const f = ((a / (Math.PI * 2)) * PLEATS) % 1;
  return Math.max(0, 1 - Math.abs(f - 0.5) / 0.14);
}

function whaleShellGeometry(): THREE.BufferGeometry {
  const RINGS = 60, SEG = 30;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const z = t - 0.5;
    const r = whaleRadius(t);
    // Tail stock is flattened side to side; the head is flat on top with a broad lower jaw.
    const xs = t < 0.24 ? 0.58 + (t / 0.24) * 0.42 : 1;
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      let ys = (t > 0.8 ? 0.74 : 0.86) * (sn < 0 ? 0.86 : 1);
      if (t > 0.76 && sn > 0) ys *= 1 - (t - 0.76) * 1.1;
      let rr = r;
      if (t > 0.7 && sn < -0.05) rr *= 1 + (t - 0.7) * 0.4 * -sn;
      if (sn < -0.25 && t > 0.48 && t < 0.97) rr *= 1 - pleat(a) * 0.022 * Math.min(1, (t - 0.48) * 6);
      rr *= 1 + (vn(t * 11, a * 2.2) - 0.5) * 0.025;
      pos.push(c * rr * xs, sn * rr * ys, z);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const p = i * SEG + j, q = i * SEG + ((j + 1) % SEG), u = p + SEG, v = q + SEG;
      idx.push(p, q, u, q, v, u);
    }
  }
  const tail = pos.length / 3;
  pos.push(0, 0, -0.5);
  const nose = tail + 1;
  pos.push(0, -0.004, 0.5);
  for (let j = 0; j < SEG; j++) {
    idx.push(tail, (j + 1) % SEG, j);
    idx.push(nose, RINGS * SEG + j, RINGS * SEG + ((j + 1) % SEG));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _wc = new THREE.Color();
function whaleColor(p: THREE.Vector3): THREE.Color {
  const t = p.z + 0.5;
  const a = Math.atan2(p.y, p.x);
  const sn = p.y / (Math.hypot(p.x, p.y) || 1);
  const c = _wc.copy(W_TOP).lerp(W_FLANK, THREE.MathUtils.smoothstep(sn, 0.55, -0.15));
  // Pale speckles and scars on the dark back.
  if (sn > -0.1) {
    const sp = vn(t * 60, a * 9);
    if (sp > 0.8) c.lerp(W_SPOT, (sp - 0.8) * 3.5);
    if (Math.abs(vn(t * 7 + 5, a * 3) - 0.5) < 0.02 && sn > 0.3) c.lerp(W_SPOT, 0.5);
  }
  // Irregular white belly that reaches up the flanks in patches (humpback pattern).
  const edge = -0.2 + (vn(t * 7 + 3, a * 1.6) - 0.5) * 0.55 + (t > 0.35 && t < 0.92 ? 0.1 : -0.45);
  const w = THREE.MathUtils.smoothstep(edge + 0.06 - sn, 0, 0.12);
  if (w > 0) {
    _wb.copy(W_BELLY);
    // Throat pleats: grey grooves from chin to navel.
    if (sn < -0.25 && t > 0.5 && t < 0.97) _wb.lerp(W_PLEAT, pleat(a) * 0.75);
    // Mottled grey on the rear belly.
    if (t < 0.45) _wb.lerp(W_FLANK, (0.45 - t) * 2.2 * vn(t * 20, a * 4));
    c.lerp(_wb, w);
  }
  // Mouth line along the side of the head.
  if (t > 0.79) {
    const my = -0.12 - (t - 0.79) * 0.35;
    if (Math.abs(sn - my) < 0.045) c.lerp(W_MOUTH, 0.85);
  }
  // Barnacle clusters on the chin and throat.
  if (t > 0.9 && sn < -0.1) {
    const bn = vn(t * 90, a * 14);
    if (bn > 0.62) c.lerp(W_BARN, Math.min(1, (bn - 0.62) * 4));
  }
  return c;
}
const _wb = new THREE.Color();

function whaleBody(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  b.add(whaleShellGeometry(), { color: (p) => whaleColor(p).clone() });
  // Tubercles: rows of knobs on the rostrum and along the lower jaw.
  for (let k = 0; k < 26; k++) {
    const t = 0.83 + (k % 13) * 0.0125;
    const top = k < 13;
    const side = (k % 2 ? 1 : -1) * (0.01 + ((k * 7) % 4) * 0.012);
    const r = whaleRadius(t);
    const y = top ? r * (0.74 * (1 - (t - 0.76) * 1.1)) * 0.92 : -r * 0.6;
    const x = top ? side * 0.8 : Math.sign(side) * r * 0.78;
    b.add(P.sphere(0.0042 + ((k * 13) % 5) * 0.0008, 1), { color: top ? W_TOP : W_BARN }, M.t(x, y * 0.97, t - 0.5, 0, 0, 0, 1, 0.7, 1));
  }
  // Small dorsal fin on a hump, then knuckles along the ridge to the tail.
  b.add(P.cone(0.028, 0.055, 8), { color: W_TOP }, M.t(0, 0.078, -0.17, -0.65, 0, 0, 0.55, 1, 1.6));
  for (let k = 0; k < 6; k++) {
    const t = 0.06 + k * 0.045;
    b.add(P.sphere(0.009, 1), { color: W_TOP }, M.t(0, whaleRadius(t) * 0.84, t - 0.5, 0, 0, 0, 0.7, 0.8, 1.4));
  }
  // Eyes with a pale rim.
  for (const x of [-1, 1]) {
    const r = whaleRadius(0.79);
    b.add(P.sphere(0.012, 1), { color: 0xc4ccd0 }, M.t(x * r * 0.99, -0.018, 0.29));
    b.add(P.sphere(0.0085, 1), { color: 0x07090b }, M.t(x * r * 1.02, -0.018, 0.293));
  }
  return b.build();
}

/** Long humpback flipper: scalloped leading edge, white beneath, mottled white and slate on top. Pivot at the root, along +x. */
function whaleFin(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(0, 0.036);
  for (let k = 1; k <= 12; k++) {
    const u = k / 12;
    // Leading edge knobs (tubercles).
    sh.lineTo(u * 0.34, 0.036 - u * 0.058 + (k % 2 ? 0.006 : -0.001));
  }
  sh.quadraticCurveTo(0.36, -0.03, 0.33, -0.036);
  sh.lineTo(0.2, -0.048);
  sh.quadraticCurveTo(0.06, -0.05, 0, -0.032);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -0.006);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  const top = new THREE.Color(0x2a323b);
  const b = new GeoBuilder();
  b.add(g, {
    color: (p, nn) => {
      if (nn.y < -0.2) return vn(p.x * 40, p.z * 40) > 0.78 ? W_PLEAT.clone() : W_BELLY.clone();
      // Top: slate near the root, white toward the tip and along the leading edge, with mottles.
      const m = THREE.MathUtils.smoothstep(p.x, 0.08, 0.3) * 0.7 + (p.z < -0.018 ? 0.4 : 0) + (vn(p.x * 30, p.z * 30) - 0.5) * 0.5;
      return top.clone().lerp(W_BELLY, THREE.MathUtils.clamp(m, 0, 1));
    },
  });
  return b.build();
}

/** Tail fluke: two swept lobes with a serrated trailing edge; black above, white with dark marks beneath. Pivot at the tail stock, along -z. */
function whaleFluke(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const side of [-1, 1]) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(side * 0.1, -0.012, side * 0.19, -0.06);
    s.lineTo(side * 0.205, -0.098);
    // Serrated trailing edge back to the notch.
    for (let k = 1; k <= 10; k++) {
      const u = k / 10;
      s.lineTo(side * (0.205 - u * 0.2), -0.098 + u * 0.058 + (k % 2 ? 0.006 : -0.003));
    }
    s.lineTo(0, -0.03);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, curveSegments: 8 });
    g.translate(0, 0, -0.006);
    g.rotateX(Math.PI / 2);
    g.computeVertexNormals();
    b.add(g, {
      color: (p, nn) => {
        if (nn.y > -0.2) return W_TOP.clone();
        const n = vn(p.x * 28 + 3, p.z * 28);
        return n > 0.62 ? W_TOP.clone().lerp(W_BELLY, 0.15) : W_BELLY.clone();
      },
    });
  }
  return b.build();
}

/** Smooth bottlenose dolphin: dark cape, pale flank blaze, white belly, beak, swept dorsal fin, flippers and flukes. */
function dolphinGeometry(): THREE.BufferGeometry {
  const TOP = new THREE.Color(0x3f505e), CAPE = new THREE.Color(0x34424e), FLANK = new THREE.Color(0x8e9eab), BLAZE = new THREE.Color(0xb7c3cc), BELLY = new THREE.Color(0xeef2f4);
  const k: [number, number][] = [[0, 0.012], [0.1, 0.028], [0.3, 0.072], [0.5, 0.1], [0.66, 0.099], [0.78, 0.086], [0.86, 0.064], [0.9, 0.034], [0.94, 0.022], [1, 0.011]];
  const rad = (t: number) => {
    for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) {
      const f = (t - k[i][0]) / (k[i + 1][0] - k[i][0]);
      return k[i][1] + (k[i + 1][1] - k[i][1]) * f * f * (3 - 2 * f);
    }
    return 0.011;
  };
  const RINGS = 40, SEG = 18;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const r = rad(t);
    const xs = t < 0.26 ? 0.55 + (t / 0.26) * 0.45 : 1;
    for (let j = 0; j < SEG; j++) {
      const an = (j / SEG) * Math.PI * 2;
      const sn = Math.sin(an);
      // Melon bulge above the beak.
      const melon = t > 0.8 && t < 0.9 && sn > 0 ? 1 + (1 - Math.abs(t - 0.85) / 0.05) * 0.12 * sn : 1;
      pos.push(Math.cos(an) * r * xs, sn * r * (sn < 0 ? 0.88 : 0.97) * melon, t - 0.5);
    }
  }
  for (let i = 0; i < RINGS; i++) for (let j = 0; j < SEG; j++) {
    const p = i * SEG + j, q = i * SEG + ((j + 1) % SEG), u = p + SEG, v = q + SEG;
    idx.push(p, q, u, q, v, u);
  }
  const tail = pos.length / 3;
  pos.push(0, 0, -0.5);
  const nose = tail + 1;
  pos.push(0, 0, 0.5);
  for (let j = 0; j < SEG; j++) {
    idx.push(tail, (j + 1) % SEG, j);
    idx.push(nose, RINGS * SEG + j, RINGS * SEG + ((j + 1) % SEG));
  }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  const colorAt = (p: THREE.Vector3) => {
    const t = p.z + 0.5;
    const sn = p.y / (Math.hypot(p.x, p.y) || 1);
    const c = TOP.clone().lerp(FLANK, THREE.MathUtils.smoothstep(sn, 0.45, -0.1));
    if (sn > 0.25 && t > 0.35 && t < 0.82) c.lerp(CAPE, 0.6);
    // Pale blaze sweeping from the eye back along the flank.
    const blaze = Math.abs(sn - (0.05 - (0.8 - t) * 0.35));
    if (t > 0.3 && t < 0.8 && blaze < 0.12) c.lerp(BLAZE, 0.6 * (1 - blaze / 0.12));
    if (sn < -0.3 && t > 0.2) c.lerp(BELLY, THREE.MathUtils.smoothstep(-sn, 0.3, 0.55));
    return c;
  };
  const bld = new GeoBuilder();
  bld.add(shell, { color: (p) => colorAt(p) });
  // Swept-back dorsal fin.
  const fin = new THREE.Shape();
  fin.moveTo(0.03, 0);
  fin.quadraticCurveTo(0.0, 0.07, -0.07, 0.12);
  fin.quadraticCurveTo(-0.05, 0.05, -0.08, 0);
  fin.lineTo(0.03, 0);
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.014, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1, curveSegments: 6 });
  fg.rotateY(Math.PI / 2);
  fg.translate(0.007, rad(0.52) * 0.9, 0.02);
  bld.add(fg, { color: CAPE });
  // Flippers and flukes.
  const flip = new THREE.Shape();
  flip.moveTo(0, 0.02);
  flip.quadraticCurveTo(0.08, 0.0, 0.12, -0.05);
  flip.quadraticCurveTo(0.05, -0.03, 0, -0.02);
  const pg = new THREE.ExtrudeGeometry(flip, { depth: 0.008, bevelEnabled: false, curveSegments: 5 });
  pg.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const g = pg.clone();
    if (side < 0) g.scale(-1, 1, 1);
    g.rotateZ(side * -0.5);
    g.translate(side * rad(0.72) * 0.75, -rad(0.72) * 0.45, 0.22);
    bld.add(g, { color: TOP });
  }
  const fluke = new THREE.Shape();
  fluke.moveTo(0, 0.01);
  fluke.quadraticCurveTo(0.1, -0.01, 0.15, -0.07);
  fluke.quadraticCurveTo(0.07, -0.05, 0, -0.03);
  const kg = new THREE.ExtrudeGeometry(fluke, { depth: 0.01, bevelEnabled: false, curveSegments: 6 });
  kg.rotateX(Math.PI / 2);
  for (const side of [-1, 1]) {
    const g = kg.clone();
    if (side < 0) g.scale(-1, 1, 1);
    g.translate(0, 0, -0.49);
    bld.add(g, { color: TOP });
  }
  // Eyes.
  for (const x of [-1, 1]) bld.add(P.sphere(0.008, 1), { color: 0x0a0c0e }, M.t(x * rad(0.84) * 0.93, 0.008, 0.34));
  return bld.build();
}

/** Tint a material toward deep sea-water colour the further below the surface it is (light absorption). */
function underwater<T extends THREE.Material>(mat: T, key: string): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    if (!shader.vertexShader.includes('varying float vWy')) shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWy;');
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vWy = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace(
        '#include <fog_fragment>',
        '{ float uwD = max(-vWy, 0.0); float ab = (1.0 - exp(-uwD * 0.5)) * 0.5; gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.035, 0.19, 0.26), ab); }\n#include <fog_fragment>'
      );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

// ---------------- Effects textures ----------------

function spiralFoamTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const cx = s / 2;
  const grd = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.35, 'rgba(240,252,255,0.75)');
  grd.addColorStop(0.75, 'rgba(230,250,255,0.25)');
  grd.addColorStop(1, 'rgba(230,250,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  // Swirling streaks, like the whirl of foam after a breach.
  g.lineCap = 'round';
  for (let k = 0; k < 90; k++) {
    const r0 = 10 + Math.random() * 110;
    const a0 = Math.random() * Math.PI * 2;
    const len = 0.5 + Math.random() * 1.4;
    g.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.55})`;
    g.lineWidth = 1 + Math.random() * 3.5;
    g.beginPath();
    for (let u = 0; u <= 1; u += 0.05) {
      const a = a0 + u * len;
      const r = r0 + u * 14;
      const x = cx + Math.cos(a) * r, y = cx + Math.sin(a) * r;
      if (u === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Lacy foam: rings of bubbles, denser toward the middle.
  for (let k = 0; k < 520; k++) {
    const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.7) * 118;
    g.strokeStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.5 * (1 - r / 130)})`;
    g.lineWidth = 0.8 + Math.random() * 1.6;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 2 + Math.random() * 7, 0, Math.PI * 2);
    g.stroke();
  }
  for (let k = 0; k < 160; k++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 120;
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 0.8 + Math.random() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft, broken ring of foam (for ripples and the foam collar around a rising whale). */
function foamRingTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const cx = s / 2;
  // RingGeometry UVs map the ring's bounding square onto the texture: radius 1 = texture edge.
  const grd = g.createRadialGradient(cx, cx, cx * 0.62, cx, cx, cx);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  // Break it up: gaps and bubbly specks.
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 70; k++) {
    const a = Math.random() * Math.PI * 2, r = cx * (0.72 + Math.random() * 0.26);
    g.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.4})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 1.5 + Math.random() * 5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 140; k++) {
    const a = Math.random() * Math.PI * 2, r = cx * (0.7 + Math.random() * 0.28);
    g.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.6})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 0.8 + Math.random() * 2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function softTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(235,255,255,0.9)');
  grd.addColorStop(1, 'rgba(235,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _ax = new THREE.Vector3();

interface Whale {
  root: THREE.Group;
  body: THREE.SkinnedMesh;
  spine: THREE.Bone[];
  swimPhase: number;
  finL: THREE.Group;
  finR: THREE.Group;
  fluke: THREE.Group;
  x: number;
  z: number;
  heading: number;
  route: { x: number; z: number; r: number; a: number; dir: number };
  state: 'swim' | 'dive' | 'breach' | 'recover';
  /** Current pose: tilt from vertical toward yaw (90 = level), spin, depth. */
  pose: { y: number; pitch: number; roll: number; yaw: number };
  turnRate: number;
  wanderSeed: number;
  t: number;
  nextBreach: number;
  nextSpout: number;
  nextPrint: number;
  bx: number;
  bz: number;
  fallYaw: number;
  length: number;
  flags: Set<string>;
  ring: THREE.Mesh;
  glow: THREE.Mesh;
  patch: THREE.Mesh;
  foam: THREE.Mesh;
}

interface Pod {
  /** Shared leap rhythm (radians). */
  phase: number;
  x: number;
  z: number;
  a: number;
  r: number;
  cx: number;
  cz: number;
  dir: number;
  speed: number;
  ids: number[];
}

interface Dolphin {
  pod: number;
  /** Lag behind the pod's leap rhythm (fraction of a cycle), so a pod leaps in a rippling line. */
  lag: number;
  leapH: number;
  stroke: number;
  offX: number;
  offZ: number;
  phase: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
  wasUp: boolean;
  spin: boolean;
}

/**
 * Humpback whales that cruise the deep water, spout and breach (an airborne spin,
 * broadside landing, huge swirling splash, fluke
 * flip as it dives), and dolphin pods porpoising in leaping arcs.
 */
export class Marine {
  readonly group = new THREE.Group();
  whales: Whale[] = [];
  private pods: Pod[] = [];
  private dolphins: Dolphin[] = [];
  private dolphinMesh: THREE.InstancedMesh;
  private dolphinBend: THREE.InstancedBufferAttribute;
  private spray = new Particles(1500, 0xf2fcff);
  private mist = new Particles(420, 0xe8f8ff);
  /** Rising, flaring sheets of water thrown up around a splash. */
  private crowns: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number; life: number; r0: number; r1: number; h: number }[] = [];
  private rings: { mesh: THREE.Mesh; t: number; life: number; r0: number; r1: number; alpha: number }[] = [];
  private rng: RNG;
  private time = 0;
  sfx: (n: string, x: number, z: number) => void = () => {};

  constructor(private world: World, private water: Water) {
    this.rng = new RNG(world.seed * 53 + 17);
    this.group.add(this.spray.points, this.mist.points);
    (this.mist.points.material as THREE.ShaderMaterial).blending = THREE.NormalBlending;

    const mat = stylisedMaterial();
    const bodyGeo = whaleBody(), finGeo = whaleFin(), flukeGeo = whaleFluke();
    const finMat = underwater(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, side: THREE.DoubleSide }), 0.3), 'whale-fin');
    const foamTex = spiralFoamTexture(), soft = softTexture();
    const ringTex = foamRingTexture();
    const ringGeo = new THREE.RingGeometry(0.72, 1, 64, 1).rotateX(-Math.PI / 2);
    for (let k = 0; k < 16; k++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, color: 0xf2fcff, transparent: true, opacity: 0, depthWrite: false, fog: true }));
      m.visible = false;
      m.renderOrder = 15;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1, life: 1, r0: 1, r1: 2, alpha: 0.6 });
    }

    const crownGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 6, true).translate(0, 0.5, 0);
    for (let k = 0; k < 8; k++) {
      const cm = new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 }, uFlare: { value: 0.5 }, uSeed: { value: k * 17.3 }, uDay: this.water.shared.uDay },
        vertexShader: `uniform float uFlare; uniform float uSeed; varying vec2 vUv;
          void main(){ vUv = uv; vec3 p = position; float ang = atan(p.z, p.x);
            // Ragged rim: the sheet breaks into tongues of water.
            float jag = 0.7 + 0.2 * sin(ang * 9.0 + uSeed) + 0.1 * sin(ang * 23.0 + uSeed * 2.0);
            p.y *= jag; p.xz *= 1.0 + p.y * uFlare;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
        fragmentShader: `uniform float uA; uniform float uDay; uniform float uSeed; varying vec2 vUv;
          float hs(float x){ return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
          void main(){
            // Irregular tongues of water: each column rises to its own height and breaks up at the top.
            float cx = vUv.x * 64.0; float c0 = floor(cx); float fx = fract(cx);
            float r1 = mix(hs(c0), hs(c0 + 1.0), smoothstep(0.0, 1.0, fx));
            float r2 = mix(hs(c0 * 1.7 + 3.1), hs((c0 + 1.0) * 1.7 + 3.1), smoothstep(0.0, 1.0, fx));
            float top = 0.3 + 0.7 * r2;
            float a = uA * (1.0 - smoothstep(top - 0.3, top, vUv.y)) * (0.3 + 0.7 * r1) * smoothstep(0.0, 0.05, vUv.y);
            vec3 col = mix(vec3(0.55, 0.8, 0.86), vec3(1.0), smoothstep(0.05, 0.6, vUv.y)) * mix(0.35, 1.0, uDay);
            gl_FragColor = vec4(col, a * 0.9); }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const cmesh = new THREE.Mesh(crownGeo, cm);
      cmesh.visible = false;
      cmesh.renderOrder = 17;
      this.group.add(cmesh);
      this.crowns.push({ mesh: cmesh, mat: cm, t: 1, life: 1, r0: 1, r1: 1, h: 1 });
    }

    // Whales live out in the open ocean, beyond the reef shelf.
    const spots = this.deepSpots(MARINE.whales, -4.8, 0.78, 1.15);
    spots.forEach((s, k) => {
      const L = MARINE.whaleLength * (0.9 + this.rng.next() * 0.2);
      const root = new THREE.Group();
      const bodyMat = underwater(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }), 0.3), 'whale-body');
      const { body, spine } = rigWhale(bodyGeo, bodyMat);
      const finL = new THREE.Group(), finR = new THREE.Group();
      const fl = new THREE.Mesh(finGeo, finMat), fr = new THREE.Mesh(finGeo, finMat);
      fl.castShadow = fr.castShadow = true;
      fl.scale.x = -1; // mirrored for the left side
      finL.add(fl);
      finR.add(fr);
      finL.position.set(-0.09, -0.04, -0.05);
      finR.position.set(0.09, -0.04, -0.05);
      const fluke = new THREE.Group();
      const fm = new THREE.Mesh(flukeGeo, finMat);
      fm.castShadow = true;
      fluke.add(fm);
      spine[2].add(finL, finR);
      spine[8].add(fluke);
      root.add(body);
      root.scale.setScalar(L);
      this.group.add(root);
      const mk = (geo: THREE.BufferGeometry, m: THREE.Material) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
      };
      const ring = mk(new THREE.RingGeometry(0.6, 1.25, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTex, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: true }));
      ring.renderOrder = 16;
      const glowMat = new THREE.ShaderMaterial({
        uniforms: { uA: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uA; varying vec2 vUv; void main(){ float a = pow(vUv.y, 2.2) * uA * (0.6 + 0.4 * sin(vUv.x * 6.2831 * 3.0)); gl_FragColor = vec4(vec3(0.75, 1.0, 1.0) * a, a); }',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const glow = mk(new THREE.CylinderGeometry(0.55, 0.9, 1, 16, 1, true).translate(0, -0.5, 0), glowMat);
      glow.renderOrder = 9;
      const patch = mk(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: soft, transparent: true, opacity: 0, depthWrite: false, fog: true }));
      patch.renderOrder = 9;
      const foam = mk(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0, depthWrite: false, fog: true }));
      foam.renderOrder = 15;
      const a = this.rng.range(0, Math.PI * 2);
      this.whales.push({
        root, body, finL, finR, fluke, x: s.x, z: s.z, heading: 0,
        route: { x: s.x, z: s.z, r: 10 + this.rng.next() * 10, a, dir: this.rng.chance(0.5) ? 1 : -1 },
        state: 'swim', t: 0, nextBreach: MARINE.firstBreach + k * 9 + this.rng.next() * 10, nextSpout: 3 + this.rng.next() * 8, nextPrint: 1 + this.rng.next() * 3,
        bx: 0, bz: 0, fallYaw: 0, length: L, flags: new Set(), ring, glow, patch, foam,
        spine, swimPhase: 0, pose: { y: -MARINE.swimDepth, pitch: 90, roll: 0, yaw: a }, turnRate: 0, wanderSeed: this.rng.next() * 100,
      });
    });

    // Dolphin pods.
    const dgeo = dolphinGeometry();
    const total = MARINE.pods * MARINE.dolphinsPerPod;
    this.dolphinBend = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
    this.dolphinBend.setUsage(THREE.DynamicDrawUsage);
    dgeo.setAttribute('iBend', this.dolphinBend);
    const dmat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0 }), 0.3);
    const dBase = dmat.onBeforeCompile;
    dmat.onBeforeCompile = (shader, r) => {
      dBase.call(dmat, shader, r);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 iBend; varying float vWy;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            // Flexible body: tail strokes (x = phase, y = amplitude) and a leap arch (z).
            float zz = transformed.z;
            float wgt = smoothstep(0.3, -0.55, zz);
            transformed.y += iBend.y * (wgt * wgt + 0.06) * sin(iBend.x - zz * 6.0);
            transformed.y -= iBend.z * (zz * zz * 4.0 - 0.33);
          }`)
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vWy = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWy;')
        .replace('#include <fog_fragment>', '{ float uwD = max(-vWy, 0.0); gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.035, 0.19, 0.26), (1.0 - exp(-uwD * 0.8)) * 0.55); }\n#include <fog_fragment>');
    };
    dmat.customProgramCacheKey = () => 'dolphin';
    this.dolphinMesh = new THREE.InstancedMesh(dgeo, dmat, total);
    this.dolphinMesh.castShadow = true;
    this.dolphinMesh.frustumCulled = false;
    this.dolphinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.dolphinMesh.count = 0;
    this.group.add(this.dolphinMesh);
    // Each pod swims a loop that lies entirely in deep water (checked all the way round).
    const loops: { cx: number; cz: number; r: number }[] = [];
    for (let k = 0; k < 3000 && loops.length < MARINE.pods; k++) {
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(this.world.half * 0.72, this.world.half * 1.05);
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d, r = 9 + this.rng.next() * 9;
      if (loops.some((l) => Math.hypot(l.cx - cx, l.cz - cz) < l.r + r + 12)) continue;
      let ok = true;
      for (let s = 0; s < 16 && ok; s++) {
        const t = (s / 16) * Math.PI * 2;
        if (this.bedAt(cx + Math.cos(t) * r, cz + Math.sin(t) * r) > -2.8) ok = false;
      }
      if (ok) loops.push({ cx, cz, r });
    }
    loops.forEach((l, k) => {
      const a0 = this.rng.range(0, 6.28);
      const s = { x: l.cx + Math.cos(a0) * l.r, z: l.cz + Math.sin(a0) * l.r };
      const pod: Pod = { phase: this.rng.next() * 6.28, x: s.x, z: s.z, cx: l.cx, cz: l.cz, a: a0, r: l.r, dir: k % 2 ? 1 : -1, speed: MARINE.dolphinSpeed, ids: [] };
      for (let d = 0; d < MARINE.dolphinsPerPod; d++) {
        pod.ids.push(this.dolphins.length);
        this.dolphins.push({ pod: k, lag: d * 0.07 + this.rng.next() * 0.05, leapH: 0.85 + this.rng.next() * 0.3, stroke: this.rng.next() * 6.28, offX: (this.rng.next() - 0.5) * 3.2, offZ: (d - MARINE.dolphinsPerPod / 2) * 0.7 + (this.rng.next() - 0.5) * 0.6, phase: this.rng.next() * 6.28, x: s.x, y: -0.4, z: s.z, pitch: 0, yaw: 0, roll: 0, wasUp: false, spin: false });
      }
      this.pods.push(pod);
    });
    // Place every dolphin before the first frame (nothing sits at the origin).
    this.updateDolphins(0.0001);
  }

  /** Random deep-water points around the island (optionally within a radius band of the map). */
  private deepSpots(n: number, maxBed = -3.2, rMin = 0.5, rMax = 0.9): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const w = this.world;
    for (let k = 0; k < 4000 && out.length < n; k++) {
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(w.half * rMin, w.half * rMax);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (this.bedAt(x, z) > maxBed) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 25)) continue;
      out.push({ x, z });
    }
    return out;
  }

  /** Seabed height (the dark ocean floor lies at -6.2 beyond the island's slopes). */
  private bedAt(x: number, z: number): number {
    const w = this.world;
    if (Math.abs(x) > w.half || Math.abs(z) > w.half) return -6.2;
    return Math.max(w.heightAt(x, z), -6.2);
  }

  private deepEnough(x: number, z: number, bed = -2.6): boolean {
    const w = this.world;
    if (Math.abs(x) > w.half * 1.05 || Math.abs(z) > w.half * 1.05) return true;
    return w.heightAt(x, z) < bed;
  }

  /** Start a breach now (e.g. when the player taps a whale). */
  breach(w: Whale): void {
    if (w.state !== 'swim') return;
    w.state = 'dive';
    w.t = 0;
    // Fall roughly sideways to the direction of travel.
    w.fallYaw = w.heading + (this.rng.chance(0.5) ? 1 : -1) * (Math.PI / 2) + this.rng.range(-0.4, 0.4);
    w.flags.clear();
  }

  /** Whale near a world point (for tap-to-breach). */
  whaleNear(x: number, z: number, r = 4): Whale | null {
    let best: Whale | null = null, bd = r;
    for (const w of this.whales) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** A sheet of water that shoots up around a splash, flares out and collapses. */
  private crown(x: number, z: number, r0: number, r1: number, h: number, life: number): void {
    const c = this.crowns.find((k) => k.t >= k.life) ?? this.crowns[0];
    c.t = 0;
    c.life = life;
    c.r0 = r0;
    c.r1 = r1;
    c.h = h;
    c.mesh.position.set(x, -0.05, z);
    c.mesh.rotation.y = this.rng.next() * 6.28;
    // Droplets flung off the rim.
    for (let k = 0; k < Math.round(90 * (h / 2)); k++) {
      const a = this.rng.next() * Math.PI * 2;
      const out = (1.2 + this.rng.next() * 2.2) * (r1 / 3);
      this.spray.spawn(x + Math.cos(a) * r0, 0.08, z + Math.sin(a) * r0, Math.cos(a) * out, 2 + this.rng.next() * 4 * (h / 2), Math.sin(a) * out, 0.9 + this.rng.next() * 0.9, 0.04 + this.rng.next() * 0.1, 0.02);
    }
  }

  private updateCrowns(dt: number): void {
    for (const c of this.crowns) {
      if (c.t >= c.life) {
        c.mesh.visible = false;
        continue;
      }
      c.t += dt;
      const f = Math.min(1, c.t / c.life);
      const r = c.r0 + (c.r1 - c.r0) * (1 - (1 - f) * (1 - f));
      // A fast impact plume followed by a slower collapse.
      const rise = f < 0.18 ? Math.sin(f / 0.18 * Math.PI / 2) : Math.pow(Math.max(0, 1 - (f - 0.18) / 0.82), 1.4);
      c.mesh.visible = true;
      c.mesh.scale.set(r, Math.max(0.01, c.h * Math.pow(rise, 0.8)), r);
      c.mat.uniforms.uA.value = Math.pow(1 - f, 1.2) * 0.9;
      c.mat.uniforms.uFlare.value = 0.3 + f * 0.5;
    }
  }

  /** Spawn an expanding ripple ring on the water. */
  private ring(x: number, z: number, r0: number, r1: number, life: number, delay = 0, alpha = 0.6): void {
    const slot = this.rings.find((r) => r.t >= r.life) ?? this.rings[0];
    slot.alpha = alpha;
    slot.t = -delay;
    slot.life = life;
    slot.r0 = r0;
    slot.r1 = r1;
    slot.mesh.position.set(x, 0.035, z);
  }

  update(dt: number, camTarget: THREE.Vector3): void {
    if (dt <= 0) {
      this.spray.update(0, 0);
      return;
    }
    this.time += dt;
    for (const w of this.whales) this.updateWhale(w, dt, camTarget);
    this.updateDolphins(dt);
    for (const r of this.rings) {
      if (r.t >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      r.t += dt;
      if (r.t < 0) continue;
      const f = Math.min(1, r.t / r.life);
      const rad = r.r0 + (r.r1 - r.r0) * (1 - (1 - f) * (1 - f));
      r.mesh.visible = true;
      r.mesh.scale.set(rad, 1, rad);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - f) * (1 - f) * r.alpha;
    }
    this.updateCrowns(dt);
    this.spray.update(dt, 9);
    this.mist.update(dt, 0.45);
  }

/** Apply a pose (tilt from vertical toward yaw, spin about the body axis) to the whale root. */
  private applyPose(w: Whale, x: number, y: number, z: number): THREE.Quaternion {
    const p = w.pose;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(p.pitch)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(p.roll)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    // Never sink into the seabed: lift the whole body if its lowest point would touch the bottom.
    const ax = _ax.set(0, 0, 1).applyQuaternion(q);
    const L = w.length;
    const lowest = y - Math.abs(ax.y) * 0.5 * L - 0.2 * L;
    const floor = this.bedAt(x, z) + 0.3;
    if (lowest < floor) y += floor - lowest;
    // Out of sight below the surface until it breaches.
    if (w.state !== 'breach') {
      const highest = y + Math.abs(ax.y) * 0.5 * L + 0.16 * L;
      if (highest > -0.3) y -= highest + 0.3;
    }
    w.root.position.set(x, y, z);
    w.root.quaternion.copy(q);
    return q;
  }

  /** Swim animation: body wave, fluke following the tail, slow fin strokes. */
  private animateBody(w: Whale, dt: number, strength: number): void {
    w.swimPhase += dt * (1.6 + strength * 0.8);
    const ph = w.swimPhase;
    const arch = w.state === 'breach' ? Math.sin(Math.min(1, w.t / IMPACT_T) * Math.PI) : 0;
    poseWhaleSpine(w.spine, ph, strength, -w.turnRate, arch);
    // Fluke inherits the last spine joint, so it never separates from the tail stock.
    w.fluke.rotation.set(Math.sin(ph - 4.5) * 0.22 * strength, 0, 0);
    // Flippers swept back and held close along the flanks, with slow small strokes and steering.
    const st = Math.sin(ph * 0.5);
    const steer = THREE.MathUtils.clamp(w.turnRate * 0.8, -0.3, 0.3);
    w.finL.rotation.set(0, -1.2 + steer, 0.4 + st * 0.08 * strength);
    w.finR.rotation.set(0, 1.2 + steer, -0.4 - st * 0.08 * strength);
  }

  private updateWhale(w: Whale, dt: number, camTarget: THREE.Vector3): void {
    const L = w.length;
    const P = w.pose;
    if (w.state === 'swim') {
      // Wander in long, natural curves through deep water, fully submerged.
      const lookX = w.x + Math.sin(P.yaw) * 10, lookZ = w.z + Math.cos(P.yaw) * 10;
      let want = Math.sin(this.time * 0.07 + w.wanderSeed) * 0.35 + Math.sin(this.time * 0.023 + w.wanderSeed * 2) * 0.25;
      if (!this.deepEnough(lookX, lookZ, -4.6)) {
        // Steer away from shallows: turn toward open sea (away from the island centre).
        const away = Math.atan2(w.x, w.z);
        let d = away - P.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        want = Math.sign(d) * 0.5;
      }
      // Don't wander off beyond the horizon: circle back toward the island's waters.
      if (Math.hypot(w.x, w.z) > this.world.half * 1.3) {
        let d = Math.atan2(-w.x, -w.z) - P.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        want = Math.sign(d) * 0.4;
      }
      w.turnRate += (want - w.turnRate) * Math.min(1, dt * 0.8);
      P.yaw += w.turnRate * dt;
      const sp = MARINE.whaleSpeed;
      w.x += Math.sin(P.yaw) * sp * dt;
      w.z += Math.cos(P.yaw) * sp * dt;
      w.heading = P.yaw;
      // Gentle rise-and-fall and banking into turns.
      P.pitch += (90 + Math.sin(this.time * 0.4 + w.wanderSeed) * 6 - P.pitch) * Math.min(1, dt);
      P.roll += (-w.turnRate * 40 - P.roll) * Math.min(1, dt);
      P.y += (-MARINE.swimDepth + Math.sin(this.time * 0.3 + w.wanderSeed) * 0.25 - P.y) * Math.min(1, dt * 0.8);
      this.applyPose(w, w.x, P.y, w.z);
      this.animateBody(w, dt, 1);
      w.nextBreach -= dt;
      if (w.nextBreach <= 0) {
        w.nextBreach = MARINE.breachEvery[0] + this.rng.next() * (MARINE.breachEvery[1] - MARINE.breachEvery[0]);
        // Prefer breaching where the player is looking.
        const near = Math.hypot(w.x - camTarget.x, w.z - camTarget.z) < 90;
        // Only breach where the sea is deep enough for the rise (otherwise try again soon).
        if ((near || this.rng.chance(0.4)) && this.bedAt(w.x, w.z) < -4.6) this.breach(w);
        else if (this.bedAt(w.x, w.z) >= -4.6) w.nextBreach = 6;
      }
      w.nextPrint -= dt;
      if (w.nextPrint <= 0) {
        w.nextPrint = 2.6 + this.rng.next() * 2;
        const tx = w.x - Math.sin(P.yaw) * L * 0.4, tz = w.z - Math.cos(P.yaw) * L * 0.4;
        this.ring(tx, tz, L * 0.08, L * 0.32, 3.2, 0, 0.22);
      }
      w.ring.visible = w.glow.visible = w.patch.visible = false;
      this.fadeFoam(w, dt);
      return;
    }
    if (w.state === 'dive' || w.state === 'recover') {
      // Dive: nose down, then U-turn to point straight up, deep below the breach point.
      // Recover: from head-down after the splash back to level swimming.
      w.t += dt;
      const dur = w.state === 'dive' ? DIVE_T : 3.2;
      const f = Math.min(1, w.t / dur);
      const e = f * f * (3 - 2 * f);
      if (w.state === 'dive') {
        const k = f < 0.4 ? f / 0.4 : 1;
        P.pitch = f < 0.4 ? 90 + 40 * k : 130 - (130 - 36) * ((f - 0.4) / 0.6);
        P.y = -MARINE.swimDepth + (-0.64 * L + MARINE.swimDepth) * e;
        const sp = MARINE.whaleSpeed * (1 - f);
        w.x += Math.sin(P.yaw) * sp * dt;
        w.z += Math.cos(P.yaw) * sp * dt;
        P.roll *= 1 - Math.min(1, dt * 2);
        // Turn toward the breach direction while swinging nose-up (hidden underwater).
        if (f > 0.4) {
          let dy = w.fallYaw - w.heading;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          const u = (f - 0.4) / 0.6;
          P.yaw = w.heading + dy * u * u * (3 - 2 * u);
        }
      } else {
        P.pitch = 180 + (90 - 180) * e;
        P.roll = 450 - 90 * e;
        P.y += (-MARINE.swimDepth - P.y) * Math.min(1, dt * 1.2);
        w.x += Math.sin(P.yaw) * MARINE.whaleSpeed * e * dt;
        w.z += Math.cos(P.yaw) * MARINE.whaleSpeed * e * dt;
      }
      this.applyPose(w, w.x, P.y, w.z);
      this.animateBody(w, dt, 1.4);
      this.fadeFoam(w, dt);
      if (f >= 1) {
        if (w.state === 'dive') {
          w.state = 'breach';
          w.t = 0;
          w.bx = w.x;
          w.bz = w.z;
          w.flags.clear();
        } else {
          w.state = 'swim';
          P.roll = 0;
          w.turnRate = 0;
        }
      }
      return;
    }

    // ---------------- Breach ----------------
    w.t += dt;
    const t = w.t;
    const k = sampleBreach(t);
    const fy = w.fallYaw;
    const dirX = Math.sin(fy), dirZ = Math.cos(fy);
    const cx = w.bx + dirX * k.h * L, cz = w.bz + dirZ * k.h * L;
    const cy = k.y * L;
    // Orientation: yaw toward the fall direction, tilt from vertical, spin about the body axis.
    P.yaw = fy;
    P.pitch = k.pitch;
    P.roll = k.roll;
    P.y = cy;
    const q = this.applyPose(w, cx, cy, cz);
    this.animateBody(w, dt, t < 1.1 ? 2.2 : t < IMPACT_T ? 1.1 : 1.7);
    // Fins sweep out wide; the fluke flexes.
    w.finL.rotation.set(0, 0.3 - k.fin * 0.3, -k.fin + Math.sin(t * 5) * 0.08);
    w.finR.rotation.set(0, -0.3 + k.fin * 0.3, k.fin - Math.sin(t * 5) * 0.08);
    w.fluke.rotation.x += t > IMPACT_T ? Math.sin((t - IMPACT_T) * 5) * 0.5 : 0;
    w.x = cx;
    w.z = cz;

    // Underwater glow and pale patch as it rises from the deep (0.2 – 1.4 s), light column until ~2.4 s.
    const glowA = t < 0.3 ? t / 0.3 : t < 2.2 ? 1 : Math.max(0, 1 - (t - 2.2) / 0.6);
    w.glow.visible = glowA > 0.01;
    w.glow.position.set(w.bx, -0.06, w.bz);
    w.glow.scale.set(L * 0.35, L * 1.1, L * 0.35);
    (w.glow.material as THREE.ShaderMaterial).uniforms.uA.value = glowA * 0.4;
    const patchA = t < 1.3 ? Math.min(1, t / 0.5) * (1 - Math.max(0, (t - 1.0) / 0.3)) : 0;
    w.patch.visible = patchA > 0.01;
    w.patch.position.set(w.bx, -0.02, w.bz);
    w.patch.scale.set(L * 0.42, 1, L * 0.7);
    w.patch.rotation.y = w.heading;
    (w.patch.material as THREE.MeshBasicMaterial).opacity = patchA;

    // Bright foam ring hugging the body at the waterline while it rises and hangs.
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let ringOn = false;
    if (t > 0.65 && t < IMPACT_T && Math.abs(axis.y) > 0.2) {
      const s = -cy / axis.y;
      if (Math.abs(s) < 0.5 * L) {
        ringOn = true;
        const wx = cx + axis.x * s, wz = cz + axis.z * s;
        const r = whaleRadius(0.5 + s / L) * L * 1.6 + 0.15;
        w.ring.position.set(wx, 0.04, wz);
        w.ring.scale.set(r, 1, r);
        (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.85;
        if (this.rng.next() < dt * 40) this.spray.spawn(wx + (this.rng.next() - 0.5) * r * 2, 0.05, wz + (this.rng.next() - 0.5) * r * 2, (this.rng.next() - 0.5) * 0.8, 0.8 + this.rng.next() * 1.2, (this.rng.next() - 0.5) * 0.8, 0.6, 0.12);
      }
    }
    w.ring.visible = ringOn;

    // Beats.
    const once = (id: string, at: number, fn: () => void) => {
      if (t >= at && !w.flags.has(id)) {
        w.flags.add(id);
        fn();
      }
    };
    once('surface', 0.65, () => {
      this.sfx('splash', w.bx, w.bz);
      for (const [r1, life, delay] of [[L * 0.45, 1.6, 0], [L * 0.7, 2.2, 0.35], [L * 0.95, 2.6, 0.8], [L * 1.1, 2.8, 1.3]]) this.ring(w.bx, w.bz, 0.3, r1, life, delay);
      this.burst(w.bx, w.bz, 90, 2.4, 0.6);
      this.crown(w.bx, w.bz, L * 0.12, L * 0.3, L * 0.16, 1.4);
    });
    once('impact', IMPACT_T, () => {
      const impact = sampleBreach(IMPACT_T);
      const ix = w.bx + dirX * L * impact.h, iz = w.bz + dirZ * L * impact.h;
      this.sfx('bigsplash', ix, iz);
      this.burst(ix, iz, 620, 8.2, L * 0.42);
      this.crown(ix, iz, L * 0.24, L * 0.9, L * 0.8, 2.0);
      this.crown(ix, iz, L * 0.18, L * 0.55, L * 0.48, 1.4);
      for (let m = 0; m < 60; m++) {
        const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * L * 0.4;
        this.mist.spawn(ix + Math.cos(a) * r, this.rng.next() * L * 0.25, iz + Math.sin(a) * r, Math.cos(a) * 1.6, 1.5 + this.rng.next() * 2.5, Math.sin(a) * 1.6, 1.2 + this.rng.next() * 0.8, 1.4 + this.rng.next() * 1.2, 1.2);
      }
      for (let m = 0; m < 150; m++) {
        const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * L * 0.55;
        // Mist hangs in the air and drifts downwind before fading.
        this.mist.spawn(ix + Math.cos(a) * r, 0.2 + this.rng.next() * L * 0.4, iz + Math.sin(a) * r, Math.cos(a) * 0.7 + 0.35, 0.2 + this.rng.next() * 0.8, Math.sin(a) * 0.7 + 0.2, 2.4 + this.rng.next() * 2.2, 0.9 + this.rng.next() * 1.1, 0.8);
      }
      for (const [r1, life, delay] of [[L * 1.0, 2.2, 0], [L * 1.5, 3.2, 0.25], [L * 2.0, 4.2, 0.6]]) this.ring(ix, iz, L * 0.3, r1, life, delay);
      w.foam.visible = true;
      w.foam.position.set(ix, 0.03, iz);
      w.foam.userData = { t: 0, x: ix, z: iz };
    });
    once('fluke', FLUKE_T, () => {
      w.root.updateMatrixWorld(true);
      const tail = w.fluke.getWorldPosition(new THREE.Vector3());
      this.sfx('splash', tail.x, tail.z);
      this.burst(tail.x, tail.z, 110, 2.8, 0.45);
      this.crown(tail.x, tail.z, L * 0.08, L * 0.24, L * 0.16, 1.2);
      // Water pouring off the raised fluke.
      for (let k = 0; k < 60; k++) this.spray.spawn(tail.x + (this.rng.next() - 0.5) * L * 0.3, tail.y + this.rng.next() * 0.4, tail.z + (this.rng.next() - 0.5) * L * 0.3, (this.rng.next() - 0.5) * 0.4, this.rng.next() * 0.5, (this.rng.next() - 0.5) * 0.4, 0.8 + this.rng.next() * 0.6, 0.06 + this.rng.next() * 0.1, 0);
    });
    this.fadeFoam(w, dt);
    if (t >= BREACH_END) {
      // Roll back to level and swim on from where it went under.
      w.state = 'recover';
      w.t = 0;
      w.heading = fy;
    }
  }

  /** Swirling foam left by the impact spreads and fades over seven seconds. */
  private fadeFoam(w: Whale, dt: number): void {
    const u = w.foam.userData as { t?: number };
    if (!w.foam.visible || u.t === undefined) return;
    u.t += dt;
    const f = u.t / 7;
    const L = w.length;
    const r = L * (0.45 + 0.8 * (1 - Math.pow(1 - Math.min(1, f), 2)));
    w.foam.scale.set(r, 1, r);
    w.foam.rotation.y += dt * 0.5 * (1 - f);
    (w.foam.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85) * 0.95;
    if (f >= 1) w.foam.visible = false;
  }

  /** A splash of droplets (whales breaching, birds diving, a lunging alligator). */
  splash(x: number, z: number, n: number, speed: number, radius: number, y = 0.05): void {
    this.burst(x, z, n, speed, radius, y);
  }

  private burst(x: number, z: number, n: number, speed: number, radius: number, y = 0.05): void {
    for (let k = 0; k < n; k++) {
      const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * radius;
      const up = speed * (0.5 + this.rng.next() * 0.8);
      const out = speed * 0.35 * (0.3 + this.rng.next());
      // Mostly fine droplets, with the odd bigger clump of water.
      const big = this.rng.next() < 0.05;
      this.spray.spawn(x + Math.cos(a) * r, y, z + Math.sin(a) * r, Math.cos(a) * out, up, Math.sin(a) * out, 0.8 + this.rng.next() * 0.9, big ? 0.14 + this.rng.next() * 0.12 : 0.04 + this.rng.next() * 0.08, big ? 0.12 : 0.03);
    }
  }

  // ---------------- Dolphins ----------------

  private updateDolphins(dt: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const pod of this.pods) {
      pod.a += (dt * pod.speed * pod.dir) / pod.r;
      const nx = pod.cx + Math.cos(pod.a) * pod.r, nz = pod.cz + Math.sin(pod.a) * pod.r;
      pod.x = nx;
      pod.z = nz;
      // Shallows ahead (e.g. the land was raised): drift the whole loop further out to sea.
      if (!this.deepEnough(nx, nz, -2.2)) {
        const d = Math.hypot(pod.cx, pod.cz) || 1;
        pod.cx += (pod.cx / d) * dt * 4;
        pod.cz += (pod.cz / d) * dt * 4;
      }
    }
    const L = MARINE.dolphinLength;
    const cycle = (2 * Math.PI) / MARINE.leapPeriod;
    for (const pod of this.pods) pod.phase += dt * cycle;
    const bend = this.dolphinBend.array as Float32Array;
    this.dolphins.forEach((d, i) => {
      const pod = this.pods[d.pod];
      // Travel direction is the tangent of the pod's loop; the pod swims in a loose echelon.
      const yaw = Math.atan2(-Math.sin(pod.a) * pod.dir, Math.cos(pod.a) * pod.dir);
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const tx = pod.x + fz * d.offX - fx * d.offZ, tz = pod.z - fx * d.offX - fz * d.offZ;
      d.x += (tx - d.x) * Math.min(1, dt * 1.5);
      d.z += (tz - d.z) * Math.min(1, dt * 1.5);
      // Porpoising together: the pod's rhythm, each dolphin a little behind the one ahead.
      const ph = (((pod.phase - d.lag * Math.PI * 2) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const up = ph < Math.PI;
      const u = ph / Math.PI;
      const big = d.spin ? 1.45 : 1;
      d.y = up ? Math.sin(u * Math.PI) * MARINE.leapHeight * d.leapH * big : -0.32 - Math.sin((u - 1) * Math.PI) * 0.22;
      d.pitch = up ? Math.cos(u * Math.PI) * 0.9 : Math.cos((u - 1) * Math.PI) * 0.18;
      if (up && !d.wasUp) {
        d.spin = this.rng.chance(0.1);
        this.dolphinSplash(d.x, d.z, 12);
      }
      if (!up && d.wasUp) {
        this.dolphinSplash(d.x + fx * 0.6, d.z + fz * 0.6, 16);
        this.ring(d.x + fx * 0.6, d.z + fz * 0.6, 0.15, 0.9, 1.1, 0, 0.45);
      }
      d.wasUp = up;
      d.roll = up && d.spin ? u * Math.PI * 2 : Math.sin(pod.phase * 0.3 + d.lag * 9) * 0.15;
      d.yaw = yaw;
      // Strong tail strokes under water, a gentle flex and an arched back in the air.
      d.stroke += dt * (up ? 4 : 13);
      bend[i * 3] = d.stroke;
      bend[i * 3 + 1] = up ? 0.018 : 0.075;
      bend[i * 3 + 2] = up ? Math.sin(u * Math.PI) * 0.05 : 0;
      e.set(-d.pitch, yaw, d.roll, 'YXZ');
      q.setFromEuler(e);
      p.set(d.x, d.y, d.z);
      s.setScalar(L);
      this.dolphinMesh.setMatrixAt(i, m.compose(p, q, s));
    });
    this.dolphinBend.needsUpdate = true;
    // Only as many instances as there are dolphins (spare slots would sit frozen at the map centre).
    this.dolphinMesh.count = this.dolphins.length;
    this.dolphinMesh.instanceMatrix.needsUpdate = true;
  }

  private dolphinSplash(x: number, z: number, n: number): void {
    for (let k = 0; k < n; k++) this.spray.spawn(x + (this.rng.next() - 0.5) * 0.3, 0.05, z + (this.rng.next() - 0.5) * 0.3, (this.rng.next() - 0.5) * 1, 1 + this.rng.next() * 1.5, (this.rng.next() - 0.5) * 1, 0.6, 0.06);
  }

  /** Positions for the minimap. */
  positions(): { x: number; z: number }[] {
    return this.whales.map((w) => ({ x: w.x, z: w.z }));
  }
}
