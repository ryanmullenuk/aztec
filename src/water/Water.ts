import * as THREE from 'three';
import { COLORS, WORLD } from '../config';
import { World } from '../world/World';

/** GLSL shared by the ocean, rivers and pool. */
const waterVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const waterFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uWorld;
  uniform float uFlow;
  uniform sampler2D uHeight;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform float uSunI;
  uniform vec3 uSkyCol;
  uniform float uDay;
  uniform float uStorm;
  uniform vec3 cDeep; uniform vec3 cDeep2; uniform vec3 cMid; uniform vec3 cShallow; uniform vec3 cShallowB; uniform vec3 cFoam;
  varying vec3 vW;

  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float waveH(vec2 p, float t){
    float amp = 1.0 + uStorm * 1.5;
    float h = 0.05 * sin(dot(p, vec2(0.8, 0.6)) * 1.1 + t * 1.2)
            + 0.035 * sin(dot(p, vec2(-0.5, 0.9)) * 1.8 + t * 1.6)
            + 0.04 * vnoise(p * 1.3 + vec2(t * 0.32, t * 0.21) * (1.0 + uFlow * 2.0))
            + 0.022 * vnoise(p * 3.2 - vec2(t * 0.45, -t * 0.28) * (1.0 + uFlow * 3.0));
    return h * amp;
  }
  void main() {
    vec2 uv = (vW.xz + uWorld * 0.5) / uWorld;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    vec4 hr = texture2D(uHeight, clamp(uv, 0.0, 1.0));
    float bed = mix(-7.0, hr.r, inside);
    float depth = max(vW.y - bed, 0.0);
    float t = uTime;
    vec2 p = vW.xz;
    float e = 0.12;
    float h0 = waveH(p, t);
    vec3 n = normalize(vec3(h0 - waveH(p + vec2(e, 0.0), t), e * 1.4, h0 - waveH(p + vec2(0.0, e), t)));
    vec3 V = normalize(cameraPosition - vW);

    // Colour by depth: luminous turquoise shallows -> azure -> cobalt/sapphire, darker toward the map edge.
    vec3 col = mix(cShallowB, cShallow, smoothstep(0.05, 0.55, depth));
    col = mix(col, cMid, smoothstep(0.55, 1.7, depth));
    col = mix(col, cDeep2, smoothstep(1.7, 3.6, depth));
    float far = smoothstep(uWorld * 0.42, uWorld * 1.4, length(vW.xz));
    col = mix(col, cDeep, clamp(max(smoothstep(3.6, 6.5, depth), far), 0.0, 1.0));

    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 lit = col * (0.62 + 0.38 * ndl) * mix(vec3(1.0), uSunCol, 0.22) * mix(0.28, 1.0, uDay);
    // Fresnel sky reflection.
    float F = 0.02 + 0.55 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    lit = mix(lit, uSkyCol * mix(0.35, 1.0, uDay), F);
    // Sun sparkle.
    vec3 R = reflect(-uSunDir, n);
    float sp = pow(max(dot(R, V), 0.0), 220.0);
    float glint = step(0.72, vnoise(p * 9.0 + t * 1.3)) * pow(max(dot(R, V), 0.0), 40.0);
    lit += uSunCol * (sp * 2.2 + glint * 0.9) * uSunI * 0.45 * (1.0 - uStorm * 0.8);

    // Shoreline foam from the depth difference, curling bands and foam around rocks.
    float fn = vnoise(p * 1.4 + t * 0.15);
    float shore = 1.0 - smoothstep(0.0, 0.16 + 0.1 * fn, depth);
    float bandMask = 1.0 - smoothstep(0.1, 0.55, depth);
    float bands = smoothstep(0.6, 0.95, sin(depth * 20.0 - t * 1.7 + fn * 5.0) * 0.5 + 0.5) * bandMask;
    float rock = hr.g * (0.65 + 0.35 * sin(t * 1.8 + fn * 6.0));
    float foam = clamp(shore + bands * 0.55 + rock, 0.0, 1.0);
    foam *= smoothstep(0.25, 0.55, vnoise(p * 3.6 + vec2(t * 0.4, -t * 0.25)) + shore * 0.7 + rock * 0.4);
    foam *= inside;
    lit = mix(lit, cFoam * mix(0.35, 1.05, uDay), foam);

    // Deep water stays slightly translucent so whales, rays and fish schools show beneath the surface.
    float alpha = mix(0.32, 0.82, smoothstep(0.2, 3.2, depth));
    alpha = max(alpha, foam);
    gl_FragColor = vec4(lit, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Waterfall curtain: fast scrolling streaks. */
const fallFrag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uDay;
  varying vec2 vUv;
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hsh(i), hsh(i + vec2(1.0, 0.0)), u.x), mix(hsh(i + vec2(0.0, 1.0)), hsh(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float s = vnoise(vec2(vUv.x * 14.0, vUv.y * 3.0 + uTime * 3.2));
    float s2 = vnoise(vec2(vUv.x * 30.0, vUv.y * 6.0 + uTime * 4.5));
    vec3 col = mix(vec3(0.35, 0.8, 0.85), vec3(0.97, 1.0, 1.0), smoothstep(0.35, 0.8, s * 0.6 + s2 * 0.5 + vUv.y * 0.15));
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    float a = edge * (0.75 + 0.25 * s) * smoothstep(0.0, 0.08, 1.0 - vUv.y);
    gl_FragColor = vec4(col * mix(0.35, 1.0, uDay), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;
const fallVert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

export function makeSoftSprite(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Ocean, rivers, the waterfall pool and waterfall with mist.
 * Depth comes from a seabed height texture (terrain height per half-cell), so it works for
 * rivers above sea level as well as the ocean and needs no depth pre-pass.
 */
export class Water {
  readonly group = new THREE.Group();
  readonly oceanMat: THREE.ShaderMaterial;
  readonly riverMat: THREE.ShaderMaterial;
  readonly heightTex: THREE.DataTexture;
  private heightData: Uint16Array;
  private res: number;
  private fallMat: THREE.ShaderMaterial | null = null;
  private mist: THREE.Points | null = null;
  private mistVel: Float32Array | null = null;
  private mistLife: Float32Array | null = null;
  readonly shared = {
    uTime: { value: 0 },
    uWorld: { value: WORLD.size },
    uSunDir: { value: new THREE.Vector3(0.5, 0.5, 0.5).normalize() },
    uSunCol: { value: new THREE.Color(COLORS.sunWarm) },
    uSunI: { value: 3 },
    uSkyCol: { value: new THREE.Color(COLORS.sky) },
    uDay: { value: 1 },
    uStorm: { value: 0 },
  };

  constructor(private world: World) {
    this.res = world.N * 2;
    this.heightData = new Uint16Array(this.res * this.res * 4);
    this.heightTex = new THREE.DataTexture(this.heightData, this.res, this.res, THREE.RGBAFormat, THREE.HalfFloatType);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.updateHeight(0, 0, world.N - 1, world.N - 1);

    const colorUniforms = () => ({
      cDeep: { value: new THREE.Color(COLORS.deepOcean) },
      cDeep2: { value: new THREE.Color(COLORS.deepOcean2) },
      cMid: { value: new THREE.Color(COLORS.midWater) },
      cShallow: { value: new THREE.Color(COLORS.shallow) },
      cShallowB: { value: new THREE.Color(COLORS.shallowBright) },
      cFoam: { value: new THREE.Color(COLORS.foam) },
    });
    const make = (flow: number) =>
      new THREE.ShaderMaterial({
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          ...this.shared,
          ...colorUniforms(),
          uHeight: { value: this.heightTex },
          uFlow: { value: flow },
        },
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        fog: true,
        depthWrite: true,
      });
    this.oceanMat = make(0);
    this.riverMat = make(1);

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize, 1, 1).rotateX(-Math.PI / 2), this.oceanMat);
    ocean.name = 'ocean';
    ocean.renderOrder = 10;
    this.group.add(ocean);

    this.buildRivers();
    this.buildWaterfall();
  }

  /** Recompute the seabed height texture for a cell rectangle. */
  updateHeight(cx0: number, cz0: number, cx1: number, cz1: number): void {
    const w = this.world;
    const r = this.res;
    const toH = THREE.DataUtils.toHalfFloat;
    const x0 = Math.max(0, (cx0 - 4) * 2), x1 = Math.min(r - 1, (cx1 + 5) * 2);
    const z0 = Math.max(0, (cz0 - 4) * 2), z1 = Math.min(r - 1, (cz1 + 5) * 2);
    for (let j = z0; j <= z1; j++) {
      for (let i = x0; i <= x1; i++) {
        const x = (i + 0.5) / 2 - w.half;
        const z = (j + 0.5) / 2 - w.half;
        const k = (j * r + i) * 4;
        this.heightData[k] = toH(w.heightAt(x, z));
        this.heightData[k + 1] = toH(w.sampleField(w.foam, x, z));
        this.heightData[k + 2] = 0;
        this.heightData[k + 3] = toH(1);
      }
    }
    this.heightTex.needsUpdate = true;
  }

  private buildRivers(): void {
    const w = this.world;
    for (const river of w.rivers) {
      if (river.points.length < 3) continue;
      const pts = river.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const samples = pts.length * 3;
      const width = 2.7;
      const pos: number[] = [];
      const idx: number[] = [];
      const p = new THREE.Vector3(), tng = new THREE.Vector3();
      let lastY = Infinity;
      for (let s = 0; s <= samples; s++) {
        const u = s / samples;
        curve.getPointAt(u, p);
        curve.getTangentAt(u, tng);
        const px = -tng.z, pz = tng.x;
        const pl = Math.hypot(px, pz) || 1;
        const y = Math.min(p.y, lastY);
        lastY = y;
        pos.push(p.x + (px / pl) * width * 0.5, y, p.z + (pz / pl) * width * 0.5);
        pos.push(p.x - (px / pl) * width * 0.5, y, p.z - (pz / pl) * width * 0.5);
        if (s > 0) {
          const a = (s - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, this.riverMat);
      m.renderOrder = 11;
      m.name = 'river';
      this.group.add(m);
    }
    if (w.waterfall) {
      const f = w.waterfall;
      const pool = new THREE.Mesh(new THREE.CircleGeometry(f.poolR + 0.9, 40).rotateX(-Math.PI / 2), this.riverMat);
      pool.position.set(f.x + f.dx * (f.poolR + 1.2), f.poolY, f.z + f.dz * (f.poolR + 1.2));
      pool.renderOrder = 11;
      this.group.add(pool);
    }
  }

  private buildWaterfall(): void {
    const f = this.world.waterfall;
    if (!f) return;
    const height = Math.max(0.5, f.topY - f.bottomY);
    const geo = new THREE.PlaneGeometry(2.4, height + 0.4, 6, 12);
    // Curve the curtain outward over the lip.
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const v = 1 - (y + (height + 0.4) / 2) / (height + 0.4);
      pos.setZ(i, Math.sin(v * Math.PI * 0.5) * 0.9 + (1 - v) * 0.1);
    }
    geo.computeVertexNormals();
    this.fallMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: this.shared.uTime, uDay: this.shared.uDay },
      vertexShader: fallVert,
      fragmentShader: fallFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const curtain = new THREE.Mesh(geo, this.fallMat);
    curtain.position.set(f.x, f.bottomY + (height + 0.4) / 2 - 0.1, f.z);
    curtain.rotation.y = Math.atan2(f.dx, f.dz);
    curtain.renderOrder = 12;
    this.group.add(curtain);

    // Mist spray at the base.
    const count = 140;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    this.mistVel = new Float32Array(count * 3);
    this.mistLife = new Float32Array(count);
    for (let i = 0; i < count; i++) this.mistLife[i] = Math.random() * 2;
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.9,
      map: makeSoftSprite(64, 'rgba(255,255,255,0.8)', 'rgba(255,255,255,0)'),
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      sizeAttenuation: true,
    });
    this.mist = new THREE.Points(g, mat);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 13;
    this.group.add(this.mist);
  }

  /** Waves at a point in world space (used for boats bobbing). */
  waveHeight(x: number, z: number, t: number): number {
    const s = 1 + this.shared.uStorm.value * 1.5;
    return (0.05 * Math.sin((x * 0.8 + z * 0.6) * 1.1 + t * 1.2) + 0.035 * Math.sin((-x * 0.5 + z * 0.9) * 1.8 + t * 1.6)) * s;
  }

  update(dt: number, time: number): void {
    this.shared.uTime.value = time;
    const f = this.world.waterfall;
    if (this.mist && f && this.mistVel && this.mistLife) {
      const pos = this.mist.geometry.getAttribute('position') as THREE.BufferAttribute;
      const a = pos.array as Float32Array;
      for (let i = 0; i < this.mistLife.length; i++) {
        this.mistLife[i] -= dt;
        if (this.mistLife[i] <= 0) {
          this.mistLife[i] = 1.5 + Math.random() * 1.5;
          const side = (Math.random() - 0.5) * 2.2;
          a[i * 3] = f.x + f.dx * 1.1 + -f.dz * side;
          a[i * 3 + 1] = f.bottomY + 0.1;
          a[i * 3 + 2] = f.z + f.dz * 1.1 + f.dx * side;
          this.mistVel[i * 3] = f.dx * (0.4 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.5;
          this.mistVel[i * 3 + 1] = 0.3 + Math.random() * 0.8;
          this.mistVel[i * 3 + 2] = f.dz * (0.4 + Math.random() * 0.8) + (Math.random() - 0.5) * 0.5;
        }
        a[i * 3] += this.mistVel[i * 3] * dt;
        a[i * 3 + 1] += this.mistVel[i * 3 + 1] * dt;
        a[i * 3 + 2] += this.mistVel[i * 3 + 2] * dt;
        this.mistVel[i * 3 + 1] *= 0.985;
      }
      pos.needsUpdate = true;
    }
  }
}
