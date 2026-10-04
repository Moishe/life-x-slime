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

// Counts fixed steps and reports when a tick is due. Used to drive Life from
// Physarum steps (rather than the wall clock) while recording a movie.
export class StepTicker {
  private steps = 0;

  step(stepsPerTick: number): boolean {
    this.steps++;
    if (this.steps < stepsPerTick) return false;
    this.steps = 0;
    return true;
  }

  reset(): void {
    this.steps = 0;
  }
}
