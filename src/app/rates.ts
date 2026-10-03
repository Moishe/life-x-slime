// Counts events and reports them as a per-second rate between samples.
export class RateMeter {
  private count = 0;
  private lastSampleMs: number | null = null;

  add(n = 1): void {
    if (n > 0) this.count += n;
  }

  sample(nowMs: number): number {
    const elapsed = this.lastSampleMs === null ? 0 : nowMs - this.lastSampleMs;
    const rate = elapsed > 0 ? (this.count * 1000) / elapsed : 0;
    this.count = 0;
    this.lastSampleMs = nowMs;
    return rate;
  }
}
