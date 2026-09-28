import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Colony } from '../src/ai/Colony';
import { makeIslander } from '../src/entities/Islander';

function setup() {
  const pen = { id: 7, key: 'chickenpen', complete: true, x: 20, z: 20, door: { x: 21, z: 21 } } as any;
  const near = { ...pen, id: 8, x: 0, z: 0 };
  const buildings = new Map([[7, pen], [8, near]]);
  const colony = new Colony({} as any, {} as any, {} as any,
    { byId: (id: number) => buildings.get(id), of: () => [near, pen] } as any, {} as any, {} as any, () => 0.5);
  const chased = new Set<number>();
  colony.hooks = {
    animalInfo: () => ({ name: 'Chicken', food: true, needsPen: false, mode: 'carry', meat: 3 }),
    animalPos: () => ({ x: 0, z: 0, free: true }),
    canCapture: id => !chased.has(id), beginChase: id => { chased.add(id); },
    catchable: () => true, grab: () => 'carry', releaseAnimal: id => { chased.delete(id); },
  };
  colony.list = Array.from({ length: 5 }, (_, n) => makeIslander(n, `Person ${n}`, 'm', 0, 0, () => 0.5));
  colony.list[1].child = true;
  colony.list[2].sleeping = true;
  colony.list[3].task = { kind: 'build' } as any;
  colony.list[4].manualRole = true;
  return { colony, pen, buildings, chased };
}

test('only idle adults are sent, each animal reserved once, chosen pen retained after catching', () => {
  const { colony, pen } = setup();
  const animals = [{ id: 0, x: 0, z: 0 }, { id: 1, x: 2, z: 0 }];
  assert.equal(colony.roundUp(pen, animals), 1);
  assert.equal(colony.roundUp(pen, animals), 0);
  assert.equal(colony.list[3].task?.kind, 'build');
  const worker = colony.list[0];
  assert.equal(worker.task?.building, pen.id);
  (colony as any).runTask(worker, 0.1);
  assert.equal(worker.task?.phase, 1);
  assert.equal(worker.task?.building, pen.id);
  assert.equal(worker.task?.x, pen.door.x);
  assert.equal(worker.carry?.kind, 'chicken');
});

test('demolishing the selected pen cancels its chase and releases the animal', () => {
  const { colony, pen, buildings, chased } = setup();
  colony.roundUp(pen, [{ id: 0, x: 0, z: 0 }]);
  buildings.delete(pen.id);
  (colony as any).runTask(colony.list[0], 0.1);
  assert.equal(colony.list[0].task, null);
  assert.equal(chased.size, 0);
});

test('unfinished pens cannot start a round-up', () => {
  const { colony, pen } = setup();
  pen.complete = false;
  assert.equal(colony.roundUp(pen, [{ id: 0, x: 0, z: 0 }]), 0);
});
