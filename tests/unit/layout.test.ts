import { describe, it, expect } from 'vitest';
import {
  ACTOR_BYTES, FOOD_SEED_BYTES, packActors, packFoodSeeds, ringSlot, unpackActors, unpackCounters, type ActorRecord,
} from '../../src/physarum/layout';

const actor: ActorRecord = {
  x: 1.5, y: 2.25, dir: 0.5, speed: 1.25,
  seed: [1, 0, 0, 1], color: [0, 0.5, 1, 0.75],
  age: 7, life: 20000, alive: true, rng: 0xdeadbeef,
};

describe('actor packing', () => {
  it('uses 64 bytes per actor at the WGSL offsets', () => {
    const buf = packActors([actor, { ...actor, alive: false }]);
    expect(buf.byteLength).toBe(2 * ACTOR_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    expect(Array.from(f.slice(0, 12))).toEqual([1.5, 2.25, 0.5, 1.25, 1, 0, 0, 1, 0, 0.5, 1, 0.75]);
    expect(Array.from(u.slice(12, 16))).toEqual([7, 20000, 1, 0xdeadbeef]);
    expect(u[16 + 14]).toBe(0);
  });

  it('round-trips through unpackActors', () => {
    expect(unpackActors(packActors([actor]))).toEqual([actor]);
  });
});

describe('food seed packing', () => {
  it('writes color then cell coordinates', () => {
    const buf = packFoodSeeds([{ cellX: 3, cellY: 9, rgb: [0.5, 0.25, 1] }]);
    expect(buf.byteLength).toBe(FOOD_SEED_BYTES);
    expect(Array.from(new Float32Array(buf, 0, 4))).toEqual([0.5, 0.25, 1, 1]);
    expect(Array.from(new Uint32Array(buf, 16, 2))).toEqual([3, 9]);
  });
});

describe('counters', () => {
  it('unpacks head, childCount, aliveCount, childrenInserted', () => {
    expect(unpackCounters(new Uint32Array([5, 6, 7, 8]).buffer)).toEqual({
      head: 5, childCount: 6, aliveCount: 7, childrenInserted: 8,
    });
  });
});

describe('ringSlot', () => {
  it('wraps the head into the pool', () => {
    expect(ringSlot(0, 8)).toBe(0);
    expect(ringSlot(13, 8)).toBe(5);
    expect(ringSlot(0xffffffff, 8)).toBe(7);
  });

  it('rejects pool sizes that are not powers of two', () => {
    expect(() => ringSlot(1, 12)).toThrow(/power of two/);
  });
});
