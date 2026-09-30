import { test } from 'node:test';
import assert from 'node:assert/strict';
import { giveWay, Hull, hullGap, pickSchool, stationOffset, visitorDeals } from '../src/entities/fleet';

/** Small seeded generator so offer tests are repeatable. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const hull = (x: number, z: number, heading: number, o: Partial<Hull> = {}): Hull => ({ x, z, heading, half: 0.68, beam: 0.21, speed: 2, pri: 10, moored: false, ref: {}, ...o });

test('boats spread over the schools, doubling up only when the others are far', () => {
  const schools = [{ x: 50, z: 0, stock: 100 }, { x: 0, z: 60, stock: 100 }, { x: -70, z: 0, stock: 100 }];
  const working = [0, 0, 0];
  const picks: number[] = [];
  for (let k = 0; k < 3; k++) {
    const i = pickSchool(0, 0, schools, working, 40);
    picks.push(i);
    working[i]++;
  }
  assert.deepEqual([...picks].sort(), [0, 1, 2]);
  // An empty school is skipped; a much nearer busy school still wins over a very far one.
  assert.equal(pickSchool(0, 0, [{ x: 5, z: 0, stock: 100 }, { x: 200, z: 0, stock: 100 }, { x: 1, z: 0, stock: 1 }], [1, 0, 0], 40), 0);
  assert.equal(pickSchool(0, 0, [{ x: 5, z: 0, stock: 2 }], [0]), -1);
});

test('boats sharing a school hold stations spread round it', () => {
  for (const n of [2, 3, 5]) {
    const st = Array.from({ length: n }, (_, k) => stationOffset(k, n, 0, 4.5));
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      assert.ok(Math.hypot(st[a].x - st[b].x, st[a].z - st[b].z) > 1.5, `stations ${a} and ${b} of ${n} too close`);
    }
    for (const s of st) assert.ok(Math.abs(Math.hypot(s.x, s.z) - 4.5) < 1e-6);
  }
  // A lone boat sits on the side facing `base`.
  const one = stationOffset(0, 1, Math.PI / 2, 4.5);
  assert.ok(one.x > 4.4 && Math.abs(one.z) < 1e-6);
});

test('hull gaps: side-by-side berths are clear, crossing hulls overlap', () => {
  assert.ok(hullGap(hull(0, 0, 0), hull(0.9, 0, 0)).gap > 0.3);
  assert.ok(hullGap(hull(0, 0, 0), hull(0, 0.5, Math.PI / 2)).gap < 0);
  const g = hullGap(hull(0, 0, 0), hull(0, 1.5, 0));
  assert.ok(Math.abs(g.gap - (1.5 - 2 * (0.68 - 0.21) - 0.42)) < 1e-6);
  assert.ok(g.nz < -0.99);
});

test('boats meeting bow to bow turn to pass and the lower priority gives way', () => {
  const a = hull(0, 0, 0, { pri: 10 });
  const b = hull(0, 3, Math.PI, { pri: 11 });
  const ga = giveWay(a, 0, [a, b], 0.3, 3), gb = giveWay(b, Math.PI, [a, b], 0.3, 3);
  // Each turns to its own side, which in world terms takes them apart.
  const ax = Math.sin(ga.turn), bx = Math.sin(Math.PI + gb.turn);
  assert.ok(ax * bx < 0, 'boats should veer to opposite sides');
  assert.ok(gb.slow <= ga.slow);
  // A boat off to the side isn't in the way.
  assert.deepEqual(giveWay(a, 0, [a, hull(3, 1, 0)], 0.3, 3), { turn: 0, slow: 1 });
});

test('visiting traders offer 1-3 sensible, affordable-sized deals', () => {
  const res = { wood: 120, stone: 40, grain: 60, fruit: 5, meat: 0, fish: 12, belief: 80 };
  for (let seed = 1; seed < 200; seed++) {
    const deals = visitorDeals(res, rng(seed));
    assert.ok(deals.length >= 1 && deals.length <= 3);
    const pairs = new Set<string>();
    for (const d of deals) {
      const [give, n] = Object.entries(d.give)[0] as [keyof typeof res, number];
      const [get, m] = Object.entries(d.get)[0] as [keyof typeof res, number];
      assert.notEqual(give, get);
      assert.notEqual(give, 'belief');
      assert.ok(n >= 5 && n <= 60 && n <= Math.max(5, res[give] * 0.4));
      assert.ok(m >= 1);
      assert.ok(!pairs.has(`${give}>${get}`));
      pairs.add(`${give}>${get}`);
      assert.equal(d.taken, false);
    }
  }
  // Even a poor village gets something to consider.
  assert.ok(visitorDeals({ wood: 0, stone: 0, grain: 0, fruit: 0, meat: 0, fish: 0, belief: 0 }, rng(3)).length >= 1);
});
