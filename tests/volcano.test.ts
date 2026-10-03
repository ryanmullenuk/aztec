import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Volcano, VolcanoCycle, volcanoRockGeometry } from '../src/entities/Volcano';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { WORLD } from '../src/config';

test('smoke precedes eruption and cooling leads to a dormant interval', () => {
  const v = new VolcanoCycle(42);
  v.update(150); assert.equal(v.phase, 'smoking');
  v.update(299); assert.equal(v.phase, 'smoking');
  v.update(1); assert.equal(v.phase, 'erupting');
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

test('crater geometry has finite positions and normals', () => {
  const geometry = volcanoRockGeometry();
  for (const name of ['position', 'normal']) {
    assert.ok(Array.from(geometry.getAttribute(name).array).every(Number.isFinite));
  }
  geometry.dispose();
});
test('cooling retains the mountain and basalt channels but removes lava and smoke', () => {
  const w = new World(); generateIsland(w, WORLD.islandSeed); growIslets(w);
  const v = new Volcano(w);
  const staticCount = v.group.children.length;
  v.update(455);
  assert.equal(v.state.phase, 'erupting');
  assert.equal(v.group.getObjectByName('Active lava')!.visible, true);
  assert.equal(v.state.calm(() => true), true);
  v.update(25);
  assert.equal(v.state.phase, 'dormant');
  assert.equal(v.group.children.length, staticCount);
  assert.equal(v.group.getObjectByName('Active lava')!.visible, false);
  const beds = v.group.children.filter(o => o.name === 'Cooled lava channel');
  assert.equal(beds.length, 3);
  assert.ok(beds.every(o => o.visible));
  assert.ok(v.group.children.filter(o => o.name === 'Volcanic smoke').every(o => !o.visible));
});

test('smoke countdown persists and old saves receive the longer warning', () => {
  const old = new VolcanoCycle(42, { x: 0, z: 0, phase: 'smoking', remaining: 15, cycle: 0 });
  assert.equal(old.remaining, 280);
  const current = new VolcanoCycle(42, { x: 0, z: 0, phase: 'smoking', remaining: 120, cycle: 0, warningVersion: 2 });
  current.update(0); assert.equal(current.remaining, 120);
  current.update(119); assert.equal(current.phase, 'smoking');
  current.update(1); assert.equal(current.phase, 'erupting');
});
