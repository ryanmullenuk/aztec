import * as THREE from 'three';
import { COLORS, WORLD } from '../config';
import { Simplex2, clamp, smoothstep } from '../world/noise';
import { RNG } from '../world/rng';
import { World } from '../world/World';

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function col(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

const C = {
  sand: col(COLORS.sand),
  sandGold: col(COLORS.sandGold),
  wetSand: col(COLORS.wetSand),
  seabed: col(0xe6d3a2),
  seabedDeep: col(0x9fb7a8),
  grass: col(COLORS.grass),
  grassBright: col(COLORS.grassBright),
  olive: col(COLORS.grassOlive),
  jungleFloor: col(0x55822c),
  earth: col(0x9a7a4a),
  rock: col(COLORS.rock),
  rockLight: col(COLORS.rockLight),
  rockLav: col(COLORS.rockShadow),
  moss: col(COLORS.moss),
};

/**
 * Stepped, rounded-terrace terrain mesh built from the world layer grid.
 * Colours are baked into vertex colours; dynamic path wear and farm soil come from a
 * small data texture sampled in the fragment shader.
 */
export class Terrain {
  /** Group of chunk meshes that share one vertex buffer (each chunk is frustum-culled on its own). */
  readonly mesh = new THREE.Group();
  private chunks: { mesh: THREE.Mesh; i0: number; i1: number; j0: number; j1: number }[] = [];
  readonly material: THREE.MeshStandardMaterial;
  readonly wearTex: THREE.DataTexture;
  private geo: THREE.BufferGeometry;
  private M: number;
  private step: number;
  private noise: Simplex2;
  private wearData: Uint8Array;
  readonly uniforms = {
    uTime: { value: 0 },
    uWear: { value: null as THREE.Texture | null },
    uWorld: { value: WORLD.size },
    uPathCol: { value: new THREE.Color(COLORS.dirt) },
    uPathCol2: { value: new THREE.Color(COLORS.dirtDark) },
    uSoilCol: { value: new THREE.Color(COLORS.soil) },
    uCaustic: { value: 1 },
  };

  private sub: number;

  constructor(private world: World, subdiv: number = WORLD.meshSubdiv) {
    this.sub = subdiv;
    this.noise = new Simplex2(new RNG(world.seed * 7 + 3));
    this.M = world.N * subdiv;
    this.step = 1 / subdiv;
    const V = this.M + 1;
    const pos = new Float32Array(V * V * 3);
    const nor = new Float32Array(V * V * 3);
    const colr = new Float32Array(V * V * 3);
    const mask = new Float32Array(V * V * 2);
    const idx = new Uint32Array(this.M * this.M * 6);
    let k = 0;
    for (let j = 0; j < this.M; j++) {
      for (let i = 0; i < this.M; i++) {
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        // Alternate the diagonal for a less regular look.
        if ((i + j) & 1) {
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        } else {
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
        }
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    this.geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));

    const N = world.N;
    this.wearData = new Uint8Array(N * N * 4);
    this.wearTex = new THREE.DataTexture(this.wearData, N, N, THREE.RGBAFormat);
    this.wearTex.magFilter = THREE.LinearFilter;
    this.wearTex.minFilter = THREE.LinearFilter;
    this.wearTex.needsUpdate = true;
    this.uniforms.uWear.value = this.wearTex;

    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.material.onBeforeCompile = (shader) => this.patchShader(shader);
    // Chunks: same attributes (one GPU buffer), separate index ranges and bounds.
    const C = 6;
    const per = Math.ceil(this.M / C);
    for (let cj = 0; cj < C; cj++) {
      for (let ci = 0; ci < C; ci++) {
        const i0 = ci * per, i1 = Math.min(this.M, (ci + 1) * per);
        const j0 = cj * per, j1 = Math.min(this.M, (cj + 1) * per);
        const ix: number[] = [];
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            const q = (j * this.M + i) * 6;
            for (let k = 0; k < 6; k++) ix.push(idx[q + k]);
          }
        }
        const g = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'color', 'aMask']) g.setAttribute(name, this.geo.getAttribute(name));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(ix), 1));
        const m = new THREE.Mesh(g, this.material);
        m.receiveShadow = true;
        m.castShadow = true;
        m.name = 'terrain';
        this.chunks.push({ mesh: m, i0, i1, j0, j1 });
        this.mesh.add(m);
      }
    }
    this.rebuild(0, 0, N - 1, N - 1);
    this.updateWear();
  }

  /** Recompute vertices covering the cell rectangle (inclusive), padded for smoothing. */
  rebuild(cx0: number, cz0: number, cx1: number, cz1: number): void {
    const w = this.world;
    const s = this.sub;
    const V = this.M + 1;
    const i0 = clamp((cx0 - 4) * s, 0, this.M), i1 = clamp((cx1 + 5) * s, 0, this.M);
    const j0 = clamp((cz0 - 4) * s, 0, this.M), j1 = clamp((cz1 + 5) * s, 0, this.M);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = this.geo.getAttribute('normal') as THREE.BufferAttribute;
    const colr = this.geo.getAttribute('color') as THREE.BufferAttribute;
    const mask = this.geo.getAttribute('aMask') as THREE.BufferAttribute;
    const P = pos.array as Float32Array, NR = nor.array as Float32Array, CL = colr.array as Float32Array, MK = mask.array as Float32Array;
    const e = 0.2;
    const n = new THREE.Vector3();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = i * this.step - w.half;
        const z = j * this.step - w.half;
        const y = w.heightAt(x, z);
        const v = j * V + i;
        P[v * 3] = x;
        P[v * 3 + 1] = y;
        P[v * 3 + 2] = z;
        const hx = w.heightAt(x + e, z) - w.heightAt(x - e, z);
        const hz = w.heightAt(x, z + e) - w.heightAt(x, z - e);
        n.set(-hx, 2 * e, -hz).normalize();
        NR[v * 3] = n.x;
        NR[v * 3 + 1] = n.y;
        NR[v * 3 + 2] = n.z;
        const m = this.colorAt(x, z, y, n.y, tmpA);
        CL[v * 3] = tmpA.r;
        CL[v * 3 + 1] = tmpA.g;
        CL[v * 3 + 2] = tmpA.b;
        MK[v * 2] = m.grass;
        MK[v * 2 + 1] = m.flat;
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    colr.needsUpdate = true;
    mask.needsUpdate = true;
    // Refresh bounds of the chunks we touched.
    for (const c of this.chunks) {
      if (c.i1 < i0 || c.i0 > i1 || c.j1 < j0 || c.j0 > j1) continue;
      let minY = Infinity, maxY = -Infinity;
      for (let j = c.j0; j <= c.j1; j += 2) {
        for (let i = c.i0; i <= c.i1; i += 2) {
          const y = P[(j * V + i) * 3 + 1];
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      const cx = ((c.i0 + c.i1) / 2) * this.step - w.half, cz = ((c.j0 + c.j1) / 2) * this.step - w.half;
      const hw = ((c.i1 - c.i0) / 2) * this.step, hd = ((c.j1 - c.j0) / 2) * this.step, hh = (maxY - minY) / 2 + 0.5;
      const g = c.mesh.geometry;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(hw, hd, hh));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - hw, minY - 0.5, cz - hd), new THREE.Vector3(cx + hw, maxY + 0.5, cz + hd));
    }
  }

  /** Terrain colour rules: seabed, wet sand, beach, meadow, jungle floor, earthy terrace faces, rock and moss. */
  private colorAt(x: number, z: number, y: number, ny: number, out: THREE.Color): { grass: number; flat: number } {
    const w = this.world;
    const nz1 = this.noise.noise(x * 0.09, z * 0.09);
    const nz2 = this.noise.noise(x * 0.35 + 40, z * 0.35 - 40);
    const flat = smoothstep(0.8, 0.97, ny);
    if (y < -0.04) {
      const depth = -y;
      out.copy(C.seabed).lerp(C.seabedDeep, smoothstep(0.3, 3.5, depth));
      out.multiplyScalar(0.95 + nz2 * 0.06);
      return { grass: 0, flat: 0 };
    }
    // Bicubic samples with a slight noise warp: soft, organic boundaries between grass, jungle floor, sand and rock.
    const qx = x + nz2 * 0.45, qz = z + nz1 * 0.45;
    const sandy = w.sampleFieldCubic(w.sandy, qx, qz);
    const forest = w.sampleFieldCubic(w.forest, qx, qz);
    const rocky = w.sampleFieldCubic(w.rocky, qx, qz);
    // Grass: lime to yellow-green in the sun, olive in dips and on terrace faces.
    tmpB.copy(C.grass).lerp(C.grassBright, clamp(0.5 + nz1 * 0.6 + nz2 * 0.2, 0, 1));
    out.copy(tmpB).lerp(C.olive, clamp((1 - flat) * 0.3 + Math.max(0, -nz1) * 0.25, 0, 1));
    out.lerp(C.jungleFloor, clamp(forest * 0.6 * (0.6 + flat * 0.4), 0, 1));
    out.lerp(C.earth, (1 - flat) * 0.28);
    // Sand: wet at the waterline, cream to pale gold above.
    const lowSand = 1 - smoothstep(0.35, 0.9, y);
    const sandAmt = clamp(Math.max(sandy, lowSand * (1 - rocky)), 0, 1);
    if (sandAmt > 0) {
      tmpB.copy(C.sand).lerp(C.sandGold, clamp(0.5 + nz2 * 0.7, 0, 1));
      tmpB.lerp(C.wetSand, 1 - smoothstep(-0.04, 0.16, y));
      out.lerp(tmpB, sandAmt);
    }
    // Rock: warm grey-mauve, lavender on faces, moss on flat tops.
    if (rocky > 0.05) {
      tmpB.copy(C.rock).lerp(C.rockLight, clamp(0.5 + nz2 * 0.8, 0, 1));
      tmpB.lerp(C.rockLav, (1 - flat) * 0.2);
      tmpB.lerp(C.moss, flat * 0.3 * clamp(0.5 + nz1, 0, 1));
      out.lerp(tmpB, smoothstep(0.1, 0.7, rocky) * (0.65 + (1 - flat) * 0.35));
    }
    const grass = clamp((1 - sandAmt) * (1 - rocky) * (1 - forest * 0.8) * flat, 0, 1);
    return { grass, flat };
  }

  /** Push wear and soil fields into the GPU texture. */
  updateWear(): void {
    const w = this.world;
    const d = this.wearData;
    for (let i = 0; i < w.N * w.N; i++) {
      d[i * 4] = Math.min(255, w.wear[i] * 255);
      d[i * 4 + 1] = Math.min(255, w.soil[i] * 255);
      d[i * 4 + 2] = 0;
      d[i * 4 + 3] = 255;
    }
    this.wearTex.needsUpdate = true;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  private patchShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
    Object.assign(shader.uniforms, this.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 aMask;
        varying vec3 vWPos;
        varying vec2 vMask;
        varying float vViewDist;`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 wpT = modelMatrix * vec4(transformed, 1.0);
        vWPos = wpT.xyz;
        vMask = aMask;
        vViewDist = length(cameraPosition - wpT.xyz);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform sampler2D uWear;
        uniform float uWorld;
        uniform vec3 uPathCol;
        uniform vec3 uPathCol2;
        uniform vec3 uSoilCol;
        uniform float uCaustic;
        varying vec3 vWPos;
        varying vec2 vMask;
        varying float vViewDist;
        float th21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        float vn2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(th21(i), th21(i + vec2(1.0, 0.0)), f.x), mix(th21(i + vec2(0.0, 1.0)), th21(i + vec2(1.0, 1.0)), f.x), f.y); }
        float caustic(vec2 p, float t){
          vec2 q = p * 0.75;
          float c = 0.0;
          for (int i = 0; i < 3; i++) {
            q += vec2(sin(q.y * 1.3 + t * 0.8), cos(q.x * 1.2 - t * 0.6)) * 0.55;
            c += abs(sin(q.x * 1.9) * cos(q.y * 1.7));
          }
          return pow(clamp(c / 3.0, 0.0, 1.0), 6.0) * 2.4;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 wuv = (vWPos.xz + uWorld * 0.5) / uWorld;
          vec4 wr = texture2D(uWear, wuv);
          // Smooth noise (not per-cell hash) so dirt paths have soft, organic edges.
          float grain = vn2(vWPos.xz * 2.3) * 0.65 + vn2(vWPos.xz * 7.0) * 0.35;
          // Farm soil with furrows.
          float soil = smoothstep(0.1, 0.6, wr.g) * vMask.y;
          float furrow = 0.82 + 0.18 * sin(vWPos.x * 7.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, uSoilCol * furrow, soil);
          // Trampled paths: terracotta dirt with a ragged edge.
          float wear = smoothstep(0.3 + grain * 0.35, 0.9 + grain * 0.1, wr.r) * (0.4 + 0.6 * vMask.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(uPathCol, uPathCol2, grain), wear);
          // Tiny wildflower specks on sunny meadow grass.
          vec2 fc = floor(vWPos.xz * 4.0);
          float h = th21(fc);
          if (h > 0.93 && vMask.x > 0.45 && wear < 0.2 && soil < 0.1) {
            vec2 fp = fract(vWPos.xz * 4.0) - 0.5 - (vec2(th21(fc + 3.1), th21(fc + 7.7)) - 0.5) * 0.5;
            float m = smoothstep(0.13, 0.07, length(fp)) * (1.0 - smoothstep(35.0, 70.0, vViewDist));
            float pick = fract(h * 97.0);
            vec3 fcol = pick < 0.4 ? vec3(1.0, 0.98, 0.92) : (pick < 0.7 ? vec3(1.0, 0.55, 0.72) : vec3(1.0, 0.86, 0.25));
            diffuseColor.rgb = mix(diffuseColor.rgb, fcol, m * vMask.x);
          }
          // Caustics dancing on the shallow seabed.
          if (vWPos.y < 0.02) {
            float depth = -vWPos.y;
            float c = caustic(vWPos.xz, uTime) * exp(-depth * 0.7) * smoothstep(0.0, 0.25, depth) * uCaustic;
            diffuseColor.rgb += vec3(0.85, 1.0, 0.95) * c * 0.45;
          }
        }`
      );
  }
}
