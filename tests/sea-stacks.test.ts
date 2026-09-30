import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { SEA_STACKS, WORLD } from '../src/config';
import { placeSeaStacks, stackCells } from '../src/water/SeaStacks';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

test('sea stacks: a few, from the seed, standing only in the sea off exposed coasts', () => {
  const w = island();
  const sites = placeSeaStacks(w, WORLD.islandSeed);
  assert.ok(sites.length >= SEA_STACKS.count[0] && sites.length <= SEA_STACKS.count[1], `count ${sites.length}`);
  assert.deepEqual(placeSeaStacks(w, WORLD.islandSeed), sites);
  // Every rock's cells are sea: no building land is blocked.
  const cells = stackCells(w, sites);
  assert.ok(cells.length > sites.length * 10);
  for (const i of cells) assert.ok(w.layer[i] <= 0, 'rock on land');
  for (const s of sites) {
    assert.ok(s.main.r >= SEA_STACKS.radius[0] && s.main.top >= SEA_STACKS.height[0]);
    assert.ok(s.rocks.length >= 3);
    // Away from the village plain.
    assert.ok(Math.hypot(s.x - w.meadow.x, s.z - w.meadow.z) > w.meadow.r + SEA_STACKS.plainClear);
    // Not in the strait: never with both islands' shores close by.
    const [cx, cz] = w.cellOf(s.x, s.z);
    let isles = 0;
    for (let dz = -7; dz <= 7; dz++) for (let dx = -7; dx <= 7; dx++) {
      const i = w.idx(cx + dx, cz + dz);
      if (w.layer[i] >= 1) isles |= w.isle[i] === 2 ? 2 : w.isle[i] === 1 ? 1 : 0;
    }
    assert.notEqual(isles, 3);
    for (const o of sites) if (o !== s) assert.ok(Math.hypot(o.x - s.x, o.z - s.z) >= SEA_STACKS.spacing);
  }
});

test('sea stacks keep off reefs and coral', () => {
  const w = island();
  const first = placeSeaStacks(w, WORLD.islandSeed);
  const reefs = first.map((s) => ({ x: s.x, z: s.z, r: 4 }));
  const again = placeSeaStacks(w, WORLD.islandSeed, reefs);
  for (const s of again) {
    for (const r of [s.main, ...s.rocks]) for (const a of reefs) assert.ok(Math.hypot(r.x - a.x, r.z - a.z) > a.r + r.r);
  }
});
