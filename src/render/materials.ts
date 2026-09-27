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
function patchSeeThrough(mat: THREE.MeshStandardMaterial, key: string): THREE.MeshStandardMaterial {
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
          if (seeBayer(gl_FragCoord.xy) < inTube * uCut * 0.62) discard;
        }`
      );
  };
  mat.customProgramCacheKey = () => key;
  return mat;
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
export function peopleMaterial(): THREE.MeshStandardMaterial {
  if (people) return people;
  const mat = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 }), 0.45);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    base.call(mat, shader, r);
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
  };
  people = mat;
  return mat;
}

/**
 * Fish material: the stylised patches plus a swimming body bend. Each vertex's `aFish`
 * attribute (from fishGeometry) gives its sideways swing (growing toward the tail), a fin-flap
 * weight for the pectoral fins, and a phase so the bend travels down the body as a wave.
 * Each instance swims out of step with the others (phase from its position).
 */
export function fishMaterial(rate: number, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
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
  };
  mat.customProgramCacheKey = () => 'fish';
  return mat;
}
