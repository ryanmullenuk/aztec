import * as THREE from 'three';
import { bakePose, loadGlbPeople, GlbPeople } from './glbPeople';
import { stylisedMaterial } from '../render/materials';

/** A seated copy of the same character models used by the islanders ashore (a baked pose). */
export class CanoePassenger extends THREE.Group {
  private disposed = false;
  private geometries: THREE.BufferGeometry[] = [];
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });

  constructor(readonly gender: 'm' | 'f', private bodyScale: number, fallback: THREE.BufferGeometry) {
    super();
    this.name = `Canoe passenger ${gender}`;
    // Keep a passenger visible while the shared character models are loading.
    const placeholder = new THREE.Mesh(fallback, stylisedMaterial());
    placeholder.castShadow = true;
    this.add(placeholder);
    loadGlbPeople().then((models) => {
      if (!this.disposed) this.seat(models);
    }).catch((err) => console.warn('Canoe character failed to load; keeping the rower.', err));
  }

  private seat(models: GlbPeople): void {
    this.clear();
    const g = this.gender;
    const body = new THREE.Group();
    body.scale.setScalar(this.bodyScale * (g === 'f' ? 0.98 : 1));
    // Hips sit just above the bench; feet rest inside the hull.
    body.position.y = 0.37;
    this.add(body);
    // Seated: thighs forward along the bench, shins down, hands resting forward on the knees.
    const geo = bakePose(models[g], {
      spine: [0.08, 0, 0],
      thighL: [-Math.PI / 2, 0, 0.05], thighR: [-Math.PI / 2, 0, -0.05],
      shinL: [Math.PI / 2, 0, 0], shinR: [Math.PI / 2, 0, 0],
      upper_armL: [-0.35, 0, 0.08], upper_armR: [-0.35, 0, -0.08],
      forearmL: [-1.05, 0, 0], forearmR: [-1.05, 0, 0],
    });
    const skin = new THREE.Color(0xc98450), gold = new THREE.Color(0xd9a521);
    const colors = geo.getAttribute('color'), tags = geo.getAttribute('aMat');
    for (let i = 0; i < colors.count; i++) {
      const tag = tags.getX(i);
      const tint = tag === 1 ? skin : tag === 2 ? gold : null;
      if (tint) colors.setXYZ(i, colors.getX(i) * tint.r, colors.getY(i) * tint.g, colors.getZ(i) * tint.b);
    }
    this.geometries.push(geo);
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = mesh.receiveShadow = true;
    body.add(mesh);
  }

  /** Late model loads must not bring passengers back after they have disembarked. */
  override dispose(): void {
    this.disposed = true;
    this.visible = false;
    this.clear();
    for (const geo of this.geometries) geo.dispose();
    this.geometries.length = 0;
    this.material.dispose();
  }
}
