import * as THREE from 'three';
import { loadGlbPeople, GlbPeople } from './glbPeople';
import { stylisedMaterial } from '../render/materials';

/** A seated copy of the same character parts used by the islanders ashore. */
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
    const g = this.gender, sk = models.skel[g];
    const body = new THREE.Group();
    body.scale.setScalar(this.bodyScale * (g === 'f' ? 0.98 : 1));
    // Hips sit just above the bench; feet rest inside the hull.
    body.position.y = 0.37;
    this.add(body);
    const skin = new THREE.Color(0xc98450), gold = new THREE.Color(0xd9a521);
    const part = (key: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
      const joint = new THREE.Group();
      joint.position.set(x, y, z);
      parent.add(joint);
      const source = models.parts.get(key);
      if (source) {
        // Do not mutate geometries or per-instance attributes owned by IslanderRig.
        const geo = source.clone();
        geo.deleteAttribute('iAccent');
        const colors = geo.getAttribute('color'), tags = geo.getAttribute('aMat');
        for (let i = 0; i < colors.count; i++) {
          const tag = tags.getX(i);
          const tint = tag === 1 ? skin : tag === 2 ? gold : null;
          if (tint) colors.setXYZ(i, colors.getX(i) * tint.r, colors.getY(i) * tint.g, colors.getZ(i) * tint.b);
        }
        this.geometries.push(geo);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.castShadow = mesh.receiveShadow = true;
        joint.add(mesh);
      }
      return joint;
    };
    const pelvis = part(`pelvis_${g}`, body);
    const chest = part(`chest_${g}`, pelvis, 0, sk.chestY);
    chest.rotation.x = 0.08;
    part(`head_${g}`, chest, 0, sk.neckY);
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      const thigh = part(`thigh_${g}${side}`, pelvis, sign * sk.hipX, sk.hipDY ?? -0.03);
      thigh.rotation.x = -Math.PI / 2;
      const shin = part(`shin_${g}${side}`, thigh, 0, -sk.thigh);
      shin.rotation.x = Math.PI / 2;
      const arm = part(`uarm_${g}${side}`, chest, sign * sk.shoulderX, sk.shoulderY);
      arm.rotation.x = -0.35;
      arm.rotation.z = sign * 0.08;
      const forearm = part(`farm_${g}${side}`, arm, 0, -sk.upper);
      forearm.rotation.x = -1.05;
    }
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
