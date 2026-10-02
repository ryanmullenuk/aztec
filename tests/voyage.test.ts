import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOODS, VOYAGE } from '../src/config';
import { RNG } from '../src/world/rng';
import { Voyages, holdValue, rollEvents, spoil, voyageHaul } from '../src/entities/Voyage';
import { Economy } from '../src/economy/Economy';
import { makeIslander } from '../src/entities/Islander';

// The orbs draw one small canvas texture: a stand-in canvas for node.
const ctx2d = { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' };
(globalThis as any).document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const stock = { wood: 50, stone: 50, grain: 50, fruit: 50, meat: 2, fish: 5, belief: 10 };

test('voyage rules: cargo worth, events, spoils and what comes home', () => {
  assert.equal(holdValue({ grain: 10, pearls: 2 }), 10 + 2 * VOYAGE.values.pearls);
  const rng = new RNG(7);
  for (let k = 0; k < 50; k++) {
    const ev = rollEvents(rng, 200);
    assert.ok(ev.length >= VOYAGE.events[0] && ev.length <= VOYAGE.events[1]);
    for (let i = 1; i < ev.length; i++) assert.ok(ev[i].at >= ev[i - 1].at, 'in order');
    assert.ok(ev.every((e) => e.at > 0 && e.at < 200 && e.kind in VOYAGE.odds));
  }
  const h = { grain: 40, pearls: 3 };
  const lost = spoil(h, 0.5);
  assert.deepEqual(lost, { grain: 20, pearls: 2 });
  assert.deepEqual(h, { grain: 20, pearls: 1 });
  // A good cargo comes home as chickens, herbs, spices and what the island is shortest of.
  const haul = voyageHaul({ grain: 40, pearls: 3 }, 1, new RNG(3), stock);
  assert.ok(haul.chickens >= 1 && haul.chickens <= VOYAGE.maxChickens);
  assert.ok((haul.goods.herbs ?? 0) >= 1 && (haul.goods.spices ?? 0) >= 1);
  assert.ok(haul.res.meat && haul.res.fish, `shortest stores: ${JSON.stringify(haul.res)}`);
  const worth = haul.chickens * VOYAGE.chickenValue + (haul.goods.herbs ?? 0) * GOODS.herbs.value + (haul.goods.spices ?? 0) * GOODS.spices.value + (haul.res.meat ?? 0) * VOYAGE.values.meat + (haul.res.fish ?? 0) * VOYAGE.values.fish;
  const v = holdValue({ grain: 40, pearls: 3 });
  assert.ok(worth > v * VOYAGE.rate[0] * 0.85 && worth < v * VOYAGE.rate[1] * 1.15, `worth ${worth} for ${v}`);
  // Nothing in, nothing out.
  assert.equal(voyageHaul({}, 1, new RNG(1), stock).chickens, 0);
});

/** A voyage ship with the world around it stubbed: just the logic of sailing, events, loss and return. */
function harbour() {
  const eco = new Economy();
  Object.assign(eco.res, { wood: 100, stone: 50, grain: 100, fruit: 40, meat: 10, fish: 40, belief: 100 });
  eco.goods.pearls = 3;
  eco.foodCap = 999;
  eco.woodCap = 999;
  const dock = { id: 4, key: 'tradedock', complete: true, x: 0, z: 0, door: { x: 0, z: -1 }, dockX: 0, dockZ: 3, dir: [0, 1] } as any;
  const bld = { byId: (id: number) => (id === 4 ? dock : undefined), list: [dock] } as any;
  const list = [1, 2, 3, 4, 5, 6].map((id) => makeIslander(id, `V${id}`, id % 2 ? 'm' : 'f', 0, 0, () => 0.5));
  for (const i of list) i.role = 'gatherer';
  const colony = {
    list,
    remove(i: any) { this.list = this.list.filter((x: any) => x !== i); },
    restore(d: any) { const i = makeIslander(d.id, d.name, d.gender, d.x, d.z, () => 0.5); this.list.push(i); return i; },
  } as any;
  const boats = {
    fleets: [] as any[], traffic: () => [], open: () => true, openSea: (x: number, z: number) => ({ x: x + 40, z }),
    waterPath: () => [], berth: () => ({ x: 0, z: 4, out: 0, approach: { x: 0, z: 6 } }), sailPath: (_v: any, _m: any, _p: any, i: number) => i + 1,
    berthStep: () => true, ride: () => {}, fx: { wake: () => {} },
  } as any;
  const world = { half: 100, heightAt: () => -2 } as any;
  const V = new Voyages(world, bld, eco, boats, colony) as any;
  const notes: string[] = [];
  const chickens: number[] = [];
  V.hooks = { notify: (m: string) => notes.push(m), sfx: () => {}, addChicken: () => (chickens.push(1), true), visitorOrbs: () => [] };
  V.buildAt(dock);
  V.update(VOYAGE.buildSeconds + 1, 0);
  return { V, eco, colony, notes, chickens };
}

test('voyage ship: load from the stores, sail with a crew, weather a calmed storm, come home and unload', () => {
  const { V, eco, colony, notes, chickens } = harbour();
  assert.equal(V.state, 'docked');
  V.load('grain', 1);
  V.load('grain', 1);
  V.load('pearls', 1);
  assert.equal(eco.res.grain, 80);
  assert.equal(eco.goods.pearls, 2);
  V.load('grain', -1);
  assert.equal(eco.res.grain, 90);
  assert.deepEqual(V.hold, { grain: 10, pearls: 1 });
  assert.equal(V.whyNotSail(), null);
  V.sail();
  assert.equal(colony.list.length, 6 - VOYAGE.crew, 'crew aboard');
  // Out over the edge.
  for (let k = 0; k < 600 && V.state === 'out'; k++) V.update(1 / 10, k / 10);
  assert.equal(V.state, 'away');
  // A storm, calmed in time.
  V.events = [{ at: V.total - V.timer + 0.1, kind: 'storm', done: false }];
  V.update(0.5, 0);
  assert.ok(V.storm > 0);
  assert.ok(notes.some((n) => n.includes('storm')));
  assert.match(V.calm(), /dies away/);
  assert.equal(eco.res.belief, 100 - VOYAGE.calmCost);
  V.timer = 0.1;
  V.update(0.5, 0);
  assert.equal(V.state, 'back');
  assert.ok(V.haul, 'brought goods home');
  for (let k = 0; k < 600 && V.state !== 'docked'; k++) V.update(1 / 10, 0);
  assert.equal(V.state, 'docked');
  assert.equal(colony.list.length, 6, 'crew home');
  const herbs0 = eco.goods.herbs;
  V.unload();
  assert.ok(eco.goods.herbs > herbs0 || eco.goods.spices > 0);
  assert.ok(chickens.length >= 1);
  assert.equal(V.haul, null);
  // Saved and loaded at the dock.
  const saved = JSON.parse(JSON.stringify(V.serialize()));
  const { V: W } = harbour();
  W.restore(saved, new Map([[4, 4]]));
  assert.equal(W.state, 'docked');
  assert.equal(W.voyages, 1);
});

test('voyage ship: an uncalmed storm can sink it, and its crew are lost', () => {
  const { V, colony, notes } = harbour();
  V.load('grain', 1);
  V.load('grain', 1);
  V.sail();
  for (let k = 0; k < 600 && V.state === 'out'; k++) V.update(1 / 10, 0);
  // The worst luck.
  V.rng = { next: () => 0, range: (a: number) => a, int: (a: number) => a, pick: (a: any[]) => a[0] };
  V.events = [{ at: V.total - V.timer + 0.1, kind: 'storm', done: false }];
  V.update(0.5, 0);
  V.update(VOYAGE.calmWindow + 1, 0);
  assert.ok(V.doomed, 'doomed');
  V.timer = 0.1;
  V.update(0.5, 0);
  assert.equal(V.state, 'none', 'never came home');
  assert.equal(colony.list.length, 6 - VOYAGE.crew, 'crew lost');
  assert.ok(notes.some((n) => n.includes('never came home')));
  assert.equal(V.serialize(), null);
});
