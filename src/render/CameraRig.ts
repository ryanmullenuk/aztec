import * as THREE from 'three';
import { CAMERA, RENDER } from '../config';
import { clamp, lerp, smoothstep } from '../world/noise';
import { World } from '../world/World';

/**
 * Miniature-diorama camera: narrow FOV, looking down ~53°, tilting lower when close.
 * All inputs set goals; the actual camera eases toward them.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  goal = { x: 0, z: 0, dist: CAMERA.startDistance, yaw: CAMERA.startYaw, tilt: 0 };
  cur = { x: 0, z: 0, dist: CAMERA.startDistance, yaw: CAMERA.startYaw, tilt: 0 };
  private groundY = 0;
  boundRadius = 80;

  constructor(aspect: number, private world: World) {
    this.camera = new THREE.PerspectiveCamera(RENDER.fov, aspect, RENDER.near, RENDER.far);
  }

  jumpTo(x: number, z: number, dist = this.goal.dist, yaw = this.goal.yaw): void {
    this.goal = { x, z, dist, yaw, tilt: this.goal.tilt };
    this.cur = { ...this.goal };
    this.groundY = Math.max(0, this.world.heightAt(x, z));
    this.apply();
  }

  get pitch(): number {
    const t = smoothstep(CAMERA.minDistance, 70, this.cur.dist);
    // Zoomed right out the view turns to look almost straight down on the whole map.
    const top = smoothstep(CAMERA.maxDistance * 0.8, this.maxDist, this.cur.dist);
    // Player tilt offsets the automatic zoom-based pitch (kept between a low view and straight down).
    const base = lerp(CAMERA.pitchClose, CAMERA.pitch, t);
    return (clamp(lerp(base + this.cur.tilt, CAMERA.overviewPitch, top), 16, 86) * Math.PI) / 180;
  }

  /** Furthest zoom: far enough to fit the whole map (and a margin of sea) on screen. */
  get maxDist(): number {
    const span = this.world.N * 1.12;
    const vh = 2 * Math.tan((RENDER.fov * Math.PI) / 360);
    return Math.max(CAMERA.maxDistance, span / (vh * Math.min(1, this.camera.aspect)));
  }

  /** Fly out to see the whole map from above (or back to where you were). */
  toggleOverview(): void {
    if (this.saved) {
      this.goal = { ...this.saved };
      this.saved = null;
      return;
    }
    this.saved = { ...this.goal };
    // Islands side by side on a wide screen, one above the other on a tall (phone) screen.
    // (Centred a little toward the bottom of the screen, which the toolbar covers.)
    const wide = this.camera.aspect >= 1;
    this.goal = { x: wide ? 0 : 7, z: wide ? 7 : 0, dist: this.maxDist * 1.04, yaw: wide ? 0 : Math.PI / 2, tilt: 0 };
  }
  private saved: { x: number; z: number; dist: number; yaw: number; tilt: number } | null = null;

  /** Tilt the view up or down (degrees). */
  tilt(deg: number): void {
    this.goal.tilt = clamp(this.goal.tilt + deg, -30, 32);
  }

  /** World units per screen pixel at the focus point. */
  unitsPerPixel(screenH: number): number {
    return (2 * this.cur.dist * Math.tan((RENDER.fov * Math.PI) / 360)) / screenH;
  }

  /** Pan by a screen-space pixel delta (drag). */
  panPixels(dx: number, dy: number, screenH: number): void {
    const u = this.unitsPerPixel(screenH) * CAMERA.panSpeed;
    const yaw = this.cur.yaw;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const k = 1 / Math.max(0.5, Math.sin(this.pitch));
    this.goal.x += -rx * dx * u + fx * dy * u * k;
    this.goal.z += -rz * dx * u + fz * dy * u * k;
    // Keep immediate response for drags.
    this.cur.x = lerp(this.cur.x, this.goal.x, 0.6);
    this.cur.z = lerp(this.cur.z, this.goal.z, 0.6);
    this.clampGoal();
  }

  /** Pan with keyboard: forward/right in [-1,1], scaled per second. */
  panKeys(fwd: number, right: number, dt: number): void {
    const yaw = this.goal.yaw;
    const speed = this.goal.dist * CAMERA.keyPanSpeed * dt;
    this.goal.x += (Math.cos(yaw) * right - Math.sin(yaw) * fwd) * speed;
    this.goal.z += (-Math.sin(yaw) * right - Math.cos(yaw) * fwd) * speed;
    this.clampGoal();
  }

  /** Zoom by a factor, optionally toward a world point. */
  zoom(factor: number, toward?: { x: number; z: number }): void {
    const old = this.goal.dist;
    this.goal.dist = clamp(old * factor, CAMERA.minDistance, this.maxDist);
    this.saved = null;
    if (toward) {
      const k = 1 - this.goal.dist / old;
      this.goal.x += (toward.x - this.goal.x) * k;
      this.goal.z += (toward.z - this.goal.z) * k;
    }
    this.clampGoal();
  }

  rotate(d: number): void {
    this.goal.yaw += d;
  }

  private clampGoal(): void {
    const r = Math.hypot(this.goal.x, this.goal.z);
    if (r > this.boundRadius) {
      this.goal.x *= this.boundRadius / r;
      this.goal.z *= this.boundRadius / r;
    }
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-CAMERA.damping * dt);
    this.cur.x = lerp(this.cur.x, this.goal.x, k);
    this.cur.z = lerp(this.cur.z, this.goal.z, k);
    this.cur.dist = lerp(this.cur.dist, this.goal.dist, k);
    this.cur.yaw = lerp(this.cur.yaw, this.goal.yaw, k);
    this.cur.tilt = lerp(this.cur.tilt, this.goal.tilt, k);
    const gy = Math.max(0, this.world.heightAt(this.cur.x, this.cur.z));
    this.groundY = lerp(this.groundY, gy, 1 - Math.exp(-3 * dt));
    this.apply();
  }

  private apply(): void {
    const p = this.pitch;
    const d = this.cur.dist;
    this.target.set(this.cur.x, this.groundY, this.cur.z);
    this.camera.position.set(
      this.cur.x + Math.sin(this.cur.yaw) * Math.cos(p) * d,
      this.groundY + Math.sin(p) * d,
      this.cur.z + Math.cos(this.cur.yaw) * Math.cos(p) * d
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Radius of ground visible around the target (for shadow fitting and LOD). */
  get viewRadius(): number {
    return this.cur.dist * Math.tan((RENDER.fov * Math.PI) / 360) * 1.9 * Math.max(1, this.camera.aspect * 0.8);
  }
}
