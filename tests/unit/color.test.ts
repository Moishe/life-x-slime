import { describe, it, expect } from 'vitest';
import { dominantColor, hsv2rgb, hsvDistance, hsvMix, rgb2hsv, type Vec3 } from '../../src/color';

const close = (actual: number[], expected: number[], digits = 5) =>
  expected.forEach((e, i) => expect(actual[i]).toBeCloseTo(e, digits));

const NO_LOCK = { lockToHsvAngles: 0, hsvAngleOffset: 0, hsvSaturationMultiplier: 1, hsvValueMultiplier: 1 };

describe('rgb2hsv / hsv2rgb', () => {
  it('converts primaries', () => {
    close(rgb2hsv([1, 0, 0]), [0, 1, 1]);
    close(rgb2hsv([0, 1, 0]), [1 / 3, 1, 1]);
    close(rgb2hsv([0, 0, 1]), [2 / 3, 1, 1]);
  });

  it('maps black and grey to hue 0, saturation 0', () => {
    close(rgb2hsv([0, 0, 0]), [0, 0, 0]);
    close(rgb2hsv([0.5, 0.5, 0.5]), [0, 0, 0.5]);
  });

  it('round-trips', () => {
    const samples: Vec3[] = [[0.2, 0.4, 0.6], [0.9, 0.1, 0.3], [0.5, 0.5, 0.1]];
    for (const rgb of samples) close(hsv2rgb(rgb2hsv(rgb)), rgb, 4);
  });
});

describe('hsvDistance', () => {
  it('uses circular hue difference', () => {
    expect(hsvDistance([0.95, 1, 1], [0.05, 1, 1])).toBeCloseTo(0.1, 6);
  });

  it('combines hue, saturation and value differences', () => {
    expect(hsvDistance([0, 1, 1], [0, 0, 0])).toBeCloseTo(Math.SQRT2, 6);
  });
});

describe('hsvMix', () => {
  const hueOf = (rgb: Vec3) => rgb2hsv(rgb)[0];

  it('wraps forward across red (0.9 -> 0.1 at 0.25 gives 0.95)', () => {
    expect(hueOf(hsvMix(hsv2rgb([0.9, 1, 1]), hsv2rgb([0.1, 1, 1]), 0.25))).toBeCloseTo(0.95, 4);
  });

  it('wraps backward across red (0.1 -> 0.9 at 0.25 gives 0.05)', () => {
    expect(hueOf(hsvMix(hsv2rgb([0.1, 1, 1]), hsv2rgb([0.9, 1, 1]), 0.25))).toBeCloseTo(0.05, 4);
  });

  it('interpolates directly when no wrap is shorter', () => {
    expect(hueOf(hsvMix(hsv2rgb([0.2, 1, 1]), hsv2rgb([0.4, 1, 1]), 0.5))).toBeCloseTo(0.3, 4);
  });

  it('returns the second color at d = 1', () => {
    close(hsvMix([0, 0, 1], [1, 0, 0], 1), [1, 0, 0], 4);
  });
});

describe('dominantColor', () => {
  it('returns the input unchanged when hue locking is off', () => {
    expect(dominantColor([0.2, 0.4, 0.6], NO_LOCK)).toEqual([0.2, 0.4, 0.6]);
  });

  it('quantizes hue to lockToHsvAngles steps, rounding half up', () => {
    const lock = { ...NO_LOCK, lockToHsvAngles: 4 };
    expect(rgb2hsv(dominantColor(hsv2rgb([0.3, 1, 1]), lock))[0]).toBeCloseTo(0.25, 4);
  });

  it('keeps hues above 0.5 (no fold into [0, 0.5])', () => {
    const lock = { ...NO_LOCK, lockToHsvAngles: 4 };
    expect(rgb2hsv(dominantColor(hsv2rgb([0.7, 1, 1]), lock))[0]).toBeCloseTo(0.75, 4);
  });

  it('treats an offset of 1.0 as no offset', () => {
    const lock = { ...NO_LOCK, lockToHsvAngles: 4, hsvAngleOffset: 1 };
    expect(rgb2hsv(dominantColor(hsv2rgb([0.3, 1, 1]), lock))[0]).toBeCloseTo(0.25, 4);
  });

  it('scales and clamps saturation and value', () => {
    const lock = { lockToHsvAngles: 4, hsvAngleOffset: 0, hsvSaturationMultiplier: 0.5, hsvValueMultiplier: 2 };
    close(rgb2hsv(dominantColor(hsv2rgb([0.25, 1, 0.4]), lock)), [0.25, 0.5, 0.8], 4);
  });
});
