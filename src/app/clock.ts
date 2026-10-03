// Converts frame time into a whole number of fixed-rate steps. After a long
// stall (e.g. a hidden tab) it runs at most maxStepsPerAdvance steps and
// drops the rest instead of trying to catch up.
export class FixedStepClock {
  private accumulatorMs = 0;

  constructor(
    public hz: number,
    private maxStepsPerAdvance: number,
  ) {}

  advance(dtMs: number): number {
    this.accumulatorMs += dtMs;
    const periodMs = 1000 / this.hz;
    const steps = Math.floor(this.accumulatorMs / periodMs);
    if (steps > this.maxStepsPerAdvance) {
      this.accumulatorMs = 0;
      return this.maxStepsPerAdvance;
    }
    this.accumulatorMs -= steps * periodMs;
    return steps;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
