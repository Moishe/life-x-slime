import { describe, it, expect } from 'vitest';
import { PhysarumSim } from '../../src/physarum/simulation';
import { DEFAULT_PARAMS } from '../../src/physarum/params';
import { actor, getDevice, pixel, readTexture } from './helpers';

const W = 64;

async function makeSim(poolSize = 256) {
  const sim = new PhysarumSim(await getDevice(), { width: W, height: W, poolSize, cellSize: 16 });
  // Quiet, deterministic settings: actors stand still, never die, never reproduce.
  sim.params = {
    ...DEFAULT_PARAMS, minSpeed: 0, maxSpeed: 0, spawnProbability: 0, alwaysSpawnFromParent: -1,
    foodExhaustion: 0, fadeDecrement: 0, foodFadeDecrement: 0, life: 1000000,
  };
  return sim;
}

const spawnsAt = (n: number) => Array.from({ length: n }, (_, i) => actor({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5 }));

describe('PhysarumSim', () => {
  it('injects spawns so they are alive on the next step', async () => {
    const sim = await makeSim();
    sim.step(spawnsAt(10), []);
    sim.step([], []);
    const counters = await sim.readCounters();
    expect(counters?.aliveCount).toBe(10);
    expect(counters?.head).toBe(10);
  });

  it('deposits a new actor into the trail returned by .trail', async () => {
    const sim = await makeSim();
    sim.step([actor({ x: 5.5, y: 7.5, color: [0, 1, 0, 1], seed: [0, 1, 0, 1] })], []);
    const out = await readTexture(await getDevice(), sim.trail, W, W);
    expect(pixel(out, W, 5, 7)).toEqual([0, 255, 0, 255]);
  });

  it('never holds more than poolSize actors as the ring wraps', async () => {
    const sim = await makeSim(256);
    expect(sim.maxSpawnsPerStep).toBe(224);
    sim.step(spawnsAt(200), []);
    sim.step(spawnsAt(200), []);
    sim.step([], []);
    const counters = await sim.readCounters();
    expect(counters?.aliveCount).toBe(256);
    expect(counters?.head).toBe(400);
  });

  it('rejects more spawns than a step can hold', async () => {
    const sim = await makeSim(256);
    expect(() => sim.step(spawnsAt(225), [])).toThrow(/max is 224/);
  });

  it('counts reproduced children as inserted', async () => {
    const sim = await makeSim();
    sim.params.spawnProbability = 1;
    sim.step(spawnsAt(10), []);
    sim.step([], []);
    expect((await sim.readCounters())?.childrenInserted).toBe(10);
  });

  it('applies death food seeds to the food texture', async () => {
    const sim = await makeSim();
    sim.step([], [{ cellX: 1, cellY: 2, rgb: [1, 0, 0] }]);
    const out = await readTexture(await getDevice(), sim.foodTexture, W, W);
    const p = pixel(out, W, 20, 36);
    expect(Math.abs(p[0] - 128)).toBeLessThanOrEqual(1);
    expect(p[1]).toBe(0);
    expect(Math.abs(p[3] - 128)).toBeLessThanOrEqual(1);
  });

  it('setPoolSize clears actors and resets every counter', async () => {
    const sim = await makeSim(256);
    sim.params.spawnProbability = 1;
    sim.step(spawnsAt(10), []);
    sim.step([], []);
    sim.setPoolSize(512);
    sim.step([], []);
    expect(await sim.readCounters()).toEqual({ head: 0, childCount: 0, aliveCount: 0, childrenInserted: 0 });
    expect(sim.poolSize).toBe(512);
  });

  it('clearActors empties the pool without reallocating', async () => {
    const sim = await makeSim();
    sim.step(spawnsAt(10), []);
    sim.clearActors();
    sim.step([], []);
    expect((await sim.readCounters())?.aliveCount).toBe(0);
  });

  it('clearTrail and clearFood blank their textures', async () => {
    const device = await getDevice();
    const sim = await makeSim();
    sim.step([actor({ x: 5.5, y: 7.5, color: [0, 1, 0, 1] })], [{ cellX: 0, cellY: 0, rgb: [1, 0, 0] }]);
    sim.clearTrail();
    sim.clearFood();
    expect(pixel(await readTexture(device, sim.trail, W, W), W, 5, 7)).toEqual([0, 0, 0, 255]);
    expect(pixel(await readTexture(device, sim.foodTexture, W, W), W, 3, 3)).toEqual([0, 0, 0, 0]);
  });
});
