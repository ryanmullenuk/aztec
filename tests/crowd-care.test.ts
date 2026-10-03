import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avoidCrowd } from '../src/ai/CrowdAvoidance';
import { SpatialHash } from '../src/world/SpatialHash';
import { makeIslander, Islander } from '../src/entities/Islander';
import { poseFor } from '../src/entities/IslanderRig';
import { Colony } from '../src/ai/Colony';
import { firepitModel } from '../src/buildings/models';

function people() {
  const a = makeIslander(1, 'A', 'm', -0.7, 0, () => 0.5);
  const b = makeIslander(2, 'B', 'f', 0.7, 0, () => 0.5);
  a.anim = b.anim = 'walk'; a.speed = b.speed = 1;
  a.heading = Math.PI / 2; b.heading = -Math.PI / 2;
  const grid = new SpatialHash<Islander>(2); grid.insert(a); grid.insert(b);
  return { a, b, grid };
}
test('head-on walkers choose opposite sides before overlapping', () => {
  const { a, b, grid } = people();
  const av = avoidCrowd(a, 1, 0, 1, grid, () => true);
  const bv = avoidCrowd(b, -1, 0, 1, grid, () => true);
  assert.ok(av.x > 0 && bv.x < 0);
  assert.ok(av.z * bv.z < 0);
  for (let t = 0; t < 0.8; t += 0.05)
    assert.ok(Math.hypot(a.x + av.x * t - b.x - bv.x * t, av.z * t - bv.z * t) > 0.32);
});
test('walker waits when the passage has no safe sidestep', () => {
  const { a, grid } = people();
  assert.deepEqual(avoidCrowd(a, 1, 0, 1, grid, (_x, z) => Math.abs(z) < 0.02), { x: 0, z: 0 });
});
test('healing bed enforces flat straight legs until cured, even with a stale walk animation', () => {
  const { a } = people(); a.condition = 'sick';
  a.task = { kind: 'heal', phase: 1, stage: 3, slot: 0, target: 5, timer: 0, x: 0, z: 0 };
  for (const t of [0, 3, 50]) {
    a.animT = t;
    const pose = poseFor(a, false);
    assert.ok(pose.lying && pose.flatBed);
    assert.deepEqual([pose.thL, pose.thR, pose.shL, pose.shR], [0, 0, 0, 0]);
  }
  a.condition = 'well'; a.task.stage = 4;
  assert.equal(poseFor(a, false).flatBed, false);
});
test('fire gathering includes a real dance pose and stays outside the hearth', () => {
  const { a } = people();
  const fire = { id: 7, key: 'firepit', complete: true, x: 0, z: 0 };
  const colony = new Colony({} as any, {} as any, { add() {} } as any,
    { byId: () => fire } as any, {} as any, {} as any, () => 0.5);
  a.x = 1.75; a.z = 0; a.task = { kind: 'bonfire', target: 7, stage: 2, timer: 30, x: a.x, z: a.z };
  let dances = false;
  for (let i = 0; i < 100; i++) {
    (colony as any).runTask(a, 0.1);
    if (a.anim === 'dance') { dances = true; assert.equal(poseFor(a, false).lying, false); }
    assert.ok(Math.hypot(a.x, a.z) > 1.5);
  }
  assert.ok(dances);
  const model = firepitModel(); assert.equal(model.torches?.length, 3);
});
