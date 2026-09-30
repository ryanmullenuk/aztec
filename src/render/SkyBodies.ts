import * as THREE from 'three';
import type { LightState } from './Lighting';

/** A disc with a soft, bright edge (the sun), or a glow falling off from the middle. */
function radialTexture(stops: [number, string][], size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A full moon: a pale disc, darker near its rim, with soft grey maria and a few bright craters. */
function moonTexture(): THREE.Texture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = S * 0.46, m = S / 2;
  g.save();
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.clip();
  const base = g.createRadialGradient(m - r * 0.2, m - r * 0.25, r * 0.1, m, m, r);
  base.addColorStop(0, '#fbfaf4');
  base.addColorStop(0.75, '#e6e5dc');
  base.addColorStop(1, '#b9bab4');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // The dark "seas".
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const maria: [number, number, number][] = [[-0.25, -0.2, 0.3], [0.12, -0.3, 0.22], [0.2, 0.05, 0.26], [-0.05, 0.28, 0.2], [-0.35, 0.18, 0.16]];
  for (const [x, y, s] of maria) {
    for (let k = 0; k < 5; k++) {
      const cx = m + (x + (rnd() - 0.5) * 0.12) * r, cy = m + (y + (rnd() - 0.5) * 0.12) * r, rr = s * r * (0.6 + rnd() * 0.6);
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      grd.addColorStop(0, 'rgba(120,122,128,0.45)');
      grd.addColorStop(1, 'rgba(120,122,128,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
  }
  // Bright little craters.
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.92, rr = 1 + rnd() * 4;
    g.fillStyle = `rgba(255,255,250,${0.25 + rnd() * 0.35})`;
    g.beginPath();
    g.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, rr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // A soft edge.
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(m, m, r * 0.94, m, m, r * 1.02);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The night sky's stars and the Milky Way live on a sphere this far round the camera (behind the sun and moon). */
const STAR_R = 1000;
/** The Milky Way's great circle (its pole) and the direction of its bright core, in the sky's own frame. */
const GAL_POLE = new THREE.Vector3(0.42, 0.3, 0.86).normalize();
const GAL_CORE = new THREE.Vector3(1, 0, 0).projectOnPlane(GAL_POLE).normalize();

/**
 * Star positions (on the unit sphere), brightness and colour: a few thousand, most of them faint,
 * a scatter of bright ones tinted blue-white, white, yellow and amber, and many crowded along the
 * Milky Way, thickest toward its core.
 */
function starField(n: number, seed = 7): THREE.BufferGeometry {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2832 * rnd());
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), ph = new Float32Array(n), col = new Float32Array(n * 3);
  const v = new THREE.Vector3(), u = new THREE.Vector3().crossVectors(GAL_POLE, GAL_CORE);
  const tints = [[0.75, 0.85, 1.1], [0.9, 0.95, 1.05], [1, 1, 1], [1.05, 1, 0.88], [1.1, 0.9, 0.7]];
  for (let i = 0; i < n; i++) {
    if (i % 20 < 9) {
      // Along the band: spread round the great circle, bunched toward the core, close to the plane.
      const a = gauss() * 1.3 + (rnd() < 0.3 ? Math.PI : 0);
      v.copy(GAL_CORE).multiplyScalar(Math.cos(a)).addScaledVector(u, Math.sin(a)).addScaledVector(GAL_POLE, gauss() * (rnd() < 0.5 ? 0.04 : 0.1)).normalize();
    } else {
      const z = rnd() * 2 - 1, a = rnd() * 6.2832, r = Math.sqrt(1 - z * z);
      v.set(r * Math.cos(a), z, r * Math.sin(a));
    }
    pos.set([v.x, v.y, v.z], i * 3);
    // Few bright, many faint.
    mag[i] = Math.pow(rnd(), 5.5);
    ph[i] = rnd();
    const t = tints[Math.min(4, Math.floor(rnd() * rnd() * 5.5 + (rnd() < 0.5 ? 1.5 : 0)))];
    col.set(t, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  return g;
}

const STAR_VS = /* glsl */ `
  attribute float aMag;
  attribute float aPhase;
  attribute vec3 aCol;
  uniform float uTime, uVis, uPx, uRadius;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec4 wp = modelMatrix * vec4(position * uRadius, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    float up = normalize(wp.xyz - cameraPosition).y;
    // Dimmed and reddened low in the haze, twinkling hardest there.
    float haze = smoothstep(-0.01, 0.3, up);
    float tw = sin(uTime * (1.7 + aPhase * 3.1) + aPhase * 41.0) * 0.5 + sin(uTime * (4.3 + aPhase * 2.3) + aPhase * 17.0) * 0.5;
    vA = uVis * haze * (0.34 + 1.9 * aMag) * (1.0 + tw * mix(0.45, 0.2, haze));
    vCol = aCol * mix(vec3(1.0, 0.8, 0.6), vec3(1.0), haze);
    gl_PointSize = uPx * (1.1 + 2.6 * aMag);
  }`;
const STAR_FS = /* glsl */ `
  varying vec3 vCol;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = 1.0 - smoothstep(0.0, 1.0, d);
    gl_FragColor = vec4(vCol * vA * a * a, 1.0);
  }`;

const MILKY_VS = /* glsl */ `
  varying vec3 vDir;
  varying float vUp;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vUp = normalize(wp.xyz - cameraPosition).y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const MILKY_FS = /* glsl */ `
  uniform float uVis;
  uniform vec3 uPole, uCore, uMoon;
  varying vec3 vDir;
  varying float vUp;
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
  void main() {
    vec3 d = normalize(vDir);
    float lat = dot(d, uPole);
    vec3 onBand = normalize(d - uPole * lat + 1e-5);
    float toCore = 0.5 + 0.5 * dot(onBand, uCore);
    float n = fbm(d * 5.0), n2 = fbm(d * 13.0 + 3.0), n3 = fbm(d * 31.0 - 5.0);
    // The wandering band: wider and brighter toward the core, broken up into star clouds.
    float w = 0.07 + 0.08 * toCore * toCore + (n - 0.5) * 0.06;
    float band = exp(-pow(lat / w, 2.0)) * (0.25 + 0.75 * pow(toCore, 2.5));
    float bulge = exp(-pow(lat / 0.16, 2.0)) * pow(toCore, 10.0);
    float clump = smoothstep(0.3, 0.8, n2 * 0.65 + n3 * 0.55);
    float I = band * (0.2 + 1.4 * clump) + bulge * (0.5 + 0.6 * clump);
    // Dark dust lanes down the middle: wandering, ragged and broken.
    float rift = abs(lat - 0.01 + (fbm(d * 3.0 + 7.0) - 0.5) * 0.1);
    float riftW = (0.018 + 0.028 * toCore) * (0.5 + n2);
    I *= 1.0 - 0.8 * (1.0 - smoothstep(0.0, riftW, rift)) * smoothstep(0.35, 0.65, n + toCore * 0.3);
    vec3 col = mix(vec3(0.5, 0.58, 0.85), vec3(1.0, 0.86, 0.66), clamp(bulge * 1.4 + toCore * 0.2, 0.0, 1.0)) * (0.85 + 0.3 * n3);
    // Washed out low in the haze and near the bright moon.
    float haze = smoothstep(0.0, 0.35, vUp);
    float moon = 1.0 - 0.7 * smoothstep(0.75, 0.99, dot(d, uMoon));
    gl_FragColor = vec4(col * I * uVis * haze * moon * 0.26, 1.0);
  }`;

const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const deg = Math.PI / 180;

/**
 * The sun and the moon in the sky, where the light really comes from: seen whenever the view
 * looks up far enough (free-roam POV, or tilted low). The sun is a bright disc in a warm glow that
 * turns orange, swells and sinks into the sea as it sets; at night a pale full moon rides high in
 * a cool halo. Both fade behind storm cloud. They sit far off along their directions from the
 * camera (inside the far plane and the sea, so the sea hides the sun once it has set).
 */
export class SkyBodies {
  readonly group = new THREE.Group();
  private sun: THREE.Sprite;
  /** A tight bright corona round the disc, and the wide, warm brightening of the sky round it. */
  private sunCorona: THREE.Sprite;
  private sunGlow: THREE.Sprite;
  private moon: THREE.Sprite;
  private moonGlow: THREE.Sprite;
  private static DIST = 1100;
  /** The turning night sky (it wheels round the celestial pole through the day): stars, Milky Way. */
  private sky = new THREE.Group();
  private stars: THREE.Points;
  private milky: THREE.Mesh;
  private starMat: THREE.ShaderMaterial;
  private milkyMat: THREE.ShaderMaterial;
  private tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.55);

  constructor() {
    const sprite = (map: THREE.Texture, additive: boolean, order: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      s.renderOrder = order;
      s.frustumCulled = false;
      this.group.add(s);
      return s;
    };
    const glow = radialTexture([[0, 'rgba(255,255,255,0.55)'], [0.18, 'rgba(255,255,255,0.28)'], [0.45, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
    const aureole = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.12, 'rgba(255,255,255,0.55)'], [0.35, 'rgba(255,255,255,0.18)'], [0.7, 'rgba(255,255,255,0.04)'], [1, 'rgba(255,255,255,0)']]);
    this.sunGlow = sprite(aureole, true, -7);
    this.sunCorona = sprite(glow, true, -6);
    this.sun = sprite(radialTexture([[0, 'rgba(255,255,255,1)'], [0.78, 'rgba(255,255,255,1)'], [0.9, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]), true, -5);
    this.moonGlow = sprite(glow, true, -6);
    this.moon = sprite(moonTexture(), false, -5);
    this.group.name = 'skyBodies';

    const px = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uVis: { value: 0 }, uPx: { value: 1.35 * px }, uRadius: { value: STAR_R } },
      vertexShader: STAR_VS, fragmentShader: STAR_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.stars = new THREE.Points(starField(7000), this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    this.milkyMat = new THREE.ShaderMaterial({
      uniforms: { uVis: { value: 0 }, uPole: { value: GAL_POLE }, uCore: { value: GAL_CORE }, uMoon: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: MILKY_VS, fragmentShader: MILKY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
    });
    this.milky = new THREE.Mesh(new THREE.SphereGeometry(STAR_R * 1.02, 64, 32), this.milkyMat);
    this.milky.frustumCulled = false;
    this.milky.renderOrder = -10;
    this.sky.add(this.milky, this.stars);
    this.sky.name = 'nightSky';
    this.group.add(this.sky);
  }

  /** Place them for this frame, around the camera. `overcast` 0..1 hides them behind cloud. */
  update(camera: THREE.Camera, ls: LightState, overcast: number, dayT = 0, time = 0): void {
    const cam = camera.position, D = SkyBodies.DIST;
    const size = (angle: number) => 2 * D * Math.tan((angle * deg) / 2);
    const clouds = 1 - Math.min(1, overcast * 1.1);

    // Stars and the Milky Way come out as the sky darkens, wheeling slowly round the pole.
    const starVis = THREE.MathUtils.smoothstep(ls.night, 0.4, 0.85) * clouds * clouds;
    this.sky.visible = starVis > 0.003;
    if (this.sky.visible) {
      this.sky.position.copy(cam);
      this.sky.quaternion.copy(this.tilt).multiply(_q.setFromAxisAngle(_up, -dayT * Math.PI * 2));
      this.starMat.uniforms.uVis.value = starVis;
      this.starMat.uniforms.uTime.value = time;
      this.milkyMat.uniforms.uVis.value = starVis;
      // The moon, in the sky's own (turning) frame.
      this.milkyMat.uniforms.uMoon.value.copy(ls.moonSky).applyQuaternion(_q.copy(this.sky.quaternion).invert());
    }

    // The sun: warmer, larger and dimmer low down; gone once it has sunk below the horizon.
    const elev = Math.asin(THREE.MathUtils.clamp(ls.sunSky.y, -1, 1)) / deg;
    const sunVis = THREE.MathUtils.smoothstep(elev, -4, 1.5) * clouds;
    this.sun.visible = this.sunGlow.visible = this.sunCorona.visible = sunVis > 0.003;
    if (this.sun.visible) {
      const low = 1 - THREE.MathUtils.smoothstep(elev, 0, 20);
      _p.copy(ls.sunSky).multiplyScalar(D).add(cam);
      this.sun.position.copy(_p);
      this.sunGlow.position.copy(_p);
      this.sunCorona.position.copy(_p);
      const disc = size(3.2 * (1 + 0.35 * low));
      this.sun.scale.set(disc, disc, 1);
      const corona = size(9 * (1 + 0.6 * low));
      this.sunCorona.scale.set(corona, corona, 1);
      const halo = size(30 * (1 + 0.4 * low));
      this.sunGlow.scale.set(halo, halo, 1);
      // A white-hot disc tinted by the sunlight's own colour (deep orange as it sets).
      _c.set(1, 1, 1).lerp(ls.sunColor, 0.4 + 0.55 * low);
      const sm = this.sun.material as THREE.SpriteMaterial;
      sm.color.copy(_c).multiplyScalar(2.6 * (1 - 0.35 * low));
      sm.opacity = sunVis;
      // A bright corona (radiant as it sets) in a wide glow that warms the sky round it.
      const cm = this.sunCorona.material as THREE.SpriteMaterial;
      cm.color.copy(ls.sunColor).multiplyScalar(2.2 + 1.3 * low);
      cm.opacity = sunVis;
      const gm = this.sunGlow.material as THREE.SpriteMaterial;
      gm.color.copy(ls.sunColor).multiplyScalar(0.55 + 0.35 * low);
      gm.opacity = sunVis * 0.7;
    }

    // The moon: rises into the night sky with the moonlight, a cool halo round it.
    const mElev = Math.asin(THREE.MathUtils.clamp(ls.moonSky.y, -1, 1)) / deg;
    const moonVis = THREE.MathUtils.smoothstep(ls.night, 0.35, 0.75) * THREE.MathUtils.smoothstep(mElev, -2, 3) * clouds;
    this.moon.visible = this.moonGlow.visible = moonVis > 0.003;
    if (this.moon.visible) {
      _p.copy(ls.moonSky).multiplyScalar(D).add(cam);
      this.moon.position.copy(_p);
      this.moonGlow.position.copy(_p);
      const disc = size(2.9);
      this.moon.scale.set(disc, disc, 1);
      const halo = size(11);
      this.moonGlow.scale.set(halo, halo, 1);
      const mm = this.moon.material as THREE.SpriteMaterial;
      mm.color.setRGB(1.25, 1.27, 1.3);
      mm.opacity = moonVis;
      const gm = this.moonGlow.material as THREE.SpriteMaterial;
      gm.color.setRGB(0.55, 0.65, 0.85);
      gm.opacity = moonVis * 0.45;
    }
  }
}
