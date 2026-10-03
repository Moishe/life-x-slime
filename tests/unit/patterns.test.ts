import { describe, it, expect } from 'vitest';
import { LifeEngine } from '../../src/life/engine';
import { PATTERNS, fromRows, rotateCells, placePattern } from '../../src/life/patterns';

const byId = (id: string) => {
  const p = PATTERNS.find(p => p.id === id);
  if (!p) throw new Error(`missing pattern ${id}`);
  return p;
};

const cellSet = (cells: { x: number; y: number }[]) =>
  new Set(cells.map(c => `${c.x},${c.y}`));

describe('pattern library', () => {
  it('contains the full curated palette', () => {
    expect(PATTERNS.map(p => p.id).sort()).toEqual(
      [
        'acorn', 'beacon', 'beehive', 'blinker', 'block', 'glider',
        'gosperGun', 'loaf', 'lwss', 'pentadecathlon', 'pond',
        'pulsar', 'rPentomino', 'toad',
      ].sort(),
    );
  });

  it('has correct cell counts for known patterns', () => {
    expect(byId('block').cells).toHaveLength(4);
    expect(byId('pulsar').cells).toHaveLength(48);
    expect(byId('gosperGun').cells).toHaveLength(36);
    expect(byId('rPentomino').cells).toHaveLength(5);
    expect(byId('acorn').cells).toHaveLength(7);
    expect(byId('lwss').cells).toHaveLength(9);
  });

  it('parses rows into cells', () => {
    expect(cellSet(fromRows(['#.', '.#']))).toEqual(new Set(['0,0', '1,1']));
  });

  it('rotates a blinker from horizontal to vertical', () => {
    const rotated = rotateCells(fromRows(['###']), 1);
    expect(cellSet(rotated)).toEqual(new Set(['0,0', '0,1', '0,2']));
  });

  it('returns to the original shape after 4 rotations', () => {
    const glider = byId('glider').cells;
    expect(cellSet(rotateCells(glider, 4))).toEqual(cellSet(glider));
  });

  it('still lifes are stable when placed', () => {
    for (const id of ['block', 'beehive', 'loaf', 'pond']) {
      const e = new LifeEngine(20, 20);
      placePattern(e, byId(id), 5, 5);
      const before = cellSet(e.liveCells());
      e.tick();
      expect(cellSet(e.liveCells()), id).toEqual(before);
    }
  });

  it('oscillators return to their initial state after their period', () => {
    const periods: [string, number][] = [
      ['blinker', 2], ['toad', 2], ['beacon', 2], ['pulsar', 3], ['pentadecathlon', 15],
    ];
    for (const [id, period] of periods) {
      const e = new LifeEngine(40, 40);
      placePattern(e, byId(id), 12, 12);
      const before = cellSet(e.liveCells());
      for (let i = 0; i < period; i++) e.tick();
      expect(cellSet(e.liveCells()), id).toEqual(before);
    }
  });

  it('the Gosper gun emits its first glider by generation 30', () => {
    const e = new LifeEngine(96, 96);
    placePattern(e, byId('gosperGun'), 5, 5);
    for (let i = 0; i < 30; i++) e.tick();
    // gun (36 cells) has period 30 and has released one 5-cell glider
    expect(e.population()).toBe(41);
  });
});
