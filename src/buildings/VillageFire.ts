import * as THREE from 'three';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { FX } from '../render/materials';

let material: THREE.MeshBasicMaterial | undefined;
/** Faceted flame tongues and 28 drifting embers, merged into one animated draw call. */
export function villageFire(): THREE.Mesh {
  const b = new GeoBuilder();
  for (let k = 0; k < 11; k++) {
    const a = k * 2.4, inner = k > 6;
    const h = inner ? 0.8 + (k % 3) * 0.16 : 1.1 + (k % 4) * 0.22;
    const r = inner ? 0.12 : 0.22;
    const g = new THREE.ConeGeometry(r, h, 5, 4);
    g.translate(0, h / 2, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / h;
      p.setX(i, p.getX(i) + Math.sin(y * 5 + k) * y * 0.13);
      p.setZ(i, p.getZ(i) + Math.cos(y * 4 + k) * y * 0.09);
    }
    b.add(g, { color: new THREE.Color(inner ? 3.8 : 2.8, inner ? 2.8 : 0.85 + (k % 3) * 0.25, inner ? 0.55 : 0.06), sway: k * 0.7 },
      M.t(Math.cos(a) * (inner ? 0.09 : 0.2), 0, Math.sin(a) * (inner ? 0.09 : 0.2)));
    g.dispose();
  }
  for (let k = 0; k < 28; k++) {
    b.add(P.sphere(0.012 + (k % 4) * 0.004, 0), { color: new THREE.Color(3.6, 1.4 + (k % 3) * 0.4, 0.12), mat: 1, sway: k / 28 }, M.t(0, 0, 0, 0, k, 0, 0.65, 1.5, 0.65));
  }
  if (!material) {
    material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, fog: true });
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = FX.uTime;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute vec2 aVeg;
        attribute float aMat;`);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aMat > 0.5) {
          float life = fract(uTime * (0.22 + aVeg.x * 0.12) + aVeg.x);
          float angle = aVeg.x * 57.0 + life * 3.0;
          transformed *= sin(life * 3.14159);
          transformed += vec3(cos(angle) * (0.1 + life * 0.45) + life * life * 0.3,
            0.7 + life * 2.1, sin(angle) * (0.1 + life * 0.4));
        } else {
          float height = position.y;
          transformed.x += sin(uTime * 4.6 + height * 4.0 + aVeg.x) * height * 0.065;
          transformed.z += cos(uTime * 3.7 + height * 3.0 + aVeg.x) * height * 0.05;
          transformed.y *= 0.94 + sin(uTime * 6.0 + aVeg.x) * 0.09;
        }`);
    };
    material.customProgramCacheKey = () => 'village-fire-v1';
  }
  const geo = b.build();
  // Include shader-displaced embers in culling bounds.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 2);
  return new THREE.Mesh(geo, material);
}
