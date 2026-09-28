import * as THREE from 'three';
import { COLORS, WORLD } from '../config';
import { World } from '../world/World';
import { GeoBuilder, M, P, lumpy } from '../render/GeoBuilder';
import { stylisedMaterial, treeMaterial } from '../render/materials';
import { angularRockGeometry, rockColor } from '../render/rocks';
import { bushGeometry, fernGeometry } from '../vegetation/models';
import { hangingVine } from '../vegetation/detail';
import { Particles } from '../render/Particles';
import { RNG } from '../world/rng';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The sea plane sits a little above 0 so surf can wash up the beaches (and drain back below 0). */
export const SEA_SURFACE = 0.07;
/** Swell wavelengths and headings, shared with the shader (keep in step with SWL / SWA). */
const SWELL_L = [11.8, 8.3, 6.1, 4.55];
const SWELL_A = [0.0, 0.62, -0.55, 1.15];

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
  /** Extra depth for narrow canals, too fine for the seabed texture to resolve. */
  uniform float uDeepen;
  /** 1 for the sea: surf rolls in and washes up the beaches (the plane sits SEA_SURFACE above 0). */
  uniform float uSwash;
  uniform float uSurface;
  /** Wind strength patch at this pixel (set by waves()). */
  float gWind;
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
  /** Swell components: wavelengths (no simple ratios, so they never fall into step) and headings. */
  const float SWL[7] = float[7](11.8, 8.3, 6.1, 4.55, 3.4, 2.45, 1.8);
  const float SWA[7] = float[7](0.0, 0.62, -0.55, 1.15, -1.0, 0.3, -1.45);
  /**
   * Natural sea: seven swells from spread-out headings. Their crests are bent by broad noise so
   * they curve instead of running in rows, and each builds and fades in slowly drifting wave
   * groups, so the sea never shows a grid. On top, three layers of drifting ripple noise, made
   * rougher or glassier by broad wind patches. Each layer fades once smaller than a few pixels.
   * The CPU matches the swell sines (without the groups) so boats ride them.
   */
  float waves(vec2 p, float t, float fw, out vec2 g, out float ampSum) {
    float h = 0.0;
    g = vec2(0.0);
    ampSum = 0.0;
    float amp = 1.0 + uStorm * 1.7;
    // Broad fields shared by all swells (a few lookups instead of two per swell).
    float bendA = vnoise(p * 0.031 + vec2(3.1, 7.7));
    float bendB = vnoise(p * 0.057 + vec2(-5.3, 1.9));
    float grpA = vnoise(p * 0.019 + vec2(t * 0.021, -t * 0.013));
    float grpB = vnoise(p * 0.043 + vec2(-t * 0.017, t * 0.024) + 9.4);
    for (int i = 0; i < 7; i++) {
      float fi = float(i);
      float lam = SWL[i];
      float ang = 0.62 + SWA[i];
      vec2 d = vec2(cos(ang), sin(ang));
      float k = TAU / lam;
      float w = sqrt(9.8 * k) * 0.55 * (1.0 + uFlow * 1.5);
      float mixK = fract(fi * 0.618 + 0.21);
      float bend = (mix(bendA, bendB, mixK) - 0.5) * (4.0 + fi * 0.6);
      float ph = dot(d, p) * k + t * w + fi * 1.93 + bend;
      // Wave groups: each swell swells and fades across the sea.
      float grp = 0.3 + 1.4 * smoothstep(0.15, 0.85, mix(grpA, grpB, fract(fi * 0.414 + 0.35)));
      float A = lam * 0.0105 * amp * grp;
      h += A * sin(ph);
      // Long swells shade gently, and fade further as the camera pulls back (from high up a real
      // sea shows wind texture and glitter, not rows of swell).
      g += A * k * d * cos(ph) * 0.34 * (1.0 - smoothstep(lam * 0.12, lam * 0.4, fw)) * (1.0 - 0.65 * smoothstep(0.06, 0.4, fw));
      ampSum += A;
    }
    // Wind patches: rough, darker ruffled water beside glassy calm stretches, drifting slowly.
    gWind = smoothstep(0.28, 0.78, vnoise(p * 0.012 + vec2(t * 0.004, t * 0.003)) * 0.65 + vnoise(p * 0.031 - vec2(t * 0.006, 0.0)) * 0.35);
    // A slow large-scale warp keeps the ripple layers from drifting in straight lines.
    vec2 warp = vec2(vnoise(p * 0.045 + vec2(t * 0.012, 0.0)), vnoise(p * 0.045 + vec2(5.2, -t * 0.01))) * 6.0;
    float ra = 0.32 * amp * mix(0.35, 1.7, gWind);
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
    // Broad, slow undulations that stay visible zoomed right out (no period, no rows).
    vec3 m1 = vnoised(p * 0.07 + vec2(t * 0.02, -t * 0.015));
    vec3 m2 = vnoised(p * 0.16 + vec2(-t * 0.03, t * 0.02) + 3.3);
    g += m1.xy * 0.07 * 0.85 + m2.xy * 0.16 * 0.22;
    return h;
  }
  void main() {
    vec2 uv = (vW.xz + uWorld * 0.5) / uWorld;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec4 hr = texture2D(uHeight, clamp(uv, 0.0, 1.0));
    float bed = mix(-7.0, hr.r, inside);
    float t = uTime;
    vec2 p = vW.xz;
    // ---- Surf ----
    // Waves roll in over the shallows along the depth contours, arriving at different moments
    // along the coast, every third or so bigger; each one washes up the sand, then drains back.
    float cd0 = max(-bed, 0.0);
    float along = vnoise(p * 0.055) * 2.8 + vnoise(p * 0.16 + 4.0) * 0.8;
    float surfP = t * 1.2 + along * 3.14159;
    float setK = 0.72 + 0.28 * sin(surfP * 0.34 + along * 1.7);
    // Distance to the nearest land (blue channel): surf lines run parallel to the coast.
    float sd = hr.b;
    float surfZone = (1.0 - smoothstep(2.6, 5.5, sd)) * inside * uSwash;
    float fSw = fract((surfP - 1.5708) / TAU);
    float runup = smoothstep(0.0, 0.16, fSw) * (1.0 - smoothstep(0.28, 0.92, fSw));
    float level = mix(vW.y, -0.03 + (uSurface + 0.03) * runup * setK, uSwash * inside);
    float wet = 0.0;
    if (bed > level && uSwash > 0.5 && inside > 0.5) {
      // Above the water line: sand the last wave reached stays dark and glossy for a moment.
      float reach = -0.03 + (uSurface + 0.03) * setK * 0.95;
      wet = (bed < reach ? 1.0 : 0.0) * (1.0 - smoothstep(0.3, 1.0, fSw)) * smoothstep(0.1, 0.3, fSw + 0.2);
      if (wet < 0.02) discard;
    }
    float depth = max(level - bed, 0.0) + uDeepen;
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
    float cdepth = max(level - mix(-7.0, (bs / 6.0) * 0.6 + hr.r * 0.4, inside), 0.0) + uDeepen;
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
    // Ruffled wind patches read slightly darker and bluer than the glassy calms.
    col *= mix(1.04, 0.93, gWind * smoothstep(1.5, 4.0, cdepth));

    float dayK = mix(0.3, 1.0, uDay);
    float ndl = max(dot(n, L), 0.0);
    vec3 lit = col * (0.78 + 0.22 * ndl) * mix(vec3(1.0), uSunCol, 0.15) * dayK;
    // Gentle light through the swell tops (every pow() base is clamped to 0..1: pow of a tiny negative
    // rounding error is NaN on some GPUs, and one NaN pixel turns the whole frame black once bloom spreads it).
    float back = pow(clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0), 3.0);
    float crestK = smoothstep(0.35, 0.75, vnoise(p * 0.09 + vec2(t * 0.03, 0.0)) * 0.7 + gWind * 0.5);
    lit += vec3(0.03, 0.16, 0.18) * clamp(crest, 0.0, 1.0) * (0.3 + back) * dayK * smoothstep(0.8, 3.0, depth) * 0.55 * crestK;

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

    // Shoreline: a white lip that follows the swash up and down the sand.
    float fn = vnoise(p * 1.1 + t * 0.12);
    // Thickest as a wave surges up the sand, thinning as it drains away.
    float surge = smoothstep(0.0, 0.12, fSw) * (1.0 - smoothstep(0.2, 0.55, fSw)) * setK * uSwash;
    float shore = 1.0 - smoothstep(0.0, 0.05 + 0.06 * fn + 0.16 * surge, depth);
    // Rolling surf lines: a lighter hump out in the shallows that steepens and breaks into
    // foam as it nears the beach.
    float line = pow(clamp(0.5 + 0.5 * sin(sd * 3.6 + surfP), 0.0, 1.0), 4.0) * surfZone * setK;
    float breaking = 1.0 - smoothstep(0.3, 2.2, sd);
    lit += vec3(0.14, 0.24, 0.24) * line * (1.0 - breaking) * dayK;
    // The steep face in front of each wave sits in its own shadow.
    float trough = pow(clamp(0.5 + 0.5 * sin(sd * 3.6 + surfP + 1.1), 0.0, 1.0), 6.0) * surfZone * setK;
    lit *= 1.0 - 0.16 * trough * (0.4 + breaking);
    float surfFoam = line * mix(0.3, 1.0, breaking) * smoothstep(0.08, 0.42, vnoise(p * 3.1 + vec2(t * 0.4, -t * 0.25)) * 0.8 + breaking * 0.3) * 1.35;
    // The foam left behind as a wave drains back down the beach.
    float backwash = (1.0 - smoothstep(0.0, 0.18, depth)) * smoothstep(0.3, 0.6, fSw) * (1.0 - smoothstep(0.6, 0.95, fSw)) * uSwash
                   * smoothstep(0.45, 0.75, vnoise(p * 4.5 + vec2(0.0, t * 0.3)));
    // The old gentle ripples on rivers and pools.
    float bandMask = (1.0 - smoothstep(0.08, 0.5, depth)) * (1.0 - uSwash);
    float bands = smoothstep(0.7, 0.97, sin(depth * 11.0 - t * 1.1 + fn * 3.0) * 0.5 + 0.5) * bandMask;
    float rock = hr.g * (0.55 + 0.35 * sin(t * 1.4 + fn * 5.0) + 0.4 * line);
    float foam = clamp(shore * 0.9 + bands * 0.4 + rock * 0.85 + surfFoam * 0.95 + backwash * 0.6, 0.0, 1.0);
    foam *= smoothstep(0.2, 0.5, vnoise(p * 2.6 + vec2(t * 0.3, -t * 0.2)) + shore * 0.8 + rock * 0.4 + surfFoam * 1.6);
    foam *= inside;
    lit = mix(lit, cFoam * mix(0.3, 1.05, uDay), foam);

    // Deep water stays slightly translucent so whales, rays and fish schools show beneath the surface.
    float alpha = mix(0.22, 0.6, smoothstep(0.0, 0.9, cdepth));
    alpha = mix(alpha, 0.64, smoothstep(0.9, 3.6, cdepth));
    alpha = max(alpha, foam);
    // Wet sand just above the water line: a thin dark gloss, no water colour.
    if (wet > 0.0) {
      lit = mix(vec3(0.3, 0.27, 0.2), skyR * 0.6, 0.25) * dayK;
      alpha = 0.3 * wet;
    }
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
    vec3 glass = vec3(0.2, 0.68, 0.8);
    vec3 white = vec3(0.95, 0.99, 1.0);
    vec3 col = mix(glass, white, clamp(aer * 0.42 + streak * 0.22 + smoothstep(0.82, 1.0, v) * 0.4 - 0.06, 0.0, 1.0));
    // Faceted vertical bands, as if the sheet of water were cut into flat strips.
    float band = hsh(vec2(floor(u * 11.0 + sin(v * 3.0) * 0.4), uLayer));
    col *= 0.86 + 0.18 * band + 0.08 * streak;
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

/**
 * The waterfall's plunge pool: clear turquoise, a pale sandy shallow rim shading to deep teal in
 * the middle, with slowly drifting faceted ripple cells and a bright water line at the edge.
 * Partly see-through so the rocks on the bottom show.
 */
const poolFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uDay;
  uniform float uR;
  varying vec2 vUv;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hsh2(vec2 p){ return vec2(hsh(p), hsh(p + 17.31)); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float ang = atan(q.y, q.x);
    float r = length(q) + (vnoise(vec2(ang * 2.2, 3.0)) - 0.5) * 0.14 + (vnoise(vec2(ang * 7.0, 9.0)) - 0.5) * 0.05;
    if (r > 1.0) discard;
    float depth = 1.0 - smoothstep(0.3, 0.98, r);
    // Linear colours (the output is converted to sRGB): sandy shallows, turquoise, deep teal.
    vec3 shallow = vec3(0.34, 0.62, 0.45);
    vec3 mid = vec3(0.012, 0.45, 0.55);
    vec3 deep = vec3(0.004, 0.16, 0.3);
    vec3 col = mix(shallow, mid, smoothstep(0.0, 0.42, depth));
    col = mix(col, deep, smoothstep(0.5, 1.0, depth));
    // Faceted ripple cells drifting slowly (Voronoi): each cell a slightly different shade.
    vec2 pc = q * uR * 0.9 + vec2(uTime * 0.05, -uTime * 0.035);
    vec2 cell = floor(pc);
    float f1 = 9.0, f2 = 9.0; vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = cell + vec2(float(i), float(j));
      vec2 o = hsh2(g);
      o = 0.5 + 0.35 * sin(uTime * 0.6 + 6.2831 * o);
      float d = length(g + o - pc);
      if (d < f1) { f2 = f1; f1 = d; id = g; } else if (d < f2) f2 = d;
    }
    col *= 0.9 + hsh(id) * 0.16;
    float line = 1.0 - smoothstep(0.0, 0.07, f2 - f1);
    col = mix(col, vec3(0.35, 0.82, 0.88), line * 0.06);
    // Bright water line against the rim.
    float rim = smoothstep(0.9, 0.99, r);
    col = mix(col, vec3(0.85, 0.95, 0.9), rim * 0.35);
    float a = mix(0.58, 0.9, depth);
    a = max(a, rim * 0.8);
    gl_FragColor = vec4(col * mix(0.3, 1.0, uDay), a);
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
  readonly canalMat: THREE.ShaderMaterial;
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
    this.heightF = new Float32Array(this.res * this.res);
    this.shoreD = new Float32Array(this.res * this.res);
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
    const make = (flow: number, deepen = 0) =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...this.shared,
          ...colorUniforms(),
          uHeight: { value: this.heightTex },
          uFlow: { value: flow },
          uDeepen: { value: deepen },
          uSwash: { value: 0 },
          uSurface: { value: SEA_SURFACE },
        },
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        fog: true,
        depthWrite: true,
      });
    this.oceanMat = make(0);
    this.oceanMat.uniforms.uSwash.value = 1;
    this.riverMat = make(1);
    this.canalMat = make(0.4, 0.7);

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize, 1, 1).rotateX(-Math.PI / 2), this.oceanMat);
    ocean.name = 'ocean';
    ocean.position.y = SEA_SURFACE;
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
    this.setCanals();
  }

  private canalMesh: THREE.Mesh | null = null;

  /** Rebuild the water surface of all player-dug canals (one quad per channel cell). */
  setCanals(): void {
    const w = this.world;
    const N = w.N;
    const pos: number[] = [], idx: number[] = [];
    let n = 0;
    for (let i = 0; i < N * N; i++) {
      if (!w.canal[i]) continue;
      if (Number.isNaN(w.riverY[i])) continue;
      const cx = i % N, cz = (i / N) | 0;
      const x = w.centerX(cx), z = w.centerZ(cz);
      // Sit just below the lowest bank (so it never floats over the land) and above the bed.
      let bank = Infinity;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!w.inBounds(cx + ox, cz + oz)) continue;
        const j = w.idx(cx + ox, cz + oz);
        if (w.canal[j] || w.layer[j] <= 0 || !Number.isNaN(w.riverY[j])) continue;
        bank = Math.min(bank, w.heightAt(w.centerX(cx + ox), w.centerZ(cz + oz)));
      }
      const bed = w.heightAt(x, z);
      const y = Math.max(bed + 0.1, Math.min(w.riverY[i], bank - 0.08));
      const h = 0.53;
      pos.push(x - h, y, z - h, x + h, y, z - h, x + h, y, z + h, x - h, y, z + h);
      idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
      n += 4;
    }
    if (this.canalMesh) {
      this.group.remove(this.canalMesh);
      this.canalMesh.geometry.dispose();
      this.canalMesh = null;
    }
    if (!n) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.canalMesh = new THREE.Mesh(g, this.canalMat);
    this.canalMesh.renderOrder = 11;
    this.canalMesh.name = 'canals';
    this.group.add(this.canalMesh);
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
        const h = w.heightAt(x, z);
        this.heightF[j * r + i] = h;
        this.heightData[k] = toH(h);
        this.heightData[k + 1] = toH(w.sampleField(w.foam, x, z));
        this.heightData[k + 3] = toH(1);
      }
    }
    this.shoreDistance();
    this.heightTex.needsUpdate = true;
  }

  private heightF = new Float32Array(0);
  private shoreD = new Float32Array(0);

  /**
   * Distance from each water texel to the nearest land, in world units (blue channel), so surf
   * lines can roll in parallel to the real coastline even over flat shelves. Two-pass chamfer
   * distance transform, then a light blur so the contours curve smoothly.
   */
  private shoreDistance(): void {
    const r = this.res;
    const H = this.heightF, D = this.shoreD;
    const BIG = 1e6;
    for (let i = 0; i < r * r; i++) D[i] = H[i] > 0 ? 0 : BIG;
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < r; i++) {
        const k = j * r + i;
        let v = D[k];
        if (v === 0) continue;
        if (i > 0) v = Math.min(v, D[k - 1] + a);
        if (j > 0) {
          v = Math.min(v, D[k - r] + a);
          if (i > 0) v = Math.min(v, D[k - r - 1] + b);
          if (i < r - 1) v = Math.min(v, D[k - r + 1] + b);
        }
        D[k] = v;
      }
    }
    for (let j = r - 1; j >= 0; j--) {
      for (let i = r - 1; i >= 0; i--) {
        const k = j * r + i;
        let v = D[k];
        if (v === 0) continue;
        if (i < r - 1) v = Math.min(v, D[k + 1] + a);
        if (j < r - 1) {
          v = Math.min(v, D[k + r] + a);
          if (i < r - 1) v = Math.min(v, D[k + r + 1] + b);
          if (i > 0) v = Math.min(v, D[k + r - 1] + b);
        }
        D[k] = v;
      }
    }
    const toH = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < r; i++) {
        // 3x3 blur (texels → world units: two texels per unit), capped far out at sea.
        let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= r || jj >= r) continue;
          sum += Math.min(D[jj * r + ii], 40);
          n++;
        }
        this.heightData[(j * r + i) * 4 + 2] = toH((sum / n) * 0.5);
      }
    }
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
      const R = f.poolR + 1.4;
      const poolMat = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.shared.uTime, uDay: this.shared.uDay, uR: { value: R } },
        vertexShader: fallVert,
        fragmentShader: poolFrag,
        transparent: true,
        depthWrite: false,
        fog: true,
      });
      const pool = new THREE.Mesh(new THREE.CircleGeometry(R, 56).rotateX(-Math.PI / 2), poolMat);
      pool.position.set(f.x + f.dx * (f.poolR + 1.2), f.poolY + 0.004, f.z + f.dz * (f.poolR + 1.2));
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
    curtain(2.5, 0.3, 0.8, 0);
    curtain(1.7, 0.22, 1.05, 1);
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

    // Rock setting (after the reference art): tall faceted columns stepping up either side of the
    // fall, a rock face behind the curtain, blocks round the pool and stones on its bed, with
    // moss on the crowns and ferns, bushes and vines growing on the ledges.
    const rng = new RNG(this.world.seed * 17 + 5);
    const b = new GeoBuilder();
    const plants = new GeoBuilder();
    const leafy: THREE.BufferGeometry[] = [];
    const H0 = f.topY - f.poolY;
    const at = (a: number, l: number): [number, number] => [f.x + px * a + f.dx * l, f.z + pz * a + f.dz * l];
    /** A rock: across / along the fall, base height, size (across, height, along), turn, moss. */
    const rock = (a: number, l: number, y0: number, w: number, h: number, d: number, turn = 0, moss = 0.55, wet = f.poolY + 0.08) => {
      const [x, z] = at(a, l);
      b.add(angularRockGeometry(Math.floor(rng.next() * 1e6)), { color: rockColor(moss, wet), ao: { y0: y0 - 0.2, y1: y0 + h * 0.6, min: 0.6 } }, M.t(x, y0, z, 0, yaw + turn, 0, w / 2, h, d / 2));
      return { x, z, top: y0 + h * 1.02, w, d };
    };
    const ledges: { x: number; z: number; top: number; w: number; d: number; face: number }[] = [];
    for (const s of [-1, 1]) {
      const add = (r: ReturnType<typeof rock>, face = 1) => ledges.push({ ...r, face });
      // Tall columns flanking the fall, stepping back and up.
      add(rock(s * 1.6, -0.1, f.poolY - 0.5, 1.4, H0 + 0.8, 1.6, rng.range(-0.3, 0.3), 0.6));
      add(rock(s * 2.65, -1.0, f.poolY + 0.1, 1.9, H0 + 1.25, 1.9, rng.range(-0.3, 0.3), 0.6));
      add(rock(s * 4.4, -0.6, f.poolY + 0.4, 1.9, H0 * 0.8 + 0.5, 1.7, rng.range(-0.4, 0.4), 0.65));
      // A lower step down toward the pool, and a block sitting in its edge.
      add(rock(s * 3.5, 0.9, f.poolY - 0.4, 1.7, H0 * 0.55, 1.6, rng.range(-0.4, 0.4), 0.6));
      add(rock(s * 3.3, 2.7, f.poolY - 0.45, 1.5, 1.15, 1.4, rng.range(-0.6, 0.6), 0.5));
      // Stones framing the lip, and the ones the river splits round before the drop.
      rock(s * 1.2, 0.05, f.topY - 0.55, 0.85, 0.8, 0.9, rng.range(-0.5, 0.5), 0.75, f.topY - 0.2);
      rock(s * 0.72, -1.05, f.topY - 0.38, 0.55, 0.5, 0.6, rng.range(-0.5, 0.5), 0.4, f.topY - 0.1);
    }
    // Rock face behind the curtain, so the water falls against stone.
    rock(0, -0.6, f.poolY - 0.45, 2.7, H0 + 0.1, 1.0, 0, 0.3);
    // Pool: stones on the bed and a couple breaking the surface, blocks and pebbles round the rim.
    const pc = at(0, f.poolR + 1.2);
    const R = f.poolR + 1.4;
    rock(-1.7, 3.7, f.poolY - 0.5, 1.0, 0.62, 0.9, rng.next() * 3, 0.35);
    rock(2.0, 4.9, f.poolY - 0.5, 1.1, 0.68, 1.0, rng.next() * 3, 0.35);
    for (const [a, l, w] of [[0.5, 5.5, 0.9], [-1.1, 2.8, 0.8], [1.4, 6.7, 0.7], [-2.3, 6.0, 0.8]] as const) rock(a, l, f.poolY - 0.62, w, 0.38, w * 0.9, rng.next() * 3, 0);
    for (const deg of [55, 80, 105, 135, 225, 255, 280, 305]) {
      const ang = (deg * Math.PI) / 180;
      const rr = R * rng.range(0.92, 1.08);
      const a = Math.sin(ang) * rr, l = f.poolR + 1.2 + Math.cos(ang) * rr;
      const big = rng.chance(0.45);
      const [x, z] = at(a, l);
      const g0 = Math.min(this.world.heightAt(x, z), f.poolY + 0.3);
      const w = big ? rng.range(0.9, 1.3) : rng.range(0.45, 0.7);
      rock(a, l, g0 - 0.15, w, big ? rng.range(0.6, 0.95) : rng.range(0.3, 0.45), w * rng.range(0.8, 1.1), rng.next() * 3, 0.5);
    }
    void pc;
    // Plants on the ledges: ferns and bushes on the crowns, vines hanging down the faces.
    const fern = fernGeometry(false, 31), bush = bushGeometry(false, false, 41), flower = bushGeometry(true, false, 42);
    const vine = new THREE.Color(0x4c702f), vineLeaf = new THREE.Color(0x7aa83f);
    for (const L of ledges) {
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const ox = rng.range(-0.35, 0.35) * L.w, oz = rng.range(-0.35, 0.35) * L.d;
        const g = rng.chance(0.5) ? fern : rng.chance(0.7) ? bush : flower;
        const sc = g === fern ? rng.range(0.8, 1.3) : rng.range(0.55, 0.8);
        leafy.push(g.clone().applyMatrix4(M.t(L.x + ox, L.top - 0.06, L.z + oz, 0, rng.next() * 6.28, 0, sc)));
      }
      // Vines down the face turned toward the pool.
      for (let v = 0; v < rng.int(1, 3); v++) {
        const off = rng.range(-0.4, 0.4) * L.w;
        const top = new THREE.Vector3(L.x + f.dx * L.d * 0.42 + px * off, L.top - 0.05, L.z + f.dz * L.d * 0.42 + pz * off);
        hangingVine(plants, top, rng.range(0.6, Math.min(2.2, L.top - f.poolY)), rng, vine, vineLeaf);
      }
    }
    const rocks = new THREE.Mesh(b.build(), stylisedMaterial());
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    rocks.name = 'waterfallRocks';
    this.group.add(rocks);
    const green = new THREE.Mesh(mergeGeometries([plants.build(), ...leafy])!, treeMaterial());
    green.castShadow = true;
    green.receiveShadow = true;
    green.name = 'waterfallPlants';
    this.group.add(green);

    // Spray droplets thrown up in arcs and soft mist rolling downstream.
    this.spray = new Particles(520, 0xf4fcff);
    this.fallMist = new Particles(160, 0xeef8ff, 0.32);
    this.group.add(this.spray.points, this.fallMist.points);
  }

  /** Waves at a point in world space (used for boats bobbing). */
  waveHeight(x: number, z: number, t: number): number {
    // The four longest of the shader's swells, at their average strength (the rest are too small
    // to move a boat; the crest bending and wave groups are left out).
    const amp = 1 + this.shared.uStorm.value * 1.7;
    let h = 0;
    for (let i = 0; i < 4; i++) {
      const lam = SWELL_L[i];
      const ang = 0.62 + SWELL_A[i];
      const k = (Math.PI * 2) / lam;
      const w = Math.sqrt(9.8 * k) * 0.55;
      h += lam * 0.0105 * amp * Math.sin((Math.cos(ang) * x + Math.sin(ang) * z) * k + t * w + i * 1.93);
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
