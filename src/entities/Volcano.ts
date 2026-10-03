import * as THREE from 'three';
import { World } from '../world/World';
import { RNG } from '../world/rng';

export type VolcanoPhase = 'dormant' | 'smoking' | 'erupting' | 'cooling';
export interface VolcanoSave { x: number; z: number; phase: VolcanoPhase; remaining: number; cycle: number; coolingHot?: boolean; warningVersion?: number }
export const VOLCANO_SMOKE_SECONDS = 300;
export const VOLCANO_COST = 50;
export const VOLCANO_HAPPINESS = 0.15;

/** Simulation timer is persisted; decorative animation never consumes the game's random stream. */
export class VolcanoCycle {
  phase: VolcanoPhase = 'dormant';
  remaining = 150;
  cycle = 0;
  coolingHot = false;
  constructor(private seed: number, saved?: VolcanoSave) {
    if (saved && ['dormant', 'smoking', 'erupting', 'cooling'].includes(saved.phase)
      && Number.isFinite(saved.remaining) && saved.remaining >= 0 && saved.remaining <= 900) {
      this.phase = saved.phase; this.remaining = saved.remaining;
      // Preserve time already spent smoking when loading the old 35-second warning.
      if (saved.phase === 'smoking' && saved.warningVersion !== 2)
        this.remaining = Math.max(0, VOLCANO_SMOKE_SECONDS - (35 - Math.min(35, saved.remaining)));
      this.coolingHot = saved.coolingHot === true;
      this.cycle = Number.isSafeInteger(saved.cycle) && saved.cycle >= 0 ? saved.cycle : 0;
    }
  }
  get active(): boolean { return this.phase === 'smoking' || this.phase === 'erupting'; }
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.remaining -= dt;
    while (this.remaining <= 0) {
      if (this.phase === 'dormant') { this.phase = 'smoking'; this.remaining += VOLCANO_SMOKE_SECONDS; }
      else if (this.phase === 'smoking') { this.phase = 'erupting'; this.remaining += 65; }
      else if (this.phase === 'erupting') { this.coolingHot = true; this.phase = 'cooling'; this.remaining += 25; }
      else {
        this.phase = 'dormant'; this.cycle++;
        this.remaining += new RNG(this.seed + this.cycle * 7919).range(240, 480);
      }
    }
  }
  calm(pay: (cost: number) => boolean): boolean {
    if (!this.active || !pay(VOLCANO_COST)) return false;
    this.coolingHot = this.phase === 'erupting';
    this.phase = 'cooling'; this.remaining = 25;
    return true;
  }
}

/** Uneven slopes and a broken crater lip shared by the rock and lava geometry. */
export function volcanoSurface(f: number, angle: number): THREE.Vector3 {
  const ridge = Math.sin(angle * 9 + 0.7) * 0.58 + Math.sin(angle * 15 - 0.8) * 0.24;
  const radius = 2.85 + 5.1 * Math.pow(f, 1.12);
  const shoulder = 1 + f * (0.10 * Math.sin(angle * 3 + 0.6) + 0.06 * Math.cos(angle * 5));
  const r = radius * shoulder + ridge * Math.sin(Math.PI * f);
  // Steep fluted walls open onto a broad, asymmetric apron.
  const notch = Math.pow(Math.max(0, Math.cos(angle - 0.35)), 40) * 1.0;
  const lip = Math.sin(angle * 7) * 0.32 + Math.sin(angle * 13) * 0.21 - notch;
  const ridgeLobes = Math.pow(Math.max(0, Math.cos(angle - 2.3)), 6) * 4.4
    + Math.pow(Math.max(0, Math.cos(angle - 4.35)), 10) * 3.3
    + Math.pow(Math.max(0, Math.cos(angle - 5.4)), 8) * 2.0;
  const foothills = ridgeLobes * Math.exp(-(((f - 0.62) / 0.26) ** 2)) * Math.sin(Math.PI * f);
  const height = foothills + 10.2 * Math.pow(1 - f, 1.10) + lip * (1 - f)
    + ridge * Math.sin(Math.PI * f) * 0.8;
  return new THREE.Vector3(Math.cos(angle) * r + 0.38 * (1 - f), height, Math.sin(angle) * r);
}

export function volcanoRockGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], colours: number[] = [], indices: number[] = [];
  const sides = 64, rings = 20;
  const dark = new THREE.Color(0x303740), ash = new THREE.Color(0x879098);
  // Lower flank -> lip -> deep inner crater -> closed rocky floor.
  for (let j = 0; j <= rings + 5; j++) for (let i = 0; i <= sides; i++) {
    const angle = i / sides * Math.PI * 2;
    let point: THREE.Vector3;
    if (j <= rings) point = volcanoSurface(1 - j / rings, angle);
    else {
      const t = (j - rings) / 5;
      point = volcanoSurface(0, angle);
      const innerRadius = t < 1 ? 1 - t * 0.48 : 0;
      point.x = 0.38 + (point.x - 0.38) * innerRadius;
      point.z *= innerRadius;
      point.y = point.y * (1 - t) + 7.2 * t;
    }
    positions.push(point.x, point.y, point.z);
    const strata = 0.36 + Math.sin(point.y * 3.5 + Math.sin(angle * 6) * 0.8) * 0.09;
    const c = dark.clone().lerp(ash, Math.max(0, strata + Math.sin(angle * 17 + j * 8) * 0.12));
    if (j > rings) c.multiplyScalar(0.65);
    colours.push(c.r, c.g, c.b);
    if (j < rings + 5 && i < sides) {
      const a = j * (sides + 1) + i, b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

/** One breached outlet splits into three channels across the lower apron. */
export function volcanoChannel(f: number, branch: number): number {
  const fork = Math.max(0, (f - 0.35) / 0.65);
  return 0.35 + (branch - 1) * 0.52 * fork * fork + Math.sin(f * 10) * 0.045 * f;
}

// Smooth seeded value noise avoids repeating stripes in dirt and molten surfaces.
const SURFACE_NOISE = `
float surfaceHash(vec3 p) {
  p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float surfaceNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(surfaceHash(i), surfaceHash(i+vec3(1,0,0)), f.x),
    mix(surfaceHash(i+vec3(0,1,0)), surfaceHash(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(surfaceHash(i+vec3(0,0,1)), surfaceHash(i+vec3(1,0,1)), f.x),
    mix(surfaceHash(i+vec3(0,1,1)), surfaceHash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
`;

/** Fine stone grain fades with pixel footprint so distant cliffs do not sparkle. */
function texturedRock(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vRockPoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvRockPoint = position;');
    shader.fragmentShader = 'varying vec3 vRockPoint;\n' + SURFACE_NOISE + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float footprint = length(fwidth(vRockPoint));
      float fineFade = 1.0 - smoothstep(0.008, 0.04, footprint);
      float coarseFade = 1.0 - smoothstep(0.04, 0.18, footprint);
      float soil = surfaceNoise(vRockPoint * 3.8);
      float aggregate = surfaceNoise(vRockPoint * 17.0);
      float grit = surfaceNoise(vRockPoint * 85.0);
      vec3 dirtTint = mix(vec3(0.69, 0.66, 0.60), vec3(1.13, 1.10, 1.03), soil);
      diffuseColor.rgb *= dirtTint * (0.86 + aggregate * 0.28
        + (aggregate - 0.5) * 0.42 * coarseFade + (grit - 0.5) * 0.72 * fineFade);
    `);
  };
  return material;
}

export class Volcano {
  readonly group = new THREE.Group();
  readonly state: VolcanoCycle;
  readonly x: number;
  readonly z: number;
  readonly radius = 13;
  private age = 0;
  private lava: THREE.Group;
  private pool: THREE.Mesh;
  private smoke: THREE.Sprite[] = [];
  private lavaTime = { value: 0 };
  private lavaHeat = { value: 0 };
  private streams: THREE.Mesh[] = [];
  private bubbles: THREE.Mesh[] = [];
  private flowBlobs!: THREE.InstancedMesh;
  private blobTransform = new THREE.Object3D();
  private blobUp = new THREE.Vector3(0, 1, 0);
  private readonly glow = new THREE.MeshStandardMaterial({ color: 0xff6b13, emissive: 0xff3800, emissiveIntensity: 2.7, roughness: 0.7 });
  notify: (message: string) => void = () => {};

  constructor(w: World, saved?: VolcanoSave) {
    this.state = new VolcanoCycle(w.seed, saved);
    // Prefer the broad inland crown of island two, clear of existing buildings and landmarks.
    let best = -Infinity, site = -1;
    for (let i = 0; i < w.layer.length; i++) {
      if (w.isle[i] !== 2 || w.layer[i] < 2 || w.distWater[i] < 13) continue;
      const cx = i % w.N, cz = Math.floor(i / w.N);
      let clear = true;
      for (let dz = -13; dz <= 13 && clear; dz++) for (let dx = -13; dx <= 13; dx++) {
        if (!w.inBounds(cx + dx, cz + dz)) { clear = false; break; }
        const j = w.idx(cx + dx, cz + dz);
        if (w.occ[j] || w.blockFixed[j] || w.layer[j] < 1) { clear = false; break; }
      }
      const score = w.layer[i] * 2 + w.distWater[i];
      if (clear && score > best) { best = score; site = i; }
    }
    const savedSite = saved && Number.isFinite(saved.x) && Number.isFinite(saved.z) ? w.cellIndexAt(saved.x, saved.z) : -1;
    if (savedSite >= 0 && w.isle[savedSite] === 2 && w.layer[savedSite] >= 1) site = savedSite;
    this.x = site >= 0 ? w.centerX(site % w.N) : 0;
    this.z = site >= 0 ? w.centerZ(Math.floor(site / w.N)) : 0;
    this.group.visible = site >= 0;
    this.group.name = 'Second island volcano';
    let y = site >= 0 ? w.heightAt(this.x, this.z) : 0;
    if (site >= 0) for (let n = 0; n < 24; n++) {
      const a = n * Math.PI / 12;
      y = Math.min(y, w.heightAt(this.x + Math.cos(a) * 8, this.z + Math.sin(a) * 8));
    }
    this.group.position.set(this.x, y, this.z);
    this.group.scale.set(1.35, 1.8, 1.25);
    if (site >= 0) w.blockCircle(this.x, this.z, this.radius + 0.8);
    const stone = texturedRock(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    const mountain = new THREE.Mesh(volcanoRockGeometry(), stone);
    mountain.castShadow = true; mountain.receiveShadow = true;
    this.group.add(mountain);
    // Batched angular outcrops and scrub nest the mountain into its jungle island.
    const rng = new RNG(w.seed + 9817), dummy = new THREE.Object3D();
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const outcrops = new THREE.InstancedMesh(rockGeo,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })), 78);
    const shrubs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), 240);
    for (const [mesh, vegetation] of [[outcrops, false], [shrubs, true]] as const) {
      for (let i = 0; i < mesh.count; i++) {
        const f = rng.range(vegetation ? 0.40 : 0.25, 0.98);
        // Leave the lava apron bare while the opposite flanks retain vegetation.
        const angle = rng.range(1.2, Math.PI * 2 - 0.5);
        const point = volcanoSurface(f, angle);
        const size = rng.range(vegetation ? 0.18 : 0.25, vegetation ? 0.72 : 0.95);
        dummy.position.copy(point);
        const ground = (w.heightAt(this.x + point.x * 1.35, this.z + point.z * 1.25) - y) / 1.8;
        dummy.position.y = Math.max(point.y, ground) + (vegetation ? 0.12 : size * 0.35);
        dummy.rotation.set(rng.range(-0.15, 0.15), angle, rng.range(-0.2, 0.2));
        dummy.scale.set(size, size * (vegetation ? 0.65 : rng.range(1.8, 3.6)), size);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, new THREE.Color(vegetation ? 0x628c32 : 0x737d87).multiplyScalar(rng.range(0.65, 1.15)));
      }
      mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    }
    // Irregular clusters at ground level soften the boundary into the forest.
    const rubble = new THREE.InstancedMesh(rockGeo,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0x68727c, roughness: 1, flatShading: true })), 92);
    for (let i = 0; i < rubble.count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const point = volcanoSurface(1, angle).multiplyScalar(rng.range(0.84, 1.07));
      const size = rng.range(0.18, 0.8);
      const ground = (w.heightAt(this.x + point.x * 1.35, this.z + point.z * 1.25) - y) / 1.8;
      dummy.position.set(point.x, ground + size * 0.28, point.z);
      dummy.rotation.set(rng.range(-0.4, 0.4), angle, rng.range(-0.3, 0.3));
      dummy.scale.set(size * rng.range(0.8, 1.5), size * rng.range(0.6, 1.8), size);
      dummy.updateMatrix(); rubble.setMatrixAt(i, dummy.matrix);
    }
    rubble.castShadow = true; rubble.receiveShadow = true; this.group.add(rubble);
    // Scree fans: many small stones in one draw call, clustered between larger outcrops.
    const pebbles = new THREE.InstancedMesh(rockGeo,
      texturedRock(new THREE.MeshStandardMaterial({ color: 0x80878b, roughness: 1, flatShading: true })), 650);
    for (let i = 0; i < pebbles.count; i++) {
      const f = rng.range(0.50, 0.995), angle = rng.range(0, Math.PI * 2);
      const point = volcanoSurface(f, angle);
      const ground = (w.heightAt(this.x + point.x * 1.35, this.z + point.z * 1.25) - y) / 1.8;
      const size = rng.range(0.035, 0.16);
      dummy.position.set(point.x, Math.max(point.y, ground) + size * 0.3, point.z);
      dummy.rotation.set(rng.next(), angle, rng.next());
      dummy.scale.set(size * 1.4, size * 0.6, size);
      dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
      pebbles.setColorAt(i, new THREE.Color().setScalar(rng.range(0.55, 1.1)));
    }
    pebbles.receiveShadow = true; this.group.add(pebbles);
    // Broad pointed leaves form recognisable tropical plants among the rock ledges.
    const leafGeometry = new THREE.BufferGeometry();
    leafGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, -0.22, 0.28, 0.46, 0, 0.42, 1.05,
      0, 0, 0, 0, 0.42, 1.05, 0.22, 0.28, 0.46,
    ], 3));
    leafGeometry.computeVertexNormals();
    const leaves = new THREE.InstancedMesh(leafGeometry,
      new THREE.MeshStandardMaterial({ color: 0x6d9637, roughness: 1, side: THREE.DoubleSide }), 420);
    for (let plant = 0; plant < 60; plant++) {
      const f = rng.range(0.48, 0.99), angle = rng.range(1.15, 5.8);
      const point = volcanoSurface(f, angle);
      const terrain = (w.heightAt(this.x + point.x * 1.35, this.z + point.z * 1.25) - y) / 1.8;
      point.y = Math.max(point.y, terrain) + 0.08;
      const size = rng.range(0.55, 1.05);
      for (let leaf = 0; leaf < 7; leaf++) {
        dummy.position.copy(point);
        dummy.rotation.set(rng.range(-0.25, 0.35), leaf * Math.PI * 2 / 7 + angle, 0);
        dummy.scale.setScalar(size); dummy.updateMatrix();
        leaves.setMatrixAt(plant * 7 + leaf, dummy.matrix);
      }
    }
    leaves.castShadow = true; leaves.receiveShadow = true; this.group.add(leaves);
    // Dark cooling crust breaks the molten surface into moving orange fissures.
    this.glow.onBeforeCompile = shader => {
      shader.uniforms.uLavaTime = this.lavaTime;
      shader.uniforms.uLavaHeat = this.lavaHeat;
      shader.vertexShader = 'varying vec3 vLavaPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvLavaPosition = position;');
      shader.fragmentShader = 'varying vec3 vLavaPosition; uniform float uLavaTime; uniform float uLavaHeat;\n' + SURFACE_NOISE + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        // Radial advection travels from the crater towards the foot of each slope.
        float radius = length(vLavaPosition.xz - vec2(0.38, 0.0));
        vec3 flow = vec3(radius * 1.8 - uLavaTime * 0.30,
          atan(vLavaPosition.z, vLavaPosition.x - 0.38) * 3.0, vLavaPosition.y * 0.14);
        vec3 warp = vec3(surfaceNoise(flow * 0.7), surfaceNoise(flow * 0.6 + 17.2), 0.0);
        float blobs = surfaceNoise(flow + warp * 1.8);
        float molten = smoothstep(0.24, 0.69, blobs) * uLavaHeat;
        diffuseColor.rgb = mix(vec3(0.07, 0.022, 0.008), vec3(1.0, 0.27, 0.025), molten);
        totalEmissiveRadiance *= (0.20 + 0.80 * molten) * uLavaHeat;
      `);
    };
    this.lava = new THREE.Group(); this.lava.name = 'Active lava'; this.group.add(this.lava);
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(2.15, 48).rotateX(-Math.PI / 2), this.glow);
    // Lake sits well below the broken rim.
    this.pool.position.set(0.38, 8.8, 0); this.lava.add(this.pool);
    const bubbleGeo = new THREE.IcosahedronGeometry(0.22, 1);
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(bubbleGeo, this.glow); this.bubbles.push(b); this.lava.add(b);
    }
    for (let k = 0; k < 3; k++) {
      const positions: number[] = [], indices: number[] = [];
      for (let n = 0; n <= 64; n++) {
        const f = n / 64;
        const angle = volcanoChannel(f, k);
        const width = (0.24 + 0.10 * Math.sin(f * 7) ** 2) / (2.85 + 5.1 * f ** 1.12);
        for (const side of [-1, 1]) {
          const point = volcanoSurface(f, angle + width * side);
          point.y += 0.11;
          positions.push(point.x, point.y, point.z);
        }
        if (n < 64) { const a = n * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      // Cooled basalt beds remain visible throughout dormancy.
      const bedGeometry = geometry.clone();
      const bedPositions = bedGeometry.getAttribute('position');
      for (let n = 0; n <= 64; n++) {
        const f = n / 64, angle = volcanoChannel(f, k);
        const width = 0.5 / (2.85 + 5.1 * f ** 1.12);
        for (let side = 0; side < 2; side++) {
          const p = volcanoSurface(f, angle + (side * 2 - 1) * width);
          bedPositions.setXYZ(n * 2 + side, p.x, p.y + 0.055, p.z);
        }
      }
      bedGeometry.computeVertexNormals();
      const bed = new THREE.Mesh(bedGeometry, new THREE.MeshStandardMaterial({ color: 0x282824, roughness: 1 }));
      bed.name = 'Cooled lava channel'; bed.receiveShadow = true; this.group.add(bed);
      const stream = new THREE.Mesh(geometry, this.glow);
      this.streams.push(stream); this.lava.add(stream);
    }
    this.flowBlobs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), this.glow, 24);
    this.flowBlobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flowBlobs.frustumCulled = false;
    this.flowBlobs.name = 'Downhill molten lobes'; this.lava.add(this.flowBlobs);
    // Soft particles overlap into a billowing plume, fading before they respawn.
    const pixels = new Uint8Array(64 * 64 * 4);
    for (let py = 0; py < 64; py++) for (let px = 0; px < 64; px++) {
      const dx = (px - 31.5) / 31.5, dy = (py - 31.5) / 31.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, 1 - d) ** 1.6;
      const i = (py * 64 + px) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      pixels[i + 3] = Math.round(alpha * 255);
    }
    const smokeMap = new THREE.DataTexture(pixels, 64, 64);
    smokeMap.needsUpdate = true;
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeMap, color: 0x777675, transparent: true, opacity: 0, depthWrite: false, fog: true,
      }));
      m.name = 'Volcanic smoke';
      this.smoke.push(m); this.group.add(m);
    }
    this.animate(0);
  }
  save(): VolcanoSave | undefined {
    return this.group.visible ? { x: this.x, z: this.z, phase: this.state.phase, remaining: this.state.remaining, cycle: this.state.cycle, coolingHot: this.state.coolingHot, warningVersion: 2 } : undefined;
  }
  update(dt: number): void {
    if (!this.group.visible) return;
    const previous = this.state.phase;
    this.state.update(dt); this.age += dt;
    if (previous !== this.state.phase && this.state.phase === 'smoking')
      this.notify('The volcano will smoke for five minutes before lava appears. Use Calm on the volcano for 50 Belief to reassure your people.');
    if (previous !== this.state.phase && this.state.phase === 'erupting')
      this.notify('The volcano is erupting! Lava is spilling down its slopes. Use Calm for 50 Belief.');
    this.animate(dt);
  }
  private animate(_dt: number): void {
    const phase = this.state.phase, t = this.age;
    const cooling = phase === 'cooling' ? Math.min(1, this.state.remaining / 25) : 0;
    const strength = phase === 'erupting' ? 1 : this.state.coolingHot ? cooling : 0;
    this.lava.visible = strength > 0;
    this.lavaTime.value = t; this.lavaHeat.value = strength;
    this.glow.emissiveIntensity = strength * (2.4 + Math.sin(t * 4) * 0.3);
    this.glow.color.setRGB(0.12 + strength * 0.88, 0.035 + strength * 0.3, 0.015);
    this.pool.position.y = 8.8 + Math.sin(t * 1.7) * 0.07 * strength;
    this.bubbles.forEach((b, i) => {
      const a = i * 2.4, r = 0.5 + (i % 3) * 0.5;
      b.position.set(0.38 + Math.cos(a) * r, 8.76 + Math.max(0, Math.sin(t * 2.5 + i)) * 0.35 * strength, Math.sin(a) * r);
      b.scale.setScalar(0.6 + Math.max(0, Math.sin(t * 2.5 + i)) * 0.65);
    });
    this.streams.forEach((m, i) => {
      // Fill each ribbon downhill as the overflow begins.
      const progress = phase === 'erupting' ? Math.max(0, Math.min(1, (65 - this.state.remaining - i * 5) / 22)) : 1;
      m.geometry.setDrawRange(0, Math.floor(progress * 64) * 6);
      m.visible = progress > 0 && (i === 0 || strength > 0.3);
    });
    if (strength > 0) for (let i = 0; i < 24; i++) {
      const branch = i % 3;
      const f = (t * (0.021 + (i % 5) * 0.0017) + i * 0.381966) % 1;
      const angle = volcanoChannel(f, branch);
      const point = volcanoSurface(f, angle);
      const tangent = volcanoSurface(f, angle + 0.001).sub(point);
      const downhill = volcanoSurface(Math.min(1, f + 0.001), angle).sub(point);
      const normal = tangent.cross(downhill).normalize();
      this.blobTransform.position.copy(point).addScaledVector(normal, 0.11);
      this.blobTransform.quaternion.setFromUnitVectors(this.blobUp, normal);
      const front = phase === 'erupting' ? Math.max(0, Math.min(1, (65 - this.state.remaining - branch * 5) / 22)) : 1;
      const size = f < front ? Math.sin(Math.PI * f) * (0.22 + (i % 4) * 0.04) * strength : 0;
      this.blobTransform.scale.set(size, size * 0.48, size * 1.5);
      this.blobTransform.updateMatrix(); this.flowBlobs.setMatrixAt(i, this.blobTransform.matrix);
    }
    this.flowBlobs.instanceMatrix.needsUpdate = strength > 0;
    this.smoke.forEach((m, i) => {
      const f = ((t * 0.045 + i / 28) % 1);
      m.position.set(0.38 + f * f * 6 + Math.sin(i * 2.4 + t * 0.2) * f * 0.9, 9.1 + f * 15, Math.cos(i * 3 + t * 0.14) * f * 1.7);
      m.scale.set(1.3 + f * 6, 1.5 + f * 5, 1);
      const material = m.material as THREE.SpriteMaterial;
      material.opacity = (this.state.active ? (phase === 'erupting' ? 0.8 : 0.5) : cooling * 0.4) * Math.sin(Math.PI * f);
      material.rotation = Math.sin(t * 0.1 + i) * 0.5;
      m.visible = material.opacity > 0.01;
    });
  }
}
