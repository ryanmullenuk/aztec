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
 * Two islands from a hand-designed layout:
 *  - a large main island with a wide, open grassland plain in the middle for the village
 *    (room for fifty islanders, their homes and several farms), mountains, a river and a
 *    waterfall to the north-west, beaches and a belt of jungle around the edges,
 *  - a wild island across a shallow strait (bridgeable) with dense jungle, hills, fruit and
 *    most of the wild animals,
 * Earlier notes for the shared terrain:
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

  // ---- The hand-designed layout (the same for everyone), in map units -1..1. ----
  // Main island: a broad body with peninsulas; the village plain sits in its middle.
  const mainLobes = [
    { x: -0.3, z: 0.06, rx: 0.47, rz: 0.41, a: 0.1 },
    { x: -0.63, z: -0.3, rx: 0.2, rz: 0.14, a: -0.6 },
    { x: -0.62, z: 0.44, rx: 0.19, rz: 0.13, a: 0.7 },
    { x: -0.2, z: 0.52, rx: 0.22, rz: 0.12, a: 1.4 },
    { x: -0.12, z: -0.4, rx: 0.22, rz: 0.13, a: -1.1 },
  ];
  // Wild island to the east.
  const wildLobes = [
    { x: 0.55, z: -0.02, rx: 0.26, rz: 0.34, a: 0.25 },
    { x: 0.66, z: 0.36, rx: 0.14, rz: 0.1, a: 0.8 },
    { x: 0.44, z: -0.4, rx: 0.15, rz: 0.1, a: -0.8 },
    { x: 0.74, z: -0.12, rx: 0.12, rz: 0.16, a: 0.1 },
  ];
  /** The shallow strait between the islands (a band around x = straitX, bridgeable). */
  const straitX = 0.215, straitW = 0.035;
  const plain = { x: -0.22, z: 0.1, r: WORLD.meadowRadius / (N / 2) };
  // Mountain range on the north-west of the main island (rivers and the waterfall start there).
  const mc = { x: -0.5, z: -0.2 };
  const mDir = 0.75;
  const mcs = Math.cos(mDir), msn = Math.sin(mDir);
  // Rocky hills on the wild island, and a knoll or two on the main island's edge.
  const knolls = [
    { x: 0.5, z: -0.12, r: 0.1, h: 0.55 },
    { x: 0.62, z: 0.14, r: 0.08, h: 0.45 },
    { x: 0.42, z: 0.2, r: 0.07, h: 0.35 },
    { x: 0.58, z: -0.3, r: 0.07, h: 0.4 },
    { x: -0.62, z: 0.36, r: 0.06, h: 0.28 },
    { x: 0.02, z: -0.36, r: 0.06, h: 0.26 },
  ];
  // Islets out on the reef shelf.
  world.islets = [];
  const islets = [
    [-0.95, -0.62, 0.045], [-0.98, 0.1, 0.05], [-0.9, 0.72, 0.045], [-0.2, 0.86, 0.05], [0.3, 0.72, 0.045], [0.9, 0.62, 0.05], [0.94, -0.5, 0.045], [0.2, -0.82, 0.05], [-0.45, -0.78, 0.045],
  ].map(([x, z, r], k) => ({ x, z, r, h: 0.28 + (k % 3) * 0.06 }));
  // The islets as they are now: bigger, fuller and further in from the map edge, several joined
  // to the coast by a sand spit. Built alongside the original ones (above) and applied only after
  // the plants are generated, so saved plant states still line up (see growIslets).
  const grown = [
    { x: -0.8, z: -0.6, r: 0.08, spit: [-0.66, -0.36] },
    { x: -0.86, z: 0.14, r: 0.06 },
    { x: -0.78, z: 0.7, r: 0.08, spit: [-0.64, 0.47] },
    { x: -0.2, z: 0.8, r: 0.085, spit: [-0.2, 0.56] },
    { x: 0.32, z: 0.74, r: 0.075 },
    { x: 0.78, z: 0.62, r: 0.08, spit: [0.66, 0.38] },
    { x: 0.8, z: -0.5, r: 0.08, spit: [0.7, -0.2] },
    { x: 0.2, z: -0.78, r: 0.085 },
    { x: -0.46, z: -0.74, r: 0.08 },
  ].map((it, k) => {
    // Two smaller lobes on the side facing the island (never out toward the map edge).
    const toC = Math.atan2(-it.z, -it.x);
    const hash = (n: number) => {
      const v = Math.sin(k * 91.7 + n * 17.3) * 43758.5;
      return v - Math.floor(v);
    };
    const blobs = [{ x: it.x, z: it.z, r: it.r }];
    for (let j = 0; j < 2; j++) {
      const a = toC + (j === 0 ? -1 : 1) * (0.5 + hash(j) * 0.7);
      const d = it.r * (0.6 + hash(j + 5) * 0.25);
      blobs.push({ x: it.x + Math.cos(a) * d, z: it.z + Math.sin(a) * d, r: it.r * (0.55 + hash(j + 9) * 0.2) });
    }
    return { ...it, h: 0.3 + (k % 3) * 0.06, blobs };
  });
  const vGrown = new Float32Array(N * N);
  const zone = new Uint8Array(N * N);
  world.isle = new Uint8Array(N * N);
  const lobeField = (wx: number, wz: number, lobes: typeof mainLobes) => {
    let m = -10;
    for (const L of lobes) {
      const dx = wx - L.x, dz = wz - L.z;
      const ca = Math.cos(L.a), sa = Math.sin(L.a);
      const u = dx * ca + dz * sa, w = -dx * sa + dz * ca;
      m = smax(m, 1 - Math.sqrt((u / L.rx) ** 2 + (w / L.rz) ** 2), 0.22);
    }
    return m;
  };

  const v = new Float32Array(N * N);
  const massif = new Float32Array(N * N);
  const knollM = new Float32Array(N * N);
  const plainM = new Float32Array(N * N);
  for (let cz = 0; cz < N; cz++) {
    for (let cx = 0; cx < N; cx++) {
      const i = cz * N + cx;
      const nx = ((cx + 0.5) / N) * 2 - 1;
      const nz = ((cz + 0.5) / N) * 2 - 1;
      const wx = nx + 0.09 * sA.fbm(nx * 1.8 + 3.1, nz * 1.8 - 5.7, 4);
      const wz = nz + 0.09 * sA.fbm(nx * 1.8 - 9.2, nz * 1.8 + 2.4, 4);
      const coast = sB.fbm(nx * 4.2 + 11, nz * 4.2 - 7, 4) * 0.15;
      const mMain = lobeField(wx, wz, mainLobes) + coast;
      const mWild = lobeField(wx, wz, wildLobes) + coast;
      let m = Math.max(mMain, mWild);
      // Keep a shallow strait open between the two islands: a gently winding channel that only
      // exists where both coasts are close (it fades out into open sea beyond the islands).
      const between = 1 - smoothstep(0.12, 0.42, Math.max(-mMain, -mWild));
      const sd = Math.abs(nx - straitX + sA.noise(nz * 2.2, 7) * 0.03 + Math.sin(nz * 5.5) * 0.012) / straitW + (1 - between) * 3;
      if (sd < 1 && m > -0.08) m = Math.min(m, -0.04 - (1 - sd) * 0.05);
      if (m > 0) world.isle[i] = mWild > mMain ? 2 : 1;

      let h: number;
      if (m > 0) {
        // Gently rolling lowland rising inland.
        h = 0.06 + Math.pow(m, 0.8) * 0.4 + sA.fbm(nx * 3 + 2, nz * 3, 4) * 0.07;
      } else {
        // Wide shallow reef shelf, then a drop-off into the deep (always shallow in the strait).
        const shelfW = 0.36 + sC.noise(nx * 2.3 + 5, nz * 2.3) * 0.1;
        if (m > -shelfW) h = -0.012 + (m / shelfW) * 0.1 + sC.fbm(nx * 9, nz * 9, 2) * 0.018;
        else h = -0.112 - (-shelfW - m) * 1.7;
        // The strait itself stays wadeable-shallow (so it can be bridged), blending smoothly
        // into the surrounding shelf rather than as a hard straight band.
        if (between > 0) h = Math.max(h, lerp(h, -0.045 + sC.noise(nx * 12, nz * 12) * 0.01, between * (1 - smoothstep(1, 2.4, sd))));
      }
      // Mountain massif on the main island: ridged peaks, only on land.
      const mx = nx - mc.x, mz = nz - mc.z;
      const mu = mx * mcs + mz * msn, mw = -mx * msn + mz * mcs;
      const md = Math.sqrt((mu / 0.36) ** 2 + (mw / 0.17) ** 2) + sC.fbm(nx * 3.5 + 1, nz * 3.5 - 1, 3) * 0.2;
      const mm = (1 - smoothstep(0.25, 1.0, md)) * smoothstep(0.04, 0.26, mMain);
      massif[i] = mm;
      const rid = sB.ridge(nx * 2.5 + 4, nz * 2.5 + 8, 4);
      h += mm * (0.45 + rid * 1.3 + Math.pow(rid, 2) * 1.1 * mm);
      // Hills and knolls.
      for (const k of knolls) {
        const dk = Math.hypot(nx - k.x, nz - k.z) / k.r;
        if (dk < 1.4) {
          const kv = Math.max(0, 1 - dk * dk) * k.h * smoothstep(0, 0.12, m);
          h += kv;
          knollM[i] = Math.max(knollM[i], 1 - dk / 1.4);
        }
      }
      // The village plain: wide, level grassland.
      const dp = Math.hypot(nx - plain.x, nz - plain.z) / plain.r;
      plainM[i] = 1 - smoothstep(0.85, 1.25, dp);
      // The grown islets (same base terrain, new islets), and which cells either layout touches.
      let hg = h;
      let inZone = false;
      const edge = Math.max(Math.abs(nx), Math.abs(nz));
      for (const it of grown) {
        let di = 1e9, gap = 1e9;
        for (const bl of it.blobs) {
          const d = Math.hypot(nx - bl.x, nz - bl.z);
          di = Math.min(di, d / bl.r);
          gap = Math.min(gap, d - bl.r);
        }
        di += sB.noise(nx * 9 + it.x * 7, nz * 9 - it.z * 7) * 0.16;
        const iv = (1 - di) * it.h + sB.noise(nx * 14, nz * 14) * 0.03 - 0.015;
        if (iv > hg) hg = iv;
        // A ring of shallows, fading into the deep toward the map edge instead of being cut off.
        const ring = lerp(-0.012 - (gap / 0.05) * 0.045, -0.3, smoothstep(0.9, 0.985, edge));
        if (gap < 0.13) hg = Math.max(hg, ring);
        if (gap < 0.15) inZone = true;
        if (it.spit) {
          // Sand spit from the islet to the coast, with shallows either side.
          const [sx, sz] = it.spit;
          const ex = sx - it.x, ez = sz - it.z;
          const t = clamp(((nx - it.x) * ex + (nz - it.z) * ez) / (ex * ex + ez * ez), 0, 1);
          const ds = Math.hypot(nx - it.x - ex * t, nz - it.z - ez * t) + sB.noise(nx * 11 + 3, nz * 11) * 0.006;
          const sand = 0.034 - (ds / 0.02) ** 2 * 0.05 + sC.noise(nx * 20, nz * 20) * 0.006;
          if (sand > hg) hg = sand;
          if (ds < 0.08) hg = Math.max(hg, -0.012 - (ds / 0.05) * 0.045);
          if (ds < 0.1) inZone = true;
        }
      }
      // Islets, each with its own ring of shallows.
      for (const it of islets) {
        const di = Math.hypot(nx - it.x, nz - it.z) / it.r;
        const iv = (1 - di) * it.h + sB.noise(nx * 14, nz * 14) * 0.03 - 0.015;
        if (iv > h) h = iv;
        if (di < 3.2) h = Math.max(h, -0.012 - (di - 1) * 0.045);
        if (di < 3.4) inZone = true;
      }
      v[i] = h;
      vGrown[i] = hg;
      zone[i] = inZone ? 1 : 0;
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
  for (const it of grown) world.islets.push({ x: it.x * world.half, z: it.z * world.half, r: it.r * world.half });
  // The grown islets' layers, for growIslets to apply once the plants exist.
  const cells: number[] = [], layers: number[] = [];
  for (let i = 0; i < N * N; i++) {
    if (!zone[i]) continue;
    const toLayer = (h: number) => clamp(h > 0 ? 1 + Math.floor(Math.pow(h, 0.95) * 10.5) : Math.ceil(h * 18), WORLD.minLayer, WORLD.maxLayer);
    const L = toLayer(vGrown[i]);
    // Only where the new islets actually change the ground (the coasts they meet keep their shape).
    if (L === toLayer(v[i]) || !Number.isNaN(world.riverY[i])) continue;
    cells.push(i);
    layers.push(L);
  }
  world.isletNext = { cells: Int32Array.from(cells), layer: Int8Array.from(layers) };

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

  placeMeadow(world, plain, plainM);

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
      // The wild island is thick jungle; the main island keeps open grassland between its woods.
      if (world.isle[i] === 2) f = Math.max(f, 0.62 + sA.noise(nx * 9, nz * 9) * 0.25) * smoothstep(1.5, 3.5, world.distWater[i]) * (1 - world.rocky[i] * 0.6);
      else f *= 0.8;
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

function placeMeadow(world: World, plain: { x: number; z: number; r: number }, plainM: Float32Array): void {
  const N = world.N;
  const mcx = Math.round(((plain.x + 1) / 2) * N - 0.5), mcz = Math.round(((plain.z + 1) / 2) * N - 0.5);
  const mL = 3;
  const r = world.meadow.r;
  world.meadow = { x: world.centerX(mcx), z: world.centerZ(mcz), r, layer: mL };
  // Level the plain to one layer, easing into the surrounding land.
  for (let i = 0; i < N * N; i++) {
    const k = plainM[i];
    if (k <= 0 || world.layer[i] < 1) continue;
    world.layer[i] = Math.round(lerp(world.layer[i], mL, k));
    if (k > 0.6) {
      world.rocky[i] = 0;
      world.sandy[i] = 0;
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
