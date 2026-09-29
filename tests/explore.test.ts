import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { Explore } from '../src/render/Explore';
function setup() {
  const e = Object.create(Explore.prototype) as any;
  Object.assign(e, { active: true, x: 0, z: 0, yaw: 0, pitch: 0, keys: new Set(['up']), sticks: { move: { x: 0, y: 0, pointer: -1 }, look: { x: 0, y: 0, pointer: -1 } },
    overlay: { querySelectorAll: () => [], classList: { add() {} } },
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
test('free roam passes through occupied ground, water, map edges and steep drops', () => {
  for (const block of [(w: any) => w.occ[0] = 1, (w: any) => w.isLandCell = () => false,
    (w: any) => w.cellIndexAt = () => -1, (w: any) => w.heightAt = (_x: number, z: number) => z < 0 ? -5 : 2]) {
    const e = setup(); block(e.world); e.update(0.05);
    assert.ok(Math.abs(e.rig.camera.position.z + 0.12) < 1e-8);
    assert.ok(e.rig.camera.position.y >= 1.55);
  }
});
test('joysticks support simultaneous movement and looking without diagonal speed boost', () => {
  const e = setup(); e.keys.clear();
  e.sticks.move = { x: 1, y: -1, pointer: 1 };
  e.sticks.look = { x: 1, y: -1, pointer: 2 };
  e.update(0.05);
  assert.ok(Math.abs(Math.hypot(e.x, e.z) - 0.12) < 1e-8);
  assert.ok(e.yaw < 0); assert.ok(e.pitch > 0); assert.ok(e.x > 0);
  e.clear();
  assert.deepEqual(e.sticks.move, { x: 0, y: 0, pointer: -1 });
  assert.deepEqual(e.sticks.look, { x: 0, y: 0, pointer: -1 });
});
test('look controls clamp pitch and exit restores camera settings', () => {
  const e = setup(); e.keys = new Set(['look-up']);
  for (let i = 0; i < 100; i++) e.update(0.05);
  assert.equal(e.pitch, 0.65);
  e.previous = { cur: { x: 8, z: 9, dist: 40 }, fov: 30, near: 0.2 };
  e.rig.update = () => {};
  (globalThis as any).document = { body: { classList: { remove() {} } } };
  e.exit(); assert.equal(e.active, false); assert.equal(e.rig.camera.fov, 30);
  assert.equal(e.rig.cur.x, 8); assert.equal(e.keys.size, 0);
});

test('mouse and touch pointers control separate sticks and cancel safely', () => {
  const pads = ['move', 'look'].map(name => ({
    dataset: { stick: name }, style: { setProperty() {} }, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
  })) as any[];
  const listeners: Record<string, () => void> = {};
  (globalThis as any).window = { addEventListener: (name: string, fn: () => void) => listeners[name] = fn };
  (globalThis as any).document = {
    createElement: () => ({ querySelector: () => ({ addEventListener() {} }), querySelectorAll: () => pads }),
    body: { appendChild() {} }, addEventListener() {},
  };
  const e = new Explore({} as any, {} as any, () => {}) as any; e.active = true;
  const pointer = (id: number, x: number, y: number, type: string) =>
    ({ pointerId: id, clientX: x, clientY: y, button: 0, pointerType: type, preventDefault() {} });
  pads[0].onpointerdown(pointer(1, 50, 20, 'touch'));
  pads[1].onpointerdown(pointer(2, 80, 50, 'touch'));
  assert.equal(e.sticks.move.y, -1); assert.equal(e.sticks.look.x, 1);
  pads[0].onpointerdown(pointer(3, 80, 50, 'touch'));
  assert.equal(e.sticks.move.pointer, 1);
  pads[0].onpointercancel(pointer(1, 50, 20, 'touch'));
  assert.equal(e.sticks.move.y, 0); assert.equal(e.sticks.look.x, 1);
  pads[0].onpointerdown(pointer(4, 20, 50, 'mouse'));
  assert.equal(e.sticks.move.x, -1);
  pads[0].onlostpointercapture(pointer(4, 20, 50, 'mouse'));
  assert.equal(e.sticks.move.x, 0);
  listeners.blur();
  assert.equal(e.sticks.look.x, 0); assert.equal(e.sticks.look.pointer, -1);
});
