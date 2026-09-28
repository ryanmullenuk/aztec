import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _s = new THREE.Sphere();

/**
 * What the camera can see this frame, shared by every system that animates many entities: a
 * frustum test (with a margin so shadows and limbs don't pop at the screen edge) and distance.
 * Off-screen entities keep simulating but skip posing and drawing their parts.
 */
export const View = {
  frustum: new THREE.Frustum(),
  cam: new THREE.Vector3(),
  frame: 0,
  ready: false,

  update(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_m);
    this.cam.setFromMatrixPosition(camera.matrixWorld);
    this.frame++;
    this.ready = true;
  },

  /** Is a sphere at (x, y, z) of radius r (plus a small margin) on screen? */
  sees(x: number, y: number, z: number, r = 0.5): boolean {
    if (!this.ready) return true;
    _s.center.set(x, y, z);
    _s.radius = r + 1.2;
    return this.frustum.intersectsSphere(_s);
  },

  /** Squared distance from the camera. */
  dist2(x: number, y: number, z: number): number {
    const dx = x - this.cam.x, dy = y - this.cam.y, dz = z - this.cam.z;
    return dx * dx + dy * dy + dz * dz;
  },
};
