import * as THREE from 'three';
import { RNG } from '../world/rng';
import { World } from '../world/World';

/** Puffy cloud texture: overlapping soft blobs, brighter on top. */
function cloudTexture(seed: number): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const rng = new RNG(seed);
  for (let k = 0; k < 16; k++) {
    const x = s * (0.25 + rng.next() * 0.5), y = s * (0.35 + rng.next() * 0.3), r = s * (0.12 + rng.next() * 0.16);
    const grd = g.createRadialGradient(x, y - r * 0.25, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.55, 'rgba(242,246,250,0.6)');
    grd.addColorStop(1, 'rgba(230,236,244,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Puff {
  sprite: THREE.Sprite;
  cx: number;
  cz: number;
  y: number;
  r: number;
  a: number;
  speed: number;
  phase: number;
  scale: number;
}

/** Soft clouds clinging to and drifting around the island's highest peaks. */
export class PeakClouds {
  readonly group = new THREE.Group();
  private puffs: Puff[] = [];
  private time = 0;

  constructor(world: World) {
    const rng = new RNG(world.seed * 29 + 5);
    const N = world.N;
    // Highest points, well apart.
    const cand: { i: number; L: number }[] = [];
    for (let i = 0; i < N * N; i++) if (world.layer[i] >= 11) cand.push({ i, L: world.layer[i] + rng.next() * 0.5 });
    cand.sort((a, b) => b.L - a.L);
    const peaks: { x: number; z: number; y: number }[] = [];
    for (const c of cand) {
      const x = world.centerX(c.i % N), z = world.centerZ((c.i / N) | 0);
      if (peaks.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
      peaks.push({ x, z, y: world.heightAt(x, z) });
      if (peaks.length >= 3) break;
    }
    const texes = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
    for (const pk of peaks) {
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) {
        const mat = new THREE.SpriteMaterial({ map: texes[k % 3], transparent: true, depthWrite: false, opacity: 0.8, fog: true });
        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 18;
        this.group.add(sprite);
        this.puffs.push({
          sprite, cx: pk.x, cz: pk.z, y: pk.y + rng.range(-1.5, 1.2), r: rng.range(1.5, 4.5), a: rng.range(0, Math.PI * 2),
          speed: rng.range(0.03, 0.07) * (rng.chance(0.5) ? 1 : -1), phase: rng.range(0, 10), scale: rng.range(3.5, 6.5),
        });
      }
    }
  }

  /** @param day 0 at night … 1 in daylight; @param camDist camera distance (clouds thin out when zoomed in close). */
  update(dt: number, day: number, camDist: number): void {
    this.time += dt;
    const near = THREE.MathUtils.smoothstep(camDist, 18, 45);
    for (const p of this.puffs) {
      p.a += p.speed * dt;
      const breathe = Math.sin(this.time * 0.25 + p.phase);
      p.sprite.position.set(p.cx + Math.cos(p.a) * p.r, p.y + breathe * 0.3, p.cz + Math.sin(p.a) * p.r);
      const s = p.scale * (1 + breathe * 0.06);
      p.sprite.scale.set(s * 1.5, s, 1);
      const m = p.sprite.material as THREE.SpriteMaterial;
      m.opacity = (0.35 + 0.25 * (breathe * 0.5 + 0.5)) * near;
      const l = 0.35 + 0.65 * day;
      m.color.setRGB(l, l, l * 1.04);
    }
  }
}
