import { describe, it, expect } from 'vitest';
import { COLOR_SLOTS, MAX_COLORS, OrganismPalette, PALETTES, PALETTE_NAMES, colorFor, paletteColors } from '../../src/life/palette';
import { ClusterTracker } from '../../src/life/tracker';
import { rgb2hsv } from '../../src/color';
import { mulberry32, type Rng } from '../../src/rng';

const cells = (list: [number, number][]) => list.map(([x, y]) => ({ x, y }));
// Deterministic test RNG that returns the given values in order.
const sequence = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};

const slot = (r: number) => Math.floor(r * COLOR_SLOTS);

describe('paletteColors', () => {
  it('makes rainbow from evenly spaced fully saturated hues', () => {
    const colors = paletteColors('rainbow', 8);
    expect(colors).toHaveLength(8);
    colors.forEach((rgb, i) => {
      const [h, s, v] = rgb2hsv(rgb);
      expect(h * 360).toBeCloseTo(i * 45, 3);
      expect(s).toBeCloseTo(1, 5);
      expect(v).toBeCloseTo(1, 5);
    });
  });

  it('returns exactly the stops when the count matches', () => {
    expect(paletteColors('apple 1980s', 6)[3]).toEqual([0xE0 / 255, 0x3A / 255, 0x3E / 255]);
  });

  it('picks evenly among the stops for fewer colors, and blends neighbors for more', () => {
    const stops = paletteColors('apple 1980s', 6);
    expect(paletteColors('apple 1980s', 3)).toEqual([stops[0], stops[2], stops[4]]);
    const twelve = paletteColors('apple 1980s', 12);
    expect(twelve[2]).toEqual(stops[1]);
    expect(twelve[11][0]).toBeCloseTo((stops[5][0] + stops[0][0]) / 2, 6);
  });

  it('gives every palette the requested count, clamped to 1..MAX_COLORS', () => {
    for (const name of PALETTE_NAMES) {
      expect(paletteColors(name, 5)).toHaveLength(5);
      expect(paletteColors(name, 0)).toHaveLength(1);
      expect(paletteColors(name, 99)).toHaveLength(MAX_COLORS);
      for (const hex of PALETTES[name]) expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('spreads slots evenly over every color count', () => {
    for (let n = 1; n <= MAX_COLORS; n++) expect(COLOR_SLOTS % n).toBe(0);
    expect(colorFor(paletteColors('rainbow', 4), 6)).toEqual(paletteColors('rainbow', 4)[2]);
  });
});

describe('OrganismPalette', () => {
  it('gives a newly born organism a random palette index', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.5]));
    const ev = tracker.update(cells([[10, 10], [11, 10], [12, 10]]));
    palette.apply(ev);
    expect(palette.indexOf(ev.born[0].id)).toBe(slot(0.5));
  });

  it('keeps an organism color while its id survives', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.1, 0.9]));
    const ev1 = tracker.update(cells([[10, 10], [11, 10], [12, 10]]));
    palette.apply(ev1);
    const ev2 = tracker.update(cells([[11, 9], [11, 10], [11, 11]]));
    palette.apply(ev2);
    expect(ev2.updated[0].id).toBe(ev1.born[0].id);
    expect(palette.indexOf(ev1.born[0].id)).toBe(slot(0.1));
  });

  it('forgets organisms that died', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.3]));
    const ev1 = tracker.update(cells([[10, 10], [11, 10], [12, 10]]));
    palette.apply(ev1);
    palette.apply(tracker.update([]));
    expect(palette.indexOf(ev1.born[0].id)).toBeUndefined();
  });

  it('on a split, the largest fragment keeps the color and the other gets a new one', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.1, 0.9]));
    const frag4: [number, number][] = [[10, 10], [11, 10], [10, 11], [11, 11]];
    const frag6: [number, number][] = [[16, 10], [17, 10], [18, 10], [16, 11], [17, 11], [18, 11]];
    const ev1 = tracker.update(cells([...frag4, [13, 10], [14, 10], ...frag6]));
    palette.apply(ev1);
    const ev2 = tracker.update(cells([...frag4, ...frag6]));
    palette.apply(ev2);
    expect(palette.indexOf(ev2.updated[0].id)).toBe(slot(0.1));
    expect(palette.indexOf(ev2.born[0].id)).toBe(slot(0.9));
  });

  it('on a merge, the surviving id keeps its color', () => {
    const tracker = new ClusterTracker(128, 128);
    const palette = new OrganismPalette(sequence([0.1, 0.6]));
    const small: [number, number][] = [[10, 10], [11, 10], [10, 11], [11, 11]];
    const big: [number, number][] = [[20, 10], [21, 10], [22, 10], [20, 11], [21, 11], [22, 11]];
    const ev1 = tracker.update(cells([...small, ...big]));
    palette.apply(ev1);
    const bigId = ev1.born.find(m => m.cellCount === 6)!.id;
    const bigColor = palette.indexOf(bigId);
    const ev2 = tracker.update(cells([...small, ...big, [13, 10], [15, 10], [17, 10], [18, 10]]));
    palette.apply(ev2);
    expect(ev2.updated[0].id).toBe(bigId);
    expect(palette.indexOf(bigId)).toBe(bigColor);
  });

  it('is deterministic for a seed', () => {
    const run = () => {
      const tracker = new ClusterTracker(128, 128);
      const palette = new OrganismPalette(mulberry32(5));
      const ev = tracker.update(cells([[2, 2], [3, 2], [40, 40], [41, 40], [80, 80], [81, 80]]));
      palette.apply(ev);
      return ev.born.map(m => palette.indexOf(m.id));
    };
    expect(run()).toEqual(run());
  });
});
