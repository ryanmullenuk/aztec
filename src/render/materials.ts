import * as THREE from 'three';

/** Uniforms shared by every patched material, updated once per frame. */
export const FX = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  /** Sun direction in view space (towards the sun). */
  uSunView: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 0.85, 0.6) },
  uSunI: { value: 3 },
  /** 0..1 night factor, for emissive torch flames. */
  uNight: { value: 0 },
  /** Camera and look-at point, and how zoomed in the view is (0 far → 1 close), for fading trees in the way. */
  uCamPos: { value: new THREE.Vector3() },
  uFocus: { value: new THREE.Vector3() },
  uCut: { value: 0 },
};

/**
 * Trees that stand between the camera and what it's looking at dither to semi-transparent,
 * but only when zoomed in (fully solid when zoomed out).
 */
function patchSeeThrough(mat: THREE.MeshStandardMaterial, key: string, amount = 0.62): THREE.MeshStandardMaterial {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.uniforms.uCamPos = FX.uCamPos;
    shader.uniforms.uFocus = FX.uFocus;
    shader.uniforms.uCut = FX.uCut;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSeeW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 sw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            sw = instanceMatrix * sw;
          #endif
          vSeeW = (modelMatrix * sw).xyz;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uCamPos; uniform vec3 uFocus; uniform float uCut; varying vec3 vSeeW;
        float seeBayer(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          float a = mod(q.x + q.y * 2.0, 4.0), b = mod(q.x * 2.0 + q.y * 3.0, 4.0);
          return (a * 4.0 + b + 0.5) / 16.0;
        }`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        if (uCut > 0.01) {
          vec3 ab = uFocus - uCamPos;
          float L = length(ab);
          vec3 dir = ab / L;
          vec3 ap = vSeeW - uCamPos;
          float s = dot(ap, dir);
          float r = length(ap - dir * s);
          float inTube = (1.0 - smoothstep(2.6, 4.4, r)) * step(0.0, s) * (1.0 - smoothstep(L - 0.5, L + 1.5, s));
          if (seeBayer(gl_FragCoord.xy) < inTube * uCut * ${amount.toFixed(2)}) discard;
        }`
      );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

let canopy: THREE.MeshStandardMaterial | null = null;
/**
 * Canopy roofs (the Great Hall): like trees, they dither away where they stand between the camera
 * and what it looks at when zoomed in, but more strongly, so the people under them show.
 */
export function canopyMaterial(): THREE.MeshStandardMaterial {
  if (!canopy) canopy = patchSeeThrough(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })), 'canopy', 0.88);
  return canopy;
}

let tree: THREE.MeshStandardMaterial | null = null;
/** Stylised material for trees, with the see-through effect when zoomed in. */
export function treeMaterial(): THREE.MeshStandardMaterial {
  if (!tree) tree = patchSeeThrough(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })), 'tree');
  return tree;
}
let treeDouble: THREE.MeshStandardMaterial | null = null;
export function treeMaterialDouble(): THREE.MeshStandardMaterial {
  if (!treeDouble) treeDouble = patchSeeThrough(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide })), 'tree-double');
  return treeDouble;
}

/**
 * Patches a MeshStandardMaterial with:
 *  - wind sway driven by the `aVeg.x` attribute (0 = rigid),
 *  - sunlight glowing through foliage from behind (`aVeg.y` = leaf flag),
 *  - a warm rim light on the tops of shapes (tree crowns, thatch, rock tops).
 */
export function patchStylised(mat: THREE.MeshStandardMaterial, rim = 0.35): THREE.MeshStandardMaterial {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FX);
    shader.uniforms.uRim = { value: rim };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aVeg;
        uniform float uTime;
        uniform float uWind;
        varying float vLeaf;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vLeaf = aVeg.y;
        if (aVeg.x > 0.0) {
          #ifdef USE_INSTANCING
            vec3 org = instanceMatrix[3].xyz;
          #else
            vec3 org = modelMatrix[3].xyz;
          #endif
          float ph = org.x * 0.21 + org.z * 0.17;
          float s = aVeg.x * uWind;
          transformed.x += (sin(uTime * 1.5 + ph) * 0.07 + sin(uTime * 3.3 + ph * 2.3) * 0.022) * s;
          transformed.z += (cos(uTime * 1.2 + ph * 1.3) * 0.05 + sin(uTime * 2.7 + ph) * 0.018) * s;
          transformed.y += sin(uTime * 2.1 + ph) * 0.012 * s;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSunView;
        uniform vec3 uSunCol;
        uniform float uSunI;
        uniform float uRim;
        varying float vLeaf;`
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 Vv = normalize(vViewPosition);
          // Sun behind the foliage relative to the viewer: light glows through.
          float back = pow(clamp(dot(-Vv, uSunView), 0.0, 1.0), 3.0);
          float wrap = clamp(0.5 - dot(normal, uSunView) * 0.5, 0.0, 1.0);
          outgoingLight += diffuseColor.rgb * uSunCol * uSunI * vLeaf * (back * 0.35 + wrap * 0.06);
          // Warm rim on top edges.
          float rimF = pow(1.0 - clamp(dot(normal, Vv), 0.0, 1.0), 3.0);
          float upF = clamp(dot(normal, uSunView) * 0.5 + 0.5, 0.0, 1.0);
          // Foliage gets a softer rim tinted by its own green, so sunlit crowns stay leafy instead of
          // washing out pale.
          vec3 rimCol = mix(uSunCol, uSunCol * diffuseColor.rgb * 2.2, vLeaf * 0.7);
          outgoingLight += rimCol * rimF * upF * uRim * 0.18 * uSunI * (0.5 - 0.25 * vLeaf);
        }
        #include <opaque_fragment>`
      );
  };
  return mat;
}

let shared: THREE.MeshStandardMaterial | null = null;
/** The one material used by all merged, vertex-coloured models (vegetation, rocks, buildings, creatures). */
export function stylisedMaterial(): THREE.MeshStandardMaterial {
  if (!shared) {
    shared = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  }
  return shared;
}

/**
 * Procedural surface "skin" for building meshes, keyed off the vertex colour and world-space
 * position / normal so adobe, stone, timber and thatch read as hand-made:
 *  - all surfaces: two-scale blotchy value noise (grime), faint rain streaks on walls, and a soft
 *    darkening near the building's base (base height = the mesh's model-matrix origin, which for
 *    building meshes sits on the ground);
 *  - warm, light adobe walls: running-bond mud-brick courses (0.16 x 0.08) with thin mortar and a
 *    per-brick tint, partly covered by irregular smooth mud-plaster patches;
 *  - pale plaster / cream: mostly plastered, with faint brick courses showing through;
 *  - grey stone: chunkier block joints on walls (0.3 x 0.18) and flagstones on tops, plus speckle;
 *  - thatch (the aVeg leaf flag 0.2, or straw colours): fine striations down the slope;
 *  - timber browns: faint grain.
 * Fine detail fades out with camera distance and screen-space texel size to avoid moiré.
 * All tuning is in perceptual (≈sRGB) terms and converted to a linear multiplier at the end.
 */
function patchBuilding(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBldW;\nvarying vec3 vBldN;\nvarying float vBldBase;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 bw = vec4(transformed, 1.0);
          vec3 bn = objectNormal;
          #ifdef USE_INSTANCING
            bw = instanceMatrix * bw;
            bn = mat3(instanceMatrix) * bn;
            vBldBase = (modelMatrix * instanceMatrix[3]).y;
          #else
            vBldBase = modelMatrix[3].y;
          #endif
          vBldW = (modelMatrix * bw).xyz;
          vBldN = mat3(modelMatrix) * bn;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBldW;
        varying vec3 vBldN;
        varying float vBldBase;
        float bHash(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float bNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(bHash(i), bHash(i + vec2(1.0, 0.0)), u.x), mix(bHash(i + vec2(0.0, 1.0)), bHash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        // Staggered block courses: x = mortar coverage (0..1), y = per-block random, z = distance to nearest joint.
        vec3 bBlocks(vec2 p, vec2 size, float jitter, float mortarW, float pw) {
          vec2 q = p / size;
          float row = floor(q.y);
          q.x += fract(row * 0.5) + (bHash(vec2(row, 7.13)) - 0.5) * jitter;
          vec2 id = floor(q);
          vec2 f = fract(q);
          vec2 e = min(f, 1.0 - f) * size;
          float d = min(e.x, e.y);
          return vec3(1.0 - smoothstep(mortarW, mortarW + pw * 1.5, d), bHash(id + vec2(3.7, 11.1)), d);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 bc = diffuseColor.rgb;
          vec3 sc = pow(max(bc, vec3(0.0)), vec3(1.0 / 2.2));
          float mx = max(sc.r, max(sc.g, sc.b)), mn = min(sc.r, min(sc.g, sc.b));
          float sat = (mx - mn) / max(mx, 1e-3);
          float val = mx;
          // 0 = red .. 1 = yellow, meaningful for warm colours (r >= g >= b).
          float hueW = clamp((sc.g - sc.b) / max(sc.r - sc.b, 1e-3), 0.0, 1.0);
          float warm = step(sc.b, sc.g) * step(sc.g, sc.r);

          vec3 n = normalize(vBldN);
          float ny = abs(n.y);
          float wallW = 1.0 - smoothstep(0.4, 0.55, ny);
          float topW = smoothstep(0.85, 0.95, n.y);
          // Horizontal tangent of the face, so courses run along any wall (and down any roof slope).
          float nl = length(n.xz);
          vec2 tH = nl > 1e-3 ? vec2(-n.z, n.x) / nl : vec2(1.0, 0.0);
          float uT = dot(vBldW.xz, tH);
          vec2 suv = ny > 0.55 ? vBldW.xz : vec2(uT, vBldW.y);

          // Detail fades: distance to camera, and the world size of a screen pixel.
          float pw = max(length(dFdx(vBldW)), length(dFdy(vBldW)));
          float dFade = 1.0 - smoothstep(15.0, 45.0, length(vBldW - cameraPosition));
          float fadeFine = dFade * (1.0 - smoothstep(0.012, 0.03, pw));
          float fadeStone = dFade * (1.0 - smoothstep(0.02, 0.05, pw));
          float fadeMicro = dFade * (1.0 - smoothstep(0.007, 0.018, pw));

          // Leave foliage (crops, potted plants) alone.
          float wAll = 1.0 - smoothstep(0.5, 0.9, vLeaf);

          // Material classes from the vertex colour.
          float thatchFlag = step(0.05, vLeaf) * (1.0 - step(0.6, vLeaf));
          float thatchW = max(thatchFlag, warm * smoothstep(0.53, 0.58, hueW) * smoothstep(0.38, 0.45, sat) * smoothstep(0.5, 0.58, val) * (1.0 - step(0.97, ny)));
          float grey = 1.0 - smoothstep(0.22, 0.28, sat);
          float plasterW = grey * smoothstep(0.84, 0.9, val) * step(sc.b, sc.r);
          float stoneW = grey * smoothstep(0.4, 0.48, val) * (1.0 - smoothstep(0.82, 0.88, val));
          float adobeW = warm * (1.0 - thatchW) * smoothstep(0.72, 0.8, val) * smoothstep(0.2, 0.28, sat) * smoothstep(0.28, 0.34, hueW) * (1.0 - smoothstep(0.58, 0.64, hueW));
          float woodW = warm * (1.0 - thatchW) * (1.0 - smoothstep(0.66, 0.72, val)) * smoothstep(0.3, 0.4, sat) * smoothstep(0.12, 0.2, val);

          // Perceptual brightness multiplier.
          float n1 = bNoise(suv * 2.2 + 17.0);
          float n2 = bNoise(suv * 6.5 - 5.0);
          float m = 1.0 + ((n1 - 0.5) * 0.14 + (n2 - 0.5) * 0.07) * wAll;
          float st = bNoise(vec2(suv.x * 9.0, suv.y * 0.7));
          m *= 1.0 - smoothstep(0.62, 0.95, st) * 0.06 * wallW * wAll;
          float hb = vBldW.y - vBldBase;
          m *= mix(1.0, mix(0.84, 1.0, smoothstep(-0.02, 0.3, hb)), (wallW * 0.85 + 0.15) * wAll);
          float desat = 0.0;

          float mudW = max(adobeW, plasterW) * wAll;
          if (mudW > 0.01) {
            // Irregular mud-plaster patches over the brickwork (mostly plastered on pale walls).
            float pn = bNoise(suv * 1.7 + 3.1) * 0.65 + bNoise(suv * 4.6 - 1.7) * 0.35;
            float thr = mix(0.56, 0.40, plasterW);
            float patchM = smoothstep(thr - 0.03, thr + 0.03, pn);
            float rim = smoothstep(thr - 0.04, thr, pn) * (1.0 - smoothstep(thr, thr + 0.05, pn));
            vec2 bp = suv + (n2 - 0.5) * vec2(0.012, 0.006);
            vec3 bk = bBlocks(bp, vec2(0.16, 0.08), 0.35, 0.0045, pw);
            float bricks = wallW * fadeFine * (1.0 - patchM) * max(adobeW, plasterW * 0.45) * wAll;
            m *= 1.0 - bk.x * 0.18 * bricks;
            m *= 1.0 + (bk.y - 0.5) * 0.1 * bricks;
            m *= 1.0 - (1.0 - smoothstep(0.0, 0.018, bk.z)) * 0.04 * bricks;
            float tone = mix(0.95, 1.05, step(0.5, bNoise(suv * 0.9 + 11.0)));
            m *= mix(1.0, tone, patchM * mudW);
            m *= 1.0 - rim * 0.06 * mudW;
            desat = patchM * mudW * 0.12;
          }
          float stW = stoneW * wAll * max(wallW, topW);
          if (stW > 0.01) {
            vec2 sz = mix(vec2(0.3, 0.18), vec2(0.3, 0.26), topW);
            vec3 sb = bBlocks(suv + (n1 - 0.5) * 0.02, sz, 0.6, 0.007, pw);
            float sw = stW * fadeStone;
            m *= 1.0 - sb.x * 0.2 * sw;
            m *= 1.0 + (sb.y - 0.5) * 0.14 * sw;
            m *= 1.0 + (smoothstep(0.0, 0.05, sb.z) - 0.5) * 0.05 * sw;
            m *= 1.0 + (bNoise(suv * 22.0) - 0.5) * 0.08 * stW * fadeFine;
          }
          float thW = thatchW * wAll;
          if (thW > 0.01) {
            float s1 = bNoise(vec2(uT * 24.0, vBldW.y * 3.0));
            float s2 = bNoise(vec2((uT + vBldW.y * 0.7) * 16.0, vBldW.y * 2.0));
            float f = thW * fadeMicro;
            m *= 1.0 + ((s1 - 0.5) * 0.16 + (s2 - 0.5) * 0.08) * f;
            m *= 1.0 - smoothstep(0.7, 0.9, s1) * 0.08 * f;
          }
          float wdW = woodW * wAll;
          if (wdW > 0.01) {
            vec2 wc = ny > 0.55 ? vBldW.zx : vec2(uT, vBldW.y);
            float g1 = bNoise(vec2(wc.x * 26.0, wc.y * 1.3));
            float g2 = bNoise(vec2(wc.x * 45.0 + g1 * 3.0, wc.y * 0.8));
            m *= 1.0 + ((g1 - 0.5) * 0.12 * fadeFine + (g2 - 0.5) * 0.08 * fadeMicro) * wdW;
          }

          float lum = dot(bc, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(bc, vec3(lum), desat) * pow(max(m, 0.0), 2.2);
        }`
      );
  };
  mat.customProgramCacheKey = () => 'building';
  return mat;
}

let building: THREE.MeshStandardMaterial | null = null;
/** Stylised material for building meshes, with the hand-made surface skin (see patchBuilding). */
export function buildingMaterial(): THREE.MeshStandardMaterial {
  if (!building) building = patchBuilding(patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })));
  return building;
}

let sharedDouble: THREE.MeshStandardMaterial | null = null;
/** Double-sided variant for thin leaves and fronds. */
export function stylisedMaterialDouble(): THREE.MeshStandardMaterial {
  if (!sharedDouble) {
    sharedDouble = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  }
  return sharedDouble;
}

let glow: THREE.MeshBasicMaterial | null = null;
/** Emissive flame / torch material (bright enough to bloom). */
export function flameMaterial(): THREE.MeshBasicMaterial {
  if (!glow) {
    glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.5, 0.4), toneMapped: true, fog: true });
  }
  return glow;
}

let people: THREE.MeshStandardMaterial | null = null;
/**
 * Character material: the stylised patches plus per-instance skin tone (vertices tagged aMat = 1)
 * and per-instance accent cloth colour (aMat = 2, from the instanced `iAccent` attribute).
 */
/** Per-person skin tone (aMat 1, from the instance colour) and accent cloth (aMat 2, from iAccent). */
function peopleColours(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMat;
        attribute vec3 iAccent;`)
      .replace('#include <color_vertex>', `
        vColor = vec4(1.0);
        vColor.rgb *= color;
        float isSkin = step(0.5, aMat) * (1.0 - step(1.5, aMat));
        float isAccent = step(1.5, aMat);
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb *= mix(vec3(1.0), instanceColor.rgb, isSkin);
        #endif
        vColor.rgb *= mix(vec3(1.0), iAccent, isAccent);`);
}

function makePeopleMaterial(): THREE.MeshStandardMaterial {
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), 0.45);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base.call(mat, shader, r);
    peopleColours(shader);
  };
  return mat;
}

export function peopleMaterial(): THREE.MeshStandardMaterial {
  if (people) return people;
  people = makePeopleMaterial();
  return people;
}

/** The instanced-animal material with a night glow, for sea creatures (land animals share peopleMaterial). */
let seaLife: THREE.MeshStandardMaterial | null = null;
export function seaLifeMaterial(): THREE.MeshStandardMaterial {
  seaLife ??= patchBioGlow(makePeopleMaterial(), 'sealife', BIO_GLOW.turtle);
  return seaLife;
}

/**
 * Night-time bioluminescence on sea life: after dark a creature gives off a soft blue light, its
 * outline brightest (a Fresnel rim), so fish, rays and turtles read as glowing shapes under the
 * water and the bloom haloes them. Nothing shows by day.
 */
export const BIO_GLOW = {
  fish: { color: 0x2fa8ff, body: 0.65, rim: 1.8 },
  ray: { color: 0x3aa2ff, body: 0.45, rim: 5.0 },
  turtle: { color: 0x3fb4ff, body: 0.4, rim: 4.0 },
};
export function patchBioGlow<T extends THREE.MeshStandardMaterial>(mat: T, key: string, g: { color: number; body: number; rim: number }): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  const col = { value: new THREE.Color(g.color) };
  const k = { value: new THREE.Vector2(g.body, g.rim) };
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.uniforms.uBioNight = FX.uNight;
    shader.uniforms.uBioTime = FX.uTime;
    shader.uniforms.uBioCol = col;
    shader.uniforms.uBioK = k;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBioNight;\nuniform float uBioTime;\nuniform vec3 uBioCol;\nuniform vec2 uBioK;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float bioRim = pow(clamp(1.0 - abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
          // A slow breathing shimmer so the glow feels alive.
          float bioPulse = 0.85 + 0.15 * sin(uBioTime * 1.7 + vViewPosition.x * 3.0 + vViewPosition.y * 2.0);
          totalEmissiveRadiance += uBioCol * smoothstep(0.35, 0.85, uBioNight) * (uBioK.x + uBioK.y * bioRim) * bioPulse;
        }`);
  };
  mat.customProgramCacheKey = () => prevKey() + '|bio-' + key;
  return mat;
}

/**
 * GPU skinning for instanced characters: each instance's bone matrices are one row of
 * `bones` (4 RGBA float texels per bone, column-major), looked up by gl_InstanceID and
 * blended by the vertex's aSkinI / aSkinW (4 influences).
 */
const SKIN_COMMON = `
  attribute vec4 aSkinI;
  attribute vec4 aSkinW;
  uniform highp sampler2D uBones;
  mat4 boneMat(float b) {
    int x = int(b + 0.5) * 4;
    return mat4(texelFetch(uBones, ivec2(x, gl_InstanceID), 0), texelFetch(uBones, ivec2(x + 1, gl_InstanceID), 0),
                texelFetch(uBones, ivec2(x + 2, gl_InstanceID), 0), texelFetch(uBones, ivec2(x + 3, gl_InstanceID), 0));
  }
  mat4 skinMatrix() {
    return boneMat(aSkinI.x) * aSkinW.x + boneMat(aSkinI.y) * aSkinW.y + boneMat(aSkinI.z) * aSkinW.z + boneMat(aSkinI.w) * aSkinW.w;
  }`;

/** The people material with instanced GPU skinning (and the model's colour texture), and a matching shadow depth material. */
export function peopleSkinnedMaterial(bones: THREE.DataTexture, map: THREE.Texture | null = null, skinUv = new THREE.Vector2(0.5, 0.5)): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.78, metalness: 0 }), 0.45);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base.call(mat, shader, r);
    peopleColours(shader);
    shader.uniforms.uBones = { value: bones };
    shader.uniforms.uSkinUv = { value: skinUv };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${SKIN_COMMON}
        attribute float aHairB;
        attribute vec3 iLook;
        varying float vHairK;
        varying float vHairTone;
        varying float vBeardK;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        mat4 skinM = skinMatrix();
        objectNormal = normalize(mat3(skinM) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Boys: the beard is slimmed a little and painted as skin (below), so it reads as a chin.
        float aBeard = step(1.5, aHairB), aHair = step(0.5, aHairB);
        vBeardK = aBeard * iLook.z;
        if (vBeardK > 0.5) transformed = mix(transformed, vec3(0.0, 1.6, 0.0), 0.12);
        transformed = (skinM * vec4(transformed, 1.0)).xyz;
        vHairK = aHair * iLook.x * (1.0 - vBeardK);
        vHairTone = iLook.y;`);
    // Elders: the hair is redrawn grey (women) or white (men), keeping the texture's facet shading.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uSkinUv;
        varying float vHairK;
        varying float vHairTone;
        varying float vBeardK;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (vHairK > 0.01) {
          float hl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          float hg = vHairTone * (0.74 + 0.26 * smoothstep(0.0, 0.05, hl));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(hg, hg * 0.985, hg * 0.955), vHairK);
        }
        #ifdef USE_MAP
          if (vBeardK > 0.5) diffuseColor.rgb = texture2D(map, uSkinUv).rgb;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'people-skinned';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uBones = { value: bones };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${SKIN_COMMON}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = (skinMatrix() * vec4(transformed, 1.0)).xyz;`);
  };
  depth.customProgramCacheKey = () => 'people-skinned-depth';
  return { mat, depth };
}

/**
 * Fish material: the stylised patches plus a swimming body bend. Each vertex's `aFish`
 * attribute (from fishGeometry) gives its sideways swing (growing toward the tail), a fin-flap
 * weight for the pectoral fins, and a phase so the bend travels down the body as a wave.
 * Each instance swims out of step with the others (phase from its position).
 */
/**
 * @param surfaceY for fish seen through a water surface drawn before them: each fish takes the
 *   depth of the point where the view ray enters the water, so the water surface (which writes
 *   depth) no longer hides it, while land, trees, rocks and buildings in front of that point still
 *   do. The fish are then drawn after the water with normal depth testing.
 */
export function fishMaterial(rate: number, params: THREE.MeshStandardMaterialParameters = {}, surfaceY?: number): THREE.MeshStandardMaterial {
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, ...params }), 0.5);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base.call(mat, shader, r);
    shader.uniforms.uSwim = { value: rate };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aFish;
        uniform float uSwim;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 fo = instanceMatrix[3].xyz;
          #else
            vec3 fo = modelMatrix[3].xyz;
          #endif
          float fph = fo.x * 7.3 + fo.z * 5.1 + fo.y * 3.0;
          // Swim speed wobbles a little per fish so a school doesn't beat in unison.
          float rate = uSwim * (0.85 + 0.3 * fract(sin(fph) * 43758.5));
          float wave = sin(uTime * rate + fph - aFish.z);
          transformed.x += wave * aFish.x;
          // Pectoral fins scull: their tips swing out and back, a beat out of step with the tail.
          float flap = sin(uTime * rate * 0.7 + fph * 1.7);
          transformed.x += sign(position.x) * flap * aFish.y * 0.006;
          transformed.z += flap * aFish.y * 0.008;
        }`);
    if (surfaceY !== undefined) {
      shader.uniforms.uSurfaceY = { value: surfaceY };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n        uniform float uSurfaceY;')
        .replace('#include <project_vertex>', `#include <project_vertex>
        {
          #ifdef USE_INSTANCING
            vec4 fw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #else
            vec4 fw = modelMatrix * vec4(transformed, 1.0);
          #endif
          // Depth where the view ray enters the water (a hair nearer than the surface itself).
          vec3 ray = fw.xyz - cameraPosition;
          float tS = ray.y < -1e-4 ? clamp((uSurfaceY - cameraPosition.y) / ray.y, 0.0, 1.0) : 1.0;
          vec4 sc = projectionMatrix * viewMatrix * vec4(cameraPosition + ray * tS, 1.0);
          gl_Position.z = (sc.z / sc.w - 0.0002) * gl_Position.w;
        }`);
    }
  };
  mat.customProgramCacheKey = () => (surfaceY !== undefined ? 'fish-surface' : 'fish');
  return patchBioGlow(mat, 'fish', BIO_GLOW.fish);
}
