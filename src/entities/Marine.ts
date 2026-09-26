import * as THREE from 'three';
import { MARINE } from '../config';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { patchStylised, stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { Water } from '../water/Water';
import { Particles } from './Boats';

// ---------------- Models (faceted low poly, length 1 along +z, head at +z) ----------------

const WHALE_TOP = new THREE.Color(0x2b323c);
const WHALE_MID = new THREE.Color(0x4a535e);
const WHALE_BELLY = new THREE.Color(0xdfe4e6);
const WHALE_GROOVE = new THREE.Color(0xb3bcc2);

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

function whaleBody(): THREE.BufferGeometry {
  const shell = bodyShell(whaleRadius, 16, 10, (t) => (t > 0.8 ? 0.72 : 0.86), (t, a, s) => {
    if (s < -0.3) {
      // Pale belly with throat grooves at the front half.
      if (t > 0.55) return Math.floor(a * 6) % 2 ? WHALE_BELLY : WHALE_GROOVE;
      return t > 0.35 ? WHALE_BELLY.clone().lerp(WHALE_MID, 0.4) : WHALE_MID;
    }
    return s < 0 ? WHALE_MID : WHALE_TOP;
  });
  // Dorsal hump, head knobs (tubercles) and eyes.
  const extra = new GeoBuilder();
  extra.add(P.cone(0.03, 0.05, 5), { color: WHALE_TOP }, M.t(0, 0.085, -0.16, -0.5, 0, 0));
  for (let k = 0; k < 9; k++) {
    const z = 0.3 + (k % 5) * 0.035, x = (k % 2 ? 1 : -1) * (0.012 + (k % 3) * 0.018);
    extra.add(P.sphere(0.012, 0), { color: WHALE_TOP }, M.t(x, whaleRadius(z + 0.5) * 0.7, z));
  }
  for (const x of [-1, 1]) extra.add(P.sphere(0.012, 0), { color: 0x0e1014 }, M.t(x * 0.085, -0.005, 0.33));
  return mergeFlat([shell, extra.build()]);
}

/** Long humpback pectoral fin: one tapered, swept blade, dark on top and white beneath. Pivot at the root, extends along +x. */
function whaleFin(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  // Outline in (x = span, y = chord); the leading edge is scalloped like a humpback's.
  sh.moveTo(0, 0.035);
  const lead: [number, number][] = [];
  for (let k = 1; k <= 8; k++) {
    const u = k / 8;
    lead.push([u * 0.34, 0.035 - u * 0.06 + (k % 2 ? 0.006 : 0)]);
  }
  for (const [x, y] of lead) sh.lineTo(x, y);
  sh.lineTo(0.35, -0.03);
  sh.lineTo(0.2, -0.045);
  sh.lineTo(0.06, -0.04);
  sh.lineTo(0, -0.03);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 1 });
  g.translate(0, 0, -0.006);
  g.rotateX(Math.PI / 2);
  const b = new GeoBuilder();
  b.add(g, { color: (p, nn) => (nn.y < 0 ? WHALE_BELLY : p.x > 0.22 ? WHALE_BELLY.clone().lerp(WHALE_TOP, 0.45) : WHALE_TOP) });
  return facet(b.build());
}

/** Tail fluke: two swept lobes. Pivot at the tail stock, extends along -z. */
function whaleFluke(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  for (const side of [-1, 1]) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(side * 0.17, -0.05);
    s.lineTo(side * 0.19, -0.1);
    s.lineTo(side * 0.08, -0.07);
    s.lineTo(0, -0.03);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false });
    g.translate(0, 0, -0.006);
    g.rotateX(Math.PI / 2);
    b.add(g, { color: (_p, nn) => (nn.y < -0.5 ? WHALE_BELLY : WHALE_TOP) });
  }
  return facet(b.build());
}

function dolphinGeometry(): THREE.BufferGeometry {
  const top = new THREE.Color(0x6f8394), belly = new THREE.Color(0xe3e9ec), mid = new THREE.Color(0x9aabb8);
  const k: [number, number][] = [[0, 0.015], [0.2, 0.05], [0.5, 0.1], [0.72, 0.095], [0.86, 0.06], [0.9, 0.03], [1, 0.02]];
  const rad = (t: number) => {
    for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) return k[i][1] + (k[i + 1][1] - k[i][1]) * ((t - k[i][0]) / (k[i + 1][0] - k[i][0]));
    return 0.02;
  };
  const shell = bodyShell(rad, 12, 8, () => 0.95, (_t, _a, s) => (s < -0.35 ? belly : s < 0.1 ? mid : top));
  const b = new GeoBuilder();
  b.add(P.cone(0.05, 0.12, 4), { color: top }, M.t(0, 0.13, -0.02, -0.55, 0, 0, 0.35, 1, 1));
  for (const x of [-1, 1]) b.add(P.box(0.13, 0.008, 0.05), { color: top }, M.t(x * 0.1, -0.05, 0.18, 0, x * -0.5, x * 0.4));
  for (const x of [-1, 1]) b.add(P.box(0.12, 0.008, 0.05), { color: top }, M.t(x * 0.06, 0, -0.5, 0, x * -0.5, 0));
  return mergeFlat([shell, b.build()]);
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

// ---------------- Breach choreography ----------------

/**
 * Breach keyframes, matched to the reference clip (seconds):
 *  y = body-centre height in body lengths, h = travel along the fall direction (body lengths),
 *  pitch = tilt from vertical toward the fall direction (degrees), roll = spin about the body axis (degrees),
 *  fin = pectoral fin spread (radians).
 */
const BREACH: { t: number; y: number; h: number; pitch: number; roll: number; fin: number }[] = [
  { t: 0.0, y: -1.05, h: 0.0, pitch: 8, roll: 0, fin: 0.3 },
  { t: 1.0, y: -0.49, h: 0.0, pitch: 6, roll: 10, fin: 0.5 },
  { t: 1.4, y: -0.26, h: 0.0, pitch: 7, roll: 45, fin: 0.9 },
  { t: 1.8, y: -0.06, h: 0.01, pitch: 9, roll: 95, fin: 1.1 },
  { t: 2.2, y: 0.08, h: 0.02, pitch: 12, roll: 145, fin: 0.9 },
  { t: 2.55, y: 0.14, h: 0.04, pitch: 18, roll: 180, fin: 0.7 },
  { t: 2.85, y: 0.1, h: 0.12, pitch: 40, roll: 195, fin: 0.9 },
  { t: 3.15, y: 0.02, h: 0.3, pitch: 72, roll: 208, fin: 1.2 },
  { t: 3.4, y: -0.06, h: 0.44, pitch: 96, roll: 215, fin: 1.3 },
  { t: 3.8, y: -0.26, h: 0.56, pitch: 138, roll: 222, fin: 0.8 },
  { t: 4.25, y: -0.46, h: 0.62, pitch: 172, roll: 226, fin: 0.5 },
  { t: 4.9, y: -0.95, h: 0.66, pitch: 186, roll: 228, fin: 0.3 },
];
const BREACH_END = 4.9;
/** Seconds of diving and turning upward before the breach starts. */
const DIVE_T = 3.2;
const IMPACT_T = 3.4;
const FLUKE_T = 4.2;

function sampleTrack(t: number): { y: number; h: number; pitch: number; roll: number; fin: number } {
  const K = BREACH;
  if (t <= K[0].t) return K[0];
  if (t >= K[K.length - 1].t) return K[K.length - 1];
  let i = 0;
  while (t > K[i + 1].t) i++;
  const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
  const f = (t - b.t) / (c.t - b.t);
  // Catmull-Rom for smooth, eased motion through the keys.
  const cr = (p0: number, p1: number, p2: number, p3: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  return { y: cr(a.y, b.y, c.y, d.y), h: cr(a.h, b.h, c.h, d.h), pitch: cr(a.pitch, b.pitch, c.pitch, d.pitch), roll: cr(a.roll, b.roll, c.roll, d.roll), fin: cr(a.fin, b.fin, c.fin, d.fin) };
}

interface Whale {
  root: THREE.Group;
  body: THREE.Mesh;
  finL: THREE.Group;
  finR: THREE.Group;
  fluke: THREE.Group;
  x: number;
  z: number;
  heading: number;
  route: { x: number; z: number; r: number; a: number; dir: number };
  state: 'swim' | 'dive' | 'breach' | 'recover';
  /** Body bend uniforms (travelling wave along the body, lateral turn curvature). */
  bend: { uPhase: { value: number }; uAmp: { value: number }; uTurn: { value: number } };
  /** Current pose: tilt from vertical toward yaw (90 = level), spin, depth. */
  pose: { y: number; pitch: number; roll: number; yaw: number };
  turnRate: number;
  wanderSeed: number;
  t: number;
  nextBreach: number;
  nextSpout: number;
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
 * Humpback whales that cruise the deep water, spout and breach (choreographed after the
 * reference clip: vertical rise with a spin, topple onto the back, huge swirling splash, fluke
 * flip as it dives), and dolphin pods porpoising in leaping arcs.
 */
export class Marine {
  readonly group = new THREE.Group();
  whales: Whale[] = [];
  private pods: Pod[] = [];
  private dolphins: Dolphin[] = [];
  private dolphinMesh: THREE.InstancedMesh;
  private spray = new Particles(700, 0xf2fcff);
  private mist = new Particles(220, 0xe8f8ff);
  private rings: { mesh: THREE.Mesh; t: number; life: number; r0: number; r1: number }[] = [];
  private rng: RNG;
  private time = 0;
  sfx: (n: string, x: number, z: number) => void = () => {};

  constructor(private world: World, private water: Water) {
    this.rng = new RNG(world.seed * 53 + 17);
    this.group.add(this.spray.points, this.mist.points);
    (this.mist.points.material as THREE.ShaderMaterial).blending = THREE.NormalBlending;

    const mat = stylisedMaterial();
    const bodyGeo = whaleBody(), finGeo = whaleFin(), flukeGeo = whaleFluke();
    const foamTex = spiralFoamTexture(), soft = softTexture();
    const ringGeo = new THREE.RingGeometry(0.955, 1, 56).rotateX(-Math.PI / 2);
    for (let k = 0; k < 10; k++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf2fcff, transparent: true, opacity: 0, depthWrite: false, fog: true }));
      m.visible = false;
      m.renderOrder = 15;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1, life: 1, r0: 1, r1: 2 });
    }

    const spots = this.deepSpots(MARINE.whales);
    spots.forEach((s, k) => {
      const L = MARINE.whaleLength * (0.9 + this.rng.next() * 0.2);
      const root = new THREE.Group();
      // Each whale gets its own material so its body can bend independently.
      const bend = { uPhase: { value: 0 }, uAmp: { value: 0 }, uTurn: { value: 0 } };
      const bodyMat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), 0.35);
      const baseCompile = bodyMat.onBeforeCompile;
      bodyMat.onBeforeCompile = (shader, r) => {
        baseCompile.call(bodyMat, shader, r);
        Object.assign(shader.uniforms, bend);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uPhase; uniform float uAmp; uniform float uTurn;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              // Travelling wave: still at the head, strongest at the tail (flukes drive the swim).
              float zz = transformed.z;
              float wgt = smoothstep(0.3, -0.5, zz);
              transformed.y += uAmp * wgt * wgt * sin(uPhase - zz * 5.0);
              transformed.x += uTurn * zz * zz;
            }`);
      };
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.castShadow = true;
      const finL = new THREE.Group(), finR = new THREE.Group();
      const fl = new THREE.Mesh(finGeo, mat), fr = new THREE.Mesh(finGeo, mat);
      fl.castShadow = fr.castShadow = true;
      fl.scale.x = -1; // mirrored for the left side
      finL.add(fl);
      finR.add(fr);
      finL.position.set(-0.09, -0.04, 0.2);
      finR.position.set(0.09, -0.04, 0.2);
      const fluke = new THREE.Group();
      const fm = new THREE.Mesh(flukeGeo, mat);
      fm.castShadow = true;
      fluke.add(fm);
      fluke.position.set(0, 0, -0.5);
      root.add(body, finL, finR, fluke);
      root.scale.setScalar(L);
      this.group.add(root);
      const mk = (geo: THREE.BufferGeometry, m: THREE.Material) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.visible = false;
        this.group.add(mesh);
        return mesh;
      };
      const ring = mk(new THREE.RingGeometry(0.84, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: true }));
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
        state: 'swim', t: 0, nextBreach: MARINE.firstBreach + k * 9 + this.rng.next() * 10, nextSpout: 3 + this.rng.next() * 8,
        bx: 0, bz: 0, fallYaw: 0, length: L, flags: new Set(), ring, glow, patch, foam,
        bend, pose: { y: -MARINE.swimDepth, pitch: 90, roll: 0, yaw: a }, turnRate: 0, wanderSeed: this.rng.next() * 100,
      });
    });

    // Dolphin pods.
    const dgeo = dolphinGeometry();
    const total = MARINE.pods * MARINE.dolphinsPerPod;
    this.dolphinMesh = new THREE.InstancedMesh(dgeo, mat, total);
    this.dolphinMesh.castShadow = true;
    this.dolphinMesh.frustumCulled = false;
    this.dolphinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.dolphinMesh);
    const podSpots = this.deepSpots(MARINE.pods, -1.4, 0.45, 0.8);
    podSpots.forEach((s, k) => {
      const pod: Pod = { x: s.x, z: s.z, cx: s.x, cz: s.z, a: this.rng.range(0, 6.28), r: 12 + this.rng.next() * 12, dir: k % 2 ? 1 : -1, speed: MARINE.dolphinSpeed, ids: [] };
      for (let d = 0; d < MARINE.dolphinsPerPod; d++) {
        pod.ids.push(this.dolphins.length);
        this.dolphins.push({ pod: k, offX: (this.rng.next() - 0.5) * 3, offZ: (this.rng.next() - 0.5) * 3, phase: this.rng.next() * 6.28, x: s.x, y: -0.4, z: s.z, pitch: 0, yaw: 0, roll: 0, wasUp: false, spin: false });
      }
      this.pods.push(pod);
    });
  }

  /** Random deep-water points around the island (optionally within a radius band of the map). */
  private deepSpots(n: number, maxBed = -3.2, rMin = 0.5, rMax = 0.9): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const w = this.world;
    for (let k = 0; k < 4000 && out.length < n; k++) {
      const a = this.rng.range(0, Math.PI * 2), d = this.rng.range(w.half * rMin, w.half * rMax);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (w.heightAt(x, z) > maxBed) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 25)) continue;
      out.push({ x, z });
    }
    return out;
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
    // Fall roughly sideways to the direction of travel, like the clip.
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

  /** Spawn an expanding ripple ring on the water. */
  private ring(x: number, z: number, r0: number, r1: number, life: number, delay = 0): void {
    const slot = this.rings.find((r) => r.t >= r.life) ?? this.rings[0];
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
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - f) * (1 - f) * 0.6;
    }
    this.spray.update(dt, 9);
    this.mist.update(dt, -0.3);
  }

/** Apply a pose (tilt from vertical toward yaw, spin about the body axis) to the whale root. */
  private applyPose(w: Whale, x: number, y: number, z: number): THREE.Quaternion {
    const p = w.pose;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(p.pitch)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(p.roll)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    w.root.position.set(x, y, z);
    w.root.quaternion.copy(q);
    return q;
  }

  /** Swim animation: body wave, fluke following the tail, slow fin strokes. */
  private animateBody(w: Whale, dt: number, strength: number): void {
    const B = w.bend;
    B.uPhase.value += dt * (1.6 + strength * 0.8);
    B.uAmp.value += (0.035 * strength - B.uAmp.value) * Math.min(1, dt * 2);
    B.uTurn.value += (-w.turnRate * 0.25 - B.uTurn.value) * Math.min(1, dt * 2);
    // Fluke rides the tail of the wave: position and slope at z = -0.5.
    const ph = B.uPhase.value;
    const dy = B.uAmp.value * Math.sin(ph + 2.5);
    const slope = -5 * B.uAmp.value * Math.cos(ph + 2.5);
    w.fluke.position.set(B.uTurn.value * 0.25, dy, -0.5);
    w.fluke.rotation.set(Math.atan(slope) * 1.6, B.uTurn.value, 0);
    const st = Math.sin(ph * 0.5);
    w.finL.rotation.set(0, 0.35, -0.3 - st * 0.18 * strength);
    w.finR.rotation.set(0, -0.35, 0.3 + st * 0.18 * strength);
  }

  private updateWhale(w: Whale, dt: number, camTarget: THREE.Vector3): void {
    const L = w.length;
    const P = w.pose;
    if (w.state === 'swim') {
      // Wander in long, natural curves through deep water, fully submerged.
      const lookX = w.x + Math.sin(P.yaw) * 10, lookZ = w.z + Math.cos(P.yaw) * 10;
      let want = Math.sin(this.time * 0.07 + w.wanderSeed) * 0.35 + Math.sin(this.time * 0.023 + w.wanderSeed * 2) * 0.25;
      if (!this.deepEnough(lookX, lookZ, -3)) {
        // Steer away from shallows: turn toward open sea (away from the island centre).
        const away = Math.atan2(w.x, w.z);
        let d = away - P.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        want = Math.sign(d) * 0.5;
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
        if (near || this.rng.chance(0.4)) this.breach(w);
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
        P.pitch = f < 0.4 ? 90 + 50 * k : 140 - (140 - 8) * ((f - 0.4) / 0.6);
        P.y = -MARINE.swimDepth + (-1.05 * L + MARINE.swimDepth) * e;
        const sp = MARINE.whaleSpeed * (1 - f);
        w.x += Math.sin(P.yaw) * sp * dt;
        w.z += Math.cos(P.yaw) * sp * dt;
        P.roll *= 1 - Math.min(1, dt * 2);
      } else {
        P.pitch = 186 + (90 - 186) * e;
        P.roll = 228 * (1 - e);
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
    const k = sampleTrack(t);
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
    this.animateBody(w, dt, t < 1 ? 1.5 : 0.5);
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
    (w.glow.material as THREE.ShaderMaterial).uniforms.uA.value = glowA * 1.1;
    const patchA = t < 1.3 ? Math.min(1, t / 0.5) * (1 - Math.max(0, (t - 1.0) / 0.3)) : 0;
    w.patch.visible = patchA > 0.01;
    w.patch.position.set(w.bx, -0.02, w.bz);
    w.patch.scale.set(L * 0.42, 1, L * 0.7);
    w.patch.rotation.y = w.heading;
    (w.patch.material as THREE.MeshBasicMaterial).opacity = patchA;

    // Bright foam ring hugging the body at the waterline while it rises and hangs.
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let ringOn = false;
    if (t > 0.95 && t < IMPACT_T && Math.abs(axis.y) > 0.2) {
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
    once('surface', 1.0, () => {
      this.sfx('splash', w.bx, w.bz);
      for (const [r1, life, delay] of [[L * 0.45, 1.6, 0], [L * 0.7, 2.2, 0.35], [L * 0.95, 2.6, 0.8], [L * 1.1, 2.8, 1.3]]) this.ring(w.bx, w.bz, 0.3, r1, life, delay);
      this.burst(w.bx, w.bz, 60, 2.2, 0.6);
    });
    once('impact', IMPACT_T, () => {
      const ix = w.bx + dirX * L * 0.55, iz = w.bz + dirZ * L * 0.55;
      this.sfx('bigsplash', ix, iz);
      this.burst(ix, iz, 320, 5.5, L * 0.35);
      for (let m = 0; m < 70; m++) {
        const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * L * 0.5;
        this.mist.spawn(ix + Math.cos(a) * r, 0.2 + this.rng.next() * 1.5, iz + Math.sin(a) * r, Math.cos(a) * 0.9, 0.3 + this.rng.next() * 0.9, Math.sin(a) * 0.9, 1.6 + this.rng.next() * 1.4, 0.28, 0.35);
      }
      for (const [r1, life, delay] of [[L * 0.8, 1.6, 0], [L * 1.2, 2.2, 0.25], [L * 1.6, 2.8, 0.6]]) this.ring(ix, iz, L * 0.3, r1, life, delay);
      w.foam.visible = true;
      w.foam.position.set(ix, 0.03, iz);
      w.foam.userData = { t: 0, x: ix, z: iz };
    });
    once('fluke', FLUKE_T, () => {
      const tail = new THREE.Vector3(0, 0, -0.5 * L).applyQuaternion(q).add(new THREE.Vector3(cx, cy, cz));
      this.sfx('splash', tail.x, tail.z);
      this.burst(tail.x, tail.z, 60, 2.6, 0.4);
    });
    this.fadeFoam(w, dt);
    if (t >= BREACH_END) {
      // Roll back to level and swim on from where it went under.
      w.state = 'recover';
      w.t = 0;
      w.heading = fy;
    }
  }

  /** Swirling foam disc left by the impact: spreads, spins and fades (clip 3.5 – 5.2 s). */
  private fadeFoam(w: Whale, dt: number): void {
    const u = w.foam.userData as { t?: number };
    if (!w.foam.visible || u.t === undefined) return;
    u.t += dt;
    const f = u.t / 2.2;
    const L = w.length;
    const r = L * (0.35 + 0.55 * (1 - Math.pow(1 - Math.min(1, f), 2)));
    w.foam.scale.set(r, 1, r);
    w.foam.rotation.y += dt * 0.9;
    (w.foam.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f < 0.15 ? f / 0.15 : 1 - (f - 0.15) / 0.85) * 0.95;
    if (f >= 1) w.foam.visible = false;
  }

  private burst(x: number, z: number, n: number, speed: number, radius: number): void {
    for (let k = 0; k < n; k++) {
      const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * radius;
      const up = speed * (0.5 + this.rng.next() * 0.8);
      const out = speed * 0.35 * (0.3 + this.rng.next());
      this.spray.spawn(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r, Math.cos(a) * out, up, Math.sin(a) * out, 0.8 + this.rng.next() * 0.9, 0.08 + this.rng.next() * 0.18, 0.05);
    }
  }

  // ---------------- Dolphins ----------------

  private updateDolphins(dt: number): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (const pod of this.pods) {
      pod.a += (dt * pod.speed * pod.dir) / pod.r;
      const nx = pod.cx + Math.cos(pod.a) * pod.r, nz = pod.cz + Math.sin(pod.a) * pod.r;
      if (!this.deepEnough(nx, nz, -1.0)) {
        pod.dir *= -1;
        pod.a += pod.dir * 0.3;
      } else {
        pod.x = nx;
        pod.z = nz;
      }
    }
    const L = MARINE.dolphinLength;
    this.dolphins.forEach((d, i) => {
      const pod = this.pods[d.pod];
      // Travel direction is the tangent of the pod's loop.
      const yaw = Math.atan2(-Math.sin(pod.a) * pod.dir, Math.cos(pod.a) * pod.dir);
      const tx = pod.x + d.offX, tz = pod.z + d.offZ;
      d.x += (tx - d.x) * Math.min(1, dt * 1.5);
      d.z += (tz - d.z) * Math.min(1, dt * 1.5);
      // Porpoising: each dolphin leaps in a staggered rhythm (arc out of the water, then glide under).
      d.phase += dt * (2 * Math.PI) / MARINE.leapPeriod;
      const ph = d.phase % (Math.PI * 2);
      const up = ph < Math.PI; // first half of the cycle is the leap
      const u = ph / Math.PI;
      const height = up ? Math.sin(u * Math.PI) * MARINE.leapHeight : -0.25 - Math.sin((u - 1) * Math.PI) * 0.15;
      d.y = height;
      d.pitch = up ? Math.cos(u * Math.PI) * 0.85 : Math.cos((u - 1) * Math.PI) * 0.15;
      if (up && !d.wasUp) {
        d.spin = this.rng.chance(0.12);
        this.dolphinSplash(d.x, d.z, 10);
      }
      if (!up && d.wasUp) {
        this.dolphinSplash(d.x + Math.sin(yaw) * 0.6, d.z + Math.cos(yaw) * 0.6, 14);
        this.ring(d.x + Math.sin(yaw) * 0.6, d.z + Math.cos(yaw) * 0.6, 0.15, 0.9, 1.1);
      }
      d.wasUp = up;
      d.roll = up && d.spin ? u * Math.PI * 2 : 0;
      d.yaw = yaw;
      e.set(-d.pitch, yaw, d.roll, 'YXZ');
      q.setFromEuler(e);
      p.set(d.x, d.y, d.z);
      s.setScalar(L);
      this.dolphinMesh.setMatrixAt(i, m.compose(p, q, s));
    });
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
