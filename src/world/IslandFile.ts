import { BUILDINGS, WORLD } from '../config';
import type { SaveData } from './Save';

export const MAX_ISLAND_FILE_BYTES = 8 * 1024 * 1024;

/** A portable snapshot, independent of the sender's browser and later progress. */
export function islandFile(data: SaveData): File {
  const name = (data.name ?? 'island').replace(/[^a-z0-9-]/gi, '-').replace(/-+/g, '-').slice(0, 40);
  return new File([JSON.stringify({ format: 'aztlan-isle', version: 1, save: data })],
    `${name || 'island'}.aztlan.json`, { type: 'application/json' });
}

/** Reject damaged, incompatible or unsafe files before touching the player's save. */
export function parseIslandFile(raw: string): SaveData {
  const fail = (): never => { throw new Error('This is not a compatible Aztlan Isle save file.'); };
  if (raw.length > MAX_ISLAND_FILE_BYTES) return fail();
  const file = JSON.parse(raw, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail();
    if (typeof value === 'number' && !Number.isFinite(value)) fail();
    return value;
  });
  if (file?.format !== 'aztlan-isle' || file.version !== 1) return fail();
  const d = file.save;
  const obj = (x: any) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const number = (x: any) => typeof x === 'number' && Number.isFinite(x);
  const fields = (x: any, keys: string[]) => obj(x) && keys.every(k => number(x[k]));
  const label = (x: any, max = 64) => typeof x === 'string' && x.length <= max && !/[<>"&`]/.test(x);
  const list = (x: any, max: number) => Array.isArray(x) && x.length <= max;
  const bytes = (x: any, length?: number) => {
    if (typeof x !== 'string') return false;
    try { const n = atob(x).length; return length === undefined ? n <= 1000000 && n % 4 === 0 : n === length; }
    catch { return false; }
  };
  if (!obj(d) || d.v !== 1 || d.seed !== WORLD.islandSeed || d.layout !== 1 || !number(d.savedAt)) return fail();
  if (!fields(d.time, ['elapsed', 'day', 't', 'speed']) || !fields(d.camera, ['x', 'z', 'dist', 'yaw'])) return fail();
  if (!fields(d.res, ['wood', 'stone', 'grain', 'fruit', 'meat', 'fish', 'belief']) ||
      !Object.values(d.res).every(number) || !fields(d.stats, ['sculpted', 'marked', 'boats'])) return fail();
  if (!obj(d.weather) || !['clear', 'rain', 'storm'].includes(d.weather.state)) return fail();
  if (d.name !== undefined && (typeof d.name !== 'string' || d.name.length > 32)) return fail();
  if (!list(d.milestones, 1000) || !d.milestones.every((m: any) => label(m))) return fail();
  if (!obj(d.world) || !['layer', 'sandy', 'forest', 'rocky', 'wear', 'path', 'bridge', 'canal']
      .every(k => bytes(d.world[k], WORLD.size * WORLD.size)) || !bytes(d.plants)) return fail();
  if (!list(d.buildings, 10000) || !list(d.islanders, 10000) || !list(d.schools, 10000) || !d.schools.every(number)) return fail();
  const ids = new Set<number>();
  for (const b of d.buildings) {
    if (!fields(b, ['id', 'cx', 'cz', 'rot', 'progress', 'tier', 'growth', 'stock', 'boats', 'bless']) ||
        !Object.hasOwn(BUILDINGS, b.key) || !Number.isInteger(b.id) || ids.has(b.id) ||
        !Number.isInteger(b.cx) || !Number.isInteger(b.cz) || b.cx < 0 || b.cz < 0 || b.cx >= WORLD.size || b.cz >= WORLD.size ||
        !Number.isInteger(b.tier) || b.tier < 1 || b.tier > 10 || b.boats < 0 || b.boats > 100 ||
        typeof b.complete !== 'boolean' || typeof b.upgrading !== 'boolean') return fail();
    for (const k of ['breed', 'cool', 'guard']) if (b[k] !== undefined && !number(b[k])) return fail();
    ids.add(b.id);
  }
  const islanderKeys = ['id', 'name', 'gender', 'child', 'age', 'x', 'z', 'hunger', 'rest', 'happy', 'role', 'manualRole', 'workplace', 'home', 'skin', 'cloth', 'cloth2', 'headdress', 'jewel', 'warrior', 'heading', 'condition', 'conditionT'];
  ids.clear();
  for (const i of d.islanders) {
    if (!fields(i, ['id', 'age', 'x', 'z', 'hunger', 'rest', 'happy', 'workplace', 'home', 'skin', 'cloth', 'cloth2', 'headdress', 'heading']) ||
        !Number.isInteger(i.id) || ids.has(i.id) || !label(i.name) || !['m', 'f'].includes(i.gender) || typeof i.child !== 'boolean' ||
        typeof i.manualRole !== 'boolean' || typeof i.jewel !== 'boolean' || ![null, 'jaguar', 'eagle'].includes(i.warrior) ||
        !['idle', 'builder', 'woodcutter', 'miner', 'gatherer', 'farmer', 'priest', 'fisher', 'butcher', 'smoker', 'warrior', 'archer'].includes(i.role)) return fail();
    // Health (optional: older files have none, and the healthy save none).
    if ((i.condition !== undefined && !['well', 'sick', 'mauled'].includes(i.condition)) ||
        (i.conditionT !== undefined && (!number(i.conditionT) || i.conditionT < 0))) return fail();
    ids.add(i.id);
    for (const key of Object.keys(i)) if (!islanderKeys.includes(key)) delete i[key];
  }
  if (d.goods !== undefined && (!obj(d.goods) || !Object.values(d.goods).every(number))) return fail();
  if (d.voyage !== undefined && d.voyage !== null && !obj(d.voyage)) return fail();
  if (d.trees !== undefined && (!list(d.trees, 6 * 20000) || d.trees.length % 6 !== 0 || !d.trees.every(number))) return fail();
  if (d.garden !== undefined && (!list(d.garden, 5 * 5000) || d.garden.length % 5 !== 0 || !d.garden.every(number))) return fail();
  for (const [rows, width] of [[d.animals, 5], [d.dogs, 13]] as const) {
    if (rows !== undefined && (!list(rows, 10000) || !rows.every((r: any) => Array.isArray(r) && r.length === width && r.every(number)))) return fail();
  }
  return d as SaveData;
}

export function downloadIsland(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
