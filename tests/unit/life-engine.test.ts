import { describe, it, expect } from 'vitest';
import { LifeEngine } from '../../src/life/engine';

function setCells(e: LifeEngine, cells: [number, number][]) {
  for (const [x, y] of cells) e.set(x, y, true);
}

describe('LifeEngine', () => {
  it('defaults to 128x128 and starts empty', () => {
    const e = new LifeEngine();
    expect(e.width).toBe(128);
    expect(e.height).toBe(128);
    expect(e.population()).toBe(0);
  });

  it('treats cells beyond the edge as dead (no wrapping)', () => {
    const e = new LifeEngine(10, 10);
    // A blinker lying along the left edge: the vertical phase would need x = -1.
    setCells(e, [[0, 4], [0, 5], [0, 6]]);
    e.tick();
    expect(new Set(e.liveCells().map(c => `${c.x},${c.y}`))).toEqual(new Set(['0,5', '1,5']));
  });

  it('is bounded: out-of-range get is false, set is a no-op', () => {
    const e = new LifeEngine(10, 10);
    expect(e.get(-1, 0)).toBe(false);
    expect(e.get(0, 10)).toBe(false);
    e.set(-1, 0, true);
    e.set(10, 5, true);
    expect(e.population()).toBe(0);
  });

  it('keeps a block (still life) stable with no births or deaths', () => {
    const e = new LifeEngine(10, 10);
    setCells(e, [[4, 4], [5, 4], [4, 5], [5, 5]]);
    const r = e.tick();
    expect(r.births).toHaveLength(0);
    expect(r.deaths).toHaveLength(0);
    expect(e.population()).toBe(4);
  });

  it('oscillates a blinker with period 2', () => {
    const e = new LifeEngine(10, 10);
    setCells(e, [[3, 5], [4, 5], [5, 5]]); // horizontal
    const r1 = e.tick();
    expect(e.liveCells()).toEqual([
      { x: 4, y: 4 }, { x: 4, y: 5 }, { x: 4, y: 6 },
    ]); // vertical
    expect(r1.births).toHaveLength(2);
    expect(r1.deaths).toHaveLength(2);
    e.tick();
    expect(e.liveCells()).toEqual([
      { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 },
    ]); // horizontal again
  });

  it('moves a glider one cell down-right every 4 generations', () => {
    const e = new LifeEngine(20, 20);
    // glider: .#. / ..# / ### at origin (1,1)
    setCells(e, [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]]);
    for (let i = 0; i < 4; i++) e.tick();
    expect(new Set(e.liveCells().map(c => `${c.x},${c.y}`))).toEqual(
      new Set(['3,2', '4,3', '2,4', '3,4', '4,4']),
    );
  });

  it('clear() empties the board', () => {
    const e = new LifeEngine(10, 10);
    setCells(e, [[1, 1], [2, 2]]);
    e.clear();
    expect(e.population()).toBe(0);
  });
});
