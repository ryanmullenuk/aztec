import * as THREE from 'three';
import { MARINE } from '../config';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { patchStylised } from '../render/materials';
import { RNG } from '../world/rng';
import { World } from '../world/World';
import { Water } from '../water/Water';
import { Particles } from './Boats';
import { poseWhale, sampleBreach, breachSiteOk, BREACH_T, WHALE_GIRTH, type WhaleDrive } from './WhaleMotion';
import { createWhale, type WhaleRig } from './WhaleModel';
import { Whitewater, whitewaterTexture } from './Whitewater';

// ---------------- Surfacing to breathe ----------------
/** Seconds rising from cruising depth until the back breaks the surface. */
const SURF_RISE = 2.4;
/** The blow starts just as the blowhole clears the water, and lasts this long. */
const SURF_BLOW = 2.1;
const SURF_BLOW_LEN = 0.6;
/** Arching dive back under (optionally lifting the flukes). */
const SURF_DIVE = 3.6;
/** Body-centre height while gliding at the surface (the back and blowhole just show). */
const SURF_Y = -0.3;

// ---------------- Models (length 1 along +z, head at +z) ----------------

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
const _bh = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _drive: WhaleDrive = { phase: 0, stroke: 1, turn: 0, turnLag: 0, arch: 0, fin: 0, flap: 0, flapPhase: 0, twist: 0 };

interface Whale {
  root: THREE.Group;
  rig: WhaleRig;
  swimPhase: number;
  /** Flipper beat phase, and the turn rate as the tail follows it (lagging the head). */
  flapPhase: number;
  turnLag: number;
  /** Last frame's body centre, axis and flipper / fluke tips (world): how fast water leaves them. */
  track: { c: THREE.Vector3; ax: THREE.Vector3; finL: THREE.Vector3; finR: THREE.Vector3; lobeL: THREE.Vector3; lobeR: THREE.Vector3; ok: boolean };
  /** The landing: it spreads along the body for a moment, then a jet shoots up where it went in. */
  slam: { t: number; x: number; z: number; ax: number; az: number; jet: boolean } | null;
  x: number;
  z: number;
  heading: number;
  route: { x: number; z: number; r: number; a: number; dir: number };
  state: 'swim' | 'breach' | 'surface';
  /** Surfacing to breathe: start depth, time gliding at the surface, whether the flukes lift on the dive. */
  surf: { y0: number; glide: number; fluke: boolean };
  /** Current pose: tilt from vertical toward yaw (90 = level), spin, depth. */
  pose: { y: number; pitch: number; roll: number; yaw: number };
  turnRate: number;
  wanderSeed: number;
  t: number;
  nextBreach: number;
  nextSpout: number;
  nextPrint: number;
  /** Breach: the roll it lands with (signed degrees), how it was swimming when it began (eased out), travel so far (lengths). */
  landRoll: number;
  from: { y: number; pitch: number; roll: number };
  travelled: number;
  /** A breach is wanted: head for this deep, open water first (gives up at `until`). */
  seek: { x: number; z: number; until: number } | null;
  /** Tapped while busy: breach as soon as it can. */
  wantBreach: boolean;
  /** Just breached: the next breath ends in a fluke-up dive. */
  afterBreach: boolean;
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
  private spray = new Particles(3200, 0xf2fcff);
  /** Heaving clumps of white water, and the mist that hangs after a breach (textured sprites). */
  private white: Whitewater;
  private fog: Whitewater;
  /** Fine misty spray of a whale's blow (its own pool, so a breach never steals it). */
  private blowMist = new Particles(1100, 0xf4fbff, 0.32);
  private rings: { mesh: THREE.Mesh; t: number; life: number; r0: number; r1: number; alpha: number }[] = [];
  private rng: RNG;
  private time = 0;
  sfx: (n: string, x: number, z: number) => void = () => {};

  constructor(private world: World, private water: Water) {
    this.rng = new RNG(world.seed * 53 + 17);
    const wwTex = whitewaterTexture();
    this.white = new Whitewater(1600, wwTex, 8.5);
    this.fog = new Whitewater(420, wwTex, 0.25, 0.55);
    this.fog.points.renderOrder = 18;
    this.group.add(this.spray.points, this.blowMist.points, this.white.points, this.fog.points);
    (this.blowMist.points.material as THREE.ShaderMaterial).blending = THREE.NormalBlending;

    const foamTex = spiralFoamTexture(), soft = softTexture();
    const ringTex = foamRingTexture();
    const ringGeo = new THREE.RingGeometry(0.72, 1, 64, 1).rotateX(-Math.PI / 2);
    for (let k = 0; k < 28; k++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, color: 0xf2fcff, transparent: true, opacity: 0, depthWrite: false, fog: true }));
      m.visible = false;
      m.renderOrder = 15;
      this.group.add(m);
      this.rings.push({ mesh: m, t: 1, life: 1, r0: 1, r1: 2, alpha: 0.6 });
    }

    // Whales live out in the open ocean, beyond the reef shelf.
    const spots = this.deepSpots(MARINE.whales, -4.8, 0.78, 1.15);
    spots.forEach((s, k) => {
      const L = MARINE.whaleLength * (0.9 + this.rng.next() * 0.2);
      const root = new THREE.Group();
      const bodyMat = underwater(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 }), 0.3), 'whale-body');
      const rig = createWhale(bodyMat);
      root.add(rig.mesh);
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
        root, rig, x: s.x, z: s.z, heading: 0, flapPhase: 0, turnLag: 0, slam: null,
        track: { c: new THREE.Vector3(), ax: new THREE.Vector3(), finL: new THREE.Vector3(), finR: new THREE.Vector3(), lobeL: new THREE.Vector3(), lobeR: new THREE.Vector3(), ok: false },
        route: { x: s.x, z: s.z, r: 10 + this.rng.next() * 10, a, dir: this.rng.chance(0.5) ? 1 : -1 },
        state: 'swim', surf: { y0: -MARINE.swimDepth, glide: 3, fluke: false }, t: 0,
        nextBreach: MARINE.firstBreach + k * 9 + this.rng.next() * 10, nextSpout: MARINE.firstSurface + k * 5 + this.rng.next() * 8, nextPrint: 1 + this.rng.next() * 3,
        landRoll: 170, from: { y: 0, pitch: 0, roll: 0 }, travelled: 0, seek: null, wantBreach: false, afterBreach: false, length: L, flags: new Set(), ring, glow, patch, foam,
        swimPhase: 0, pose: { y: -MARINE.swimDepth, pitch: 90, roll: 0, yaw: a }, turnRate: 0, wanderSeed: this.rng.next() * 100,
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

  /** Room to breach from here along a heading: deep water under the whole run, well clear of any shallows. */
  private canBreach(w: Whale, x = w.x, z = w.z, yaw = w.pose.yaw): boolean {
    return breachSiteOk((bx, bz) => this.bedAt(bx, bz), x, z, yaw, w.length, MARINE.breachBed, MARINE.breachClear);
  }

  /**
   * Breach (e.g. when the player taps a whale). Only ever in deep, open water: from anywhere else
   * the whale first swims out to the nearest spot with room, and breaches when it gets there.
   */
  breach(w: Whale): void {
    if (w.state !== 'swim') {
      if (w.state === 'surface') w.wantBreach = true;
      return;
    }
    if (this.canBreach(w)) {
      this.startBreach(w);
      return;
    }
    if (w.seek) return;
    // Nowhere in reach: just head straight out to sea, and breach once there's room.
    let to = this.findBreachWater(w);
    if (!to) {
      const a = Math.atan2(w.x, w.z), r = this.world.half * 1.2;
      to = { x: Math.sin(a) * r, z: Math.cos(a) * r };
    }
    w.seek = { ...to, until: this.time + MARINE.breachSeek };
  }

  /** Nearest deep, open water to breach in, reachable without crossing the shallows. */
  private findBreachWater(w: Whale): { x: number; z: number } | null {
    for (let r = 10; r <= 70; r += 10) {
      let best: { x: number; z: number } | null = null, bestTurn = Infinity;
      const n = Math.ceil(r / 2.5);
      for (let k = 0; k < n; k++) {
        const a = w.pose.yaw + (k / n) * Math.PI * 2;
        const x = w.x + Math.sin(a) * r, z = w.z + Math.cos(a) * r;
        // Arriving heading away from here; prefer the smallest turn.
        const turn = Math.min(k / n, 1 - k / n) * Math.PI * 2;
        if (turn >= bestTurn || Math.hypot(x, z) > this.world.half * 1.25) continue;
        let clear = true;
        for (let d = 4; d < r && clear; d += 4) clear = this.bedAt(w.x + Math.sin(a) * d, w.z + Math.cos(a) * d) < MARINE.whaleBed;
        if (clear && this.canBreach(w, x, z, a)) {
          best = { x, z };
          bestTurn = turn;
        }
      }
      if (best) return best;
    }
    return null;
  }

  private startBreach(w: Whale): void {
    const L = w.length, P = w.pose;
    w.state = 'breach';
    w.t = 0;
    w.seek = null;
    w.wantBreach = false;
    w.travelled = 0;
    // Lands on its side or (mostly) on its back, twisting either way.
    w.landRoll = (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(115, 190);
    // Start from exactly how it is swimming; the difference eases out over the run-up.
    const k0 = sampleBreach(0, w.landRoll);
    P.roll -= Math.round(P.roll / 360) * 360;
    w.from = { y: P.y - k0.y * L, pitch: P.pitch - k0.pitch, roll: P.roll - k0.roll };
    w.flags.clear();
    // Don't come up to breathe straight after it: the breach ends with a breath a little later.
    w.nextSpout = Infinity;
  }

  /** Come up to breathe: rise until the back breaks the surface, glide, blow, then arch and slip under. */
  surface(w: Whale): void {
    if (w.state !== 'swim') return;
    w.state = 'surface';
    w.t = 0;
    w.nextSpout = MARINE.surfaceEvery[0] + this.rng.next() * (MARINE.surfaceEvery[1] - MARINE.surfaceEvery[0]);
    // Only lift the flukes clear where the water is deep enough for the steep dive.
    // (Always after a breach, if there's room.)
    w.surf = { y0: w.pose.y, glide: 2.6 + this.rng.next() * 1.6, fluke: w.afterBreach ? this.bedAt(w.x, w.z) < -5 : this.bedAt(w.x, w.z) < -5.4 && this.rng.chance(0.55) };
    w.afterBreach = false;
    w.flags.clear();
  }

  private updateSurfacing(w: Whale, dt: number): void {
    const L = w.length, P = w.pose, S = w.surf;
    w.t += dt;
    const t = w.t;
    const diveAt = SURF_RISE + S.glide, end = diveAt + SURF_DIVE;
    const sm = (x: number) => {
      const c = THREE.MathUtils.clamp(x, 0, 1);
      return c * c * (3 - 2 * c);
    };
    // Cruise on slowly with only gentle turns while at the surface.
    const want = Math.sin(this.time * 0.07 + w.wanderSeed) * 0.12;
    w.turnRate += (want - w.turnRate) * Math.min(1, dt * 0.8);
    P.yaw += w.turnRate * dt;
    const sp = MARINE.whaleSpeed * (t < diveAt ? 0.7 : 0.7 + 0.5 * sm((t - diveAt) / SURF_DIVE));
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    w.x += fx * sp * dt;
    w.z += fz * sp * dt;
    w.heading = P.yaw;
    P.roll += (-w.turnRate * 20 - P.roll) * Math.min(1, dt);
    let arch = 0, stroke = 0.8;
    let u = 0;
    if (t < SURF_RISE) {
      // Rise nose-up a little, levelling out as the back reaches the surface.
      const r = t / SURF_RISE;
      P.y = S.y0 + (SURF_Y - S.y0) * sm(r);
      P.pitch = 90 - 9 * Math.sin(r * Math.PI);
    } else if (t < diveAt) {
      // Glide: a slow roll of the swell along the exposed back.
      const g = t - SURF_RISE;
      P.y = SURF_Y + Math.sin(g * 1.3) * 0.05;
      P.pitch = 90 + Math.sin(g * 0.9) * 1.5;
      stroke = 0.45;
    } else {
      // Arch and slip under: the head goes down, the back rolls over in a hump and the tail stock
      // (and sometimes the flukes) lifts as the body tips, then levels out below.
      u = Math.min(1, (t - diveAt) / SURF_DIVE);
      const pMax = S.fluke ? 140 : 116;
      P.pitch = u < 0.55 ? 90 + (pMax - 90) * sm(u / 0.55) : pMax + (105 - pMax) * sm((u - 0.55) / 0.45);
      const peak = S.fluke ? 0.35 : -0.45, endTail = -1.2;
      const tail = u < 0.5 ? SURF_Y + (peak - SURF_Y) * Math.sin((u / 0.5) * Math.PI * 0.5) : peak + (endTail - peak) * sm((u - 0.5) / 0.5);
      // Tail-stock height = centre - half a body along the axis (whose vertical part is cos(pitch)).
      P.y = tail + 0.5 * L * Math.cos(THREE.MathUtils.degToRad(P.pitch));
      arch = -0.7 * Math.sin(Math.min(1, u / 0.45) * Math.PI);
      // Flukes held still while raised, then a strong stroke to drive down.
      stroke = S.fluke && u > 0.3 && u < 0.62 ? 0.25 : 1.1;
    }
    this.applyPose(w, w.x, P.y, w.z);
    // Flippers eased a little out from the flanks while it idles at the surface.
    const idle = t < SURF_RISE ? sm(t / SURF_RISE) : t < diveAt ? 1 : 1 - sm(u / 0.5);
    this.animateBody(w, dt, stroke, arch, 0.12 * idle);
    w.glow.visible = w.patch.visible = false;

    // White water around the exposed back while it's up.
    const collar = t < SURF_RISE ? sm((t - SURF_RISE * 0.72) / (SURF_RISE * 0.28)) : t < diveAt ? 1 : 1 - sm(u / 0.4);
    w.ring.visible = collar > 0.02;
    if (w.ring.visible) {
      w.ring.position.set(w.x + fx * L * 0.06, 0.04, w.z + fz * L * 0.06);
      w.ring.rotation.y = P.yaw;
      w.ring.scale.set(L * 0.13, 1, L * 0.36);
      (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.42 * collar;
      // Bow wave off the head and a trickle of water off the back.
      if (this.rng.next() < dt * 14 * collar) {
        const hx = w.x + fx * L * 0.36, hz = w.z + fz * L * 0.36;
        this.spray.spawn(hx + (this.rng.next() - 0.5) * 0.4, 0.05, hz + (this.rng.next() - 0.5) * 0.4, fx * 0.5 + (this.rng.next() - 0.5) * 0.8, 0.5 + this.rng.next() * 0.8, fz * 0.5 + (this.rng.next() - 0.5) * 0.8, 0.5, 0.05 + this.rng.next() * 0.05);
      }
    }
    w.nextPrint -= dt;
    if (w.nextPrint <= 0 && collar > 0.3) {
      w.nextPrint = 0.9 + this.rng.next() * 0.5;
      this.ring(w.x - fx * L * 0.1, w.z - fz * L * 0.1, L * 0.12, L * 0.42, 2.4, 0, 0.25);
    }

    const once = (id: string, at: number, fn: () => void) => {
      if (t >= at && !w.flags.has(id)) {
        w.flags.add(id);
        fn();
      }
    };
    once('break', SURF_RISE * 0.8, () => {
      // The back breaks the surface: a soft swirl and ripple.
      this.ring(w.x, w.z, L * 0.15, L * 0.55, 2.6, 0, 0.35);
      this.burst(w.x + fx * L * 0.2, w.z + fz * L * 0.2, 24, 1.2, L * 0.12);
    });
    // The blow: a bushy column of fine mist shooting up a couple of units, then hanging and drifting.
    if (t >= SURF_BLOW && t < SURF_BLOW + SURF_BLOW_LEN) {
      w.root.updateMatrixWorld(true);
      const bh = w.rig.blowhole.getWorldPosition(_bh);
      const by = Math.max(0.08, bh.y);
      once('blow', SURF_BLOW, () => {
        this.sfx('blow', bh.x, bh.z);
        this.burst(bh.x, bh.z, 14, 1.3, 0.18);
        this.ring(bh.x, bh.z, 0.2, 1.4, 1.6, 0, 0.3);
      });
      const v = (t - SURF_BLOW) / SURF_BLOW_LEN;
      // Strongest at the start of the exhale.
      // Fine mist: many small, faint droplets that billow out as they rise.
      const n = Math.floor(dt * 420 * (1.3 - v) + this.rng.next());
      for (let k = 0; k < n; k++) {
        const up = (2.0 + this.rng.next() * 1.1) * (1 - 0.3 * v);
        const sx = (this.rng.next() - 0.5) * 0.5, sz = (this.rng.next() - 0.5) * 0.5;
        this.blowMist.spawn(bh.x + (this.rng.next() - 0.5) * 0.12, by + this.rng.next() * 0.15, bh.z + (this.rng.next() - 0.5) * 0.12,
          sx + 0.3, up, sz + 0.12, 1.6 + this.rng.next() * 1.1, 0.04 + this.rng.next() * 0.05, 0.3 + this.rng.next() * 0.3);
      }
    }
    if (S.fluke && t > diveAt) this.flukeStream(w, dt);
    if (S.fluke) {
      once('flukeup', diveAt + SURF_DIVE * 0.45, () => {
        // Water pouring off the raised flukes.
        w.root.updateMatrixWorld(true);
        const tail = w.rig.fluke.getWorldPosition(_bh);
        for (let k = 0; k < 40; k++) this.spray.spawn(tail.x + (this.rng.next() - 0.5) * L * 0.25, Math.max(0.1, tail.y) + this.rng.next() * 0.3, tail.z + (this.rng.next() - 0.5) * L * 0.25, (this.rng.next() - 0.5) * 0.4, this.rng.next() * 0.4, (this.rng.next() - 0.5) * 0.4, 0.7 + this.rng.next() * 0.6, 0.05 + this.rng.next() * 0.08, 0);
      });
    }
    once('under', diveAt + SURF_DIVE * (S.fluke ? 0.7 : 0.5), () => {
      // A smooth "fluke print" left where the tail went under.
      const tx = w.x - fx * L * 0.45, tz = w.z - fz * L * 0.45;
      this.ring(tx, tz, L * 0.1, L * 0.4, 3.0, 0, 0.35);
      this.burst(tx, tz, S.fluke ? 40 : 18, S.fluke ? 1.8 : 1.1, L * 0.1);
      if (S.fluke) this.sfx('splash', tx, tz);
    });
    if (t >= end) {
      // Carry on cruising from here (the swim state eases back to level at cruising depth).
      w.state = 'swim';
      w.ring.visible = false;
      w.ring.rotation.y = 0;
      w.nextPrint = 2 + this.rng.next() * 2;
    }
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

  /**
   * A skirt of white water thrown out low and wide round a splash (drawn out to `stretch` times as
   * long along `yaw`, the length of a whale), with droplets flung off its rim.
   */
  private skirt(x: number, z: number, r: number, speed: number, n: number, yaw: number, stretch: number, size = 1): void {
    const ax = Math.sin(yaw), az = Math.cos(yaw);
    for (let m = 0; m < n * 2.5; m++) {
      const a = this.rng.next() * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const ox = -az * c + ax * s * stretch, oz = ax * c + az * s * stretch;
      const o = speed * (0.6 + this.rng.next() * 0.6);
      if (m < n) this.white.spawn(x + ox * r, 0.1, z + oz * r, ox * o, (1.2 + this.rng.next() * 2.2) * size, oz * o, 0.9 + this.rng.next() * 0.7, (0.4 + this.rng.next() * 0.6) * size, 0.5 * size, 0.9, 0.9);
      else this.spray.spawn(x + ox * r, 0.08, z + oz * r, ox * o * 1.4, 2 + this.rng.next() * 3, oz * o * 1.4, 0.8 + this.rng.next() * 0.6, 0.04 + this.rng.next() * 0.08, 0.02);
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
    this.updateDolphins(dt, camTarget);
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
    this.spray.update(dt, 9);
    this.white.update(dt);
    this.fog.update(dt);
    // The blow rises fast, slows and hangs as it drifts; greyer at night.
    this.blowMist.update(dt, 1.5);
    const day = 0.35 + 0.65 * this.water.shared.uDay.value;
    ((this.blowMist.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.95 * day, 0.98 * day, day);
    this.white.color.setRGB(0.96 * day, 0.985 * day, day);
    this.fog.color.setRGB(0.93 * day, 0.97 * day, day);
  }

  /** Apply a pose (tilt from vertical toward yaw, spin about the body axis) to the whale root. */
  private applyPose(w: Whale, x: number, y: number, z: number): THREE.Quaternion {
    const p = w.pose;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, 0));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(p.pitch)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(p.roll)));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    // Never touch the seabed (or a slope rising under the head or tail): lift the whole body if its
    // lowest point would dig in.
    const ax = _ax.set(0, 0, 1).applyQuaternion(q);
    const L = w.length;
    const lowest = y - Math.abs(ax.y) * 0.5 * L - WHALE_GIRTH * L;
    const floor = Math.max(this.bedAt(x, z), this.bedAt(x + ax.x * 0.5 * L, z + ax.z * 0.5 * L), this.bedAt(x - ax.x * 0.5 * L, z - ax.z * 0.5 * L)) + 0.3;
    if (lowest < floor) y += floor - lowest;
    // Out of sight below the surface while cruising.
    if (w.state === 'swim') {
      const highest = y + Math.abs(ax.y) * 0.5 * L + 0.16 * L;
      if (highest > -0.3) y -= highest + 0.3;
    }
    w.root.position.set(x, y, z);
    w.root.quaternion.copy(q);
    return q;
  }

  /**
   * Swim animation (see poseWhale): the body wave and fluke strokes, faster the harder it swims;
   * the body curving into turns, head first and the tail following; the flippers (`fin` 0 along
   * the flanks .. 1 flung wide, beating with `flap`, one up and one down as it twists at `twist`
   * degrees a second).
   */
  private animateBody(w: Whale, dt: number, strength: number, arch = 0, fin = 0, flap = 0, twist = 0): void {
    w.swimPhase += dt * (1.6 + strength * 0.8);
    w.turnLag += (w.turnRate - w.turnLag) * Math.min(1, dt * 1.2);
    const d = _drive;
    d.phase = w.swimPhase;
    d.stroke = strength;
    d.turn = w.turnRate;
    d.turnLag = w.turnLag;
    d.arch = arch;
    d.fin = fin;
    d.flap = flap;
    d.flapPhase = w.flapPhase;
    d.twist = twist;
    poseWhale(w.rig, d);
  }

  /** Remember where the body and the flipper and fluke tips are, for how fast water leaves them next frame. */
  private track(w: Whale): void {
    const tr = w.track;
    tr.c.copy(w.root.position);
    tr.ax.set(0, 0, 1).applyQuaternion(w.root.quaternion);
    w.rig.finTipL.getWorldPosition(tr.finL);
    w.rig.finTipR.getWorldPosition(tr.finR);
    w.rig.lobeTipL.getWorldPosition(tr.lobeL);
    w.rig.lobeTipR.getWorldPosition(tr.lobeR);
    tr.ok = true;
  }

  /** Signed smallest angle from a to b. */
  private static turnTo(a: number, b: number): number {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /**
   * Turn rate that keeps a cruising whale in deep water: if the sea ahead shoals, swing toward
   * whichever side stays deepest (null when the way ahead is clear).
   */
  private shallowsTurn(w: Whale): number | null {
    const yaw = w.pose.yaw, L = w.length;
    const depthAt = (a: number) => Math.max(this.bedAt(w.x + Math.sin(yaw + a) * L * 1.2, w.z + Math.cos(yaw + a) * L * 1.2), this.bedAt(w.x + Math.sin(yaw + a) * L * 2.4, w.z + Math.cos(yaw + a) * L * 2.4));
    if (depthAt(0) < MARINE.whaleBed) return null;
    let best = 0, bestBed = Infinity;
    for (const a of [-1.1, -0.55, 0.55, 1.1]) {
      const b = depthAt(a) + Math.abs(a) * 0.1;
      if (b < bestBed) {
        bestBed = b;
        best = a;
      }
    }
    // Nowhere deeper nearby: head out to sea, away from the island.
    if (bestBed >= MARINE.whaleBed) best = Marine.turnTo(yaw, Math.atan2(w.x, w.z));
    return Math.sign(best || 1) * 0.55;
  }

  private updateWhale(w: Whale, dt: number, camTarget: THREE.Vector3): void {
    const L = w.length;
    const P = w.pose;
    if (w.state === 'swim') {
      // Wander in long, natural curves through deep water, fully submerged.
      let want = Math.sin(this.time * 0.07 + w.wanderSeed) * 0.35 + Math.sin(this.time * 0.023 + w.wanderSeed * 2) * 0.25;
      // Heading out to open water to breach.
      if (w.seek) want = THREE.MathUtils.clamp(Marine.turnTo(P.yaw, Math.atan2(w.seek.x - w.x, w.seek.z - w.z)) * 0.8, -0.45, 0.45);
      // Don't wander off beyond the horizon: circle back toward the island's waters.
      if (Math.hypot(w.x, w.z) > this.world.half * 1.3) want = Math.sign(Marine.turnTo(P.yaw, Math.atan2(-w.x, -w.z))) * 0.4;
      // Never into the shallows (this wins over everything else).
      want = this.shallowsTurn(w) ?? want;
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
      // Breach once it's out in open water (or give up if it can't find any in time).
      if (w.seek) {
        if (this.time > w.seek.until) w.seek = null;
        else if (Math.floor(this.time * 3) !== Math.floor((this.time - dt) * 3) && this.canBreach(w)) this.startBreach(w);
      } else if (w.wantBreach) {
        w.wantBreach = false;
        this.breach(w);
      }
      w.nextBreach -= dt;
      if (w.state === 'swim' && !w.seek && w.nextBreach <= 0) {
        w.nextBreach = MARINE.breachEvery[0] + this.rng.next() * (MARINE.breachEvery[1] - MARINE.breachEvery[0]);
        // Prefer breaching where the player is looking.
        const near = Math.hypot(w.x - camTarget.x, w.z - camTarget.z) < 90;
        if (near || this.rng.chance(0.4)) this.breach(w);
      }
      w.nextSpout -= dt;
      if (w.state === 'swim' && !w.seek && w.nextSpout <= 0) {
        if (this.bedAt(w.x, w.z) < -4.2) {
          this.surface(w);
          // Never breach in the middle of (or right after) a breath.
          w.nextBreach = Math.max(w.nextBreach, 22);
        } else w.nextSpout = 4;
      }
      if (w.state !== 'swim') {
        this.track(w);
        return;
      }
      w.nextPrint -= dt;
      if (w.nextPrint <= 0) {
        w.nextPrint = 2.6 + this.rng.next() * 2;
        const tx = w.x - Math.sin(P.yaw) * L * 0.4, tz = w.z - Math.cos(P.yaw) * L * 0.4;
        this.ring(tx, tz, L * 0.08, L * 0.32, 3.2, 0, 0.22);
      }
      w.ring.visible = w.glow.visible = w.patch.visible = false;
      this.fadeFoam(w, dt);
      this.track(w);
      return;
    }
    if (w.state === 'surface') {
      this.updateSurfacing(w, dt);
      this.fadeFoam(w, dt);
      this.track(w);
      return;
    }
    this.updateBreach(w, dt);
    this.fadeFoam(w, dt);
    this.track(w);
  }

  /**
   * The breach, one continuous move from cruising back to cruising (see WhaleMotion): run-up and
   * J-turn under water, burst out, hang, topple and slam down, flukes over, level out. Splashes
   * are set off by where the body actually meets the water, and water streams off the body,
   * flippers and flukes at the speed they're moving.
   */
  private updateBreach(w: Whale, dt: number): void {
    const L = w.length, P = w.pose, T = BREACH_T, Ls = L / MARINE.whaleLength;
    w.t += dt;
    const t = w.t;
    const k = sampleBreach(t, w.landRoll);
    // Ease out of how it was swimming, and let any turn it was making die away.
    const ease = 1 - THREE.MathUtils.smoothstep(t, 0, 1.6);
    const roll0 = P.roll;
    P.y = k.y * L + w.from.y * ease;
    P.pitch = k.pitch + w.from.pitch * ease;
    P.roll = k.roll + w.from.roll * ease;
    w.turnRate *= Math.exp(-dt * 1.5);
    P.yaw += w.turnRate * dt;
    w.heading = P.yaw;
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    w.x += fx * (k.h - w.travelled) * L;
    w.z += fz * (k.h - w.travelled) * L;
    w.travelled = k.h;
    const q = this.applyPose(w, w.x, P.y, w.z);
    // Flippers flung out wide and beating through the leap (one up, one down as it twists).
    w.flapPhase += dt * (2.4 + 2.2 * k.flap);
    this.animateBody(w, dt, k.stroke, k.arch, k.fin, k.flap, (P.roll - roll0) / dt);
    w.root.updateMatrixWorld(true);

    // Where the body is: centre, axis, head and tail heights, and where it crosses the surface.
    const cx = w.root.position.x, cy = w.root.position.y, cz = w.root.position.z;
    const axis = _ax.set(0, 0, 1).applyQuaternion(q);
    const headY = cy + axis.y * 0.5 * L, tailY = cy - axis.y * 0.5 * L;
    const hx = cx + axis.x * 0.5 * L, hz = cz + axis.z * 0.5 * L;
    const cross = Math.abs(axis.y) > 0.15 ? -cy / axis.y : Infinity;
    const wx = cx + axis.x * cross, wz = cz + axis.z * cross;
    // How fast the skin is moving: the centre, and the turn of the axis (a point s along it moves at vc + va * s).
    const tr = w.track;
    const vc = _v1.set(cx, cy, cz).sub(tr.c).divideScalar(dt);
    const va = _v2.copy(axis).sub(tr.ax).divideScalar(dt);
    if (!tr.ok) vc.set(0, 0, 0), va.set(0, 0, 0);
    const once = (id: string, when: boolean, fn: () => void) => {
      if (when && !w.flags.has(id)) {
        w.flags.add(id);
        fn();
      }
    };
    const out = w.flags.has('break');
    const down = w.flags.has('impact');

    // A pale patch and a glow in the water where the head is about to burst out.
    const rising = !out ? THREE.MathUtils.smoothstep(headY, -0.5 * L, -0.05 * L) * THREE.MathUtils.smoothstep(t, T.breakout - 1.6, T.breakout - 0.9) : THREE.MathUtils.clamp(1 - (t - T.breakout) / 0.6, 0, 1);
    w.glow.visible = rising > 0.01;
    w.patch.visible = rising > 0.01;
    if (rising > 0.01) {
      const px = out ? w.glow.position.x : hx, pz = out ? w.glow.position.z : hz;
      w.glow.position.set(px, -0.06, pz);
      w.glow.scale.set(L * 0.35, L * 1.1, L * 0.35);
      (w.glow.material as THREE.ShaderMaterial).uniforms.uA.value = rising * 0.4;
      w.patch.position.set(px, -0.02, pz);
      w.patch.scale.set(L * 0.42, 1, L * 0.7);
      w.patch.rotation.y = P.yaw;
      (w.patch.material as THREE.MeshBasicMaterial).opacity = rising * 0.9;
    }

    // Breakout: the head bursts through the surface, heaving up a dome of white water.
    once('break', headY > 0 && t < T.peak, () => {
      this.sfx('splash', hx, hz);
      for (const [r1, life, delay] of [[L * 0.45, 1.6, 0], [L * 0.7, 2.2, 0.35], [L * 0.95, 2.6, 0.8], [L * 1.1, 2.8, 1.3]]) this.ring(hx, hz, 0.3, r1, life, delay);
      this.burst(hx, hz, 150, 3.4, 0.6);
      for (let m = 0; m < 50; m++) {
        const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * 0.15 * L, o = 0.4 + this.rng.next() * 1.6;
        this.white.spawn(hx + Math.cos(a) * r, 0.05, hz + Math.sin(a) * r, Math.cos(a) * o, (3 + this.rng.next() * 4) * Ls, Math.sin(a) * o, 1 + this.rng.next() * 0.7, (0.45 + this.rng.next() * 0.65) * Ls, 0.4 * Ls, 0.9, 0.6);
      }
      this.skirt(hx, hz, L * 0.14, 2.2 * Ls, 36, P.yaw, 1.2, Ls);
    });

    // Rising through the surface: a white collar at the waterline, water dragged up round the body
    // that falls back as a skirt, and sheets of water streaming off the skin.
    let collar = false;
    if (out && !down && Math.abs(cross) < 0.5 * L) {
      collar = true;
      const r = THREE.MathUtils.clamp((0.13 * L) / Math.max(0.35, Math.abs(axis.y)), 0.1 * L, 0.3 * L) + 0.15;
      w.ring.position.set(wx, 0.04, wz);
      w.ring.rotation.y = 0;
      w.ring.scale.set(r, 1, r);
      (w.ring.material as THREE.MeshBasicMaterial).opacity = 0.85;
      const rise = Math.max(0, vc.y + va.y * cross);
      let n = Math.floor(dt * (25 + rise * 14) + this.rng.next());
      for (let m = 0; m < n; m++) {
        const a = this.rng.next() * Math.PI * 2, rr = r * (0.75 + this.rng.next() * 0.4), o = 0.4 + this.rng.next() * 1.2;
        this.white.spawn(wx + Math.cos(a) * rr, 0.06, wz + Math.sin(a) * rr, Math.cos(a) * o, rise * (0.25 + this.rng.next() * 0.5) + this.rng.next(), Math.sin(a) * o, 0.7 + this.rng.next() * 0.5, (0.3 + this.rng.next() * 0.45) * Ls, 0.35 * Ls, 0.85, 0.8);
      }
      if (this.rng.next() < dt * 40) this.spray.spawn(wx + (this.rng.next() - 0.5) * r * 2, 0.05, wz + (this.rng.next() - 0.5) * r * 2, (this.rng.next() - 0.5) * 0.8, 0.8 + this.rng.next() * 1.2, (this.rng.next() - 0.5) * 0.8, 0.6, 0.12);
      n = Math.floor(dt * 80 + this.rng.next());
      for (let m = 0; m < n; m++) {
        // A point on the exposed skin (between the waterline and the head), moving with it.
        const s = cross + this.rng.next() * (0.5 * L - cross);
        const a = this.rng.next() * Math.PI * 2, rr = 0.1 * L;
        const x = cx + axis.x * s + Math.cos(a) * rr, y = cy + axis.y * s, z = cz + axis.z * s + Math.sin(a) * rr;
        if (y < 0.15) continue;
        const vx = (vc.x + va.x * s) * 0.85, vy = (vc.y + va.y * s) * 0.85, vz = (vc.z + va.z * s) * 0.85;
        if (this.rng.next() < 0.15) this.white.spawn(x, y, z, vx + (this.rng.next() - 0.5) * 0.4, vy, vz + (this.rng.next() - 0.5) * 0.4, 0.5 + this.rng.next() * 0.4, (0.1 + this.rng.next() * 0.14) * Ls, 0.12 * Ls, 0.5, 0.3);
        else this.spray.spawn(x, y, z, vx + (this.rng.next() - 0.5) * 0.5, vy - 0.2, vz + (this.rng.next() - 0.5) * 0.5, 0.5 + this.rng.next() * 0.4, 0.05 + this.rng.next() * 0.07, 0.02);
      }
    }
    w.ring.visible = collar;

    // Water flung off the flippers as they beat, and a slap as each comes down on the sea.
    this.finSpray(w, dt, out && !down);

    // Re-entry: it slams down along its whole length (see updateSlam).
    once('impact', out && t > T.peak && (headY < 0.35 || t > T.impact + 0.3), () => {
      const hl = Math.hypot(axis.x, axis.z) || 1;
      const ax = axis.x / hl, az = axis.z / hl, yaw = Math.atan2(ax, az);
      const ix = cx + ax * 0.1 * L, iz = cz + az * 0.1 * L;
      this.sfx('bigsplash', ix, iz);
      this.burst(ix, iz, 700, 8.2, L * 0.42);
      w.slam = { t: 0, x: cx, z: cz, ax, az, jet: false };
      // A low, ragged skirt of water thrown out round the body.
      this.skirt(ix, iz, L * 0.2, 4 * Ls, 90, yaw, 1.6, Ls);
      // The first blast of white water, out and up along both sides of the body.
      for (let m = 0; m < 130; m++) {
        const along = (-0.3 + this.rng.next() * 0.8) * L, side = this.rng.chance(0.5) ? 1 : -1;
        const x = cx + ax * along - az * side * 0.1 * L, z = cz + az * along + ax * side * 0.1 * L;
        const o = (1 + this.rng.next() * 4) * Ls, up = (4 + this.rng.next() * 7) * Ls;
        this.white.spawn(x, 0.15, z, -az * side * o + (this.rng.next() - 0.5) * 1.5, up, ax * side * o + (this.rng.next() - 0.5) * 1.5, 1.5 + this.rng.next() * 1.2, (0.9 + this.rng.next() * 1.6) * Ls, 0.8 * Ls, 0.95, 0.45);
      }
      // Mist hangs over it and drifts downwind before fading.
      for (let m = 0; m < 24; m++) {
        const along = (this.rng.next() - 0.35) * L, side = (this.rng.next() - 0.5) * L * 0.5;
        this.fog.spawn(ix + ax * along - az * side, 0.5 + this.rng.next() * L * 0.35, iz + az * along + ax * side,
          (this.rng.next() - 0.5) * 1.2 + 0.35, 0.5 + this.rng.next() * 1.4, (this.rng.next() - 0.5) * 1.2 + 0.2,
          2.6 + this.rng.next() * 2.2, (3 + this.rng.next() * 2.5) * Ls, 1.1 * Ls, 0.28, 0.9, 3);
      }
      for (const [r1, life, delay] of [[L * 1.0, 2.2, 0], [L * 1.5, 3.2, 0.25], [L * 2.0, 4.2, 0.6]]) this.ring(ix, iz, L * 0.3, r1, life, delay);
      w.foam.visible = true;
      w.foam.position.set(ix, 0.03, iz);
      w.foam.rotation.y = yaw;
      w.foam.userData = { t: 0, x: ix, z: iz };
    });
    if (w.slam) this.updateSlam(w, dt);

    // The flukes swing up over it as it goes under: water pours off them, then they slip in.
    once('flukeup', down && tailY > 0.3, () => {
      const tail = w.rig.fluke.getWorldPosition(_bh);
      for (let m = 0; m < 60; m++) this.spray.spawn(tail.x + (this.rng.next() - 0.5) * L * 0.3, Math.max(0.1, tail.y) + this.rng.next() * 0.4, tail.z + (this.rng.next() - 0.5) * L * 0.3, (this.rng.next() - 0.5) * 0.4, this.rng.next() * 0.5, (this.rng.next() - 0.5) * 0.4, 0.8 + this.rng.next() * 0.6, 0.06 + this.rng.next() * 0.1, 0);
    });
    if (down) this.flukeStream(w, dt);
    once('flukedown', w.flags.has('flukeup') && tailY < 0.05, () => {
      const tx = cx - axis.x * 0.45 * L, tz = cz - axis.z * 0.45 * L;
      this.sfx('splash', tx, tz);
      this.burst(tx, tz, 110, 2.8, 0.5);
      for (let m = 0; m < 30; m++) {
        const a = this.rng.next() * Math.PI * 2, o = 0.4 + this.rng.next() * 1.2;
        this.white.spawn(tx + Math.cos(a) * 0.3, 0.05, tz + Math.sin(a) * 0.3, Math.cos(a) * o, (1.8 + this.rng.next() * 2.4) * Ls, Math.sin(a) * o, 0.9 + this.rng.next() * 0.5, (0.35 + this.rng.next() * 0.4) * Ls, 0.3 * Ls, 0.85, 0.7);
      }
      this.ring(tx, tz, L * 0.1, L * 0.45, 2.8, 0, 0.45);
    });

    if (t >= T.end) {
      // Cruising on from where it came out of the move (same pose: only the roll's whole turns go).
      w.state = 'swim';
      P.roll -= Math.round(P.roll / 360) * 360;
      w.turnRate = 0;
      w.glow.visible = w.patch.visible = w.ring.visible = false;
      w.nextBreach = MARINE.breachEvery[0] + this.rng.next() * (MARINE.breachEvery[1] - MARINE.breachEvery[0]);
      // Comes up to breathe a little later, lifting its flukes as it dives again.
      w.nextSpout = 5 + this.rng.next() * 5;
      w.afterBreach = true;
    }
  }

  /**
   * The landing, after the first slam: white water keeps bursting out sideways along the whole body
   * for a moment as it sinks in, then the hole it made closes and throws up a tall jet.
   */
  private updateSlam(w: Whale, dt: number): void {
    const s = w.slam!, L = w.length, Ls = L / MARINE.whaleLength;
    s.t += dt;
    const px = -s.az, pz = s.ax;
    if (s.t < 0.4) {
      const n = Math.floor(dt * 900 * (1 - s.t / 0.4) + this.rng.next());
      for (let m = 0; m < n; m++) {
        const along = (-0.35 + this.rng.next() * 0.9) * L, side = this.rng.chance(0.5) ? 1 : -1;
        const x = s.x + s.ax * along + px * side * 0.12 * L, z = s.z + s.az * along + pz * side * 0.12 * L;
        const o = (1.2 + this.rng.next() * 3.4) * Ls, up = (3.5 + this.rng.next() * 6.5) * Ls * (1 - (0.35 * Math.abs(along)) / L);
        const drift = (this.rng.next() - 0.5) * 2;
        this.white.spawn(x, 0.1, z, px * side * o + s.ax * drift, up, pz * side * o + s.az * drift, 1.4 + this.rng.next() * 1.1, (0.8 + this.rng.next() * 1.5) * Ls, 0.8 * Ls, 0.95, 0.5);
      }
    }
    if (!s.jet && s.t > 0.45) {
      s.jet = true;
      const jx = s.x + s.ax * 0.1 * L, jz = s.z + s.az * 0.1 * L;
      for (let m = 0; m < 70; m++) {
        const a = this.rng.next() * Math.PI * 2, r = this.rng.next() * 0.12 * L, o = this.rng.next() * 0.8;
        this.white.spawn(jx + Math.cos(a) * r, 0.1, jz + Math.sin(a) * r, Math.cos(a) * o, (6.5 + this.rng.next() * 4.5) * Ls, Math.sin(a) * o, 1.3 + this.rng.next() * 0.8, (0.6 + this.rng.next() * 0.7) * Ls, 0.35 * Ls, 0.95, 0.35);
      }
      this.burst(jx, jz, 220, 9.5, L * 0.1);
    }
    if (s.t > 3) w.slam = null;
  }

  /** Water flung off the flippers as they beat in the air, and a slap as each comes down on the sea. */
  private finSpray(w: Whale, dt: number, airborne: boolean): void {
    const tr = w.track, L = w.length, Ls = L / MARINE.whaleLength;
    if (!tr.ok) return;
    for (const right of [false, true]) {
      const tip = (right ? w.rig.finTipR : w.rig.finTipL).getWorldPosition(right ? _t2 : _t1);
      const prev = right ? tr.finR : tr.finL;
      const vx = (tip.x - prev.x) / dt, vy = (tip.y - prev.y) / dt, vz = (tip.z - prev.z) / dt;
      if (airborne && tip.y > 0.2) {
        const n = Math.floor(dt * 45 + this.rng.next());
        for (let m = 0; m < n; m++) {
          const f = 0.6 + this.rng.next() * 0.4;
          this.spray.spawn(tip.x + (this.rng.next() - 0.5) * 0.3 * Ls, tip.y, tip.z + (this.rng.next() - 0.5) * 0.3 * Ls, vx * f, vy * f, vz * f, 0.6 + this.rng.next() * 0.4, 0.05 + this.rng.next() * 0.07, 0.02);
        }
      }
      const id = right ? 'slapR' : 'slapL';
      if (prev.y > 0.12 && tip.y <= 0.12 && vy < -0.5 && !w.flags.has(id) && w.flags.has('break')) {
        w.flags.add(id);
        this.sfx('splash', tip.x, tip.z);
        this.burst(tip.x, tip.z, 70, 3.2, 0.35 * Ls);
        for (let m = 0; m < 22; m++) {
          const a = this.rng.next() * Math.PI * 2, o = 0.5 + this.rng.next() * 1.5;
          this.white.spawn(tip.x + Math.cos(a) * 0.2, 0.05, tip.z + Math.sin(a) * 0.2, Math.cos(a) * o + vx * 0.2, (2 + this.rng.next() * 3) * Ls, Math.sin(a) * o + vz * 0.2, 0.9 + this.rng.next() * 0.5, (0.35 + this.rng.next() * 0.45) * Ls, 0.3 * Ls, 0.9, 0.7);
        }
        this.ring(tip.x, tip.z, 0.2, L * 0.3, 2, 0, 0.45);
      }
    }
  }

  /** Water pouring off raised flukes: a curtain from the trailing edge, streaming hardest off the tips. */
  private flukeStream(w: Whale, dt: number): void {
    const tr = w.track;
    if (!tr.ok) return;
    const a = w.rig.lobeTipL.getWorldPosition(_t1), b = w.rig.lobeTipR.getWorldPosition(_t2);
    if (Math.max(a.y, b.y) < 0.1) return;
    const Ls = w.length / MARINE.whaleLength;
    const n = Math.floor(dt * 110 + this.rng.next());
    for (let m = 0; m < n; m++) {
      const u = this.rng.next() < 0.3 ? (this.rng.chance(0.5) ? 0 : 1) : this.rng.next();
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, z = a.z + (b.z - a.z) * u;
      if (y < 0.1) continue;
      const vx = (((a.x - tr.lobeL.x) * (1 - u) + (b.x - tr.lobeR.x) * u) / dt) * 0.8;
      const vy = (((a.y - tr.lobeL.y) * (1 - u) + (b.y - tr.lobeR.y) * u) / dt) * 0.8;
      const vz = (((a.z - tr.lobeL.z) * (1 - u) + (b.z - tr.lobeR.z) * u) / dt) * 0.8;
      if (this.rng.next() < 0.18) this.white.spawn(x, y, z, vx, vy, vz, 0.7 + this.rng.next() * 0.4, (0.16 + this.rng.next() * 0.2) * Ls, 0.15 * Ls, 0.7, 0.3);
      else this.spray.spawn(x, y, z, vx + (this.rng.next() - 0.5) * 0.3, vy, vz + (this.rng.next() - 0.5) * 0.3, 0.6 + this.rng.next() * 0.5, 0.05 + this.rng.next() * 0.08, 0.02);
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
    // Drawn out along the length of the body that landed there.
    w.foam.scale.set(r, 1, r * 1.45);
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

  private updateDolphins(dt: number, camTarget?: THREE.Vector3): void {
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
      // Splashes (rings and sound only near the camera: the droplets are cheap, rings are draw calls).
      const near = !camTarget || Math.abs(d.x - camTarget.x) + Math.abs(d.z - camTarget.z) < 110;
      if (up && !d.wasUp) {
        d.spin = this.rng.chance(0.1);
        // Leaving the water: a small burst thrown forward off the head, and a faint ring.
        this.dolphinSplash(d.x, d.z, fx, fz, 12, 1.7, 0.16);
        if (near) this.ring(d.x, d.z, 0.1, 0.5, 0.8, 0, 0.3);
      }
      if (!up && d.wasUp) {
        // Re-entry: a bigger splash, a tight ring of white water, then a spreading ripple.
        const ex = d.x + fx * 0.6, ez = d.z + fz * 0.6;
        this.dolphinSplash(ex, ez, fx, fz, d.spin ? 34 : 22, d.spin ? 2.9 : 2.3, 0.26);
        if (near) {
          this.ring(ex, ez, 0.1, 0.55, 0.7, 0, 0.7);
          this.ring(ex, ez, 0.2, 1.1, 1.3, 0.1, 0.38);
          if (d.spin || this.rng.chance(0.06)) this.sfx('splash', ex, ez);
        }
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

  /** A dolphin-sized splash: the shared droplet burst plus a few drops carried along the direction of travel. */
  private dolphinSplash(x: number, z: number, fx: number, fz: number, n: number, speed: number, radius: number): void {
    this.burst(x, z, n, speed, radius);
    for (let k = 0; k < n >> 2; k++) {
      const f = 0.6 + this.rng.next() * 0.9;
      this.spray.spawn(x + (this.rng.next() - 0.5) * 0.2, 0.06, z + (this.rng.next() - 0.5) * 0.2, fx * f + (this.rng.next() - 0.5) * 0.4, speed * (0.4 + this.rng.next() * 0.4), fz * f + (this.rng.next() - 0.5) * 0.4, 0.6 + this.rng.next() * 0.3, 0.05 + this.rng.next() * 0.05);
    }
  }

  /** Positions for the minimap. */
  positions(): { x: number; z: number }[] {
    return this.whales.map((w) => ({ x: w.x, z: w.z }));
  }
}
