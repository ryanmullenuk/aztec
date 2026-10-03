import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { RainField } from '../src/render/RainField';
import { WORLD } from '../src/config';

test('rain covers every map quadrant with short fine streaks', () => {
  const rain = new RainField();
  const geometry = rain.lines.geometry;
  const positions = geometry.getAttribute('position');
  const quadrants = [0, 0, 0, 0];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.count; i += 2) {
    const x = positions.getX(i), z = positions.getZ(i);
    quadrants[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)]++;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  assert.ok(quadrants.every(n => n > 2000));
  assert.ok(minX < -WORLD.size / 2 && maxX > WORLD.size / 2);
  assert.ok(minZ < -WORLD.size / 2 && maxZ > WORLD.size / 2);
  assert.ok(Array.from(geometry.getAttribute('aLength').array).every(n => n >= 0.19 && n <= 0.43));
});
test('rain fades out when clear and keeps static geometry while falling', () => {
  const rain = new RainField();
  const positions = rain.lines.geometry.getAttribute('position');
  const before = Array.from(positions.array);
  rain.update(1, 0.6, 0);
  assert.equal(rain.lines.visible, true);
  assert.ok((rain.lines.material as THREE.LineBasicMaterial).opacity < 0.3);
  assert.deepEqual(Array.from(positions.array), before);
  rain.update(1, 0, 0); assert.equal(rain.lines.visible, false);
});
