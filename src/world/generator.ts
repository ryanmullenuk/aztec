import { WORLD } from '../config';
import { Simplex2, clamp, lerp, smoothstep } from './noise';
import { RNG } from './rng';
import { World } from './World';

/** Smooth maximum (blends overlapping lobes into one natural coastline). */
function smax(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (a - b)) / k, 0, 1);
  return b + (a - b) * h + k * h * (1 - h);
}

/**
 * Procedural island from a seed, laid out like a tropical atoll concept:
 *  - a multi-lobed main island with bays and peninsulas and a ragged coastline,
 *  - a wide turquoise reef shelf all around, dropping off into deep navy sea,
 *  - a rocky mountain massif on one side (rivers and the waterfall start there),
 *  - scattered rocky knolls, wide sandy beaches in the bays, large open grasslands between jungle,
 *  - rocky wooded islets out on the shelf, a lagoon and an open meadow for the tribe.
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

  // Lobes of the main island: a big central body and several peninsulas.
  const lobes: { x: number; z: number; rx: number; rz: number; a: number }[] = [
    { x: 0, z: 0, rx: rng.range(0.4, 0.47), rz: rng.range(0.32, 0.38), a: rng.range(0, Math.PI) },
  ];
  const nLobes = rng.int(3, 5);
  for (let k = 0; k < nLobes; k++) {
    const ang = (k / nLobes) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const d = rng.range(0.27, 0.4);
    lobes.push({ x: Math.cos(ang) * d, z: Math.sin(ang) * d, rx: rng.range(0.16, 0.26), rz: rng.range(0.1, 0.17), a: ang + rng.range(-0.6, 0.6) });
  }
  // Mountain massif: a ridge of peaks set to one side of the island.
  const ma = rng.range(0, Math.PI * 2);
  const mc = { x: Math.cos(ma) * 0.2, z: Math.sin(ma) * 0.2 };
  const mDir = ma + Math.PI / 2 + rng.range(-0.5, 0.5);
  const mcs = Math.cos(mDir), msn = Math.sin(mDir);
  // Rocky knolls elsewhere on the island.
  const knolls: { x: number; z: number; r: number; h: number }[] = [];
  for (let k = 0; k < 40 && knolls.length < rng.int(3, 5); k++) {
    const a2 = rng.range(0, Math.PI * 2), d = rng.range(0.12, 0.42);
    const x = Math.cos(a2) * d, z = Math.sin(a2) * d;
    if (Math.hypot(x - mc.x, z - mc.z) < 0.3 || knolls.some((q) => Math.hypot(q.x - x, q.z - z) < 0.18)) continue;
    knolls.push({ x, z, r: rng.range(0.05, 0.085), h: rng.range(0.22, 0.4) });
  }
  // Islets out on the reef shelf.
  world.islets = [];
  const isletCount = rng.int(WORLD.isletCount[0], WORLD.isletCount[1]);
  const islets: { x: number; z: number; r: number; h: number }[] = [];
  for (let k = 0; k < 200 && islets.length < isletCount; k++) {
    const a2 = rng.range(0, Math.PI * 2);
    const d = rng.range(0.62, 0.84);
    const x = Math.cos(a2) * d, z = Math.sin(a2) * d;
    if (islets.some((q) => Math.hypot(q.x - x, q.z - z) < 0.2)) continue;
    islets.push({ x, z, r: rng.range(0.035, 0.065), h: rng.range(0.2, 0.42) });
  }

  const v = new Float32Array(N * N);
  const massif = new Float32Array(N * N);
  const knollM = new Float32Array(N * N);
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      const nx = ((cx + 0.5) / N) * 2 - 1;
      const nz = ((cz + 0.5) / N) * 2 - 1;
      const rx = nx * cr - nz * sr;
      const rz = nx * sr + nz * cr;
      const wx = rx + 0.11 * sA.fbm(rx * 1.8 + 3.1, rz * 1.8 - 5.7, 4);
      const wz = rz + 0.11 * sA.fbm(rx * 1.8 - 9.2, rz * 1.8 + 2.4, 4);
      let m = -10;
      for (const L of lobes) {
        const dx = wx - L.x, dz = wz - L.z;
        const ca = Math.cos(L.a), sa = Math.sin(L.a);
        const u = dx * ca + dz * sa, w = -dx * sa + dz * ca;
        m = smax(m, 1 - Math.sqrt((u / L.rx) ** 2 + (w / L.rz) ** 2), 0.22);
      }
      // Ragged coast: bays and points.
      m += sB.fbm(nx * 4.2 + 11, nz * 4.2 - 7, 4) * 0.17;

      let h: number;
      if (m > 0) {
        // Gently rolling lowland rising inland.
        h = 0.06 + Math.pow(m, 0.8) * 0.4 + sA.fbm(nx * 3 + 2, nz * 3, 4) * 0.07;
      } else {
        // Wide shallow reef shelf, then a drop-off into the deep.
        const shelfW = 0.36 + sC.noise(nx * 2.3 + 5, nz * 2.3) * 0.1;
        if (m > -shelfW) h = -0.012 + (m / shelfW) * 0.1 + sC.fbm(nx * 9, nz * 9, 2) * 0.018;
        else h = -0.112 - (-shelfW - m) * 1.7;
      }
      // Mountain massif: ridged peaks, only on land.
      const mx = nx - mc.x, mz = nz - mc.z;
      const mu = mx * mcs + mz * msn, mw = -mx * msn + mz * mcs;
      const md = Math.sqrt((mu / 0.4) ** 2 + (mw / 0.21) ** 2) + sC.fbm(nx * 3.5 + 1, nz * 3.5 - 1, 3) * 0.2;
      const mm = (1 - smoothstep(0.25, 1.0, md)) * smoothstep(0.04, 0.26, m);
      massif[i] = mm;
      // Tall, jagged peaks along the ridge.
      const rid = sB.ridge(nx * 2.5 + 4, nz * 2.5 + 8, 4);
      h += mm * (0.45 + rid * 1.3 + Math.pow(rid, 2) * 1.1 * mm);
      // Knolls.
      for (const k of knolls) {
        const dk = Math.hypot(nx - k.x, nz - k.z) / k.r;
        if (dk < 1.4) {
          const kv = Math.max(0, 1 - dk * dk) * k.h * smoothstep(0, 0.12, m);
          h += kv;
          knollM[i] = Math.max(knollM[i], 1 - dk / 1.4);
        }
      }
      // Islets, each with its own ring of shallows.
      for (const it of islets) {
        const di = Math.hypot(nx - it.x, nz - it.z) / it.r;
        const iv = (1 - di) * it.h + sB.noise(nx * 14, nz * 14) * 0.03 - 0.015;
        if (iv > h) h = iv;
        if (di < 3.2) h = Math.max(h, -0.012 - (di - 1) * 0.045);
      }
      v[i] = h;
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

  // Rocky headlands, cliffs on the mountains and knolls, wide beaches in the bays.
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      if (world.layer[i] < 1) continue;
      const nx = cx / N, nz = cz / N;
      const dw = world.distWater[i];
      const head = sC.noise(nx * 7 + 30, nz * 7 - 30);
      if (dw <= 2 && head > 0.55) {
        world.layer[i] = Math.max(world.layer[i], 2 + Math.round((head - 0.55) * 8 + (2 - dw) * 0.4));
        world.rocky[i] = 1;
      } else if (dw <= 2 || (dw <= 4 && world.layer[i] <= 2 && head < 0.2)) {
        world.sandy[i] = 1;
      }
      // Mountains: green lower slopes with rocky crags, bare rock toward the peaks.
      if (massif[i] > 0.3 && (sB.noise(nx * 12, nz * 12) > 0.3 || world.layer[i] >= 12)) world.rocky[i] = Math.max(world.rocky[i], 0.55 + massif[i] * 0.45);
      if (knollM[i] > 0.45) world.rocky[i] = Math.max(world.rocky[i], 0.8);
      if (world.layer[i] >= 13) world.rocky[i] = Math.max(world.rocky[i], 0.7 + sA.noise(nx * 20, nz * 20) * 0.3);
    }
  }

  placeMeadow(world, rng, massif);

  // Vegetation: jungle broken by large open grasslands; bare rock high up; beaches and the meadow clear.
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      if (world.layer[i] < 1) continue;
      const nx = cx / N, nz = cz / N;
      let f = smoothstep(-0.2, 0.18, sB.fbm(nx * 2.4 + 20, nz * 2.4 - 20, 4));
      // Mountain slopes are wooded below the bare rock.
      f = Math.max(f, massif[i] > 0.15 && world.layer[i] < 12 ? 0.8 : 0);
      f *= smoothstep(1.5, 4.5, world.distWater[i]);
      f *= 1 - world.rocky[i] * 0.75;
      f *= 1 - world.sandy[i];
      const dm = Math.hypot(world.centerX(cx) - world.meadow.x, world.centerZ(cz) - world.meadow.z);
      f *= smoothstep(world.meadow.r, world.meadow.r + 8, dm);
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
  let topL = 0;
  for (let i = 0; i < N * N; i++) topL = Math.max(topL, world.layer[i]);
  const srcMin = Math.max(8, topL - 5);
  // Plenty of candidate springs high in the mountains; rivers are tried until enough reach the sea.
  for (let k = 0; k < 8000 && sources.length < count * 10; k++) {
    const i = rng.int(0, N * N - 1);
    if (world.layer[i] < srcMin) continue;
    const cx = i % N, cz = (i / N) | 0;
    if (sources.some((s) => Math.hypot((s % N) - cx, ((s / N) | 0) - cz) < 6)) continue;
    sources.push(i);
  }
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const inMeadow = (cx: number, cz: number) =>
    Math.hypot(world.centerX(cx) - world.meadow.x, world.centerZ(cz) - world.meadow.z) < world.meadow.r + 3;

  for (const src of sources) {
    if (world.rivers.length >= count) break;
    // Rivers must stay apart.
    const scx = src % N, scz = (src / N) | 0;
    if (world.rivers.some((r) => r.points.some((p) => Math.hypot(world.centerX(scx) - p.x, world.centerZ(scz) - p.z) < 16))) continue;
    const riverIndex = world.rivers.length;
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
    if (path.length < 12 || world.layer[path[path.length - 1]] > 0) continue;

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
    // Waterfall on the first river: the steepest stretch high up on the mountain, deepened into a
    // proper cliff (at least five layers) that drops into a pool.
    let fallK = -1;
    if (riverIndex === 0) {
      let bestS = -1;
      for (let k = 2; k < beds.length - 8; k++) {
        if (beds[k] < 7) continue;
        const sc = beds[k] - beds[k + 4] + beds[k] * 0.25;
        if (sc > bestS) {
          bestS = sc;
          fallK = k;
        }
      }
      if (fallK < 0) {
        for (let k = 2; k < beds.length - 6; k++) if (beds[k] - beds[k + 2] >= 2 && beds[k + 2] >= 1) {
          fallK = k;
          break;
        }
      }
      if (fallK >= 0) {
        const top = beds[fallK];
        const target = Math.max(1, Math.min(beds[fallK + 2], top - 5));
        beds[fallK + 1] = top;
        for (let j = fallK + 2; j < beds.length; j++) beds[j] = Math.min(beds[j], target);
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
  }
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
