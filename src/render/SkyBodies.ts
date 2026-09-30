import * as THREE from 'three';
import type { LightState } from './Lighting';

/** A disc with a soft, bright edge (the sun), or a glow falling off from the middle. */
function radialTexture(stops: [number, string][], size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A full moon: a pale disc, darker near its rim, with soft grey maria and a few bright craters. */
function moonTexture(): THREE.Texture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = S * 0.46, m = S / 2;
  g.save();
  g.beginPath();
  g.arc(m, m, r, 0, Math.PI * 2);
  g.clip();
  const base = g.createRadialGradient(m - r * 0.2, m - r * 0.25, r * 0.1, m, m, r);
  base.addColorStop(0, '#fbfaf4');
  base.addColorStop(0.75, '#e6e5dc');
  base.addColorStop(1, '#b9bab4');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // The dark "seas".
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const maria: [number, number, number][] = [[-0.25, -0.2, 0.3], [0.12, -0.3, 0.22], [0.2, 0.05, 0.26], [-0.05, 0.28, 0.2], [-0.35, 0.18, 0.16]];
  for (const [x, y, s] of maria) {
    for (let k = 0; k < 5; k++) {
      const cx = m + (x + (rnd() - 0.5) * 0.12) * r, cy = m + (y + (rnd() - 0.5) * 0.12) * r, rr = s * r * (0.6 + rnd() * 0.6);
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      grd.addColorStop(0, 'rgba(120,122,128,0.45)');
      grd.addColorStop(1, 'rgba(120,122,128,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, S, S);
    }
  }
  // Bright little craters.
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.92, rr = 1 + rnd() * 4;
    g.fillStyle = `rgba(255,255,250,${0.25 + rnd() * 0.35})`;
    g.beginPath();
    g.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, rr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // A soft edge.
  g.globalCompositeOperation = 'destination-in';
  const edge = g.createRadialGradient(m, m, r * 0.94, m, m, r * 1.02);
  edge.addColorStop(0, 'rgba(0,0,0,1)');
  edge.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _p = new THREE.Vector3();
const _c = new THREE.Color();
const deg = Math.PI / 180;

/**
 * The sun and the moon in the sky, where the light really comes from: seen whenever the view
 * looks up far enough (free-roam POV, or tilted low). The sun is a bright disc in a warm glow that
 * turns orange, swells and sinks into the sea as it sets; at night a pale full moon rides high in
 * a cool halo. Both fade behind storm cloud. They sit far off along their directions from the
 * camera (inside the far plane and the sea, so the sea hides the sun once it has set).
 */
export class SkyBodies {
  readonly group = new THREE.Group();
  private sun: THREE.Sprite;
  /** A tight bright corona round the disc, and the wide, warm brightening of the sky round it. */
  private sunCorona: THREE.Sprite;
  private sunGlow: THREE.Sprite;
  private moon: THREE.Sprite;
  private moonGlow: THREE.Sprite;
  private static DIST = 1100;

  constructor() {
    const sprite = (map: THREE.Texture, additive: boolean, order: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      s.renderOrder = order;
      s.frustumCulled = false;
      this.group.add(s);
      return s;
    };
    const glow = radialTexture([[0, 'rgba(255,255,255,0.55)'], [0.18, 'rgba(255,255,255,0.28)'], [0.45, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']]);
    const aureole = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.12, 'rgba(255,255,255,0.55)'], [0.35, 'rgba(255,255,255,0.18)'], [0.7, 'rgba(255,255,255,0.04)'], [1, 'rgba(255,255,255,0)']]);
    this.sunGlow = sprite(aureole, true, -7);
    this.sunCorona = sprite(glow, true, -6);
    this.sun = sprite(radialTexture([[0, 'rgba(255,255,255,1)'], [0.78, 'rgba(255,255,255,1)'], [0.9, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]), true, -5);
    this.moonGlow = sprite(glow, true, -6);
    this.moon = sprite(moonTexture(), false, -5);
    this.group.name = 'skyBodies';
  }

  /** Place them for this frame, around the camera. `overcast` 0..1 hides them behind cloud. */
  update(camera: THREE.Camera, ls: LightState, overcast: number): void {
    const cam = camera.position, D = SkyBodies.DIST;
    const size = (angle: number) => 2 * D * Math.tan((angle * deg) / 2);
    const clouds = 1 - Math.min(1, overcast * 1.1);

    // The sun: warmer, larger and dimmer low down; gone once it has sunk below the horizon.
    const elev = Math.asin(THREE.MathUtils.clamp(ls.sunSky.y, -1, 1)) / deg;
    const sunVis = THREE.MathUtils.smoothstep(elev, -4, 1.5) * clouds;
    this.sun.visible = this.sunGlow.visible = this.sunCorona.visible = sunVis > 0.003;
    if (this.sun.visible) {
      const low = 1 - THREE.MathUtils.smoothstep(elev, 0, 20);
      _p.copy(ls.sunSky).multiplyScalar(D).add(cam);
      this.sun.position.copy(_p);
      this.sunGlow.position.copy(_p);
      this.sunCorona.position.copy(_p);
      const disc = size(3.2 * (1 + 0.35 * low));
      this.sun.scale.set(disc, disc, 1);
      const corona = size(9 * (1 + 0.6 * low));
      this.sunCorona.scale.set(corona, corona, 1);
      const halo = size(30 * (1 + 0.4 * low));
      this.sunGlow.scale.set(halo, halo, 1);
      // A white-hot disc tinted by the sunlight's own colour (deep orange as it sets).
      _c.set(1, 1, 1).lerp(ls.sunColor, 0.4 + 0.55 * low);
      const sm = this.sun.material as THREE.SpriteMaterial;
      sm.color.copy(_c).multiplyScalar(2.6 * (1 - 0.35 * low));
      sm.opacity = sunVis;
      // A bright corona (radiant as it sets) in a wide glow that warms the sky round it.
      const cm = this.sunCorona.material as THREE.SpriteMaterial;
      cm.color.copy(ls.sunColor).multiplyScalar(2.2 + 1.3 * low);
      cm.opacity = sunVis;
      const gm = this.sunGlow.material as THREE.SpriteMaterial;
      gm.color.copy(ls.sunColor).multiplyScalar(0.55 + 0.35 * low);
      gm.opacity = sunVis * 0.7;
    }

    // The moon: rises into the night sky with the moonlight, a cool halo round it.
    const mElev = Math.asin(THREE.MathUtils.clamp(ls.moonSky.y, -1, 1)) / deg;
    const moonVis = THREE.MathUtils.smoothstep(ls.night, 0.35, 0.75) * THREE.MathUtils.smoothstep(mElev, -2, 3) * clouds;
    this.moon.visible = this.moonGlow.visible = moonVis > 0.003;
    if (this.moon.visible) {
      _p.copy(ls.moonSky).multiplyScalar(D).add(cam);
      this.moon.position.copy(_p);
      this.moonGlow.position.copy(_p);
      const disc = size(2.9);
      this.moon.scale.set(disc, disc, 1);
      const halo = size(11);
      this.moonGlow.scale.set(halo, halo, 1);
      const mm = this.moon.material as THREE.SpriteMaterial;
      mm.color.setRGB(1.25, 1.27, 1.3);
      mm.opacity = moonVis;
      const gm = this.moonGlow.material as THREE.SpriteMaterial;
      gm.color.setRGB(0.55, 0.65, 0.85);
      gm.opacity = moonVis * 0.45;
    }
  }
}
