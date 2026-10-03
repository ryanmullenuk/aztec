import * as THREE from 'three';
import { WORLD } from '../config';
import { RNG } from '../world/rng';

/** Fine rain across the whole map, animated on the GPU in a single draw call. */
export class RainField {
  readonly lines: THREE.LineSegments;
  private motion = { value: new THREE.Vector2() };
  constructor() {
    const rng = new RNG(882391), count = 9600;
    const positions = new Float32Array(count * 6), tails = new Float32Array(count * 2);
    const lengths = new Float32Array(count * 2);
    // Stratified coverage prevents random holes in the weather when viewed from above.
    const columns = 100, rows = 96, span = WORLD.size + 24;
    for (let i = 0; i < count; i++) {
      const x = ((i % columns + rng.next()) / columns - 0.5) * span;
      const z = ((Math.floor(i / columns) + rng.next()) / rows - 0.5) * span;
      const y = rng.range(0, 56), length = rng.range(0.20, 0.42);
      positions.set([x, y, z, x, y, z], i * 6);
      tails[i * 2 + 1] = 1;
      lengths[i * 2] = lengths[i * 2 + 1] = length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aTail', new THREE.BufferAttribute(tails, 1));
    geometry.setAttribute('aLength', new THREE.BufferAttribute(lengths, 1));
    const material = new THREE.LineBasicMaterial({ color: 0xc9d8e1, transparent: true, opacity: 0, depthWrite: false, fog: true });
    material.onBeforeCompile = shader => {
      shader.uniforms.uRainMotion = this.motion;
      shader.vertexShader = 'uniform vec2 uRainMotion; attribute float aTail; attribute float aLength;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        transformed.x = mod(position.x + uRainMotion.x + ${span / 2}.0, ${span}.0) - ${span / 2}.0;
        transformed.y = mod(position.y - uRainMotion.y, 56.0) - 2.0;
        transformed += aTail * vec3(aLength * 0.12, aLength, aLength * 0.035);
      `);
    };
    this.lines = new THREE.LineSegments(geometry, material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    this.lines.renderOrder = 16;
  }
  update(realDt: number, intensity: number, storm: number): void {
    this.lines.visible = intensity > 0.02;
    (this.lines.material as THREE.LineBasicMaterial).opacity = intensity * 0.36;
    if (!this.lines.visible) return;
    this.motion.value.x = (this.motion.value.x + (0.8 + storm * 2.5) * realDt) % (WORLD.size + 24);
    this.motion.value.y = (this.motion.value.y + (15 + storm * 6) * realDt) % 56;
  }
}
