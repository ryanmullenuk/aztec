import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/ai/Colony';
import { Building } from '../src/buildings/Buildings';
import { HEAL } from '../src/buildings/models';
import { Economy } from '../src/economy/Economy';
import { makeIslander } from '../src/entities/Islander';
import { islandFile, parseIslandFile } from '../src/world/IslandFile';
import { serialize } from '../src/world/Save';
import { HEALTH, WORLD } from '../src/config';

function setup(withCentre = false) {
  const world = { half: 100, layerY: () => 0, groundY: () => 0 } as any;
  const eco = new Economy();
  Object.assign(eco.res, { grain: 40, fruit: 30, meat: 20, fish: 30 });
  const list: Building[] = [];
  if (withCentre) {
    const b = new Building(5, 'healer', 100, 100, 0, 0, world);
    b.complete = true;
    list.push(b);
  }
  const bld = { list, byId: (id: number) => list.find((b) => b.id === id), of: (k: string) => list.filter((b) => b.key === k) } as any;
  const colony = new Colony(world, {} as any, eco, bld, {} as any, {} as any, () => 0.5);
  const notes: { text: string; kind?: string }[] = [];
  colony.hooks = { notify: (text, _at, kind) => notes.push({ text, kind }) };
  colony.list = [makeIslander(1, 'Itzel', 'f', 0, 0, () => 0.5), makeIslander(2, 'Tenoch', 'm', 0, 0, () => 0.5)];
  return { colony, eco, notes, centre: list[0] };
}

test('a sick islander untreated for deathSeconds dies, with a warning first', () => {
  const { colony, notes } = setup();
  const isl = colony.list[0];
  colony.afflict(isl, 'sick');
  assert.equal(isl.condition, 'sick');
  assert.equal(isl.conditionT, HEALTH.deathSeconds);
  assert.equal((colony as any).ail(isl, HEALTH.deathSeconds - HEALTH.warnSeconds + 1), false);
  assert.ok(notes.some((n) => n.kind === 'warn' && n.text.includes('will die in')));
  assert.equal((colony as any).ail(isl, HEALTH.warnSeconds), true);
  assert.ok(!colony.list.includes(isl));
  assert.ok(notes.some((n) => n.text.includes('has died')));
});

test('nobody dies in god mode, and curing there is free', () => {
  const { colony, eco } = setup();
  eco.godMode = true;
  const isl = colony.list[0];
  colony.afflict(isl, 'mauled');
  assert.equal((colony as any).ail(isl, HEALTH.deathSeconds * 2), false);
  assert.ok(colony.list.includes(isl));
  assert.equal(colony.cureCost(isl), 0);
  assert.ok(colony.cure(isl));
  assert.equal(isl.condition, 'well');
});

test('curing costs the right food, taken across the food stores, and clears the condition', () => {
  const { colony, eco } = setup();
  const [a, b] = colony.list;
  colony.afflict(a, 'sick');
  colony.afflict(b, 'mauled');
  assert.equal(colony.cureCost(a), HEALTH.cureFood.sick);
  assert.equal(colony.cureCost(b), HEALTH.cureFood.mauled);
  const before = eco.food;
  assert.ok(colony.cure(a));
  assert.equal(a.condition, 'well');
  assert.equal(a.conditionT, 0);
  assert.equal(eco.food, before - HEALTH.cureFood.sick);
  // 70 food left: not enough for a mauling.
  assert.equal(colony.canCure(b), false);
  assert.equal(colony.cure(b), false);
  assert.equal(b.condition, 'mauled');
  assert.equal(eco.food, before - HEALTH.cureFood.sick);
});

test('patients take a bed at the Healing Centre, lie on it, and get up when cured', () => {
  const { colony, centre } = setup(true);
  const isl = colony.list[0];
  colony.afflict(isl, 'sick');
  (colony as any).goHeal(isl);
  assert.equal(isl.task?.kind, 'heal');
  assert.equal(isl.task?.target, centre.id);
  assert.equal(isl.task?.slot, 0);
  assert.deepEqual(colony.patients(centre), [isl]);
  // Arrived and walked in: lying in bed.
  isl.task!.stage = 3;
  (colony as any).runHeal(isl, isl.task, 0.1);
  assert.equal(isl.anim, 'sleep');
  assert.ok(isl.sleeping);
  assert.equal(isl.floorY, centre.y + HEAL.h + HEAL.bedTop - 0.01);
  // A second patient gets the next bed.
  const other = colony.list[1];
  colony.afflict(other, 'mauled');
  (colony as any).goHeal(other);
  assert.equal(other.task?.slot, 1);
  assert.ok(colony.cure(isl));
  assert.equal(isl.task?.stage, 4);
  assert.equal(isl.sleeping, false);
  assert.deepEqual(colony.patients(centre), [other]);
});

function snapshot(person: any) {
  const n = WORLD.size ** 2;
  const world = { seed: WORLD.islandSeed, layer: new Int8Array(n), sandy: new Float32Array(n), forest: new Float32Array(n), rocky: new Float32Array(n),
    wear: new Float32Array(n), path: new Uint8Array(n), bridge: new Uint8Array(n), canal: new Uint8Array(n) };
  return serialize({ world, veg: { plants: [] }, time: { elapsed: 0, day: 0, t: 0.5, speed: 1 }, rig: { goal: { x: 0, z: 0, dist: 30, yaw: 0 } },
    eco: { res: { wood: 1, stone: 1, grain: 1, fruit: 1, meat: 1, fish: 1, belief: 1 } }, milestones: new Set(), stats: { sculpted: 0, marked: 0, boats: 0 },
    powers: { state: 'clear' }, buildings: { list: [] }, colony: { list: [person], savePos: (i: any) => ({ x: i.x, z: i.z }) },
    wildlife: { schools: [], animals: { serialize: () => [] } }, dogs: { serialize: () => [], founded: false } } as any);
}

test('island files keep the condition and its timer, reject bad ones, and old files load healthy', async () => {
  const person = makeIslander(1, 'Test', 'f', 3, 5, () => 0.5);
  person.condition = 'mauled';
  person.conditionT = 1234.5;
  const saved = snapshot(person);
  const restored = parseIslandFile(await islandFile(saved).text());
  assert.equal(restored.islanders[0].condition, 'mauled');
  assert.equal(restored.islanders[0].conditionT, 1234.5);
  const bad = JSON.parse(await islandFile(saved).text());
  bad.save.islanders[0].condition = 'cursed';
  assert.throws(() => parseIslandFile(JSON.stringify(bad)));
  const old = JSON.parse(await islandFile(saved).text());
  delete old.save.islanders[0].condition;
  delete old.save.islanders[0].conditionT;
  const loaded = parseIslandFile(JSON.stringify(old)).islanders[0];
  assert.equal(loaded.condition, undefined);
  assert.equal(makeIslander(1, 'Test', 'f', 0, 0, () => 0.5).condition, 'well');
  // Healthy islanders save no health fields at all.
  assert.equal(snapshot(makeIslander(2, 'Well', 'm', 0, 0, () => 0.5)).islanders[0].condition, undefined);
});
