import * as THREE from 'three';
import { COLORS, WORLD } from '../config';
import { World } from '../world/World';
import { GeoBuilder, M, P, lumpy } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { Particles } from '../render/Particles';
import { RNG } from '../world/rng';

/** GLSL shared by the ocean, rivers and pool. */
const waterVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uWorld;
  uniform float uFlow;
  uniform sampler2D uHeight;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uSunI;
  uniform vec3 uSkyCol;
  uniform float uDay;
  uniform float uStorm;
  uniform vec3 cDeep; uniform vec3 cDeep2; uniform vec3 cMid; uniform vec3 cShallow; uniform vec3 cShallowB; uniform vec3 cFoam;
  varying vec3 vW;

  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  vec2 warpC(vec2 p, float t) {
    return vec2(vnoise(p * 0.35 + vec2(t * 0.18, 0.0)), vnoise(p * 0.35 + vec2(2.7, t * 0.15))) * 1.6;
  }
  const float TAU = 6.2831853;
  /** Value noise with analytic slope (xy) and value (z). */
  vec3 vnoised(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = hsh(i), b = hsh(i + vec2(1.0, 0.0)), c = hsh(i + vec2(0.0, 1.0)), d = hsh(i + vec2(1.0, 1.0));
    float k = a - b - c + d;
    return vec3(du * (vec2(b - a, c - a) + k * u.yx), a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y);
  }
  /**
   * Calm stylised sea: four long, low swells (matched on the CPU so boats ride them) plus soft
   * rippled noise in three rotated, slowly drifting layers. Noise has no period, so the surface
   * never shows a repeating pattern; each layer fades once it is smaller than a few pixels.
   */
  float waves(vec2 p, float t, float fw, out vec2 g, out float ampSum) {
    float h = 0.0;
    g = vec2(0.0);
    ampSum = 0.0;
    float amp = 1.0 + uStorm * 1.7;
    float lam = 7.5;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float ang = 0.62 + (fract(fi * 0.6180339 + 0.13) - 0.5) * (1.1 + fi * 0.2);
      vec2 d = vec2(cos(ang), sin(ang));
      float k = TAU / lam;
      float w = sqrt(9.8 * k) * 0.55 * (1.0 + uFlow * 1.5);
      float ph = dot(d, p) * k + t * w + fi * 1.93;
      float A = lam * 0.0125 * amp;
      h += A * sin(ph);
      // Slopes kept gentle: the swell reads as a slow broad shimmer, not stripes.
      g += A * k * d * cos(ph) * 0.55 * (1.0 - smoothstep(lam * 0.12, lam * 0.4, fw));
      ampSum += A;
      lam *= 0.72;
    }
    // A slow large-scale warp keeps the ripple layers from drifting in straight lines.
    vec2 warp = vec2(vnoise(p * 0.045 + vec2(t * 0.012, 0.0)), vnoise(p * 0.045 + vec2(5.2, -t * 0.01))) * 6.0;
    float ra = 0.32 * amp;
    float freq = 0.42;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float ca = cos(0.9 + fi * 2.1), sa = sin(0.9 + fi * 2.1);
      mat2 R = mat2(ca, -sa, sa, ca);
      vec2 drift = vec2(cos(fi * 2.4 + 0.5), sin(fi * 2.4 + 0.5)) * (0.22 + fi * 0.08) * (1.0 + uFlow * 3.0);
      vec2 q = R * (p + warp) * freq + drift * t * freq;
      vec3 nd = vnoised(q);
      float fade = 1.0 - smoothstep(0.12 / freq, 0.45 / freq, fw);
      g += (transpose(R) * nd.xy) * freq * ra * 0.12 * fade;
      h += (nd.z - 0.5) * ra * 0.12;
      freq *= 2.1;
      ra *= 0.55;
    }
    return h;
  }
  void main() {
    vec2 uv = (vW.xz + uWorld * 0.5) / uWorld;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec4 hr = texture2D(uHeight, clamp(uv, 0.0, 1.0));
    float bed = mix(-7.0, hr.r, inside);
    float depth = max(vW.y - bed, 0.0);
    float t = uTime;
    vec2 p = vW.xz;
    // World units covered by one pixel here: drives wave level of detail.
    float fw = length(fwidth(p)) * 1.5;
    vec2 grad; float ampSum;
    float h0 = waves(p, t, fw, grad, ampSum);
    // Far away the surface settles into a smooth sheen.
    grad *= mix(1.0, 0.5, smoothstep(0.15, 0.8, fw));
    // Glassy in very shallow water.
    grad *= mix(0.3, 1.0, smoothstep(0.05, 0.9, depth));
    vec3 n = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(uSunDir);
    float crest = h0 / max(ampSum, 1e-3);

    // Body colour by depth: bright turquoise shallows -> teal -> deep navy, darker toward the map edge.
    // Colour uses a blurred depth so seabed terrace steps don't show as contour stripes.
    float bs = 0.0;
    for (int k = 0; k < 6; k++) {
      float ak = float(k) * 1.0472;
      vec2 ou = vec2(cos(ak), sin(ak)) * (2.2 / uWorld);
      bs += texture2D(uHeight, clamp(uv + ou, 0.0, 1.0)).r;
    }
    float cdepth = max(vW.y - mix(-7.0, (bs / 6.0) * 0.6 + hr.r * 0.4, inside), 0.0);
    vec3 col = mix(cShallowB, cShallow, smoothstep(0.05, 0.75, cdepth));
    col = mix(col, cMid, smoothstep(0.6, 2.6, cdepth));
    col = mix(col, cDeep2, smoothstep(2.0, 5.2, cdepth));
    float far = smoothstep(uWorld * 0.42, uWorld * 1.4, length(vW.xz));
    // Blend toward open-ocean colour approaching the map edge so its square outline never shows.
    float edgeD = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float edgeK = (1.0 - smoothstep(0.0, 0.22, edgeD)) * inside + (1.0 - inside);
    col = mix(col, cDeep, clamp(max(max(smoothstep(4.5, 8.0, cdepth), far), edgeK), 0.0, 1.0));
    // Very soft, very large colour drift (like light and shade from passing clouds) — no visible tiling.
    float drift = vnoise(p * 0.018 + vec2(t * 0.006, -t * 0.004)) * 0.6 + vnoise(p * 0.05 - vec2(t * 0.01, 0.0)) * 0.4;
    col *= 0.93 + 0.14 * drift;

    float dayK = mix(0.3, 1.0, uDay);
    float ndl = max(dot(n, L), 0.0);
    vec3 lit = col * (0.78 + 0.22 * ndl) * mix(vec3(1.0), uSunCol, 0.15) * dayK;
    // Gentle light through the swell tops (every pow() base is clamped to 0..1: pow of a tiny negative
    // rounding error is NaN on some GPUs, and one NaN pixel turns the whole frame black once bloom spreads it).
    float back = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    lit += vec3(0.03, 0.16, 0.18) * clamp(crest, 0.0, 1.0) * (0.3 + back) * dayK * smoothstep(0.8, 3.0, depth);

    // Sunlight dancing on the shallows: soft, faint caustic lines over the sand.
    vec2 cq = p * 0.9 + warpC(p, t);
    float caus = pow(clamp(1.0 - abs(vnoise(cq) * 2.0 - 1.0), 0.0, 1.0), 7.0) * 0.6
               + pow(clamp(1.0 - abs(vnoise(cq * 1.7 + 3.1) * 2.0 - 1.0), 0.0, 1.0), 7.0) * 0.4;
    float causK = (1.0 - smoothstep(0.25, 1.9, cdepth)) * smoothstep(0.02, 0.2, depth) * (1.0 - smoothstep(0.08, 0.3, fw));
    lit += vec3(0.85, 1.0, 0.95) * caus * causK * 0.16 * uDay * (1.0 - uStorm * 0.7);

    // Sky reflection (Fresnel), kept soft so the water keeps its colour.
    vec3 R = reflect(-V, n);
    vec3 skyR = mix(uSkyCol * 0.95 + vec3(0.04), uSkyCol * vec3(0.42, 0.56, 0.75), clamp(R.y, 0.0, 1.0)) * mix(0.28, 1.0, uDay);
    float F = 0.02 + 0.98 * pow(clamp(1.0 - dot(n, V), 0.0, 1.0), 5.0);
    F = clamp(F * 1.2 + 0.02, 0.0, 0.6);
    lit = mix(lit, skyR, F);

    // Sun (or moon) on the water: a soft glowing path with a brighter core, and a few gentle glints in it.
    vec3 H = normalize(L + V + vec3(0.0, 1e-4, 0.0));
    float nh = clamp(dot(n, H), 0.0, 1.0);
    float glare = pow(nh, 900.0) * 5.0 + pow(nh, 160.0) * 0.9 + pow(nh, 30.0) * 0.08;
    vec2 gp = p * 4.0;
    vec2 cell = floor(gp);
    float r1 = hsh(cell);
    // Each glint fades in and out on its own slow timing.
    float twinkle = pow(clamp(0.5 + 0.5 * sin(t * (0.7 + r1 * 0.9) + r1 * 40.0), 0.0, 1.0), 3.0);
    vec2 fc = fract(gp) - 0.5 - (vec2(hsh(cell + 11.3), hsh(cell + 5.9)) - 0.5) * 0.55;
    float dot1 = smoothstep(0.16, 0.0, length(fc));
    float spark = step(0.86, hsh(cell + 9.1)) * twinkle * dot1 * pow(nh, 40.0) * 3.0 * (1.0 - smoothstep(0.04, 0.14, fw));
    float sunVis = (1.0 - uStorm * 0.85) * smoothstep(-0.02, 0.12, L.y);
    lit += uSunCol * (glare + spark) * uSunI * 0.3 * sunVis;

    // Whitecaps only in storms.
    float capN = vnoise(p * 1.7 + vec2(t * 0.25, -t * 0.15));
    float cap = smoothstep(0.5, 0.85, crest + (capN - 0.5) * 0.5) * smoothstep(2.5, 5.0, cdepth);
    cap *= smoothstep(0.55, 0.85, vnoise(p * 3.4 - vec2(t * 0.5, t * 0.3))) * uStorm * 1.2;
    lit = mix(lit, cFoam * mix(0.3, 1.0, uDay), clamp(cap, 0.0, 1.0) * 0.85);

    // Shoreline: a soft white lip on the sand and one or two gentle ripples rolling in.
    float fn = vnoise(p * 1.1 + t * 0.12);
    float shore = 1.0 - smoothstep(0.0, 0.13 + 0.08 * fn, depth);
    float bandMask = 1.0 - smoothstep(0.08, 0.5, depth);
    float bands = smoothstep(0.7, 0.97, sin(depth * 11.0 - t * 1.1 + fn * 3.0) * 0.5 + 0.5) * bandMask;
    float rock = hr.g * (0.6 + 0.3 * sin(t * 1.4 + fn * 5.0));
    float foam = clamp(shore * 0.9 + bands * 0.4 + rock * 0.85, 0.0, 1.0);
    foam *= smoothstep(0.2, 0.5, vnoise(p * 2.6 + vec2(t * 0.3, -t * 0.2)) + shore * 0.8 + rock * 0.4);
    foam *= inside;
    lit = mix(lit, cFoam * mix(0.3, 1.05, uDay), foam);

    // Deep water stays slightly translucent so whales, rays and fish schools show beneath the surface.
    float alpha = mix(0.22, 0.6, smoothstep(0.0, 0.9, cdepth));
    alpha = mix(alpha, 0.64, smoothstep(0.9, 3.6, cdepth));
    alpha = max(alpha, foam);
    // Beyond the island's seabed there is nothing underneath: fully opaque open sea.
    alpha = mix(1.0, alpha, inside * smoothstep(0.0, 0.16, edgeD));
    gl_FragColor = vec4(lit, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Sea mist ring: the far ocean melts into the haze, hiding the edge of the water plane.
    #ifdef USE_FOG
      float rim = smoothstep(uWorld * 1.35, uWorld * 3.2, length(vW.xz)) * 0.92;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, rim);
      gl_FragColor.a = mix(gl_FragColor.a, 1.0, rim);
    #endif
    #include <fog_fragment>
  }
`;

/**
 * Waterfall curtain: glassy teal water sliding over the lip, breaking into falling ropes of
 * white water that accelerate and aerate toward the bottom, with ragged, wind-torn edges.
 */
const fallFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uDay;
  uniform float uLayer;
  varying vec2 vUv;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float u = vUv.x, v = vUv.y; // v: 0 at the lip, 1 at the pool
    float t = uTime + uLayer * 7.3;
    // Falling water speeds up: scroll position grows faster than linearly down the fall.
    float fall = pow(v, 0.65) * 4.0 - t * (1.6 + uLayer * 0.3);
    float ropes = vnoise(vec2(u * (16.0 + uLayer * 6.0), fall)) * 0.6 + vnoise(vec2(u * 34.0, fall * 2.1 + 3.0)) * 0.4;
    float streak = vnoise(vec2(u * 60.0, fall * 3.5 + 9.0));
    // Aeration: glassy at the lip, turning white as it falls.
    float aer = smoothstep(0.05, 0.7, v) * 0.75 + ropes * 0.35;
    vec3 glass = vec3(0.24, 0.72, 0.76);
    vec3 white = vec3(0.95, 0.99, 1.0);
    vec3 col = mix(glass, white, clamp(aer + streak * 0.25, 0.0, 1.0));
    col *= 0.88 + 0.2 * streak;
    // Ragged, wobbling side edges and gaps between the ropes lower down.
    float wob = (vnoise(vec2(v * 6.0 - t * 1.2, uLayer * 5.0)) - 0.5) * 0.12 * (0.3 + v);
    float edge = smoothstep(0.0, 0.1 + 0.08 * v, u + wob) * smoothstep(0.0, 0.1 + 0.08 * v, 1.0 - u - wob);
    float gaps = mix(1.0, smoothstep(0.25, 0.55, ropes), smoothstep(0.15, 0.8, v) * (0.55 + uLayer * 0.35));
    float a = edge * gaps * mix(0.72, 0.95, aer);
    // Blend in from the river at the top; soften into the plunge foam at the bottom.
    a *= smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.93, 1.0, v));
    a *= mix(1.0, 0.7, uLayer);
    if (a < 0.02) discard;
    gl_FragColor = vec4(col * mix(0.32, 1.0, uDay), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
const fallVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

/** Churning white water and ripples spreading from where the fall hits the pool. */
const plungeFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uDay;
  varying vec2 vUv;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Stretched along the flow: the foam trails away downstream.
    p.y = p.y > 0.0 ? p.y * 0.75 : p.y * 1.5;
    float r = length(p);
    float t = uTime;
    float ang = atan(p.y, p.x);
    float churn = vnoise(vec2(ang * 3.0 + t * 0.7, r * 7.0 - t * 2.4)) * 0.6 + vnoise(p * 9.0 + vec2(t * 0.9, -t * 1.3)) * 0.4;
    float core = 1.0 - smoothstep(0.1, 0.62, r + (churn - 0.5) * 0.3);
    float rings = smoothstep(0.75, 0.95, sin(r * 22.0 - t * 4.2 + churn * 2.0) * 0.5 + 0.5) * smoothstep(0.25, 0.5, r) * (1.0 - smoothstep(0.7, 1.0, r));
    // Round bubbles drifting away from the churn.
    vec2 bq = (p + vec2(0.0, -t * 0.06)) * 14.0;
    vec2 bc = floor(bq);
    vec2 bf = fract(bq) - 0.5 - (vec2(hsh(bc + 1.3), hsh(bc + 7.1)) - 0.5) * 0.6;
    float bubbles = step(0.72, hsh(bc)) * smoothstep(0.22, 0.12, length(bf)) * smoothstep(0.95, 0.35, r);
    float a = clamp(core * (0.55 + churn * 0.6) + rings * 0.28 + bubbles * 0.55 * (1.0 - core), 0.0, 1.0);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vec3(0.95, 0.99, 1.0) * mix(0.32, 1.0, uDay), a * 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function makeSoftSprite(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Ocean, rivers, the waterfall pool and waterfall with mist.
 * Depth comes from a seabed height texture (terrain height per half-cell), so it works for
 * rivers above sea level as well as the ocean and needs no depth pre-pass.
 */
export class Water {
  readonly group = new THREE.Group();
  readonly oceanMat: THREE.ShaderMaterial;
  readonly riverMat: THREE.ShaderMaterial;
  readonly heightTex: THREE.DataTexture;
  private heightData: Uint16Array;
  private res: number;
  private fallMat: THREE.ShaderMaterial | null = null;
  private spray: Particles | null = null;
  private fallMist: Particles | null = null;
  private plungeAt = new THREE.Vector3();
  private sprayAcc = 0;
  readonly shared = {
    uTime: { value: 0 },
    uWorld: { value: WORLD.size },
    uSunDir: { value: new THREE.Vector3(0.5, 0.5, 0.5).normalize() },
    uSunCol: { value: new THREE.Color(COLORS.sunWarm) },
    uSunI: { value: 3 },
    uSkyCol: { value: new THREE.Color(COLORS.sky) },
    uDay: { value: 1 },
    uStorm: { value: 0 },
  };

  constructor(private world: World) {
    this.res = world.N * 2;
    this.heightData = new Uint16Array(this.res * this.res * 4);
    this.heightTex = new THREE.DataTexture(this.heightData, this.res, this.res, THREE.RGBAFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.updateHeight(0, 0, world.N - 1, world.N - 1);

    const colorUniforms = () => ({
      cDeep: { value: new THREE.Color(COLORS.deepOcean) },
      cDeep2: { value: new THREE.Color(COLORS.deepOcean2) },
      cMid: { value: new THREE.Color(COLORS.midWater) },
      cShallow: { value: new THREE.Color(COLORS.shallow) },
      cShallowB: { value: new THREE.Color(COLORS.shallowBright) },
      cFoam: { value: new THREE.Color(COLORS.foam) },
    });
    const make = (flow: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...this.shared,
          ...colorUniforms(),
          uHeight: { value: this.heightTex },
          uFlow: { value: flow },
        },
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        fog: true,
        depthWrite: true,
      });
    this.oceanMat = make(0);
    this.riverMat = make(1);

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize, 1, 1).rotateX(-Math.PI / 2), this.oceanMat);
    ocean.name = 'ocean';
    ocean.renderOrder = 10;
    this.group.add(ocean);
    // Dark ocean floor under everything, so looking through the water past the island's seabed
    // never shows the sky colour behind.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize, 1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x06202f), fog: true })
    );
    floor.position.y = -6.2;
    floor.name = 'oceanFloor';
    this.group.add(floor);

    this.buildRivers();
    this.buildWaterfall();
  }

  /** Recompute the seabed height texture for a cell rectangle. */
  updateHeight(cx0: number, cz0: number, cx1: number, cz1: number): void {
    const w = this.world;
    const r = this.res;
    const toH = THREE.DataUtils.toHalfFloat;
    const x0 = Math.max(0, (cx0 - 4) * 2), x1 = Math.min(r - 1, (cx1 + 5) * 2);
    const z0 = Math.max(0, (cz0 - 4) * 2), z1 = Math.min(r - 1, (cz1 + 5) * 2);
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const x = (i + 0.5) / 2 - w.half;
        const z = (j + 0.5) / 2 - w.half;
        const k = (j * r + i) * 4;
        this.heightData[k] = toH(w.heightAt(x, z));
        this.heightData[k + 1] = toH(w.sampleField(w.foam, x, z));
        this.heightData[k + 2] = 0;
        this.heightData[k + 3] = toH(1);
      }
    }
    this.heightTex.needsUpdate = true;
  }

  private buildRivers(): void {
    const w = this.world;
    for (const river of w.rivers) {
      if (river.points.length < 3) continue;
      const pts = river.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const samples = pts.length * 3;
      const width = 2.7;
      const pos: number[] = [];
      const idx: number[] = [];
      const p = new THREE.Vector3(), tng = new THREE.Vector3();
      let lastY = Infinity;
      for (let s = 0; s <= samples; s++) {
        const u = s / samples;
        curve.getPointAt(u, p);
        curve.getTangentAt(u, tng);
        const px = -tng.z, pz = tng.x;
        const pl = Math.hypot(px, pz) || 1;
        const y = Math.min(p.y, lastY);
        lastY = y;
        pos.push(p.x + (px / pl) * width * 0.5, y, p.z + (pz / pl) * width * 0.5);
        pos.push(p.x - (px / pl) * width * 0.5, y, p.z - (pz / pl) * width * 0.5);
        if (s > 0) {
          const a = (s - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, this.riverMat);
      m.renderOrder = 11;
      m.name = 'river';
      this.group.add(m);
    }
    if (w.waterfall) {
      const f = w.waterfall;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(f.poolR + 0.9, 40).rotateX(-Math.PI / 2), this.riverMat);
      pool.position.set(f.x + f.dx * (f.poolR + 1.2), f.poolY, f.z + f.dz * (f.poolR + 1.2));
      pool.renderOrder = 11;
      this.group.add(pool);
    }
  }

  private buildWaterfall(): void {
    const f = this.world.waterfall;
    if (!f) return;
    const H = Math.max(0.5, f.topY - f.bottomY);
    const px = -f.dz, pz = f.dx; // across the fall
    const yaw = Math.atan2(f.dx, f.dz);
    const mkMat = (layer: number) =>
      new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.shared.uTime, uDay: this.shared.uDay, uLayer: { value: layer } },
        vertexShader: fallVert,
        fragmentShader: fallFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
    // Curtain: over the rounded lip, then a falling arc that spreads a little toward the bottom.
    const curtain = (width: number, spread: number, throwK: number, layer: number) => {
      const cols = 14, rows = 22;
      const pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        // First 12% of the curtain wraps over the lip; the rest falls.
        const lip = Math.min(1, v / 0.12);
        const s = Math.max(0, (v - 0.12) / 0.88);
        const fwd = -0.45 * (1 - lip) + (lip < 1 ? Math.sin(lip * Math.PI * 0.5) * 0.3 : 0.3 + throwK * Math.sqrt(s) + s * 0.25);
        const y = lip < 1 ? f.topY + 0.02 - (1 - Math.cos(lip * Math.PI * 0.5)) * 0.2 : f.topY - 0.18 - (H - 0.18) * s;
        const w = width * (1 + spread * s * s);
        for (let i = 0; i <= cols; i++) {
          const u = i / cols;
          const across = (u - 0.5) * w + Math.sin(u * 9.0 + layer * 3) * 0.04 * s;
          // Slight bulge in the middle, where most of the water goes.
          const bul = Math.sin(u * Math.PI) * 0.12 * s;
          pos.push(f.x + px * across + f.dx * (fwd + bul), y, f.z + pz * across + f.dz * (fwd + bul));
          uv.push(u, v);
          if (i < cols && j < rows) {
            const a = j * (cols + 1) + i;
            idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mkMat(layer));
      m.renderOrder = 12 + layer;
      m.frustumCulled = false;
      this.group.add(m);
    };
    curtain(2.3, 0.35, 0.8, 0);
    curtain(1.6, 0.25, 1.05, 1);
    this.fallMat = null;

    // Plunge pool: churning foam and rings where the water lands.
    const land = 0.3 + 0.8 * 1.0 + 0.25 + 0.2;
    this.plungeAt.set(f.x + f.dx * land, f.poolY + 0.03, f.z + f.dz * land);
    const plunge = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4).rotateX(-Math.PI / 2).rotateY(yaw + Math.PI),
      new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.shared.uTime, uDay: this.shared.uDay },
        vertexShader: fallVert,
        fragmentShader: plungeFrag,
        transparent: true,
        depthWrite: false,
        fog: true,
      })
    );
    plunge.position.copy(this.plungeAt).addScaledVector(new THREE.Vector3(f.dx, 0, f.dz), 0.6);
    plunge.renderOrder = 12;
    this.group.add(plunge);

    // Boulders framing the lip and scattered around the plunge pool, wet near the water, mossy on top.
    const rng = new RNG(this.world.seed * 17 + 5);
    const b = new GeoBuilder();
    const rock = (x: number, z: number, y: number, r: number, squash: number, wetY: number) => {
      const g = lumpy(P.sphere(r, 1), 0.2, Math.floor(rng.next() * 1e6), squash);
      b.add(g, {
        color: (p, n) => {
          let c = new THREE.Color(0x7d7078).lerp(new THREE.Color(0xa99c96), n.y * 0.5 + 0.35);
          if (n.y > 0.55 && Math.sin(p.x * 13 + p.z * 9) > -0.1) c.lerp(new THREE.Color(0x6f8f38), 0.6);
          if (p.y < wetY + 0.25) c.multiplyScalar(0.72);
          return c;
        },
        ao: { y0: y - r * squash, y1: y + r * squash * 0.4, min: 0.62 },
      }, M.t(x, y, z, rng.next(), rng.next() * 3, rng.next()));
    };
    const lipW = 1.55;
    for (const side of [-1, 1]) {
      // Big shoulder boulders either side of the lip, and a smaller one tucked in.
      rock(f.x + px * side * (lipW + 0.35) - f.dx * 0.2, f.z + pz * side * (lipW + 0.35) - f.dz * 0.2, f.topY - 0.05, 0.75, 0.75, f.topY - 1);
      rock(f.x + px * side * (lipW - 0.1) + f.dx * 0.1, f.z + pz * side * (lipW - 0.1) + f.dz * 0.1, f.topY - 0.3, 0.42, 0.7, f.topY - 1);
      rock(f.x + px * side * (lipW + 0.9) - f.dx * 0.9, f.z + pz * side * (lipW + 0.9) - f.dz * 0.9, f.topY - 0.2, 0.5, 0.7, f.topY - 1);
      // Rocks the river splits around just before the drop.
      rock(f.x + px * side * 0.75 - f.dx * 0.95, f.z + pz * side * 0.75 - f.dz * 0.95, f.topY - 0.2, 0.26, 0.6, f.topY - 0.2);
      // Base: tumbled boulders at the foot of the cliff and a few in the pool.
      rock(f.x + px * side * (lipW + 0.4) + f.dx * 0.8, f.z + pz * side * (lipW + 0.4) + f.dz * 0.8, f.poolY + 0.1, 0.8, 0.75, f.poolY);
      rock(f.x + px * side * (lipW + 1.3) + f.dx * 1.7, f.z + pz * side * (lipW + 1.3) + f.dz * 1.7, f.poolY + 0.05, 0.55, 0.7, f.poolY);
      // A couple of stones at the pool's edge, half in the water.
      const ex = f.x + px * side * 3.0 + f.dx * 3.4, ez = f.z + pz * side * 3.0 + f.dz * 3.4;
      rock(ex, ez, Math.max(f.poolY - 0.02, this.world.heightAt(ex, ez) + 0.05), 0.42, 0.6, f.poolY);
    }
    const rocks = new THREE.Mesh(b.build(), stylisedMaterial());
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.name = 'waterfallRocks';
    this.group.add(rocks);

    // Spray droplets thrown up in arcs and soft mist rolling downstream.
    this.spray = new Particles(520, 0xf4fcff);
    this.fallMist = new Particles(160, 0xeef8ff, 0.32);
    this.group.add(this.spray.points, this.fallMist.points);
  }

  /** Waves at a point in world space (used for boats bobbing). */
  waveHeight(x: number, z: number, t: number): number {
    // The four longest of the shader's waves (the rest are too small to move a boat).
    const amp = 1 + this.shared.uStorm.value * 1.7;
    let h = 0, lam = 7.5;
    for (let i = 0; i < 4; i++) {
      const ang = 0.62 + ((i * 0.6180339 + 0.13) % 1 - 0.5) * (1.1 + i * 0.2);
      const k = (Math.PI * 2) / lam;
      const w = Math.sqrt(9.8 * k) * 0.55;
      h += lam * 0.0125 * amp * Math.sin((Math.cos(ang) * x + Math.sin(ang) * z) * k + t * w + i * 1.93);
      lam *= 0.72;
    }
    return h;
  }

  update(dt: number, time: number): void {
    this.shared.uTime.value = time;
    const f = this.world.waterfall;
    if (f && this.spray && this.fallMist && dt > 0) {
      const px = -f.dz, pz = f.dx;
      const P0 = this.plungeAt;
      this.sprayAcc += dt;
      // Droplets: a steady fountain of small splashes along the line where the curtain lands.
      while (this.sprayAcc > 0.008) {
        this.sprayAcc -= 0.008;
        const across = (Math.random() - 0.5) * 2.0;
        const out = 0.4 + Math.random() * 1.6;
        const a = (Math.random() - 0.5) * 1.6;
        this.spray.spawn(P0.x + px * across, P0.y, P0.z + pz * across, f.dx * out * Math.cos(a) + px * Math.sin(a) * out * 0.6, 1.4 + Math.random() * 2.4, f.dz * out * Math.cos(a) + pz * Math.sin(a) * out * 0.6, 0.55 + Math.random() * 0.55, 0.05 + Math.random() * 0.07);
        if (Math.random() < 0.09) {
          // Mist: slow soft billows drifting downstream and rising, growing as they go.
          this.fallMist.spawn(P0.x + px * (Math.random() - 0.5) * 2.4, P0.y + 0.1 + Math.random() * 0.4, P0.z + pz * (Math.random() - 0.5) * 2.4, f.dx * (0.3 + Math.random() * 0.5), 0.25 + Math.random() * 0.45, f.dz * (0.3 + Math.random() * 0.5), 2.2 + Math.random() * 1.6, 0.7 + Math.random() * 0.5, 0.9);
        }
      }
      this.spray.update(dt, 6.5);
      this.fallMist.update(dt, -0.05);
      const day = 0.35 + 0.65 * this.shared.uDay.value;
      ((this.spray.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.96 * day, 0.99 * day, day);
      ((this.fallMist.points.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(0.93 * day, 0.97 * day, day);
    }
  }
}
