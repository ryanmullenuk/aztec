import { BuildingKey, ResourceKey, SAVE } from '../config';
import type { Game } from '../Game';
import type { Islander, Role } from '../entities/Islander';
import { PlantState } from '../vegetation/Vegetation';
import { World } from './World';

/** Compact save format. The island is regenerated from the seed; only changes are stored. */
export interface SaveData {
  v: 1;
  seed: number;
  savedAt: number;
  time: { elapsed: number; day: number; t: number; speed: number };
  camera: { x: number; z: number; dist: number; yaw: number };
  res: Record<ResourceKey, number>;
  milestones: string[];
  stats: { sculpted: number; marked: number; boats: number };
  weather: { state: string };
  world: { layer: string; sandy: string; forest: string; rocky: string; wear: string; path?: string; bridge?: string; canal?: string };
  plants: string;
  buildings: {
    id: number; key: BuildingKey; cx: number; cz: number; rot: number; complete: boolean; progress: number; tier: number;
    upgrading: boolean; growth: number; stock: number; boats: number; bless: number;
  }[];
  islanders: Partial<Islander>[];
  schools: number[];
  /** The player's name for the island. */
  name?: string;
  /** Land animals: [alive, x, z, pen building id, respawn]. */
  animals?: number[][];
}

// ---------- base64 helpers ----------

function toB64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const q8 = (f: Float32Array) => {
  const u = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) u[i] = Math.round(Math.max(0, Math.min(1, f[i])) * 255);
  return toB64(u);
};
const dq8 = (s: string, f: Float32Array) => {
  const u = fromB64(s);
  for (let i = 0; i < f.length && i < u.length; i++) f[i] = u[i] / 255;
};

export function readSave(seed: number): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE.key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1 || d.seed !== seed) return null;
    return d;
  } catch {
    return null;
  }
}

/** Seed of whatever island is saved (used when the URL has no seed). */
export function savedSeed(): number | null {
  try {
    const raw = localStorage.getItem(SAVE.key);
    if (!raw) return null;
    return (JSON.parse(raw) as SaveData).seed ?? null;
  } catch {
    return null;
  }
}

export function serialize(g: Game): SaveData {
  const w = g.world;
  const plants = new Uint8Array(g.veg.plants.length * 4);
  g.veg.plants.forEach((p, i) => {
    plants[i * 4] = p.state | (p.marked ? 8 : 0);
    plants[i * 4 + 1] = Math.round(p.growth * 255);
    plants[i * 4 + 2] = Math.min(255, Math.round(p.amount * 4));
    plants[i * 4 + 3] = Math.min(255, Math.round(p.fruit * 20));
  });
  const layerU = new Uint8Array(w.layer.buffer.slice(0));
  return {
    v: 1,
    seed: w.seed,
    savedAt: Date.now(),
    time: { elapsed: g.time.elapsed, day: g.time.day, t: g.time.t, speed: g.time.speed },
    camera: { x: g.rig.goal.x, z: g.rig.goal.z, dist: g.rig.goal.dist, yaw: g.rig.goal.yaw },
    res: { ...g.eco.res },
    milestones: [...g.milestones],
    stats: { ...g.stats },
    weather: { state: g.powers?.state ?? 'clear' },
    world: { layer: toB64(layerU), sandy: q8(w.sandy), forest: q8(w.forest), rocky: q8(w.rocky), wear: q8(w.wear), path: toB64(w.path), bridge: toB64(w.bridge), canal: toB64(w.canal) },
    plants: toB64(plants),
    buildings: g.buildings.list.map((b) => ({
      id: b.id, key: b.key, cx: b.cx, cz: b.cz, rot: b.rot, complete: b.complete, progress: b.progress, tier: b.tier,
      upgrading: b.upgrading, growth: b.growth, stock: b.stock, boats: b.key === 'tradedock' ? b.tradeBoats : b.boats.length, bless: b.blessTimer,
    })),
    islanders: g.colony.list.map((i) => ({
      id: i.id, name: i.name, gender: i.gender, child: i.child, age: i.age, x: i.x, z: i.z, hunger: i.hunger, rest: i.rest, happy: i.happy,
      role: i.role, manualRole: i.manualRole, workplace: i.workplace, home: i.home, skin: i.skin, cloth: i.cloth, cloth2: i.cloth2,
      headdress: i.headdress, jewel: i.jewel, warrior: i.warrior, heading: i.heading,
    })),
    schools: g.wildlife?.schools.map((s) => Math.round(s.stock * 10) / 10) ?? [],
    animals: g.wildlife?.animals.serialize() ?? [],
    name: g.islandName,
  };
}

/** Step 1 of loading: terrain changes, applied before meshes are built. */
export function applyWorld(w: World, d: SaveData): void {
  const L = fromB64(d.world.layer);
  const li = new Int8Array(L.buffer);
  for (let i = 0; i < w.layer.length && i < li.length; i++) w.layer[i] = li[i];
  dq8(d.world.sandy, w.sandy);
  dq8(d.world.forest, w.forest);
  dq8(d.world.rocky, w.rocky);
  dq8(d.world.wear, w.wear);
  if (d.world.canal) {
    // Canals: their dug-out layers are already restored; refill them with water.
    const p = fromB64(d.world.canal);
    for (let i = 0; i < w.canal.length && i < p.length; i++) {
      w.canal[i] = p[i];
      if (p[i] && w.layer[i] > 0) w.riverY[i] = w.layerY(w.layer[i]) + 0.7 * w.H;
    }
  }
  if (d.world.bridge) {
    const p = fromB64(d.world.bridge);
    for (let i = 0; i < w.bridge.length && i < p.length; i++) w.bridge[i] = p[i];
  }
  if (d.world.path) {
    const p = fromB64(d.world.path);
    for (let i = 0; i < w.path.length && i < p.length; i++) w.path[i] = p[i];
  }
  w.countCanals();
  w.computeSmooth();
  w.computeDistWater();
  w.classifyGround();
  w.version++;
}

/** Step 2 of loading: plants, buildings, islanders, economy and time. */
export function applyRest(g: Game, d: SaveData): void {
  if (d.name) g.setIslandName(d.name);
  const u = fromB64(d.plants);
  g.veg.plants.forEach((p, i) => {
    if (i * 4 + 3 >= u.length) return;
    p.state = (u[i * 4] & 7) as PlantState;
    p.marked = (u[i * 4] & 8) !== 0;
    p.growth = u[i * 4 + 1] / 255;
    p.amount = u[i * 4 + 2] / 4;
    p.fruit = u[i * 4 + 3] / 20;
    g.veg.touch(p);
  });
  g.veg.refreshHeights(0, 0, g.world.N - 1, g.world.N - 1);
  const idMap = new Map<number, number>();
  for (const b of d.buildings) {
    const nb = g.buildings.restore(b.key, b.cx, b.cz, b.rot, b);
    idMap.set(b.id, nb.id);
    if (b.key === 'jetty' && b.boats > 0) g.boats?.restore(nb, b.boats);
    if (b.key === 'tradedock') for (let k = 0; k < (b.boats ?? 0); k++) g.trade?.launch(nb);
    if (b.key === 'farm' || b.key === 'butcher') g.wildlife?.registerPen(nb);
  }
  for (const data of d.islanders) {
    const i = g.colony.restore(data as Islander);
    i.home = idMap.get(i.home) ?? -1;
    i.workplace = idMap.get(i.workplace) ?? -1;
    if (i.role === 'warrior' && !i.warrior) i.role = 'idle' as Role;
  }
  Object.assign(g.eco.res, d.res);
  g.buildings.recomputeCaps();
  g.time.elapsed = d.time.elapsed;
  g.time.day = d.time.day;
  g.time.t = d.time.t;
  g.time.speed = d.time.speed || 1;
  for (const m of d.milestones) g.milestones.add(m);
  Object.assign(g.stats, d.stats);
  g.rig.jumpTo(d.camera.x, d.camera.z, d.camera.dist, d.camera.yaw);
  if (g.wildlife && d.animals) g.wildlife.animals.restore(d.animals, idMap);
  if (g.wildlife) d.schools.forEach((s, i) => g.wildlife!.schools[i] && (g.wildlife!.schools[i].stock = s));
  if (g.powers && d.weather.state === 'storm') g.powers.startStorm();
}

export function writeSave(g: Game): boolean {
  try {
    localStorage.setItem(SAVE.key, JSON.stringify(serialize(g)));
    return true;
  } catch {
    return false;
  }
}
