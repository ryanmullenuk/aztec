import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { Explore } from '../src/render/Explore';
function setup() {
  const e = Object.create(Explore.prototype) as any;
  Object.assign(e, { active: true, x: 0, z: 0, yaw: 0, pitch: 0, keys: new Set(['up']), held: new Map(),
    rig: { cur: { x: 0, z: 0, dist: 30 }, camera: new PerspectiveCamera(), target: new Vector3() },
    world: { cellIndexAt: () => 0, isLandCell: () => true, occ: [0], heightAt: () => 2 } });
  return e;
}
test('walk at eye level with bounded speed, leaving the overhead goal alone', () => {
  const e = setup(); e.rig.goal = { x: 50, z: 50 }; e.update(2);
  assert.equal(e.rig.camera.position.y, 3.55);
  assert.ok(Math.abs(e.rig.camera.position.z + 0.12) < 1e-8);
  assert.deepEqual(e.rig.goal, { x: 50, z: 50 });
});
test('buildings, water, map edges and steep drops block movement', () => {
  for (const block of [(w: any) => w.occ[0] = 1, (w: any) => w.isLandCell = () => false,
    (w: any) => w.cellIndexAt = () => -1, (w: any) => w.heightAt = (_x: number, z: number) => z < 0 ? -5 : 2]) {
    const e = setup(); block(e.world); e.update(0.05); assert.equal(e.rig.camera.position.z, 0);
  }
});
test('look controls clamp pitch and exit restores camera settings', () => {
  const e = setup(); e.keys = new Set(['look-up']);
  for (let i = 0; i < 100; i++) e.update(0.05);
  assert.equal(e.pitch, 0.65);
  e.previous = { cur: { x: 8, z: 9, dist: 40 }, fov: 30, near: 0.2 };
  e.overlay = { classList: { add() {} } }; e.rig.update = () => {};
  (globalThis as any).document = { body: { classList: { remove() {} } } };
  e.exit(); assert.equal(e.active, false); assert.equal(e.rig.camera.fov, 30);
  assert.equal(e.rig.cur.x, 8); assert.equal(e.keys.size, 0);
});
