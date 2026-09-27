import { ECONOMY, FOOD_KEYS, ResourceKey, TEMPLE } from '../config';

export type Cost = { wood: number; stone: number; belief: number };

/** Global stockpile. Physical delivery is simulated by carriers; this tracks the totals and capacities. */
export class Economy {
  res: Record<ResourceKey, number> = { ...ECONOMY.start };
  woodCap = ECONOMY.baseWoodCap;
  foodCap = ECONOMY.baseFoodCap;
  beliefCap = ECONOMY.beliefBaseCap;
  /** Rolling income rates for the UI (per minute). */
  rates: Partial<Record<ResourceKey, number>> = {};
  private acc: Partial<Record<ResourceKey, number>> = {};
  private rateTimer = 0;
  /** Test mode: everything is free and stores never run out. */
  godMode = false;
  static readonly GOD_AMOUNT = 9999;

  get food(): number {
    return FOOD_KEYS.reduce((s, k) => s + this.res[k], 0);
  }

  /** Remaining space for a resource. */
  space(k: ResourceKey): number {
    if (this.godMode) return Economy.GOD_AMOUNT;
    if (k === 'belief') return this.beliefCap - this.res.belief;
    if (k === 'wood' || k === 'stone') return this.woodCap - this.res[k];
    return this.foodCap - this.food;
  }

  /** Adds up to n; returns the amount actually stored. */
  add(k: ResourceKey, n: number): number {
    const a = Math.max(0, Math.min(n, this.space(k)));
    this.res[k] += a;
    this.acc[k] = (this.acc[k] ?? 0) + a;
    return a;
  }

  canAfford(c: Cost): boolean {
    if (this.godMode) return true;
    return this.res.wood >= c.wood && this.res.stone >= c.stone && this.res.belief >= c.belief;
  }

  spend(c: Cost): boolean {
    if (this.godMode) return true;
    if (!this.canAfford(c)) return false;
    this.res.wood -= c.wood;
    this.res.stone -= c.stone;
    this.res.belief -= c.belief;
    return true;
  }

  refund(c: Cost, frac = 1): void {
    this.add('wood', Math.floor(c.wood * frac));
    this.add('stone', Math.floor(c.stone * frac));
    this.add('belief', Math.floor(c.belief * frac));
  }

  /** Take one meal. Returns the food type eaten (variety-weighted), or null. */
  takeMeal(lastEaten?: ResourceKey): ResourceKey | null {
    const avail = FOOD_KEYS.filter((k) => this.res[k] >= 1);
    if (!avail.length) return null;
    // Prefer something different from last time for variety.
    const pick = avail.filter((k) => k !== lastEaten);
    const list = pick.length ? pick : avail;
    let best = list[0];
    for (const k of list) if (this.res[k] > this.res[best]) best = k;
    this.res[best] -= ECONOMY.foodPerMeal;
    return best;
  }

  recomputeCaps(woodCap: number, foodCap: number, templeTiers: number): void {
    if (this.godMode) return;
    this.woodCap = woodCap;
    this.foodCap = foodCap;
    this.beliefCap = ECONOMY.beliefBaseCap + templeTiers * ECONOMY.beliefCapPerTempleTier;
    this.res.belief = Math.min(this.res.belief, this.beliefCap);
  }

  update(dt: number): void {
    if (this.godMode) {
      // Keep every store brimming.
      for (const k of Object.keys(this.res) as ResourceKey[]) this.res[k] = Economy.GOD_AMOUNT;
      this.woodCap = this.foodCap = this.beliefCap = Economy.GOD_AMOUNT * 10;
    }
    this.rateTimer += dt;
    if (this.rateTimer >= 30) {
      for (const k of Object.keys(this.acc) as ResourceKey[]) this.rates[k] = ((this.acc[k] ?? 0) / this.rateTimer) * 60;
      this.acc = {};
      this.rateTimer = 0;
    }
  }

  templeUpgradeCost(tier: number): Cost {
    return TEMPLE.upgradeCost[tier] ?? TEMPLE.upgradeCost[TEMPLE.upgradeCost.length - 1];
  }
}
