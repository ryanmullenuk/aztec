import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleBreach, breachSiteOk, whaleDrop, clearOfWater, BREACH_T, BREACH_REACH } from '../src/entities/WhaleMotion';
import { MARINE } from '../src/config';

const Lmax = MARINE.whaleLength * 1.1;

test('breach starts and ends as cruising, rolling a whole turn upright', () => {
  for (const roll of [120, -170, 190]) {
    const a = sampleBreach(0, roll), b = sampleBreach(BREACH_T.end, roll);
    assert.ok(Math.abs(a.y * MARINE.whaleLength + MARINE.swimDepth) < 0.01);
    assert.ok(Math.abs(b.y - a.y) < 1e-6);
    assert.equal(a.pitch, 90);
    assert.ok(Math.abs(b.pitch - 90) < 1e-6);
    assert.ok(Math.abs(b.roll - Math.sign(roll) * 360) < 1e-6);
    assert.ok(Math.abs(sampleBreach(BREACH_T.impact, roll).roll - roll) < 1e-6);
  }
});

test('breach is smooth: no jumps in position or orientation from frame to frame', () => {
  const dt = 1 / 60;
  let p = sampleBreach(0, 170);
  for (let t = dt; t <= BREACH_T.end; t += dt) {
    const k = sampleBreach(t, 170);
    assert.ok(Math.abs(k.y - p.y) * Lmax < 0.12, `y jump at ${t}`);
    assert.ok(Math.abs(k.h - p.h) * Lmax < 0.12, `h jump at ${t}`);
    assert.ok(k.h >= p.h - 1e-9, `never slides backwards (${t})`);
    assert.ok(Math.abs(k.pitch - p.pitch) < 2.5, `pitch jump at ${t}`);
    assert.ok(Math.abs(k.roll - p.roll) < 3, `roll jump at ${t}`);
    p = k;
  }
});

test('breach clears about two thirds of the body at a steep angle, and spends 4-6.5 s above water', () => {
  let best = 0, bestPitch = 90, above = 0;
  const dt = 1 / 60;
  for (let t = 0; t <= BREACH_T.end; t += dt) {
    const k = sampleBreach(t, 170);
    const c = clearOfWater(k.y, k.pitch);
    if (c > 0.01) above += dt;
    // Before it topples over.
    if (t < BREACH_T.peak + 0.5 && c > best) (best = c), (bestPitch = k.pitch);
  }
  assert.ok(best >= 0.62 && best <= 0.78, `clear share ${best}`);
  assert.ok(90 - bestPitch >= 60 && 90 - bestPitch <= 80, `angle ${90 - bestPitch}`);
  assert.ok(above >= 4 && above <= 6.5, `above water ${above}s`);
});

test('breach never reaches down to a seabed at the deep-water limit', () => {
  for (let t = 0; t <= BREACH_T.end; t += 0.01) {
    const k = sampleBreach(t, 170);
    assert.ok((k.y - whaleDrop(k.pitch)) * Lmax > MARINE.breachBed + 0.3, `touches bottom at ${t}`);
  }
});

test('breach sites: deep open sea only, never toward or near the shallows', () => {
  // A round island (r 30) with a reef shelf out to 45, then the deep.
  const bed = (x: number, z: number) => {
    const d = Math.hypot(x, z);
    return d < 30 ? 1 : d < 45 ? -1 : -6;
  };
  const L = MARINE.whaleLength;
  const ok = (x: number, z: number, yaw: number) => breachSiteOk(bed, x, z, yaw, L, MARINE.breachBed, MARINE.breachClear);
  assert.ok(ok(75, 0, Math.PI / 2), 'out in the deep, heading out to sea');
  assert.ok(!ok(75, 0, -Math.PI / 2), 'heading in: the run would end too close to the shelf');
  assert.ok(!ok(52, 0, 0), 'deep underneath but right beside the reef');
  assert.ok(!ok(40, 0, Math.PI / 2), 'on the shelf');
  // The run reaches this far, and it's all checked.
  assert.ok(!ok(45 + BREACH_REACH * L * 0.5 + 20, 0, -Math.PI / 2));
});
