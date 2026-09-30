import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleRise, riseSiteOk, whaleDrop, clearOfWater, RISE_T, RISE_REACH } from '../src/entities/WhaleMotion';
import { MARINE } from '../src/config';

const Lmax = MARINE.whaleLength * 1.1;

test('rise starts and ends as cruising, at cruising depth and speed', () => {
  for (const lean of [8, -14]) {
    const a = sampleRise(0, lean), b = sampleRise(RISE_T.end, lean);
    assert.ok(Math.abs(a.y * MARINE.whaleLength + MARINE.swimDepth) < 0.01);
    assert.ok(Math.abs(b.y - a.y) < 1e-6);
    assert.equal(a.pitch, 90);
    assert.ok(Math.abs(b.pitch - 90) < 1e-6);
    assert.ok(Math.abs(a.roll) < 1e-6 && Math.abs(b.roll) < 1e-6);
    // Leaving at cruising speed (whale lengths a second).
    const v = (sampleRise(RISE_T.end, lean).h - sampleRise(RISE_T.end - 0.1, lean).h) / 0.1;
    assert.ok(Math.abs(v * MARINE.whaleLength - MARINE.whaleSpeed) < 0.25, `leaves at ${v * MARINE.whaleLength}`);
  }
});

test('rise is smooth: no jumps in position or orientation from frame to frame', () => {
  const dt = 1 / 60;
  let p = sampleRise(0, 12);
  for (let t = dt; t <= RISE_T.end; t += dt) {
    const k = sampleRise(t, 12);
    assert.ok(Math.abs(k.y - p.y) * Lmax < 0.05, `y jump at ${t}`);
    assert.ok(Math.abs(k.h - p.h) * Lmax < 0.08, `h jump at ${t}`);
    assert.ok(k.h >= p.h - 1e-9, `never slides backwards (${t})`);
    assert.ok(Math.abs(k.pitch - p.pitch) < 1, `pitch jump at ${t}`);
    assert.ok(Math.abs(k.roll - p.roll) < 1, `roll jump at ${t}`);
    p = k;
  }
});

test('only the head and the front of the back leave the water; it blows with its head clear; the flukes lift as it dives', () => {
  let most = 0;
  for (let t = 0; t <= RISE_T.end; t += 1 / 60) {
    const k = sampleRise(t, 12);
    // Never the whole whale: never more than about 45 % of its length out (head end up, or tail end up on the dive).
    most = Math.max(most, clearOfWater(k.y, k.pitch));
  }
  assert.ok(most <= 0.45, `clear share ${most}`);
  assert.ok(most >= 0.3, `head barely out: ${most}`);
  // At the blow the head (and the blowholes a little behind it) are well out of the water.
  const b = sampleRise(RISE_T.blow, 12);
  const head = b.y + 0.5 * Math.cos((b.pitch * Math.PI) / 180);
  assert.ok(head > 0.12, `head at the blow ${head}`);
  // On the dive the tail end rises above the surface.
  const f = sampleRise(RISE_T.flukes, 12);
  const tail = f.y - 0.5 * Math.cos((f.pitch * Math.PI) / 180);
  assert.ok(f.pitch > 110 && tail > 0.05, `flukes ${tail}`);
});

test('rise never reaches down to a seabed at the deep-water limit', () => {
  for (let t = 0; t <= RISE_T.end; t += 0.01) {
    const k = sampleRise(t, 12);
    assert.ok((k.y - whaleDrop(k.pitch)) * Lmax > MARINE.riseBed + 0.3, `touches bottom at ${t}`);
  }
});

test('rise sites: deep open sea only, never toward or near the shallows', () => {
  // A round island (r 30) with a reef shelf out to 45, then the deep.
  const bed = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    return d < 30 ? 1 : d < 45 ? -1 : -6;
  };
  const L = MARINE.whaleLength;
  const ok = (x: number, z: number, yaw: number) => riseSiteOk(bed, x, z, yaw, L, MARINE.riseBed, MARINE.riseClear);
  assert.ok(ok(75, 0, Math.PI / 2), 'out in the deep, heading out to sea');
  assert.ok(!ok(40, 0, Math.PI / 2), 'on the shelf');
  assert.ok(!ok(48, 0, 0), 'deep underneath but right beside the reef');
  // The run reaches this far, and it's all checked.
  assert.ok(!ok(45 + RISE_REACH * L * 0.5 + 6, 0, -Math.PI / 2));
});
