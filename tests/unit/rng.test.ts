import { describe, it, expect } from 'vitest';
import { mulberry32, randomNonZeroU32 } from '../../src/rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('differs across seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 10000; i++) {
      const v = r();
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });
});

describe('randomNonZeroU32', () => {
  it('returns odd unsigned 32-bit integers', () => {
    const r = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = randomNonZeroU32(r);
      expect(Number.isInteger(v)).toBe(true);
      expect(v % 2).toBe(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
