import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
import { Lighting } from '../src/render/Lighting';
import { GrassTufts } from '../src/vegetation/GrassTufts';

test('Ultra darkens the night sky and switching back restores it without accumulated dimming', () => {
  const lighting = new Lighting(new Scene(), 1024);
  const target = new Vector3();
  lighting.update(0, target, 40);
  const original = lighting.state.fog.clone();
  lighting.ultra = true;
  lighting.update(0, target, 40);
  const dark = lighting.state.fog.clone();
  assert.ok(dark.r < original.r && dark.g < original.g && dark.b < original.b);
  lighting.update(0, target, 40);
  assert.ok(lighting.state.fog.equals(dark));
  lighting.ultra = false;
  lighting.update(0, target, 40);
  assert.ok(lighting.state.fog.equals(original));
  lighting.update(0.5, target, 40);
  const day = lighting.state.fog.clone();
  lighting.ultra = true;
  lighting.update(0.5, target, 40);
  assert.ok(lighting.state.fog.equals(day));
});

test('Ultra doubles grass geometry and restores normal detail without moving instances', () => {
  const grass = new GrassTufts({ N: 2, seed: 1, half: 1 } as any, 1);
  const mesh = grass.group.children[0] as any;
  const vertices = mesh.geometry.attributes.position.count;
  const instances = mesh.instanceMatrix;
  grass.setUltra(true);
  assert.equal(mesh.geometry.attributes.position.count, vertices * 2);
  assert.equal(mesh.instanceMatrix, instances);
  const geometry = mesh.geometry;
  grass.setUltra(true);
  assert.equal(mesh.geometry, geometry);
  grass.setUltra(false);
  assert.equal(mesh.geometry.attributes.position.count, vertices);
});
