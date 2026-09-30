import { JETTY, ResourceKey, TRADE } from '../config';

/**
 * Pure boat logic shared by the fishing fleet, the trade boats and visiting traders (no three.js,
 * so it can be unit tested): which school a boat works and where it holds station, how hulls keep
 * clear of each other, and the bargains foreign traders bring.
 */

/** A hull on the water: position, heading, half length and half beam (world units). */
export interface Hull {
  x: number;
  z: number;
  heading: number;
  half: number;
  beam: number;
  speed: number;
  /** Right of way: the lower number keeps its course, the higher gives way. */
  pri: number;
  /** Moored or lying still: others steer round it. */
  moored: boolean;
  /** The boat this hull stands for (to skip itself). */
  ref: unknown;
}

// ---------------- Fishing grounds ----------------

/**
 * The school a boat should work: the nearest by sea, but a school other boats are already working
 * costs `shareCost` extra per boat, so a fleet spreads over the grounds and only doubles up when
 * that is much closer. `working[i]` counts the other boats on school i. Returns -1 if none has fish.
 */
export function pickSchool(x: number, z: number, schools: { x: number; z: number; stock: number }[], working: number[], shareCost = JETTY.shareCost, minStock = 4): number {
  let best = -1, bs = Infinity;
  schools.forEach((s, i) => {
    if (s.stock < minStock) return;
    const score = Math.hypot(s.x - x, s.z - z) + (working[i] ?? 0) * shareCost;
    if (score < bs) {
      bs = score;
      best = i;
    }
  });
  return best;
}

/**
 * Station k of n boats sharing a school: spread evenly round it, the first on the side facing
 * `base` (a heading from the school, e.g. towards home). Returns the offset from the school.
 */
export function stationOffset(k: number, n: number, base: number, radius = JETTY.stationRadius): { x: number; z: number } {
  // Keep a boat length or so between neighbouring stations however many share the school.
  const r = Math.max(radius, (n * 1.8) / (Math.PI * 2));
  const a = base + (k - (n - 1) / 2) * ((Math.PI * 2) / Math.max(1, n));
  return { x: Math.sin(a) * r, z: Math.cos(a) * r };
}

// ---------------- Keeping clear ----------------

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Gap between two hulls (keel segments with round ends, beam wide): negative when they overlap.
 * (nx, nz) points from b towards a along the closest approach.
 */
export function hullGap(a: Hull, b: Hull): { gap: number; nx: number; nz: number } {
  const la = Math.max(0, a.half - a.beam), lb = Math.max(0, b.half - b.beam);
  const ax = Math.sin(a.heading) * la, az = Math.cos(a.heading) * la;
  const bx = Math.sin(b.heading) * lb, bz = Math.cos(b.heading) * lb;
  // Closest points between segments a0 + s*da and b0 + t*db (s, t in 0..1).
  const a0x = a.x - ax, a0z = a.z - az, dax = ax * 2, daz = az * 2;
  const b0x = b.x - bx, b0z = b.z - bz, dbx = bx * 2, dbz = bz * 2;
  const rx = a0x - b0x, rz = a0z - b0z;
  const A = dax * dax + daz * daz, E = dbx * dbx + dbz * dbz, F = dbx * rx + dbz * rz;
  let s = 0, t = 0;
  if (A < 1e-9 && E < 1e-9) {
    s = t = 0;
  } else if (A < 1e-9) {
    t = clamp(F / E, 0, 1);
  } else {
    const C = dax * rx + daz * rz;
    if (E < 1e-9) s = clamp(-C / A, 0, 1);
    else {
      const B = dax * dbx + daz * dbz, den = A * E - B * B;
      s = den > 1e-9 ? clamp((B * F - C * E) / den, 0, 1) : 0;
      t = (B * s + F) / E;
      if (t < 0) {
        t = 0;
        s = clamp(-C / A, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((B - C) / A, 0, 1);
      }
    }
  }
  let nx = a0x + dax * s - (b0x + dbx * t), nz = a0z + daz * s - (b0z + dbz * t);
  let d = Math.hypot(nx, nz);
  if (d < 1e-6) {
    // Keels crossing: push apart centre to centre (or sideways if even those coincide).
    nx = a.x - b.x;
    nz = a.z - b.z;
    d = Math.hypot(nx, nz);
    if (d < 1e-6) {
      nx = Math.cos(a.heading);
      nz = -Math.sin(a.heading);
      d = 1;
    }
    return { gap: -(a.beam + b.beam), nx: nx / d, nz: nz / d };
  }
  return { gap: d - a.beam - b.beam, nx: nx / d, nz: nz / d };
}

/**
 * Rules of the sea for a boat about to sail on heading `want`: hulls lying across its course
 * ahead make it turn away (dead ahead, always to the same side, so two boats meeting bow to bow
 * pass each other) and slow down; a boat with the right of way (lower `pri`) only eases off, the
 * other gives way and waits if it must. Moored or still boats are steered round at a crawl.
 * Returns the heading change and a 0..1 speed factor.
 */
export function giveWay(me: Hull, want: number, others: Iterable<Hull>, clearance = 0.3, look = 2): { turn: number; slow: number } {
  const fx = Math.sin(want), fz = Math.cos(want);
  let turn = 0, slow = 1;
  for (const o of others) {
    if (o.ref === me.ref) continue;
    const rx = o.x - me.x, rz = o.z - me.z;
    if (Math.abs(rx) > look + me.half + o.half + 1 || Math.abs(rz) > look + me.half + o.half + 1) continue;
    const along = rx * fx + rz * fz;
    if (along <= 0) continue;
    // Positive: the other lies on my local +x side (turning towards +x raises the heading).
    const side = rx * fz - rz * fx;
    const rel = o.heading - want;
    const across = Math.abs(Math.sin(rel)) * o.half + Math.abs(Math.cos(rel)) * o.beam;
    const lengthwise = Math.abs(Math.cos(rel)) * o.half + Math.abs(Math.sin(rel)) * o.beam;
    if (Math.abs(side) - across - me.beam > clearance) continue;
    const gap = along - me.half - lengthwise;
    if (gap > look) continue;
    const urgency = 1 - clamp(gap / look, 0, 1);
    turn += (side > 0.05 ? -1 : side < -0.05 ? 1 : -1) * urgency;
    const still = o.moored || o.speed < 0.2;
    const ease = clamp((gap - clearance * 0.5) / (look * 0.7), 0, 1);
    if (still) slow = Math.min(slow, 0.35 + 0.65 * ease);
    else if (o.pri < me.pri) slow = Math.min(slow, ease);
    else slow = Math.min(slow, 0.45 + 0.55 * ease);
  }
  return { turn: clamp(turn, -1, 1), slow };
}

// ---------------- Visiting traders ----------------

/** One bargain offered by visiting traders. */
export interface VisitorDeal {
  give: Partial<Record<ResourceKey, number>>;
  get: Partial<Record<ResourceKey, number>>;
  taken: boolean;
}

const GOODS: ResourceKey[] = ['wood', 'stone', 'grain', 'fruit', 'meat', 'fish', 'belief'];

/** Round to a tidy trading amount (5s once it's big enough). */
function tidy(n: number): number {
  return n >= 20 ? Math.round(n / 5) * 5 : Math.max(1, Math.round(n));
}

/** Weighted pick of an index (weights >= 0). */
function pickWeighted(w: number[], rand: () => number): number {
  const sum = w.reduce((s, x) => s + x, 0);
  if (sum <= 0) return -1;
  let r = rand() * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r < 0 && w[i] > 0) return i;
  }
  return w.findIndex((x) => x > 0);
}

/**
 * 1-3 bargains for visiting traders, sized to the village's stores: they ask for part of what the
 * village has plenty of (never Belief) and offer what it is short of, at a rather better rate than
 * the Trade Dock market. No two deals are the same pair of goods.
 */
export function visitorDeals(res: Record<ResourceKey, number>, rand: () => number = Math.random, V = TRADE.visitors): VisitorDeal[] {
  const n = V.deals[0] + Math.floor(rand() * (V.deals[1] - V.deals[0] + 1));
  const giveKeys = GOODS.filter((k) => k !== 'belief');
  const deals: VisitorDeal[] = [];
  const used = new Set<string>();
  const gave = new Set<ResourceKey>();
  for (let d = 0; d < n * 4 && deals.length < n; d++) {
    // Ask for something the village has plenty of (a different good each deal when possible).
    const gw = giveKeys.map((k) => (res[k] >= V.minGive ? res[k] : 0) * (gave.has(k) ? 0.15 : 1));
    let gi = pickWeighted(gw, rand);
    if (gi < 0) gi = giveKeys.reduce((b, k, i) => (res[k] > res[giveKeys[b]] ? i : b), 0);
    const give = giveKeys[gi];
    // Offer something it's short of (belief now and then).
    const ow = GOODS.map((k) => (k === give ? 0 : (k === 'belief' ? 0.5 : 1) / (1 + res[k] / 20)));
    const get = GOODS[pickWeighted(ow, rand)];
    if (!get || used.has(`${give}>${get}`)) continue;
    const share = V.giveShare[0] + rand() * (V.giveShare[1] - V.giveShare[0]);
    const amount = Math.max(5, Math.min(V.maxGive, tidy(res[give] * share)));
    const rate = V.rate[0] + rand() * (V.rate[1] - V.rate[0]);
    const back = tidy((amount * V.values[give] * rate) / V.values[get]);
    used.add(`${give}>${get}`);
    gave.add(give);
    deals.push({ give: { [give]: amount }, get: { [get]: back }, taken: false });
  }
  return deals;
}

/** Where visiting traders come from. */
export function traderHome(rand: () => number = Math.random): string {
  const h = TRADE.visitors.homes;
  return h[Math.floor(rand() * h.length) % h.length];
}
