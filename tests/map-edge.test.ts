import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { landDistance, softenMapEdge } from '../src/world/mapEdge';
import { JELLYFISH, WORLD } from '../src/config';
import { Jellyfish } from '../src/entities/Jellyfish';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  return w;
}

test('map edge: the sea deepens before the edge, land and the beaches stay as they were, and it only runs once', () => {
  const w = island();
  const N = w.N;
  const before = Int8Array.from(w.layer);
  const dl = landDistance(w);
  assert.ok(softenMapEdge(w) > 0);
  for (let i = 0; i < N * N; i++) {
    // Never raises anything, never touches land or the water right beside it.
    assert.ok(w.layer[i] <= before[i]);
    if (before[i] >= 1 || dl[i] <= 2) assert.equal(w.layer[i], before[i]);
  }
  // No shallows left within a few cells of the edge (so none is cut off straight by it).
  for (let cz = 0; cz < N; cz++) for (let cx = 0; cx < N; cx++) {
    const e = Math.min(cx, cz, N - 1 - cx, N - 1 - cz);
    if (e < 3) assert.ok(w.layer[w.idx(cx, cz)] <= -6, `shallow at ${cx},${cz}`);
  }
  // A second pass (e.g. loading a save made after the first) changes nothing.
  const after = Int8Array.from(w.layer);
  assert.equal(softenMapEdge(w), 0);
  assert.deepEqual(Int8Array.from(w.layer), after);
});

test('jellyfish: swarms in the shallows off the beaches, always under water, scattering from the pointer', () => {
  const w = island();
  softenMapEdge(w);
  const water = { shared: { uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 } } } as any;
  const J = new Jellyfish(w, water) as any;
  assert.equal(J.swarms.length, JELLYFISH.swarms);
  assert.ok(J.jellies.length >= JELLYFISH.swarms * JELLYFISH.perSwarm[0]);
  const dl = landDistance(w);
  for (const s of J.swarms) {
    const i = w.cellIndexAt(s.hx, s.hz);
    assert.ok(w.layer[i] <= -1 && dl[i] >= JELLYFISH.shore[0] && dl[i] <= JELLYFISH.shore[1], 'home off a beach');
  }
  const under = () => {
    for (const j of J.jellies) {
      assert.ok(j.y < 0, `jelly out of the water at ${j.x},${j.z}`);
      assert.ok(w.heightAt(j.x, j.z) < j.y, 'jelly in the sea floor');
    }
  };
  for (let k = 0; k < 300; k++) J.update(1 / 30, null);
  under();
  // The pointer over a swarm: the jellies near it move away.
  const s = J.swarms[0];
  const near = J.jellies.filter((j: any) => j.swarm === 0).sort((a: any, b: any) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
  const cursor = new THREE.Vector3(near.x + 0.4, 0, near.z);
  const d0 = Math.hypot(near.x - cursor.x, near.z - cursor.z);
  for (let k = 0; k < 45; k++) J.update(1 / 30, cursor);
  assert.ok(Math.hypot(near.x - cursor.x, near.z - cursor.z) > d0 + 0.5, 'scattered from the pointer');
  under();
});
