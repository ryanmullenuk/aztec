import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewportSize } from '../src/render/AppViewport';
test('Home Screen game fills iPhone portrait and landscape display', () => {
  assert.deepEqual(viewportSize(393, 759, 393, 852, true), [393, 852]);
  assert.deepEqual(viewportSize(852, 360, 393, 852, true), [852, 393]);
});
test('Safari tabs and iPad split screen keep their available dimensions', () => {
  assert.deepEqual(viewportSize(393, 680, 393, 852, false), [393, 680]);
  assert.deepEqual(viewportSize(600, 900, 1024, 1366, true), [600, 900]);
});
