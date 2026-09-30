import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWhale } from '../src/entities/WhaleModel';
import { poseWhale, type WhaleDrive } from '../src/entities/WhaleMotion';

const drive = (o: Partial<WhaleDrive> = {}): WhaleDrive => ({ phase: 0, stroke: 0, turn: 0, turnLag: 0, arch: 0, fin: 0, flap: 0, flapPhase: 0, twist: 0, ...o });
const world = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
};

test('whale mesh: finite, closed skin weights on real bones, fins and flukes all present', () => {
  const r = createWhale(new THREE.MeshBasicMaterial());
  const g = r.mesh.geometry;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const bones = r.mesh.skeleton.bones.length;
  assert.equal(bones, 19);
  const box = new THREE.Box3();
  for (let i = 0; i < pos.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, i);
    assert.ok(Number.isFinite(p.x + p.y + p.z), `vertex ${i}`);
    box.expandByPoint(p);
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      sum += sw.getComponent(i, k);
      assert.ok(si.getComponent(i, k) < bones);
    }
    assert.ok(Math.abs(sum - 1) < 1e-4, `weights at ${i} sum to ${sum}`);
  }
  // Snout to fluke tips about a length; flippers and flukes reach well out to the sides.
  assert.ok(box.max.z > 0.49 && box.min.z < -0.54, `length ${box.min.z}..${box.max.z}`);
  assert.ok(box.max.x > 0.25 && box.min.x < -0.25, `span ${box.min.x}..${box.max.x}`);
});

test('pose: flippers fling out wide, the body curves into a turn, flukes stroke and flex', () => {
  const r = createWhale(new THREE.MeshBasicMaterial());
  poseWhale(r, drive());
  const tuckL = world(r.finTipL), tuckR = world(r.finTipR);
  poseWhale(r, drive({ fin: 1 }));
  const wideL = world(r.finTipL), wideR = world(r.finTipR);
  // Swung forward and out (mirror images of each other).
  assert.ok(wideL.z > tuckL.z + 0.05 && wideL.x > tuckL.x, `left ${tuckL.toArray()} -> ${wideL.toArray()}`);
  assert.ok(wideR.z > tuckR.z + 0.05 && wideR.x < tuckR.x, `right ${tuckR.toArray()} -> ${wideR.toArray()}`);
  // (Mirror images, give or take the skin's own unevenness where they're rooted.)
  assert.ok(Math.abs(wideL.x + wideR.x) < 0.005 && Math.abs(wideL.y - wideR.y) < 0.005 && Math.abs(wideL.z - wideR.z) < 0.005);
  // Turning to its left (+x): head and tail both swing toward +x (a C-shaped curve).
  poseWhale(r, drive({ turn: 0.5, turnLag: 0.5 }));
  assert.ok(world(r.fluke).x > 0.03, `tail ${world(r.fluke).x}`);
  r.head.updateWorldMatrix(true, false);
  const facing = new THREE.Vector3(0, 0, 1).transformDirection(r.head.matrixWorld);
  assert.ok(facing.x > 0.1, `head facing ${facing.toArray()}`);
  // A stroke heaves the flukes up and down, and the lobes flex against it.
  const ys = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((phase) => {
    poseWhale(r, drive({ stroke: 1.5, phase }));
    return world(r.lobeTipL).y;
  });
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.04, `fluke heave ${ys}`);
  // Both lobes cup the same way (seen from the fluke joint; the tail stock itself twists a little).
  poseWhale(r, drive({ stroke: 1.5, phase: 5.8 }));
  const l = r.fluke.worldToLocal(world(r.lobeTipL)), rr = r.fluke.worldToLocal(world(r.lobeTipR));
  assert.ok(Math.abs(l.y - rr.y) < 1e-6 && Math.abs(l.y) > 0.002, `lobes ${l.y} ${rr.y}`);
});
