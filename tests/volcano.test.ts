import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Volcano, VolcanoCycle } from '../src/entities/Volcano';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';

test('smoke precedes eruption and cooling leads to a dormant interval', () => {
  const v = new VolcanoCycle(42);
  v.update(150); assert.equal(v.phase, 'smoking');
  v.update(35); assert.equal(v.phase, 'erupting');
  v.update(65); assert.equal(v.phase, 'cooling');
  v.update(25); assert.equal(v.phase, 'dormant');
  assert.ok(v.remaining >= 240 && v.remaining <= 480);
});
test('Calm charges only active volcanoes and cannot reward repeated clicks', () => {
  const v = new VolcanoCycle(42); let spent = 0;
  assert.equal(v.calm(c => { spent += c; return true; }), false);
  v.update(150);
  assert.equal(v.calm(() => false), false); assert.equal(v.phase, 'smoking');
  assert.equal(v.calm(c => { spent += c; return true; }), true);
  assert.equal(spent, 50); assert.equal(v.phase, 'cooling');
  assert.equal(v.calm(c => { spent += c; return true; }), false);
  assert.equal(spent, 50);
});
test('saved eruption resumes, pause does not advance it', () => {
  const v = new VolcanoCycle(42, { x: 0, z: 0, phase: 'erupting', remaining: 22, cycle: 3 });
  v.update(0); assert.equal(v.remaining, 22);
  v.update(22); assert.equal(v.phase, 'cooling');
});
test('volcano is placed on the second island and reserves its footprint', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const v = new Volcano(w);
  assert.equal(v.group.visible, true);
  const i = w.cellIndexAt(v.x, v.z);
  assert.equal(w.isle[i], 2); assert.equal(w.blockFixed[i], 1);
  const saved = v.save()!;
  const again = new Volcano(w, saved);
  assert.equal(again.x, v.x); assert.equal(again.z, v.z);
});
