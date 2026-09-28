import * as THREE from 'three';
import { World } from '../world/World';
import { RNG } from '../world/rng';
import { View } from './View';

/** Occasional gentle gusts and a bounded pool of ground-skimming leaves. */
export class Breeze {
  readonly group = new THREE.Group();
  strength = 0;
  private rng: RNG;
  private wait: number;
  private age = 0;
  private duration = 0;
  private peak = 0;
  private heading = 0;
  private spawnWait = 0;
  private remaining = 0;
  private leaves: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    age: number; life: number; heading: number; speed: number; phase: number;
  }[] = [];

  constructor(private world: World, seed: number) {
    // Decorative randomness never consumes the simulation's RNG.
    this.rng = new RNG(seed ^ 0x4c454146);
    this.wait = this.rng.range(3, 7);
    this.group.name = 'Ground breeze leaves';
    const geometry = new THREE.BufferGeometry();
    // A folded pointed leaf, lying along its local X axis.
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.18, 0, 0, 0, 0, -0.075, 0, 0.035, 0,
      0, 0, -0.075, 0.18, 0, 0, 0, 0.035, 0,
      0.18, 0, 0, 0, 0, 0.075, 0, 0.035, 0,
      0, 0, 0.075, -0.18, 0, 0, 0, 0.035, 0,
    ], 3));
    geometry.computeVertexNormals();
    for (let i = 0; i < 12; i++) {
      const material = new THREE.MeshStandardMaterial({
        color: this.rng.pick([0x88834b, 0xa28a50, 0x6e8044, 0xb49a60]),
        roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.leaves.push({ mesh, age: 0, life: 0, heading: 0, speed: 0, phase: 0 });
    }
  }

  update(dt: number, target: THREE.Vector3, radius: number): void {
    // Real time keeps the breeze gentle at every simulation speed.
    dt = Math.min(0.1, Math.max(0, dt));
    if (this.duration > 0) {
      this.age += dt;
      const progress = Math.min(1, this.age / this.duration);
      this.strength = this.peak * Math.sin(Math.PI * progress) ** 2;
      this.spawnWait -= dt;
      if (this.remaining > 0 && this.spawnWait <= 0) {
        this.spawn(target, radius);
        this.remaining--;
        this.spawnWait = this.rng.range(0.45, 1.1);
      }
      if (progress === 1) {
        this.duration = 0;
        this.strength = 0;
        this.wait = this.rng.range(10, 24);
      }
    } else {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.age = 0;
        this.duration = this.rng.range(7, 12);
        this.peak = this.rng.range(0.35, 0.8);
        this.heading = this.rng.range(0, Math.PI * 2);
        this.remaining = this.rng.int(3, 6);
        this.spawnWait = 0.8;
      }
    }

    for (const leaf of this.leaves) {
      const { mesh } = leaf;
      if (!mesh.visible) continue;
      leaf.age += dt;
      const flutter = leaf.age * 3 + leaf.phase;
      const speed = leaf.speed * (0.65 + this.strength);
      const cross = Math.sin(flutter) * 0.22;
      const x = mesh.position.x + (Math.cos(leaf.heading) * speed - Math.sin(leaf.heading) * cross) * dt;
      const z = mesh.position.z + (Math.sin(leaf.heading) * speed + Math.cos(leaf.heading) * cross) * dt;
      const ground = this.dryGround(x, z);
      // Leaves are transient: discard off-screen, over water, or at the end of their life.
      if (ground === null || leaf.age >= leaf.life || !View.sees(x, ground + 0.15, z, 0.3)) {
        mesh.visible = false;
        continue;
      }
      mesh.position.set(x, ground + 0.09 + Math.abs(Math.sin(flutter)) * 0.12, z);
      mesh.rotation.set(Math.sin(flutter) * 0.35, leaf.heading + leaf.age * 1.4, Math.cos(flutter * 1.3) * 0.45);
      mesh.material.opacity = Math.min(1, leaf.age / 0.8, (leaf.life - leaf.age) / 3) * 0.9;
    }
  }

  private dryGround(x: number, z: number): number | null {
    const i = this.world.cellIndexAt(x, z);
    if (i < 0 || !this.world.isLandCell(i) || this.world.canal[i] || this.world.occ[i]) return null;
    const h = this.world.heightAt(x, z);
    if (h < 0.12 || this.world.swampWaterY(x, z) >= h) return null;
    return h;
  }

  private spawn(target: THREE.Vector3, radius: number): void {
    const leaf = this.leaves.find((l) => !l.mesh.visible);
    if (!leaf) return;
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = Math.sqrt(this.rng.next()) * Math.min(radius * 0.7, 24);
      const x = target.x + Math.cos(angle) * distance;
      const z = target.z + Math.sin(angle) * distance;
      const h = this.dryGround(x, z);
      if (h === null || !View.sees(x, h + 0.15, z, 0)) continue;
      leaf.age = 0;
      leaf.life = this.rng.range(18, 26);
      leaf.heading = this.heading + this.rng.range(-0.15, 0.15);
      leaf.speed = this.rng.range(0.8, 1.4);
      leaf.phase = this.rng.range(0, Math.PI * 2);
      leaf.mesh.position.set(x, h + 0.1, z);
      leaf.mesh.scale.setScalar(this.rng.range(0.7, 1.2));
      leaf.mesh.material.opacity = 0;
      leaf.mesh.visible = true;
      return;
    }
  }
}
