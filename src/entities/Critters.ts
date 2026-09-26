import * as THREE from 'three';
import { CRITTERS } from '../config';
import { GeoBuilder, M, P, facet } from '../render/GeoBuilder';
import { FX, stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import { Islander } from './Islander';

interface Crab {
  x: number;
  z: number;
  y: number;
  hx: number;
  hz: number;
  heading: number;
  dir: number;
  state: 'rest' | 'scuttle' | 'flee' | 'buried';
  timer: number;
  phase: number;
  sink: number;
}

interface Ray {
  x: number;
  z: number;
  y: number;
  heading: number;
  speed: number;
  turn: number;
  phase: number;
  size: number;
  cx: number;
  cz: number;
}

function crabGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  const shell = 0xd8552e, dark = 0xa83a1e, pale = 0xf2a07a;
  b.add(P.sphere(0.07, 1), { color: (_p, n) => new THREE.Color(n.y > 0.3 ? shell : pale) }, M.t(0, 0.045, 0, 0, 0, 0, 1.25, 0.55, 1));
  // Claws.
  for (const s of [-1, 1]) {
    b.add(P.box(0.05, 0.015, 0.018), { color: dark }, M.t(s * 0.085, 0.05, 0.05, 0, s * 0.5, 0));
    b.add(P.sphere(0.028, 0), { color: shell }, M.t(s * 0.105, 0.055, 0.085, 0, 0, 0, 1, 0.7, 1.3));
    // Eye stalks.
    b.add(P.cyl(0.004, 0.004, 0.03, 3), { color: dark }, M.t(s * 0.02, 0.08, 0.05));
    b.add(P.sphere(0.008, 0), { color: 0x101010 }, M.t(s * 0.02, 0.095, 0.05));
    // Legs.
    for (let k = 0; k < 3; k++) b.add(P.box(0.06, 0.008, 0.01), { color: dark, sway: 0.3 }, M.t(s * 0.085, 0.025, -0.03 + k * 0.03, 0, 0, s * -0.5));
  }
  return facet(b.build());
}

function rayGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Flat diamond disc (wings marked with sway = |x| for the flap shader), and a long thin tail.
  const s = new THREE.Shape();
  s.moveTo(0, 0.32);
  s.quadraticCurveTo(0.32, 0.1, 0.44, -0.08);
  s.quadraticCurveTo(0.2, -0.12, 0, -0.26);
  s.quadraticCurveTo(-0.2, -0.12, -0.44, -0.08);
  s.quadraticCurveTo(-0.32, 0.1, 0, 0.32);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1, curveSegments: 5 });
  g.rotateX(-Math.PI / 2);
  b.add(g, { color: (p, n) => new THREE.Color(n.y > 0 ? (Math.sin(p.x * 30) * Math.sin(p.z * 30) > 0.6 ? 0x3a3530 : 0x5a5048) : 0xd8d2c8), sway: (p) => Math.abs(p.x) });
  b.add(P.cone(0.012, 0.5, 4), { color: 0x3a3530 }, M.t(0, 0.02, -0.5, -Math.PI / 2, 0, 0));
  return facet(b.build());
}

function softShadow(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(10,30,40,0.55)');
  grd.addColorStop(1, 'rgba(10,30,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Little beach crabs that scuttle sideways and burrow, and stingrays gliding over the shallows. */
export class Critters {
  readonly group = new THREE.Group();
  private crabs: Crab[] = [];
  private rays: Ray[] = [];
  private crabMesh: THREE.InstancedMesh;
  private rayMesh: THREE.InstancedMesh;
  private rayShadow: THREE.InstancedMesh;
  private rng: RNG;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 71 + 3);
    this.spawn();
    this.crabMesh = new THREE.InstancedMesh(crabGeometry(), stylisedMaterial(), Math.max(1, this.crabs.length));
    this.crabMesh.castShadow = true;
    this.crabMesh.frustumCulled = false;
    this.crabMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.crabMesh);

    // Rays flap their wings in the vertex shader.
    const rayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    rayMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = FX.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aVeg;\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
            float w = aVeg.x;
            transformed.y += sin(uTime * 2.1 + ph - w * 5.0) * w * 0.28;
          }`);
    };
    this.rayMesh = new THREE.InstancedMesh(rayGeometry(), rayMat, Math.max(1, this.rays.length));
    this.rayMesh.frustumCulled = false;
    this.rayMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.rayMesh);
    this.rayShadow = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false, fog: true }),
      Math.max(1, this.rays.length)
    );
    this.rayShadow.frustumCulled = false;
    this.rayShadow.renderOrder = 2;
    this.group.add(this.rayShadow);
  }

  private spawn(): void {
    const w = this.world;
    for (let k = 0; k < 6000 && this.crabs.length < CRITTERS.crabs; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const i = w.idx(cx, cz);
      if (w.layer[i] < 1 || w.layer[i] > 2 || w.sandy[i] < 0.5 || w.distWater[i] > 3 || w.occ[i]) continue;
      const x = w.centerX(cx) + this.rng.range(-0.4, 0.4), z = w.centerZ(cz) + this.rng.range(-0.4, 0.4);
      this.crabs.push({ x, z, y: w.heightAt(x, z), hx: x, hz: z, heading: this.rng.range(0, 6.28), dir: 1, state: 'rest', timer: this.rng.range(0, 3), phase: this.rng.range(0, 10), sink: 0 });
    }
    for (let k = 0; k < 6000 && this.rays.length < CRITTERS.rays; k++) {
      const cx = this.rng.int(2, w.N - 3), cz = this.rng.int(2, w.N - 3);
      const x = w.centerX(cx), z = w.centerZ(cz);
      const bed = w.heightAt(x, z);
      if (bed > -0.45 || bed < -2.2) continue;
      if (this.rays.some((r) => Math.hypot(r.x - x, r.z - z) < 6)) continue;
      this.rays.push({ x, z, y: bed + 0.25, heading: this.rng.range(0, 6.28), speed: this.rng.range(0.35, 0.6), turn: 0, phase: this.rng.range(0, 10), size: this.rng.range(0.8, 1.4), cx: x, cz: z });
    }
  }

  private sandAt(x: number, z: number): boolean {
    const w = this.world;
    const i = w.cellIndexAt(x, z);
    return i >= 0 && w.layer[i] >= 1 && w.sandy[i] > 0.3 && !w.occ[i];
  }

  update(dt: number, time: number, cursor: THREE.Vector3 | null, islanders: SpatialHash<Islander>): void {
    if (dt > 0) {
      for (const c of this.crabs) this.stepCrab(c, dt, cursor, islanders);
      for (const r of this.rays) this.stepRay(r, dt, cursor);
    }
    this.draw(time);
  }

  private stepCrab(c: Crab, dt: number, cursor: THREE.Vector3 | null, islanders: SpatialHash<Islander>): void {
    c.phase += dt;
    c.timer -= dt;
    // Startled by the cursor or people walking by: scuttle off fast or dig in.
    let threat: { x: number; z: number } | null = null;
    if (cursor && Math.hypot(cursor.x - c.x, cursor.z - c.z) < CRITTERS.crabFleeRadius) threat = cursor;
    islanders.query(c.x, c.z, 0.9, (i) => (threat = i));
    if (threat && c.state !== 'flee' && c.state !== 'buried') {
      const t = threat as { x: number; z: number };
      if (this.rng.chance(0.35)) {
        c.state = 'buried';
        c.timer = 3 + this.rng.next() * 4;
      } else {
        c.state = 'flee';
        c.timer = 0.9;
        // Face so that sideways (the crab's local x) points away from the threat.
        const away = Math.atan2(c.x - t.x, c.z - t.z);
        c.heading = away - Math.PI / 2;
        c.dir = 1;
      }
    }
    if (c.state === 'buried') {
      c.sink = Math.min(1, c.sink + dt * 3);
      if (c.timer <= 0) c.state = 'rest';
      return;
    }
    c.sink = Math.max(0, c.sink - dt * 2);
    if (c.state === 'rest') {
      if (c.timer <= 0) {
        c.state = 'scuttle';
        c.timer = 0.5 + this.rng.next() * 1.2;
        // Scuttle back toward home if we've strayed.
        if (Math.hypot(c.x - c.hx, c.z - c.hz) > 2.5) c.heading = Math.atan2(c.hx - c.x, c.hz - c.z) - Math.PI / 2;
        else c.heading += this.rng.range(-0.6, 0.6);
        c.dir = this.rng.chance(0.5) ? 1 : -1;
      }
      return;
    }
    const sp = c.state === 'flee' ? 1.4 : 0.45;
    const sx = Math.cos(c.heading) * c.dir, sz = -Math.sin(c.heading) * c.dir;
    const nx = c.x + sx * sp * dt, nz = c.z + sz * sp * dt;
    if (this.sandAt(nx, nz)) {
      c.x = nx;
      c.z = nz;
      c.y = this.world.heightAt(nx, nz);
    } else c.dir *= -1;
    if (c.timer <= 0) {
      c.state = 'rest';
      c.timer = 1 + this.rng.next() * 3.5;
    }
  }

  private stepRay(r: Ray, dt: number, cursor: THREE.Vector3 | null): void {
    r.phase += dt;
    // Wander in slow loops around a home area, keeping to the shallows.
    const w = this.world;
    const ax = r.x + Math.sin(r.heading) * 1.5, az = r.z + Math.cos(r.heading) * 1.5;
    const bed = w.heightAt(ax, az);
    let want = Math.sin(r.phase * 0.2) * 0.4;
    if (bed > -0.4 || bed < -2.6 || Math.hypot(ax - r.cx, az - r.cz) > 10) want = 1.4;
    if (cursor && Math.hypot(cursor.x - r.x, cursor.z - r.z) < CRITTERS.rayFleeRadius) {
      const away = Math.atan2(r.x - cursor.x, r.z - cursor.z);
      let d = away - r.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      want = Math.sign(d) * 1.8;
      r.speed = Math.min(1.4, r.speed + dt);
    } else r.speed += (0.45 - r.speed) * dt * 0.5;
    r.turn += (want - r.turn) * Math.min(1, dt * 1.5);
    r.heading += r.turn * dt;
    r.x += Math.sin(r.heading) * r.speed * dt;
    r.z += Math.cos(r.heading) * r.speed * dt;
    const b = w.heightAt(r.x, r.z);
    r.y += (Math.min(b + 0.28, -0.22) - r.y) * Math.min(1, dt * 2);
  }

  private draw(time: number): void {
    this.crabs.forEach((c, i) => {
      const moving = c.state === 'scuttle' || c.state === 'flee';
      const bob = moving ? Math.abs(Math.sin(c.phase * 30)) * 0.012 : 0;
      _e.set(0, c.heading, moving ? Math.sin(c.phase * 30) * 0.08 : 0);
      _q.setFromEuler(_e);
      _p.set(c.x, c.y - c.sink * 0.1 + bob, c.z);
      _s.setScalar(CRITTERS.crabSize * (c.sink > 0.95 ? 0 : 1));
      this.crabMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    this.crabMesh.instanceMatrix.needsUpdate = true;
    this.rays.forEach((r, i) => {
      _e.set(Math.sin(time * 0.8 + r.phase) * 0.05, r.heading, -r.turn * 0.25);
      _q.setFromEuler(_e);
      _p.set(r.x, r.y, r.z);
      _s.setScalar(r.size);
      this.rayMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      // Soft shadow on the seabed below.
      const bed = this.world.heightAt(r.x, r.z);
      _q.identity();
      _p.set(r.x + 0.1, bed + 0.03, r.z + 0.1);
      _s.set(r.size * 1.1, 1, r.size * 0.95);
      this.rayShadow.setMatrixAt(i, _m.compose(_p, _q, _s));
    });
    this.rayMesh.instanceMatrix.needsUpdate = true;
    this.rayShadow.instanceMatrix.needsUpdate = true;
  }
}
