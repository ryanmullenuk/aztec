import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';
import { GARDEN, Garden, VARIANTS } from '../src/vegetation/Garden';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

/** A stretch of open, level meadow to plant on. */
function meadow(w: World): { x: number; z: number } {
  const g = new Garden(w);
  const m = w.meadow;
  for (let r = 0; r < 30; r++) {
    for (let a = 0; a < 24; a++) {
      const x = m.x + Math.cos((a / 24) * Math.PI * 2) * r, z = m.z + Math.sin((a / 24) * Math.PI * 2) * r;
      let ok = true;
      for (let k = -4; k <= 4 && ok; k++) for (let j = -2; j <= 2 && ok; j++) ok = g.canGrow(x + k, z + j);
      if (ok) return { x, z };
    }
  }
  throw new Error('no meadow');
}

test('garden: a stroke plants spaced-out plants of its brush that pop up, overshoot and settle', () => {
  const w = island();
  const G = new Garden(w) as any;
  const at = meadow(w);
  let n = 0;
  for (let k = 0; k <= 15; k++) n += G.paint(at.x - 3 + (6 * k) / 15, at.z, 'flowers', k === 0);
  assert.ok(n >= 20, `planted ${n}`);
  assert.equal(G.count, n);
  assert.ok(G.plants.every((p: any) => VARIANTS[p.v].brush === 'flowers'));
  // A stroke favours one or two kinds.
  const groups = new Map<string, number>();
  for (const p of G.plants) groups.set(VARIANTS[p.v].group, (groups.get(VARIANTS[p.v].group) ?? 0) + 1);
  const top = Math.max(...groups.values());
  assert.ok(top >= n * 0.4, 'mostly one kind');
  // Spacing: no two closer than their sizes allow.
  for (const a of G.plants) for (const b of G.plants) {
    if (a === b) continue;
    const need = (VARIANTS[a.v].r * a.s + VARIANTS[b.v].r * b.s) * 0.9;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= need - 1e-6);
  }
  // Going over the same bed again only fills gaps: far fewer new plants.
  for (let r = 0; r < 3; r++) for (let k = 0; k <= 15; k++) G.paint(at.x - 3 + (6 * k) / 15, at.z, 'flowers', k === 0);
  let more = 0;
  for (let k = 0; k <= 15; k++) more += G.paint(at.x - 3 + (6 * k) / 15, at.z, 'flowers', k === 0);
  assert.ok(more < n * 0.25, `refill ${more}`);
  const full = G.count;
  // The pop: hidden before its turn, past full size on the way up, settled at the end.
  const s = (t: number) => Garden.popScale(1, t);
  assert.equal(s(-0.1).s, 0);
  let peak = 0, tallest = 0;
  for (let t = 0; t < GARDEN.pop; t += 0.01) {
    peak = Math.max(peak, s(t).s);
    tallest = Math.max(tallest, s(t).sy / Math.max(1e-3, s(t).s));
  }
  assert.ok(peak > 1.15, `overshoot ${peak}`);
  assert.ok(tallest > 1.1, 'stretches as it shoots up');
  for (let k = 0; k < 40; k++) G.update(1 / 30);
  assert.ok(G.plants.every((p: any) => p.state === 0));
  assert.equal(G.count, full);
});

test('garden: keeps off water and paths, clears what is paved over, digs up, and saves', () => {
  const w = island();
  const G = new Garden(w) as any;
  const at = meadow(w);
  // Never in the sea.
  let sea = -1;
  for (let i = 0; i < w.N * w.N && sea < 0; i++) if (w.layer[i] <= -2) sea = i;
  assert.equal(G.canGrow(w.centerX(sea % w.N), w.centerZ(Math.floor(sea / w.N))), false);
  for (let k = 0; k <= 10; k++) G.paint(at.x - 2 + (4 * k) / 10, at.z, 'bushes', k === 0);
  for (let k = 0; k <= 10; k++) G.paint(at.x - 2 + (4 * k) / 10, at.z + 1.2, 'shrubs', k === 0);
  for (let k = 0; k < 40; k++) G.update(1 / 30);
  const n = G.count;
  assert.ok(n > 8);
  assert.ok(G.plants.some((p: any) => VARIANTS[p.v].brush === 'bushes') && G.plants.some((p: any) => VARIANTS[p.v].brush === 'shrubs'));
  // Save and replant exactly.
  const data = G.serialize();
  assert.equal(data.length, n * 5);
  const H = new Garden(w) as any;
  H.restore(data);
  assert.equal(H.count, n);
  assert.ok(H.plants.every((p: any) => p.state === 0));
  // A path laid over one: it is cleared away.
  const p = G.plants[0];
  const cell = w.cellIndexAt(p.x, p.z);
  w.path[cell] = 1;
  w.version++;
  for (let k = 0; k < 30; k++) G.update(1 / 30);
  assert.ok(!G.plants.some((q: any) => w.cellIndexAt(q.x, q.z) === cell));
  w.path[cell] = 0;
  // Digging up a patch.
  const before = G.count;
  G.paint(at.x, at.z, 'unplant', true);
  for (let k = 0; k < 30; k++) G.update(1 / 30);
  assert.ok(G.count < before);
  assert.ok(!G.plants.some((q: any) => Math.hypot(q.x - at.x, q.z - at.z) < GARDEN.radius.unplant - 0.01));
});
