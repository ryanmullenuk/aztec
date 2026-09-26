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
};

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
          outgoingLight += uSunCol * rimF * upF * uRim * 0.18 * uSunI * (0.4 + 0.6 * vLeaf);
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
