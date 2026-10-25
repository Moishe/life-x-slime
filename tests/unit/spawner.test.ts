import { describe, it, expect } from 'vitest';
import { SpawnScheduler, birthsToActors, deathsToFoodSeeds } from '../../src/bridge/spawner';
import { colorFor, paletteColors } from '../../src/life/palette';
import type { ColoredCell } from '../../src/life/world';
import { mulberry32 } from '../../src/rng';
import type { ActorRecord } from '../../src/physarum/layout';

const PALETTE = paletteColors('rainbow', 8);
const colorOf = (cell: ColoredCell) => colorFor(PALETTE, cell.paletteIndex);
const settings = { actorsPerBirth: 16, cellSize: 16, minSpeed: 0.3, life: 20000, colorOf };
const fakeActors = (n: number, tag = 0): ActorRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    x: tag, y: i, dir: 0, speed: 0, seed: [1, 0, 0, 1], color: [1, 0, 0, 1], age: 0, life: 1, alive: true, rng: 1,
  }));

describe('birthsToActors', () => {
  it('spawns actorsPerBirth actors inside each newborn cell block', () => {
    const actors = birthsToActors([{ x: 3, y: 5, paletteIndex: 2 }], settings, mulberry32(1), 1000);
    expect(actors).toHaveLength(16);
    for (const a of actors) {
      expect(a.x).toBeGreaterThanOrEqual(48);
      expect(a.x).toBeLessThan(64);
      expect(a.y).toBeGreaterThanOrEqual(80);
      expect(a.y).toBeLessThan(96);
      expect(a.dir).toBeGreaterThanOrEqual(0);
      expect(a.dir).toBeLessThan(2 * Math.PI);
      expect(a.speed).toBe(0.3);
      expect(a.age).toBe(0);
      expect(a.life).toBe(20000);
      expect(a.alive).toBe(true);
      expect(a.rng % 2).toBe(1);
      expect(a.seed).toEqual([...PALETTE[2], 1]);
      expect(a.color).toEqual([...PALETTE[2], 1]);
    }
  });

  it('produces births x actorsPerBirth actors', () => {
    const births = [{ x: 0, y: 0, paletteIndex: 0 }, { x: 1, y: 0, paletteIndex: 1 }, { x: 2, y: 0, paletteIndex: 2 }];
    expect(birthsToActors(births, settings, mulberry32(1), 1000)).toHaveLength(48);
  });

  it('keeps only the newest maxActors when there are too many births', () => {
    const births = Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0, paletteIndex: 0 }));
    const actors = birthsToActors(births, settings, mulberry32(1), 40);
    expect(actors).toHaveLength(40);
    // The last birth (x = 99) must be represented; the first must not.
    expect(actors.some(a => a.x >= 99 * 16)).toBe(true);
    expect(actors.some(a => a.x < 16)).toBe(false);
  });

  it('spawns nothing when actorsPerBirth is 0', () => {
    expect(birthsToActors([{ x: 0, y: 0, paletteIndex: 0 }], { ...settings, actorsPerBirth: 0 }, mulberry32(1), 100)).toEqual([]);
  });
});

describe('deathsToFoodSeeds', () => {
  it('makes one seed per death in the organism color', () => {
    expect(deathsToFoodSeeds([{ x: 4, y: 7, paletteIndex: 5 }], colorOf)).toEqual([{ cellX: 4, cellY: 7, rgb: [...PALETTE[5]] }]);
  });
});

describe('SpawnScheduler', () => {
  it('burst: hands everything to the next step', () => {
    const s = new SpawnScheduler(1000);
    s.enqueue(fakeActors(50), 30);
    expect(s.takeForStep(Infinity)).toHaveLength(50);
    expect(s.takeForStep(Infinity)).toHaveLength(0);
  });

  it('burst: spills over steps when a step limit is hit', () => {
    const s = new SpawnScheduler(1000);
    s.enqueue(fakeActors(100), 30);
    expect([s.takeForStep(40).length, s.takeForStep(40).length, s.takeForStep(40).length]).toEqual([40, 40, 20]);
  });

  it('trickle: spreads evenly across the steps until the next tick', () => {
    const s = new SpawnScheduler(1000);
    s.mode = 'trickle';
    s.enqueue(fakeActors(31), 30);
    const counts = Array.from({ length: 30 }, () => s.takeForStep(Infinity).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(31);
    expect(Math.max(...counts)).toBe(2);
    expect(Math.min(...counts)).toBe(1);
  });

  it('trickle: leftovers are kept when the next tick arrives early', () => {
    const s = new SpawnScheduler(1000);
    s.mode = 'trickle';
    s.enqueue(fakeActors(30, 1), 30);
    for (let i = 0; i < 10; i++) s.takeForStep(Infinity);
    s.enqueue(fakeActors(30, 2), 30);
    let total = 0;
    for (let i = 0; i < 30; i++) total += s.takeForStep(Infinity).length;
    expect(total).toBe(50);
    expect(s.pending).toBe(0);
  });

  it('drops the oldest queued actors beyond maxQueued', () => {
    const s = new SpawnScheduler(10);
    s.enqueue(fakeActors(8, 1), 30);
    s.enqueue(fakeActors(8, 2), 30);
    const taken = s.takeForStep(Infinity);
    expect(taken).toHaveLength(10);
    expect(taken.filter(a => a.x === 1)).toHaveLength(2);
    expect(taken.filter(a => a.x === 2)).toHaveLength(8);
  });

  it('clear() empties the queue', () => {
    const s = new SpawnScheduler(100);
    s.enqueue(fakeActors(5), 30);
    s.clear();
    expect(s.pending).toBe(0);
  });
});
