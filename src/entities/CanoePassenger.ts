import * as THREE from 'three';
import { bakePose, loadGlbPeople, GlbPeople } from './glbPeople';
import { patchStylised, stylisedMaterial } from '../render/materials';

/** A seated copy of the same character models used by the islanders ashore (a baked pose). */
export class CanoePassenger extends THREE.Group {
  private disposed = false;
  private geometries: THREE.BufferGeometry[] = [];
  private material = patchStylised(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }), 0.45);

  /** @param prop something held (a paddle), shown from the start; the body appears once the models load */
  constructor(readonly gender: 'm' | 'f', private bodyScale: number, prop?: THREE.BufferGeometry) {
    super();
    this.name = `Canoe passenger ${gender}`;
    if (prop) {
      const held = new THREE.Mesh(prop, stylisedMaterial());
      held.castShadow = true;
      this.add(held);
    }
    loadGlbPeople().then((models) => {
      if (!this.disposed) this.seat(models);
    }).catch((err) => console.error('Canoe character failed to load.', err));
  }

  private seat(models: GlbPeople): void {
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
    this.material.map = models[g].map;
    this.material.needsUpdate = true;
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
