import { test } from 'node:test';
import assert from 'node:assert/strict';
import { islandFile, parseIslandFile, MAX_ISLAND_FILE_BYTES } from '../src/world/IslandFile';
import { serialize } from '../src/world/Save';
import { makeIslander } from '../src/entities/Islander';
import { WORLD } from '../src/config';

function snapshot() {
  const n = WORLD.size ** 2;
  const world = { seed: WORLD.islandSeed, layer: new Int8Array(n).fill(3),
    sandy: new Float32Array(n), forest: new Float32Array(n), rocky: new Float32Array(n), wear: new Float32Array(n),
    path: new Uint8Array(n), bridge: new Uint8Array(n), canal: new Uint8Array(n) };
  world.layer[12] = 7; world.path[43] = 1;
  const person = makeIslander(1, 'Test', 'f', 3, 5, () => 0.5, false);
  person.warrior = 'eagle';
  return serialize({ world, veg: { plants: [{ state: 1, marked: true, growth: 0.5, amount: 2, fruit: 1 }] },
    time: { elapsed: 400, day: 2, t: 0.4, speed: 2 }, rig: { goal: { x: 4, z: 5, dist: 30, yaw: 1 } },
    eco: { res: { wood: 20, stone: 30, grain: 40, fruit: 50, meat: 60, fish: 70, belief: 80 } },
    milestones: new Set(['firstHut']), stats: { sculpted: 2, marked: 1, boats: 0 }, powers: { state: 'rain' },
    buildings: { list: [{ id: 8, key: 'home', cx: 50, cz: 50, rot: 0, complete: true, progress: 1,
      tier: 2, upgrading: false, growth: 0, stock: 0, boats: [], blessTimer: 0 }] },
    colony: { list: [person], savePos: (i: any) => ({ x: i.x, z: i.z }) },
    islandName: 'My island', wildlife: { schools: [{ stock: 4.2 }], animals: { serialize: () => [[1, 4, 5, -1, 0]] } },
    dogs: { serialize: () => [], founded: false },
  } as any);
}

test('current save survives sharing, including buildings, terrain, islanders and resources', async () => {
  const saved = snapshot();
  const file = islandFile(saved);
  const restored = parseIslandFile(await file.text());
  assert.deepEqual(restored, saved);
  restored.buildings[0].tier = 3;
  assert.equal(saved.buildings[0].tier, 2, 'recipient has an independent copy');
  assert.ok(file.name.endsWith('.aztlan.json'));
});

test('bad files and unsupported versions are rejected', async () => {
  const original = JSON.parse(await islandFile(snapshot()).text());
  for (const mutate of [
    (d: any) => { d.version = 99; },
    (d: any) => { d.save.seed = 1; },
    (d: any) => { d.save.world.layer = 'broken'; },
    (d: any) => { d.save.buildings[0].key = 'unknown'; },
    (d: any) => { d.save.islanders[0].name = '<img src=x onerror=alert(1)>'; },
    (d: any) => { d.save.buildings.push(d.save.buildings[0]); },
    (d: any) => { d.save.dogs = [[1]]; },
  ]) {
    const d = structuredClone(original); mutate(d);
    assert.throws(() => parseIslandFile(JSON.stringify(d)));
  }
  assert.throws(() => parseIslandFile('{"__proto__":{}}'));
  assert.throws(() => parseIslandFile('x'.repeat(MAX_ISLAND_FILE_BYTES + 1)));
  assert.throws(() => parseIslandFile('not JSON'));
});

test('transient islander state from a file is not assigned into the running simulation', async () => {
  const d = JSON.parse(await islandFile(snapshot()).text());
  d.save.islanders[0].task = { kind: 'invalid' };
  assert.equal(parseIslandFile(JSON.stringify(d)).islanders[0].task, undefined);
});
