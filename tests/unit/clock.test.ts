import { describe, it, expect } from 'vitest';
import { FixedStepClock } from '../../src/app/clock';

describe('FixedStepClock', () => {
  it('emits one step per period, carrying the remainder', () => {
    const c = new FixedStepClock(10, 4); // 100 ms period
    expect(c.advance(250)).toBe(2);
    expect(c.advance(40)).toBe(0);
    expect(c.advance(10)).toBe(1); // 50 + 40 + 10 = 100
  });

  it('caps catch-up after a long pause and drops the backlog', () => {
    const c = new FixedStepClock(30, 4);
    expect(c.advance(10_000)).toBe(4);
    expect(c.advance(0)).toBe(0);
  });

  it('follows a changed rate', () => {
    const c = new FixedStepClock(1, 1);
    c.hz = 2;
    expect(c.advance(500)).toBe(1);
  });

  it('reset() discards accumulated time', () => {
    const c = new FixedStepClock(10, 4);
    c.advance(90);
    c.reset();
    expect(c.advance(20)).toBe(0);
  });
});
