import * as THREE from 'three';
import { RNG } from '../world/rng';

/**
 * Clouds drifting high over the island, seen only when zoomed out: a mix of thick, nearly opaque
 * cumulus and thin, see-through wisps passing between the camera and the ground. Each cloud is a
 * small cluster of billboards, so it keeps its puffy volume from any angle. They wrap around the
 * map as they drift, fade away as the camera zooms in (and when one comes too close to the lens),
 * and dim at night.
 */

export const DRIFT_CLOUDS = {
  count: 16,
  /** Altitude band (world units) — well below the zoomed-out camera, well above the peaks. */
  height: [34, 72] as [number, number],
  /** Half-size of the square area they drift across (wrapping round). */
  span: 175,
  /** Drift speed range, units per second. */
  speed: [1.1, 2.4] as [number, number],
  /** Camera distance where the clouds start to appear and where they are fully in. */
  fadeIn: [95, 165] as [number, number],
  /** Share of thick (nearly opaque) clouds; the rest are thin wisps. */
  thick: 0.45,
};

/** Puffy cumulus texture: many overlapping soft lobes, sunlit on top and greyer underneath. */
function puffTexture(seed: number, wispy: boolean): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const rng = new RNG(seed);
  const lobes = wispy ? 24 : 30;
  for (let k = 0; k < lobes; k++) {
    // Lobes packed toward the middle so the cloud is round and full, fraying at the edge.
    const ang = rng.next() * Math.PI * 2, rad = Math.sqrt(rng.next()) * (wispy ? 0.36 : 0.26);
    const x = s * (0.5 + Math.cos(ang) * rad * (wispy ? 1.1 : 1));
    const y = s * (0.5 + Math.sin(ang) * rad * (wispy ? 0.6 : 0.9));
    const r = s * (wispy ? 0.08 + rng.next() * 0.1 : 0.1 + (0.3 - rad) * 0.45 + rng.next() * 0.07);
    const shade = Math.round(Math.min(255, 228 + (1 - y / s) * 36));
    const grd = g.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
    grd.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 4)},${wispy ? 0.45 : 1})`);
    grd.addColorStop(0.6, `rgba(${shade - 10},${shade - 7},${shade},${wispy ? 0.24 : 0.75})`);
    grd.addColorStop(1, 'rgba(215,222,234,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Part {
  sprite: THREE.Sprite;
  ox: number;
  oy: number;
  oz: number;
  sx: number;
  sy: number;
}

interface Cloud {
  x: number;
  z: number;
  y: number;
  speed: number;
  /** Peak opacity: thick cumulus near 0.9, wisps well below half. */
  alpha: number;
  phase: number;
  parts: Part[];
}

export class DriftClouds {
  readonly group = new THREE.Group();
  private clouds: Cloud[] = [];
  private time = 0;
  /** Drift direction (unit XZ), a gentle trade wind. */
  private dir = new THREE.Vector2(0.82, 0.57);

  constructor(seed: number) {
    const rng = new RNG(seed * 41 + 13);
    const C = DRIFT_CLOUDS;
    const thickTex = [puffTexture(11, false), puffTexture(12, false), puffTexture(13, false)];
    const wispTex = [puffTexture(21, true), puffTexture(22, true)];
    for (let k = 0; k < C.count; k++) {
      const thick = rng.chance(C.thick);
      const size = thick ? rng.range(26, 44) : rng.range(28, 48);
      const cloud: Cloud = {
        x: rng.range(-C.span, C.span),
        z: rng.range(-C.span, C.span),
        y: rng.range(C.height[0], C.height[1]),
        speed: rng.range(C.speed[0], C.speed[1]),
        alpha: thick ? rng.range(0.9, 1) : rng.range(0.3, 0.5),
        phase: rng.range(0, 10),
        parts: [],
      };
      const n = thick ? rng.int(5, 7) : rng.int(3, 5);
      for (let j = 0; j < n; j++) {
        const tex = thick ? thickTex[(k + j) % 3] : wispTex[(k + j) % 2];
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0 });
        const sprite = new THREE.Sprite(mat);
        // Drawn after the water and the peak puffs, from the top down.
        sprite.renderOrder = 20;
        this.group.add(sprite);
        const a = (j / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const rr = j === 0 ? 0 : size * rng.range(0.22, 0.42);
        const ps = j === 0 ? 1 : rng.range(0.55, 0.85);
        cloud.parts.push({
          sprite,
          ox: Math.cos(a) * rr * 1.3,
          oy: rng.range(-1.5, 2.5) * (thick ? 1 : 0.4),
          oz: Math.sin(a) * rr,
          sx: size * ps * (thick ? 1.1 : 1.5),
          sy: size * ps * (thick ? 0.95 : 0.85),
        });
      }
      this.clouds.push(cloud);
    }
  }

  /**
   * @param day 0 at night … 1 in daylight
   * @param camDist camera zoom distance
   * @param camPos camera position (clouds fade when they come too close to the lens)
   * @param wind wind strength multiplier
   */
  update(dt: number, day: number, camDist: number, camPos: THREE.Vector3, wind = 1): void {
    const C = DRIFT_CLOUDS;
    const zoom = THREE.MathUtils.smoothstep(camDist, C.fadeIn[0], C.fadeIn[1]);
    this.group.visible = zoom > 0.001;
    if (!this.group.visible) return;
    this.time += dt;
    const light = 0.3 + 0.7 * day;
    const w = 2 * C.span;
    for (const c of this.clouds) {
      const v = c.speed * (0.6 + 0.4 * wind) * dt;
      c.x += this.dir.x * v;
      c.z += this.dir.y * v;
      // Wrap round, fading at the edge of the band so none pops in or out.
      if (c.x > C.span) c.x -= w;
      if (c.z > C.span) c.z -= w;
      const edge = Math.max(Math.abs(c.x), Math.abs(c.z)) / C.span;
      const edgeFade = 1 - THREE.MathUtils.smoothstep(edge, 0.82, 1);
      const breathe = Math.sin(this.time * 0.12 + c.phase);
      for (const p of c.parts) {
        const px = c.x + p.ox, py = c.y + p.oy + breathe * 0.6, pz = c.z + p.oz;
        p.sprite.position.set(px, py, pz);
        p.sprite.scale.set(p.sx * (1 + breathe * 0.04), p.sy * (1 + breathe * 0.05), 1);
        // Thin out when the camera is inside or right next to it.
        const d = Math.hypot(px - camPos.x, py - camPos.y, pz - camPos.z);
        const lens = THREE.MathUtils.smoothstep(d, p.sx * 0.6, p.sx * 1.6);
        const m = p.sprite.material as THREE.SpriteMaterial;
        m.opacity = c.alpha * zoom * edgeFade * lens;
        m.color.setRGB(light, light, light * (1.02 + (1 - day) * 0.08));
      }
    }
  }
}
