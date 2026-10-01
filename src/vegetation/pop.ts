/**
 * A springy "pop into life": scale from nothing, shooting past full size and settling with a
 * damped wobble, with squash and stretch (tall and thin shooting up, short and wide landing).
 * `t` seconds since it began (≤ 0: not yet), over `dur` seconds; `freq` and `damp` set the
 * bounce (slower and heavier for trees). Returns the overall and the vertical scale.
 */
export function springPop(t: number, dur: number, freq: number, damp: number): { s: number; sy: number } {
  if (t <= 0) return { s: 0, sy: 0 };
  if (t >= dur) return { s: 1, sy: 1 };
  const e = Math.exp(-damp * t), osc = Math.cos(freq * t), wob = Math.sin(freq * t) * e;
  const s = 1 - e * osc;
  return { s: s * (1 - 0.14 * wob), sy: s * (1 + 0.3 * wob) };
}

/** Trees: a slower, heavier bounce than garden plants. */
export const TREE_POP = { dur: 1.3, freq: 8.5, damp: 4.2 };
