import * as THREE from 'three';
import { PEARLS } from '../config';
import { GeoBuilder, M, P } from '../render/GeoBuilder';
import { stylisedMaterial } from '../render/materials';
import { RNG } from '../world/rng';
import { SpatialHash } from '../world/SpatialHash';
import { World } from '../world/World';
import type { Islander } from './Islander';

interface Shell {
  x: number;
  y: number;
  z: number;
  rot: number;
  /** Seconds since it washed up. */
  age: number;
  mesh: THREE.Group;
  glint: THREE.Sprite;
}

/** A pearl oyster lying open on the sand: rough grey-brown valves, nacre inside, a pearl. */
function shellGeometry(): THREE.BufferGeometry {
  const b = new GeoBuilder();
  // Lower valve: a shallow ridged bowl bedded in the sand, lined with nacre.
  const bowl = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  b.add(bowl, { color: (p) => new THREE.Color(Math.sin(Math.atan2(p.x, p.z) * 9) > 0.3 ? 0x7a6a58 : 0x938270) }, M.t(0, 0.026, 0, 0, 0, 0, 0.095, 0.032, 0.082));
  b.add(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2), { color: (p) => new THREE.Color(0xe9dfe8).lerp(new THREE.Color(0xc9d6e6), Math.max(0, Math.sin(p.x * 60 + p.z * 40)) * 0.6) }, M.t(0, 0.022, 0, 0, 0, 0, 0.088, 1, 0.075));
  // Upper valve, hinged open at the back.
  const lid = new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const open = new THREE.Matrix4().makeTranslation(0, 0.026, -0.075).multiply(new THREE.Matrix4().makeRotationX(-2.6));
  b.add(lid, { color: (p) => new THREE.Color(Math.sin(Math.atan2(p.x, p.z) * 9) > 0.3 ? 0x7a6a58 : 0x938270) }, open.clone().multiply(M.t(0, 0, 0.075, 0, 0, 0, 0.092, 0.028, 0.08)));
  // Its nacre lining, facing out of the open shell.
  b.add(new THREE.CircleGeometry(1, 14).rotateX(Math.PI / 2), { color: (p) => new THREE.Color(0xeee4ec).lerp(new THREE.Color(0xc9d6e6), Math.max(0, Math.sin(p.x * 60 + p.y * 40)) * 0.6) }, open.clone().multiply(M.t(0, -0.002, 0.075, 0, 0, 0, 0.086, 1, 0.074)));
  // The pearl.
  b.add(P.sphere(0.021, 1), { color: 0xfbf6f2 }, M.t(0.01, 0.036, 0.012));
  return b.build();
}

function glintTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,250,240,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // A four-pointed sparkle.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(31, 4, 2, 56);
  g.fillRect(4, 31, 56, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Pearl oysters washed up on the beaches: now and then one lies open on the sand, a pearl glinting
 * in it, until a villager walking past picks it up (or the player taps it) or the tide takes it
 * back. Pearls are kept with the precious goods, for trading on voyages.
 */
export class BeachPearls {
  readonly group = new THREE.Group();
  shells: Shell[] = [];
  private spots: { x: number; z: number }[] = [];
  private rng: RNG;
  private next: number;
  private check = 0;
  private geo = shellGeometry();
  private tex = glintTexture();
  /** A pearl found: by a villager, or by the player tapping the shell (who = null). */
  onFound: ((who: Islander | null, x: number, z: number) => void) | null = null;

  constructor(private world: World) {
    this.rng = new RNG(world.seed * 41 + 3);
    this.next = this.rng.range(PEARLS.every[0] * 0.3, PEARLS.every[1] * 0.5);
    this.findSpots();
    this.group.name = 'pearls';
  }

  /** Sand just above the waterline, all round the coasts. */
  private findSpots(): void {
    const w = this.world;
    for (let cz = 1; cz < w.N - 1; cz++) {
      for (let cx = 1; cx < w.N - 1; cx++) {
        const i = w.idx(cx, cz);
        if (!w.isLandCell(i) || w.sandy[i] < 0.5 || w.distWater[i] > 2 || w.occ[i] || w.blocked(i)) continue;
        const x = w.centerX(cx), z = w.centerZ(cz), y = w.heightAt(x, z);
        if (y < 0.03 || y > 0.9) continue;
        this.spots.push({ x, z });
      }
    }
  }

  get count(): number {
    return this.shells.length;
  }

  /** Wash a shell up somewhere along the beaches (true if one was placed). */
  washUp(): boolean {
    const w = this.world;
    for (let tries = 0; tries < 30 && this.spots.length; tries++) {
      const s = this.rng.pick(this.spots);
      const x = s.x + this.rng.range(-0.4, 0.4), z = s.z + this.rng.range(-0.4, 0.4);
      const i = w.cellIndexAt(x, z);
      if (i < 0 || !w.isLandCell(i) || w.occ[i] || w.path[i]) continue;
      if (this.shells.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue;
      const mesh = new THREE.Group();
      const m = new THREE.Mesh(this.geo, stylisedMaterial());
      m.castShadow = true;
      m.scale.setScalar(1.6);
      mesh.add(m);
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xfff6e8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glint.scale.setScalar(0.3);
      mesh.add(glint);
      const y = w.heightAt(x, z);
      mesh.position.set(x, y, z);
      mesh.rotation.y = this.rng.range(0, Math.PI * 2);
      this.group.add(mesh);
      this.shells.push({ x, y, z, rot: mesh.rotation.y, age: 0, mesh, glint });
      return true;
    }
    return false;
  }

  private take(k: number, who: Islander | null): void {
    const s = this.shells[k];
    this.group.remove(s.mesh);
    (s.glint.material as THREE.Material).dispose();
    this.shells.splice(k, 1);
    this.onFound?.(who, s.x, s.z);
  }

  /** The player taps a shell: they find the pearl. True if one was there. */
  tap(camera: THREE.Camera, sx: number, sy: number, rect: DOMRect): boolean {
    const v = new THREE.Vector3();
    for (let k = 0; k < this.shells.length; k++) {
      const s = this.shells[k];
      v.set(s.x, s.y + 0.05, s.z).project(camera);
      if (v.z > 1) continue;
      const px = (v.x * 0.5 + 0.5) * rect.width + rect.left, py = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      if ((px - sx) ** 2 + (py - sy) ** 2 < 26 * 26) {
        this.take(k, null);
        return true;
      }
    }
    return false;
  }

  update(dt: number, time: number, people: SpatialHash<Islander> | null): void {
    this.next -= dt;
    if (this.next <= 0) {
      if (this.shells.length < PEARLS.maxShells) this.washUp();
      this.next = this.rng.range(PEARLS.every[0], PEARLS.every[1]);
    }
    for (let k = this.shells.length - 1; k >= 0; k--) {
      const s = this.shells[k];
      s.age += dt;
      // The tide takes it back.
      if (s.age > PEARLS.shellLife) {
        this.group.remove(s.mesh);
        this.shells.splice(k, 1);
        continue;
      }
      // A twinkle every second or so, so it catches the eye.
      const tw = Math.max(0, Math.sin(time * 2.4 + k * 2.1)) ** 6;
      s.glint.position.set(0, 0.07, 0);
      s.glint.scale.setScalar(0.12 + 0.3 * tw);
      (s.glint.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * tw;
    }
    // Villagers walking past pick them up.
    this.check -= dt;
    if (this.check <= 0 && people) {
      this.check = 0.3;
      for (let k = this.shells.length - 1; k >= 0; k--) {
        const s = this.shells[k];
        let who: Islander | null = null;
        people.query(s.x, s.z, PEARLS.pickRadius, (p) => {
          if (!who && !p.hidden && Math.hypot(p.x - s.x, p.z - s.z) < PEARLS.pickRadius) who = p;
        });
        if (who) this.take(k, who);
      }
    }
  }
}
