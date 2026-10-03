import { describe, it, expect } from 'vitest';
import { RateMeter } from '../../src/app/rates';

describe('RateMeter', () => {
  it('reports events per second between samples', () => {
    const m = new RateMeter();
    expect(m.sample(1000)).toBe(0);
    m.add(5);
    m.add();
    expect(m.sample(1500)).toBe(12);
    expect(m.sample(2500)).toBe(0);
  });

  it('ignores negative adds', () => {
    const m = new RateMeter();
    m.sample(0);
    m.add(-100);
    m.add(3);
    expect(m.sample(1000)).toBe(3);
  });
});
