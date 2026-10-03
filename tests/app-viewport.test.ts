import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewportSize } from '../src/render/AppViewport';

test('iPhone controls stay inside the available portrait and landscape area', () => {
  assert.deepEqual(viewportSize(393, 759), [393, 759]);
  assert.deepEqual(viewportSize(852, 360), [852, 360]);
});
test('visible viewport constrains controls when iOS reduces the drawable area', () => {
  assert.deepEqual(viewportSize(393, 852, 393, 759), [393, 759]);
  assert.deepEqual(viewportSize(852, 393, 852, 360), [852, 360]);
});
test('full screen and split screen retain their actual available dimensions', () => {
  assert.deepEqual(viewportSize(393, 852, 393, 852), [393, 852]);
  assert.deepEqual(viewportSize(600, 900), [600, 900]);
});
