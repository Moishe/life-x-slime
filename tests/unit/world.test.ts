import { describe, it, expect } from 'vitest';
import { LifeWorld } from '../../src/life/world';
import { PATTERNS } from '../../src/life/patterns';
import { COLOR_SLOTS } from '../../src/life/palette';
import type { Rng } from '../../src/rng';

const sequence = (values: number[]): Rng => {
  let i = 0;
  return () => values[i++ % values.length];
};
// The color slot an organism gets from this rng draw.
const slot = (r: number) => Math.floor(r * COLOR_SLOTS);
const pattern = (id: string) => PATTERNS.find(p => p.id === id)!;

describe('LifeWorld', () => {
  it('colors births by their organism and deaths by the organism they left', () => {
    const world = new LifeWorld(128, 128, sequence([0.3]));
    world.place(pattern('blinker'), 60, 64, 0);
    const result = world.tick();
    expect(result.births).toHaveLength(2);
    expect(result.deaths).toHaveLength(2);
    for (const c of [...result.births, ...result.deaths]) expect(c.paletteIndex).toBe(slot(0.3));
  });

  it('attributes a lone cell death to its previous organism', () => {
    const world = new LifeWorld(128, 128, sequence([0.7]));
    world.toggle(5, 5);
    const result = world.tick();
    expect(result.deaths).toEqual([{ x: 5, y: 5, paletteIndex: slot(0.7) }]);
    expect(result.births).toEqual([]);
    expect(world.organismCount()).toBe(0);
  });

  it('keeps separate organisms in separate stable colors', () => {
    const world = new LifeWorld(128, 128, sequence([0.0, 0.99]));
    world.place(pattern('block'), 10, 10, 0);
    world.place(pattern('block'), 100, 100, 0);
    world.tick();
    const byPosition = new Map(world.liveCells().map(c => [`${c.x},${c.y}`, c.paletteIndex]));
    expect(byPosition.get('10,10')).toBe(0);
    expect(byPosition.get('100,100')).toBe(slot(0.99));
    expect(world.organismCount()).toBe(2);
  });

  it('edits retrack immediately without producing births or deaths', () => {
    const world = new LifeWorld(128, 128, sequence([0.5]));
    world.toggle(3, 3);
    expect(world.organismCount()).toBe(1);
    expect(world.liveCells()).toEqual([{ x: 3, y: 3, paletteIndex: slot(0.5) }]);
    world.clear();
    expect(world.organismCount()).toBe(0);
    expect(world.latestEvents().died).toHaveLength(1);
  });

  it('places a pattern hanging off the edge without wrapping', () => {
    const world = new LifeWorld(128, 128, sequence([0.5]));
    world.place(pattern('glider'), 126, 126, 0);
    for (const c of world.liveCells()) {
      expect(c.x).toBeLessThan(128);
      expect(c.y).toBeLessThan(128);
    }
    // Only the glider's top-right cell (127, 126) lands on the board.
    expect(world.liveCells()).toEqual([{ x: 127, y: 126, paletteIndex: slot(0.5) }]);
  });

  it('random fill respects density 0 and 1', () => {
    const world = new LifeWorld(16, 16, sequence([0.25, 0.75]));
    world.randomFill(0);
    expect(world.liveCells()).toHaveLength(0);
    world.randomFill(1);
    expect(world.liveCells()).toHaveLength(256);
  });

  it('exposes the latest tracker events after a tick', () => {
    const world = new LifeWorld(128, 128, sequence([0.5]));
    world.place(pattern('blinker'), 60, 64, 0);
    const result = world.tick();
    expect(world.latestEvents()).toBe(result.events);
    expect(result.events.updated).toHaveLength(1);
  });
});
