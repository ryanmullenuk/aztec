import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { World } from '../src/world/World';
import { generateIsland } from '../src/world/generator';
import { growIslets } from '../src/world/islets';
import { softenMapEdge } from '../src/world/mapEdge';
import { DEFENCE, JAGUARS, WORLD } from '../src/config';
import { Jaguars } from '../src/entities/Jaguars';
import { Defence, Quarry } from '../src/entities/Defence';
import { Colony } from '../src/ai/Colony';
import { Building } from '../src/buildings/Buildings';
import { Economy } from '../src/economy/Economy';
import { makeIslander } from '../src/entities/Islander';

function island(): World {
  const w = new World();
  generateIsland(w, WORLD.islandSeed);
  growIslets(w);
  softenMapEdge(w);
  return w;
}

function jaguars(w: World) {
  const J = new Jaguars(w);
  const sounds: string[] = [];
  const arrivals: number[] = [];
  J.hooks = {
    villagers: () => [], byId: () => undefined, alarm: () => {}, maul: () => {}, godMode: () => true, danger: () => {},
    sfx: (n) => sounds.push(n), arrived: (j) => arrivals.push(j.id),
  };
  return { J: J as any, sounds, arrivals };
}

test('jaguars: an arrow drives one off, enough of them kill it, and a new one swims in from beyond the map to its den', () => {
  const w = island();
  const { J, arrivals } = jaguars(w);
  assert.equal(J.list.length, JAGUARS.count);
  const j = J.list[0];
  const den = j.den;
  // Wounded: bolts for its den.
  assert.equal(J.hitByArrow(j), 'hurt');
  assert.equal(j.state, 'retreat');
  assert.equal(j.hp, DEFENCE.jaguarHits - 1);
  for (let k = 1; k < DEFENCE.jaguarHits - 1; k++) J.hitByArrow(j);
  assert.equal(J.hitByArrow(j), 'killed');
  assert.equal(j.state, 'dead');
  assert.ok(!J.targets.includes(j), 'the dead are not shot at');
  // Lies a while, then is gone; a replacement is due later.
  for (let k = 0; k < 30 * 16; k++) J.update(1 / 30, false, null);
  assert.ok(!J.list.includes(j));
  assert.equal(J.list.length, JAGUARS.count - 1);
  assert.equal(J.pending.length, 1);
  const due = J.pending[0].at - J.time;
  assert.ok(due >= DEFENCE.respawn[0] - 20 && due <= DEFENCE.respawn[1]);
  // It sets out from out at sea past the map edge, not on the island.
  J.pending[0].at = J.time;
  J.update(1 / 30, false, null);
  const nj = J.list.find((x: any) => x.state === 'arrive');
  assert.ok(nj, 'a newcomer is on its way');
  assert.equal(J.list.length, JAGUARS.count);
  assert.ok(w.cellIndexAt(nj.x, nj.z) < 0, 'starts beyond the map');
  assert.ok(!J.targets.includes(nj), 'out of reach until it reaches the island');
  assert.equal(nj.den, den);
  // Swims in and makes its way to the empty den.
  for (let k = 0; k < 30 * 300 && nj.state === 'arrive'; k++) J.update(1 / 30, false, null);
  assert.equal(nj.state, 'rest');
  assert.ok(Math.hypot(nj.x - den.x, nj.z - den.z) < 3, 'at its den');
  assert.deepEqual(arrivals, [nj.id]);
  assert.equal(nj.hp, DEFENCE.jaguarHits);
});

function tower(rot = 0) {
  const group = new THREE.Group();
  group.position.set(0, 1, 0);
  return { id: 9, key: 'watchtower', complete: true, x: 0, z: 0, rot, group } as any;
}

test('watchtower: needs nobody to man it, shoots only at predators within range, from the window facing them', () => {
  const w = { seed: 3, cellIndexAt: () => 0, heightAt: () => 0.5 } as any;
  const b = tower(1);
  const D = new Defence(w, { list: [b] } as any) as any;
  const near: Quarry = { x: 8, y: 0.5, z: 3 }, far: Quarry = { x: -DEFENCE.range - 4, y: 0.5, z: 0 };
  const hits: Quarry[] = [];
  const sounds: string[] = [];
  const starts: THREE.Vector3[] = [];
  D.hooks = {
    quarry: () => [
      { kind: 'jaguar', ref: near, aimY: 0.8 },
      { kind: 'alligator', ref: far, aimY: 0.55 },
    ],
    hit: (_k: string, r: Quarry) => (hits.push(r), 'hurt'),
    sfx: (n: string) => sounds.push(n),
  };
  for (let k = 0; k < 30 * 30; k++) {
    const n = D.arrows.length;
    D.update(1 / 30);
    if (D.arrows.length > n) starts.push(D.arrows[D.arrows.length - 1].p.clone().addScaledVector(D.arrows[D.arrows.length - 1].v, -1 / 30));
  }
  const st = D.stats(b);
  assert.ok(st.shots >= 8 && st.shots <= 30 / (DEFENCE.reload * 0.85) + 1, `shots ${st.shots}`);
  assert.ok(hits.length > 0 && hits.every((r) => r === near), 'hits only the one in range');
  assert.ok(hits.length >= st.shots * 0.45, `mostly on target (${hits.length}/${st.shots})`);
  assert.ok(sounds.includes('bow') && sounds.includes('arrowhit'));
  // Out of the window on the +x side (the tower is turned a quarter, so that is a side window), high up.
  const win = D.windowFor(b, near.x, near.z);
  assert.ok(win.x > 0.6 && Math.abs(win.z) < 0.1 && win.y > 3, `window ${win.toArray()}`);
  for (const p of starts) assert.ok(p.distanceTo(win) < 0.05, 'arrows leave from that window');
  // A predator behind it: the opposite window.
  assert.ok(D.windowFor(b, -8, -1).x < -0.6);
  // Not yet built: no arrows.
  const u = tower();
  u.complete = false;
  const D2 = new Defence(w, { list: [u] } as any) as any;
  D2.hooks = D.hooks;
  for (let k = 0; k < 30 * 10; k++) D2.update(1 / 30);
  assert.equal(D2.stats(u).shots, 0);
});

test('watchtower: a kill is counted and reported', () => {
  const w = { seed: 5, cellIndexAt: () => 0, heightAt: () => 0 } as any;
  const b = tower();
  const D = new Defence(w, { list: [b] } as any) as any;
  let alive = true;
  const beast: Quarry = { x: 0, y: 0, z: 6 };
  const killed: string[] = [];
  D.hooks = {
    quarry: () => (alive ? [{ kind: 'jaguar', ref: beast, aimY: 0.3 }] : []),
    hit: () => ((alive = false), 'killed'),
    sfx: () => {},
    killed: (k: string) => killed.push(k),
  };
  for (let k = 0; k < 30 * 30 && alive; k++) D.update(1 / 30);
  assert.equal(alive, false);
  assert.deepEqual(killed, ['jaguar']);
  assert.equal(D.stats(b).kills, 1);
});

test('a finished watchtower takes nobody off their work', () => {
  const world = { half: 100, layerY: () => 0, groundY: () => 0 } as any;
  const eco = new Economy();
  Object.assign(eco.res, { grain: 80, fruit: 80 });
  const t = new Building(4, 'watchtower', 100, 100, 0, 0, world);
  t.complete = true;
  const list = [t];
  const bld = { list, byId: (id: number) => list.find((b) => b.id === id), of: (k: string) => list.filter((b) => b.key === k) } as any;
  const colony = new Colony(world, {} as any, eco, bld, {} as any, {} as any, () => 0.5);
  colony.list = [1, 2, 3, 4, 5].map((id) => makeIslander(id, `V${id}`, id % 2 ? 'm' : 'f', 0, 0, () => 0.5));
  (colony as any).assignJobs();
  assert.ok(colony.list.every((i) => i.workplace !== t.id));
});
