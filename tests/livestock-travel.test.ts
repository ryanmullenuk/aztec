import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, BRIDGE_DECK_Y } from '../src/world/World';
import { Pathfinder } from '../src/ai/Pathfinder';
import { escortSurfaceY, leashedWalkable } from '../src/entities/livestockTravel';
import { Animals } from '../src/entities/Animals';

function channel() {
  const w = new World(); w.layer.fill(1);
  for (let z = 0; z < w.N; z++) for (let x = 97; x <= 103; x++) w.layer[w.idx(x, z)] = -2;
  w.computeSmooth(); return w;
}
test('escort crosses water while normal walking cannot reach the opposite bank', () => {
  const w = channel(), pf = new Pathfinder(w);
  const route = pf.find(-10.5, 0.5, 10.5, 0.5, { allowWater: true })!;
  assert.ok(route.some(p => w.layer[w.cellIndexAt(p.x, p.z)] < 1));
  assert.deepEqual(route.at(-1), { x: 10.5, z: 0.5 });
  const normal = pf.find(-10.5, 0.5, 10.5, 0.5);
  assert.ok(!normal || normal.at(-1)!.x < 0);
});
test('escort prefers a nearby bridge and uses deck height', () => {
  const w = channel();
  for (let x = 97; x <= 103; x++) w.bridge[w.idx(x, 103)] = 1;
  const route = new Pathfinder(w).find(-10.5, 0.5, 10.5, 0.5, { allowWater: true })!;
  assert.ok(route.some(p => w.bridge[w.cellIndexAt(p.x, p.z)]));
  assert.ok(route.every(p => { const i = w.cellIndexAt(p.x, p.z); return w.layer[i] >= 1 || w.bridge[i]; }));
  assert.equal(escortSurfaceY(w, 0.5, 3.5), BRIDGE_DECK_Y);
});
test('only leashed pigs and goats enter water, and solid obstacles remain blocked', () => {
  const w = channel();
  const animals = Object.create(Animals.prototype) as any; animals.world = w;
  for (const sp of ['pig', 'goat']) {
    const a = { sp, x: 0.5, z: 0.5, y: 0, pen: -1, heldMode: 'lead', heldBy: { task: {} } };
    assert.equal(animals.walkable(a, 0.6, 0.5), true);
    a.heldBy = null as any;
    assert.equal(animals.walkable(a, 0.6, 0.5), false);
  }
  assert.ok(escortSurfaceY(w, 0.5, 0.5) > w.heightAt(0.5, 0.5));
  w.blockFixed[w.cellIndexAt(0.6, 0.5)] = 1;
  assert.equal(leashedWalkable(w, 0.6, 0.5, 0.5, 0.5, 0.45), false);
});
