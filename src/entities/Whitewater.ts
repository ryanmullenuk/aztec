import * as THREE from 'three';

/**
 * Clumps of white water and drifting mist for big splashes: each is a textured, rotating sprite
 * (a ragged, bubbly clump from a small atlas, shaded as if lit from above) that fades in, then
 * out, slows in the air and drops back into the sea (vanishing as it goes under).
 */
export class Whitewater {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private peak: Float32Array;
  private drag: Float32Array;
  private spin: Float32Array;
  private alpha: Float32Array;
  private rot: Float32Array;
  private tile: Float32Array;
  private next = 0;
  private live = 0;
  readonly color: THREE.Color;

  constructor(private n: number, texture: THREE.Texture, private gravity: number, opacity = 1) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3).fill(-1000);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.peak = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.spin = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.rot = new Float32Array(n);
    this.tile = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1));
    g.setAttribute('aTile', new THREE.BufferAttribute(this.tile, 1));
    this.color = new THREE.Color(1, 1, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uColor: { value: this.color }, uScale: { value: 600 }, uOpacity: { value: opacity } },
      vertexShader: `attribute float aAlpha; attribute float aSize; attribute float aRot; attribute float aTile;
        varying float vA; varying float vRot; varying vec2 vTile; uniform float uScale;
        void main(){
          vA = aAlpha; vRot = aRot; vTile = vec2(mod(aTile, 2.0), floor(aTile / 2.0)) * 0.5;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uOpacity;
        varying float vA; varying float vRot; varying vec2 vTile;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float s = sin(vRot), k = cos(vRot);
          vec2 r = vec2(c.x * k - c.y * s, c.x * s + c.y * k) + 0.5;
          if (r.x < 0.0 || r.y < 0.0 || r.x > 1.0 || r.y > 1.0) discard;
          vec4 t = texture2D(uMap, vTile + r * 0.5);
          float a = t.a * vA * uOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor * t.rgb, min(a, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 16;
  }

  /**
   * One clump. `tile` picks the sprite (0-2 clumps, 3 mist; -1 any clump); `alpha` its peak
   * opacity; `drag` how fast the air slows it (per second).
   */
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grow = 0, alpha = 1, drag = 0.4, tile = -1): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.peak[i] = alpha;
    this.drag[i] = drag;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * 1.6;
    this.tile[i] = tile >= 0 ? tile : Math.floor(Math.random() * 3);
    this.live = Math.max(this.live, 1);
  }

  update(dt: number): void {
    if (!this.live) return;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      alive++;
      // Clumps thin out into rain as they fall back.
      this.life[i] -= this.vel[i * 3 + 1] < 0 ? dt * 1.8 : dt;
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 2] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.gravity * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // Falling back into the sea: gone almost at once (never left lying on the water).
      if (this.pos[j + 1] < 0.12 && this.vel[j + 1] < 0) this.life[i] = Math.min(this.life[i], 0.12);
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      const age = 1 - Math.max(0, this.life[i]) / this.max[i];
      this.alpha[i] = this.peak[i] * Math.min(1, age / 0.08) * Math.pow(1 - age, 1.3);
    }
    this.live = alive;
    const g = this.points.geometry;
    for (const name of ['position', 'aAlpha', 'aSize', 'aRot']) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aTile') as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Atlas of 2 x 2 sprites: three ragged, bubbly clumps of white water and one soft puff of mist. */
export function whitewaterTexture(): THREE.Texture {
  const T = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = T * 2;
  const g = cv.getContext('2d')!;
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * T, oy = Math.floor(k / 2) * T, c = T / 2;
    const layer = document.createElement('canvas');
    layer.width = layer.height = T;
    const l = layer.getContext('2d')!;
    if (k < 3) {
      // A cauliflower heap of foam: many soft lumps, spread out so the outline is ragged.
      for (let i = 0; i < 24; i++) {
        const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.65) * 34;
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, R = 9 + rnd() * 16;
        const grd = l.createRadialGradient(x, y, 0, x, y, R);
        grd.addColorStop(0, 'rgba(255,255,255,0.8)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.55)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        l.fillStyle = grd;
        l.fillRect(0, 0, T, T);
      }
      // Shadowed folds between the lumps, for volume.
      l.globalCompositeOperation = 'source-atop';
      for (let i = 0; i < 14; i++) {
        const a = rnd() * Math.PI * 2, d = rnd() * 30;
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d + 6, R = 6 + rnd() * 10;
        const grd = l.createRadialGradient(x, y, 0, x, y, R);
        grd.addColorStop(0, 'rgba(120,150,168,0.35)');
        grd.addColorStop(1, 'rgba(120,150,168,0)');
        l.fillStyle = grd;
        l.fillRect(0, 0, T, T);
      }
      // A little frothy texture through it.
      l.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 18; i++) {
        const a = rnd() * Math.PI * 2, d = rnd() * 36;
        l.fillStyle = `rgba(0,0,0,${0.15 + rnd() * 0.25})`;
        l.beginPath();
        l.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 1 + rnd() * 2.5, 0, Math.PI * 2);
        l.fill();
      }
      // Streaks of spray thrown out from it, and stray droplets.
      l.globalCompositeOperation = 'source-over';
      l.lineCap = 'round';
      for (let i = 0; i < 9; i++) {
        const a = rnd() * Math.PI * 2, d0 = 22 + rnd() * 10, d1 = d0 + 8 + rnd() * 16;
        l.strokeStyle = `rgba(255,255,255,${0.2 + rnd() * 0.3})`;
        l.lineWidth = 1 + rnd() * 2;
        l.beginPath();
        l.moveTo(c + Math.cos(a) * d0, c + Math.sin(a) * d0);
        l.lineTo(c + Math.cos(a) * d1, c + Math.sin(a) * d1);
        l.stroke();
      }
      for (let i = 0; i < 20; i++) {
        const a = rnd() * Math.PI * 2, d = 30 + rnd() * 24;
        l.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.5})`;
        l.beginPath();
        l.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 0.7 + rnd() * 1.6, 0, Math.PI * 2);
        l.fill();
      }
    } else {
      // Mist: a thin, uneven cloud made of many faint wisps.
      for (let i = 0; i < 34; i++) {
        const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * 38;
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d * 0.8, R = 8 + rnd() * 14;
        const grd = l.createRadialGradient(x, y, 0, x, y, R);
        grd.addColorStop(0, 'rgba(255,255,255,0.16)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        l.fillStyle = grd;
        l.fillRect(0, 0, T, T);
      }
    }
    // Keep everything inside the sprite, fading at the edge.
    l.globalCompositeOperation = 'destination-in';
    const edge = l.createRadialGradient(c, c, T * 0.36, c, c, T * 0.5);
    edge.addColorStop(0, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = edge;
    l.fillRect(0, 0, T, T);
    // Shade: lit from above, a little grey-blue underneath.
    l.globalCompositeOperation = 'source-atop';
    const sh = l.createLinearGradient(0, 0, 0, T);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(1, k < 3 ? 'rgba(150,176,192,0.55)' : 'rgba(200,215,225,0.3)');
    l.fillStyle = sh;
    l.fillRect(0, 0, T, T);
    g.drawImage(layer, ox, oy);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
