import { TIME } from '../config';

/** [day fraction, clock hour] pairs matching the lighting keyframes (golden hour gets the most real time). */
const CLOCK: [number, number][] = [
  [0, 0], [0.14, 4], [0.2, 6], [0.27, 8], [0.4, 12], [0.48, 14.5], [0.56, 16.5], [0.74, 18.4], [0.8, 19.3], [0.86, 20.6], [1, 24],
];

/** Game clock: day fraction, day count, seasons and years. */
export class GameTime {
  /** Total elapsed game seconds (scaled by speed). */
  elapsed = 0;
  /** Day index since the start (0-based). */
  day = 0;
  /** 0..1 fraction of the current day. */
  t = TIME.startTime;
  speed = 1;
  paused = false;

  advance(realDt: number): number {
    if (this.paused) return 0;
    const dt = realDt * this.speed;
    this.elapsed += dt;
    this.t += dt / TIME.dayLength;
    while (this.t >= 1) {
      this.t -= 1;
      this.day++;
    }
    return dt;
  }

  get seasonIndex(): number {
    return Math.floor(this.day / TIME.daysPerSeason) % 4;
  }
  get season(): string {
    return TIME.seasons[this.seasonIndex];
  }
  get dayOfSeason(): number {
    return (this.day % TIME.daysPerSeason) + 1;
  }
  get year(): number {
    return Math.floor(this.day / (TIME.daysPerSeason * 4)) + 1;
  }
  /** Displayed hour of day 0..24. */
  get hour(): number {
    for (let i = 0; i < CLOCK.length - 1; i++) {
      if (this.t >= CLOCK[i][0] && this.t <= CLOCK[i + 1][0]) {
        const f = (this.t - CLOCK[i][0]) / (CLOCK[i + 1][0] - CLOCK[i][0]);
        return CLOCK[i][1] + (CLOCK[i + 1][1] - CLOCK[i][1]) * f;
      }
    }
    return 0;
  }
  get clock(): string {
    const mins = Math.floor(this.hour * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  get isNight(): boolean {
    return this.hour < 5.5 || this.hour > 20.2;
  }
}
