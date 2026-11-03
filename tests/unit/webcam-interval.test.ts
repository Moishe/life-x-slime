import { describe, it, expect } from 'vitest';
import { WEBCAM_INTERVAL_MAX_SEC, WEBCAM_INTERVAL_MIN_SEC } from '../../src/app/settings';
import { formatInterval, intervalFromPosition, positionFromInterval } from '../../src/ui/webcam-interval';

describe('webcam interval slider mapping', () => {
  it('spans 24 frames per second to once every 5 seconds', () => {
    expect(WEBCAM_INTERVAL_MIN_SEC).toBeCloseTo(1 / 24);
    expect(WEBCAM_INTERVAL_MAX_SEC).toBe(5);
    expect(intervalFromPosition(0)).toBeCloseTo(1 / 24);
    expect(intervalFromPosition(1)).toBeCloseTo(5);
  });

  it('is logarithmic: the middle of the slider is the geometric mean of the ends', () => {
    expect(intervalFromPosition(0.5)).toBeCloseTo(Math.sqrt(5 / 24));
  });

  it('round-trips through position and interval', () => {
    for (const seconds of [1 / 24, 0.1, 0.5, 1, 2.5, 5]) {
      expect(intervalFromPosition(positionFromInterval(seconds))).toBeCloseTo(seconds);
    }
    expect(positionFromInterval(1 / 24)).toBeCloseTo(0);
    expect(positionFromInterval(5)).toBeCloseTo(1);
  });

  it('clamps intervals outside the slider to its ends', () => {
    expect(positionFromInterval(0.001)).toBe(0);
    expect(positionFromInterval(60)).toBe(1);
  });
});

describe('formatInterval', () => {
  it('shows intervals under a second as a frame rate', () => {
    expect(formatInterval(1 / 24)).toBe('24 fps');
    expect(formatInterval(0.5)).toBe('2 fps');
    expect(formatInterval(Math.sqrt(5 / 24))).toBe('2.2 fps');
  });

  it('shows intervals of a second or more in seconds', () => {
    expect(formatInterval(1)).toBe('1 s');
    expect(formatInterval(2.5)).toBe('2.5 s');
    expect(formatInterval(5)).toBe('5 s');
  });
});
