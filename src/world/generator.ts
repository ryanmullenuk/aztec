import { WORLD } from '../config';
import { Simplex2, clamp, lerp, smoothstep } from './noise';
import { RNG } from './rng';
import { World } from './World';

/**
 * Procedural island from a seed: main island with coves and headlands, offshore islets,
 * stepped contour layers, highland plateau with cliffs, rivers, a waterfall with a pool,
 * a lagoon and an open meadow for the tribe.
 */
export function generateIsland(world: World, seed: number): void {
  world.seed = seed;
  const N = world.N;
  const rng = new RNG(seed);
  const sA = new Simplex2(rng);
  const sB = new Simplex2(rng);
  const sC = new Simplex2(rng);

  const rot = rng.range(0, Math.PI * 2);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const stretch = rng.range(1.0, 1.28);

  // Highland centre: offset from the middle of the island.
  const ha = rng.range(0, Math.PI * 2);
  const hc = { x: Math.cos(ha) * 0.16, z: Math.sin(ha) * 0.16 };

  // Offshore islets.
  world.islets = [];
  const isletCount = rng.int(WORLD.isletCount[0], WORLD.isletCount[1]);
  const islets: { x: number; z: number; r: number }[] = [];
  for (let k = 0; k < isletCount; k++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0.74, 0.88);
    islets.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: rng.range(0.035, 0.07) });
  }

  const v = new Float32Array(N * N);
  const hlMaskF = new Float32Array(N * N);
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const nx = ((cx + 0.5) / N) * 2 - 1;
      const nz = ((cz + 0.5) / N) * 2 - 1;
      const rx = nx * cr - nz * sr;
      const rz = nx * sr + nz * cr;
      const wx = rx + 0.2 * sA.fbm(rx * 1.3 + 3.1, rz * 1.3 - 5.7, 3);
      const wz = rz + 0.2 * sA.fbm(rx * 1.3 - 9.2, rz * 1.3 + 2.4, 3);
      const d = Math.sqrt(wx * wx + wz * wz * stretch * stretch);
      const mass = 1 - smoothstep(0.16, 0.7, d);
      const detail = sA.fbm(nx * 3.4 + 11, nz * 3.4 - 7, 5);
      const hills = sB.ridge(nx * 2.6 + 4, nz * 2.6 + 8, 3);

      let h = mass * 0.95 + detail * 0.2 - 0.22 + hills * 0.22 * mass;

      // Highland plateau with a cliff edge.
      const hd = Math.hypot(nx - hc.x, nz - hc.z) + sC.fbm(nx * 3 + 1, nz * 3 - 1, 3) * 0.12;
      const hl = (1 - smoothstep(0.08, 0.34, hd)) * smoothstep(0.2, 0.5, mass);
      hlMaskF[cz * N + cx] = hl;
      h += hl * 0.28 + smoothstep(0.42, 0.52, hl) * 0.26;

      // Deeper ocean towards the map edge.
      const dr = Math.hypot(nx, nz);
      if (h < 0) h -= smoothstep(0.72, 1.05, dr) * 0.4;

      for (const it of islets) {
        const di = Math.hypot(nx - it.x, nz - it.z);
        const iv = (1 - di / it.r) * 0.22 + sB.noise(nx * 14, nz * 14) * 0.025 - 0.02;
        if (iv > h) h = iv;
      }
      v[cz * N + cx] = h;
    }
  }

  for (let i = 0; i < N * N; i++) {
    const h = v[i];
    const L = h > 0 ? 1 + Math.floor(Math.pow(h, 0.95) * 10.5) : Math.ceil(h * 18);
    world.layer[i] = clamp(L, WORLD.minLayer, WORLD.maxLayer);
    world.forest[i] = 0;
    world.rocky[i] = 0;
    world.sandy[i] = 0;
    world.occ[i] = 0;
    world.wear[i] = 0;
    world.soil[i] = 0;
    world.foam[i] = 0;
    world.riverY[i] = NaN;
  }
  for (const it of islets) world.islets.push({ x: it.x * world.half, z: it.z * world.half, r: it.r * world.half });

  world.computeDistWater();

  // Rocky headlands and beaches.
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      if (world.layer[i] < 1) continue;
      const nx = cx / N, nz = cz / N;
      const dw = world.distWater[i];
      const head = sC.noise(nx * 9 + 30, nz * 9 - 30);
      if (dw <= 3 && head > 0.38) {
        world.layer[i] = Math.max(world.layer[i], 2 + Math.round((head - 0.38) * 6 + (3 - dw) * 0.3));
        world.rocky[i] = 1;
      } else if (dw <= 1 || (dw <= 3 && world.layer[i] <= 2 && head < 0.1)) {
        world.sandy[i] = 1;
      }
      if (hlMaskF[i] > 0.5 && sB.noise(nx * 12, nz * 12) > 0.15) world.rocky[i] = Math.max(world.rocky[i], 0.7);
      if (world.layer[i] >= 11) world.rocky[i] = Math.max(world.rocky[i], 0.6 + sA.noise(nx * 20, nz * 20) * 0.3);
    }
  }

  placeMeadow(world, rng, hlMaskF);

  // Jungle density: dense everywhere except glades, beaches and the meadow.
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      if (world.layer[i] < 1) continue;
      const nx = cx / N, nz = cz / N;
      let f = smoothstep(-0.5, -0.18, sB.fbm(nx * 5 + 20, nz * 5 - 20, 3));
      f *= smoothstep(1.5, 4.5, world.distWater[i]);
      f *= 1 - world.rocky[i] * 0.75;
      f *= 1 - world.sandy[i];
      const dm = Math.hypot(world.centerX(cx) - world.meadow.x, world.centerZ(cz) - world.meadow.z);
      f *= smoothstep(world.meadow.r, world.meadow.r + 6, dm);
      world.forest[i] = f;
    }
  }

  carveRivers(world, rng, v);
  carveLagoon(world, rng);

  world.computeDistWater();
  // Cliffs: steep layer jumps become rock.
  for (let cz = 1; cz < N - 1; cz++) {
    for (let cx = 1; cx < N - 1; cx++) {
      const i = cz * N + cx;
      const L = world.layer[i];
      if (L < 1) continue;
      let maxDiff = 0;
      for (const o of [-1, 1, -N, N]) maxDiff = Math.max(maxDiff, L - world.layer[i + o]);
      if (maxDiff >= 2 && L >= 3) world.rocky[i] = Math.max(world.rocky[i], 0.75);
    }
  }
  world.classifyGround();
  world.computeSmooth();
  world.version++;
}

function placeMeadow(world: World, rng: RNG, hl: Float32Array): void {
  const N = world.N;
  let best = -1, bestScore = -1e9;
  for (let k = 0; k < 4000; k++) {
    const cx = rng.int(8, N - 9), cz = rng.int(8, N - 9);
    const i = cz * N + cx;
    const L = world.layer[i];
    if (L < 2 || L > 6 || hl[i] > 0.15 || world.rocky[i] > 0) continue;
    const dw = world.distWater[i];
    if (dw < 11 || dw > 26) continue;
    const score = -Math.abs(dw - 15) - Math.abs(L - 3) * 1.5 + rng.next() * 3;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) {
    // Fallback: highest-distance land cell near the middle.
    for (let i = 0; i < N * N; i++) if (world.layer[i] >= 2 && world.distWater[i] > (best < 0 ? 0 : world.distWater[best])) best = i;
  }
  const mcx = best % N, mcz = (best / N) | 0;
  const mL = clamp(world.layer[best], 2, 5);
  const r = world.meadow.r;
  world.meadow = { x: world.centerX(mcx), z: world.centerZ(mcz), r, layer: mL };
  for (let cz = mcz - r - 4; cz <= mcz + r + 4; cz++) {
    for (let cx = mcx - r - 4; cx <= mcx + r + 4; cx++) {
      if (!world.inBounds(cx, cz)) continue;
      const i = world.idx(cx, cz);
      if (world.layer[i] < 1) continue;
      const d = Math.hypot(cx - mcx, cz - mcz);
      const w = 1 - smoothstep(r * 0.7, r + 3, d);
      world.layer[i] = Math.round(lerp(world.layer[i], mL, w));
      if (d < r) {
        world.rocky[i] = 0;
        world.sandy[i] = 0;
      }
    }
  }
  // Direction to the sea (for the jetty and camera composition).
  let bx = 0, bz = 0, bd = 1e9;
  for (let i = 0; i < N * N; i++) {
    if (world.layer[i] > 0) continue;
    const d = Math.hypot((i % N) - mcx, ((i / N) | 0) - mcz);
    if (d < bd) {
      bd = d;
      bx = (i % N) - mcx;
      bz = ((i / N) | 0) - mcz;
    }
  }
  const len = Math.hypot(bx, bz) || 1;
  world.seaDir = { x: bx / len, z: bz / len };
}

function carveRivers(world: World, rng: RNG, v: Float32Array): void {
  const N = world.N;
  const H = world.H;
  world.rivers = [];
  world.waterfall = null;
  const count = rng.int(WORLD.riverCount[0], WORLD.riverCount[1]);
  const sources: number[] = [];
  for (let k = 0; k < 3000 && sources.length < count; k++) {
    const i = rng.int(0, N * N - 1);
    if (world.layer[i] < 8) continue;
    const cx = i % N, cz = (i / N) | 0;
    if (sources.some((s) => Math.hypot((s % N) - cx, ((s / N) | 0) - cz) < 22)) continue;
    sources.push(i);
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const inMeadow = (cx: number, cz: number) =>
    Math.hypot(world.centerX(cx) - world.meadow.x, world.centerZ(cz) - world.meadow.z) < world.meadow.r + 3;

  sources.forEach((src, riverIndex) => {
    const path: number[] = [src];
    const visited = new Set<number>([src]);
    let cur = src;
    let momentum: [number, number] = [0, 0];
    for (let step = 0; step < 320; step++) {
      const cx = cur % N, cz = (cur / N) | 0;
      if (world.layer[cur] <= 0) break;
      let best = -1, bestS = 1e9, bestDir: [number, number] = [0, 0];
      for (const [dx, dz] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (!world.inBounds(nx, nz)) continue;
        const ni = world.idx(nx, nz);
        if (visited.has(ni)) continue;
        let s = world.layer[ni] * 1.0 + v[ni] * 2 + rng.next() * 0.35 - (dx * momentum[0] + dz * momentum[1]) * 0.25;
        if (dx !== 0 && dz !== 0) s += 0.08;
        if (inMeadow(nx, nz)) s += 3;
        if (s < bestS) {
          bestS = s;
          best = ni;
          bestDir = [dx, dz];
        }
      }
      if (best < 0) break;
      momentum = bestDir;
      visited.add(best);
      path.push(best);
      cur = best;
    }
    if (path.length < 12 || world.layer[path[path.length - 1]] > 0) return;

    // Monotonic bed along the path.
    const beds: number[] = [];
    let bed = world.layer[path[0]] - 1;
    for (const p of path) {
      if (world.layer[p] <= 0) {
        beds.push(Math.min(bed, 0));
        break;
      }
      bed = Math.min(bed, world.layer[p] - 1);
      beds.push(bed);
    }

    // Find the biggest drop for a waterfall on the first river.
    let fallK = -1, fallDrop = 1;
    if (riverIndex === 0) {
      for (let k = 2; k < beds.length - 6; k++) {
        const drop = beds[k] - beds[k + 2];
        if (drop > fallDrop && beds[k + 2] >= 1) {
          fallDrop = drop;
          fallK = k;
        }
      }
    }

    const points: { x: number; z: number; y: number }[] = [];
    for (let k = 0; k < beds.length; k++) {
      const p = path[k];
      const cx = p % N, cz = (p / N) | 0;
      const b = beds[k];
      if (world.layer[p] <= 0) {
        points.push({ x: world.centerX(cx), z: world.centerZ(cz), y: 0.0 });
        break;
      }
      const wy = world.layerY(b) + 0.7 * H;
      const carveR = k < 3 ? 0 : 1;
      for (let dz = -carveR; dz <= carveR; dz++) {
        for (let dx = -carveR; dx <= carveR; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 1) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!world.inBounds(nx, nz)) continue;
          const ni = world.idx(nx, nz);
          if (world.layer[ni] <= 0) continue;
          if (world.layer[ni] > b) world.layer[ni] = b;
          if (world.layer[ni] >= 1 || b >= 1) {
            const prev = world.riverY[ni];
            world.riverY[ni] = Number.isNaN(prev) ? wy : Math.min(prev, wy);
          }
          world.forest[ni] *= 0.2;
          world.rocky[ni] *= 0.5;
        }
      }
      // Sandy/grassy banks.
      for (const [dx, dz] of dirs) {
        const nx = cx + dx * 2, nz = cz + dz * 2;
        if (!world.inBounds(nx, nz)) continue;
        const ni = world.idx(nx, nz);
        world.forest[ni] *= 0.6;
      }
      points.push({ x: world.centerX(cx), z: world.centerZ(cz), y: wy });
    }

    if (fallK >= 0) {
      const top = path[fallK], bot = path[fallK + 2];
      const tcx = top % N, tcz = (top / N) | 0;
      const bcx = bot % N, bcz = (bot / N) | 0;
      const bBed = beds[fallK + 2];
      const poolR = 3.3;
      const poolY = world.layerY(bBed) + 0.7 * H;
      // Carve the pool and give it a sandy shore.
      const pcx = bcx + (bcx - tcx), pcz = bcz + (bcz - tcz);
      for (let dz = -6; dz <= 6; dz++) {
        for (let dx = -6; dx <= 6; dx++) {
          const nx = pcx + dx, nz = pcz + dz;
          if (!world.inBounds(nx, nz)) continue;
          const ni = world.idx(nx, nz);
          if (world.layer[ni] <= 0) continue;
          const d = Math.hypot(dx, dz);
          if (d <= poolR) {
            world.layer[ni] = Math.min(world.layer[ni], bBed);
            world.riverY[ni] = poolY;
            world.forest[ni] = 0;
            world.rocky[ni] = 0;
          } else if (d <= poolR + 2.2) {
            world.layer[ni] = Math.min(world.layer[ni], bBed + 1);
            world.sandy[ni] = 1;
            world.forest[ni] = 0;
            world.rocky[ni] = 0;
          }
        }
      }
      const dx = bcx - tcx, dz = bcz - tcz;
      const dl = Math.hypot(dx, dz) || 1;
      world.waterfall = {
        x: world.centerX(tcx) + (dx / dl) * 0.6,
        z: world.centerZ(tcz) + (dz / dl) * 0.6,
        topY: points[fallK].y,
        bottomY: poolY,
        dx: dx / dl,
        dz: dz / dl,
        poolY,
        poolR,
      };
      // Mark cliff next to the waterfall as rock.
      for (let k = Math.max(0, fallK - 2); k <= fallK + 1; k++) {
        const p = path[k];
        const cx = p % N, cz = (p / N) | 0;
        for (let oz = -3; oz <= 3; oz++) for (let ox = -3; ox <= 3; ox++) {
          if (!world.inBounds(cx + ox, cz + oz)) continue;
          const ni = world.idx(cx + ox, cz + oz);
          if (Number.isNaN(world.riverY[ni])) world.rocky[ni] = Math.max(world.rocky[ni], 0.8);
        }
      }
    }
    world.rivers.push({ points });
  });
}

function carveLagoon(world: World, rng: RNG): void {
  const N = world.N;
  world.computeDistWater();
  world.lagoon = null;
  for (let k = 0; k < 3000; k++) {
    const cx = rng.int(10, N - 11), cz = rng.int(10, N - 11);
    const i = world.idx(cx, cz);
    if (world.layer[i] < 1 || world.layer[i] > 3 || world.distWater[i] !== 4) continue;
    if (world.rocky[i] > 0 || !Number.isNaN(world.riverY[i])) continue;
    const x = world.centerX(cx), z = world.centerZ(cz);
    if (Math.hypot(x - world.meadow.x, z - world.meadow.z) < world.meadow.r + 10) continue;
    const r = rng.range(4.5, 6.5);
    for (let dz = -10; dz <= 10; dz++) {
      for (let dx = -10; dx <= 10; dx++) {
        const nx = cx + dx, nz = cz + dz;
        if (!world.inBounds(nx, nz)) continue;
        const ni = world.idx(nx, nz);
        const d = Math.hypot(dx, dz);
        if (d <= r) {
          if (world.layer[ni] > 0) world.layer[ni] = d < r * 0.55 ? -1 : 0;
          world.riverY[ni] = NaN;
          world.forest[ni] = 0;
        } else if (d <= r + 3 && world.layer[ni] >= 1) {
          world.layer[ni] = Math.min(world.layer[ni], 1);
          world.sandy[ni] = 1;
          world.forest[ni] *= 0.3;
          world.rocky[ni] = 0;
        }
      }
    }
    world.lagoon = { x, z, r };
    return;
  }
}
