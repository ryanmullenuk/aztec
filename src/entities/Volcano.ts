import * as THREE from 'three';
import { World } from '../world/World';
import { RNG } from '../world/rng';

export type VolcanoPhase = 'dormant' | 'smoking' | 'erupting' | 'cooling';
export interface VolcanoSave { x: number; z: number; phase: VolcanoPhase; remaining: number; cycle: number; coolingHot?: boolean }
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
      this.coolingHot = saved.coolingHot === true;
      this.cycle = Number.isSafeInteger(saved.cycle) && saved.cycle >= 0 ? saved.cycle : 0;
    }
  }
  get active(): boolean { return this.phase === 'smoking' || this.phase === 'erupting'; }
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.remaining -= dt;
    while (this.remaining <= 0) {
      if (this.phase === 'dormant') { this.phase = 'smoking'; this.remaining += 35; }
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
  const radius = 2.85 + 5.1 * Math.pow(f, 1.55);
  const r = radius + ridge * Math.sin(Math.PI * f);
  // Steep fluted walls open onto a broad, asymmetric apron.
  const notch = Math.pow(Math.max(0, Math.cos(angle - 0.35)), 40) * 1.0;
  const lip = Math.sin(angle * 7) * 0.32 + Math.sin(angle * 13) * 0.21 - notch;
  const height = 10.2 * Math.pow(1 - f, 1.35) + lip * (1 - f)
    + ridge * Math.sin(Math.PI * f) * 0.8;
  return new THREE.Vector3(Math.cos(angle) * r + 0.38 * (1 - f), height, Math.sin(angle) * r);
}

export function volcanoRockGeometry(): THREE.BufferGeometry {
  const positions: number[] = [], colours: number[] = [], indices: number[] = [];
  const sides = 64, rings = 20;
  const dark = new THREE.Color(0x38332f), ash = new THREE.Color(0x766b5b);
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

export class Volcano {
  readonly group = new THREE.Group();
  readonly state: VolcanoCycle;
  readonly x: number;
  readonly z: number;
  readonly radius = 8;
  private age = 0;
  private lava: THREE.Group;
  private pool: THREE.Mesh;
  private smoke: THREE.Sprite[] = [];
  private lavaTime = { value: 0 };
  private lavaHeat = { value: 0 };
  private streams: THREE.Mesh[] = [];
  private bubbles: THREE.Mesh[] = [];
  private readonly glow = new THREE.MeshStandardMaterial({ color: 0xff6b13, emissive: 0xff3800, emissiveIntensity: 2.7, roughness: 0.7 });
  notify: (message: string) => void = () => {};

  constructor(w: World, saved?: VolcanoSave) {
    this.state = new VolcanoCycle(w.seed, saved);
    // Prefer the broad inland crown of island two, clear of existing buildings and landmarks.
    let best = -Infinity, site = -1;
    for (let i = 0; i < w.layer.length; i++) {
      if (w.isle[i] !== 2 || w.layer[i] < 2 || w.distWater[i] < 9) continue;
      const cx = i % w.N, cz = Math.floor(i / w.N);
      let clear = true;
      for (let dz = -9; dz <= 9 && clear; dz++) for (let dx = -9; dx <= 9; dx++) {
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
    if (site >= 0) w.blockCircle(this.x, this.z, this.radius + 0.8);
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const mountain = new THREE.Mesh(volcanoRockGeometry(), stone);
    mountain.castShadow = true; mountain.receiveShadow = true;
    this.group.add(mountain);
    // Batched angular outcrops and scrub nest the mountain into its jungle island.
    const rng = new RNG(w.seed + 9817), dummy = new THREE.Object3D();
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const outcrops = new THREE.InstancedMesh(rockGeo,
      new THREE.MeshStandardMaterial({ color: 0x696354, roughness: 1, flatShading: true }), 46);
    const shrubs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x56742d, roughness: 1, flatShading: true }), 110);
    for (const [mesh, vegetation] of [[outcrops, false], [shrubs, true]] as const) {
      for (let i = 0; i < mesh.count; i++) {
        const f = rng.range(vegetation ? 0.52 : 0.25, 0.98);
        // Leave the lava apron bare while the opposite flanks retain vegetation.
        const angle = rng.range(1.2, Math.PI * 2 - 0.5);
        const point = volcanoSurface(f, angle);
        const size = rng.range(vegetation ? 0.18 : 0.25, vegetation ? 0.45 : 0.65);
        dummy.position.copy(point); dummy.position.y += vegetation ? 0.12 : size * 0.35;
        dummy.rotation.set(rng.range(-0.15, 0.15), angle, rng.range(-0.2, 0.2));
        dummy.scale.set(size, size * (vegetation ? 0.65 : rng.range(1.8, 3.6)), size);
        dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, new THREE.Color(vegetation ? 0x668538 : 0x827765).multiplyScalar(rng.range(0.65, 1.15)));
      }
      mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh);
    }
    // Dark cooling crust breaks the molten surface into moving orange fissures.
    this.glow.onBeforeCompile = shader => {
      shader.uniforms.uLavaTime = this.lavaTime;
      shader.uniforms.uLavaHeat = this.lavaHeat;
      shader.vertexShader = 'varying vec3 vLavaPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvLavaPosition = position;');
      shader.fragmentShader = 'varying vec3 vLavaPosition; uniform float uLavaTime; uniform float uLavaHeat;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec2 lp = vLavaPosition.xz * 2.8 + vec2(uLavaTime * 0.035, -uLavaTime * 0.06);
        float fracture = abs(sin(lp.x * 3.0 + sin(lp.y * 2.5)) * sin(lp.y * 3.2 + cos(lp.x)));
        float crack = 1.0 - smoothstep(0.04, 0.24, fracture);
        float molten = (0.16 + 0.84 * crack) * uLavaHeat;
        diffuseColor.rgb = mix(vec3(0.075, 0.023, 0.009), diffuseColor.rgb, molten);
        totalEmissiveRadiance *= molten;
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
        const width = (0.24 + 0.10 * Math.sin(f * 7) ** 2) / (2.85 + 5.1 * f ** 1.55);
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
        const width = 0.5 / (2.85 + 5.1 * f ** 1.55);
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
    return this.group.visible ? { x: this.x, z: this.z, phase: this.state.phase, remaining: this.state.remaining, cycle: this.state.cycle, coolingHot: this.state.coolingHot } : undefined;
  }
  update(dt: number): void {
    if (!this.group.visible) return;
    const previous = this.state.phase;
    this.state.update(dt); this.age += dt;
    if (previous !== this.state.phase && this.state.phase === 'smoking')
      this.notify('Grey smoke rises from the volcano. Use Calm on the volcano for 50 Belief to reassure your people.');
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
