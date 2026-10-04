import { describe, it, expect } from 'vitest';
import { PhysarumSim } from '../../src/physarum/simulation';
import { DEFAULT_PARAMS } from '../../src/physarum/params';
import { actor, getDevice, pixel, readTexture, setPixel, solidTexels, writeTexture } from './helpers';

const W = 64;

async function makeSim(poolSize = 256) {
  const sim = new PhysarumSim(await getDevice(), { width: W, height: W, poolSize, cellSize: 16 });
  // Quiet, deterministic settings: actors stand still, never die, never reproduce,
  // deposit exactly their own color, and the trail neither blurs nor fades.
  sim.params = {
    ...DEFAULT_PARAMS, minSpeed: 0, maxSpeed: 0, spawnProbability: 0, alwaysSpawnFromParent: -1,
    foodExhaustion: 0, fadeDecrement: 0, foodFadeDecrement: 0, blurMultiplier: 0, intensity: 1, life: 1000000,
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

  it('setCellSize makes death food cover the smaller block and raises the seed limit', async () => {
    const sim = await makeSim();
    expect(sim.maxFoodSeedsPerStep).toBe(16);
    sim.setCellSize(4);
    expect(sim.maxFoodSeedsPerStep).toBe(256);
    sim.step([], [{ cellX: 1, cellY: 2, rgb: [1, 0, 0] }]);
    const out = await readTexture(await getDevice(), sim.foodTexture, W, W);
    expect(Math.abs(pixel(out, W, 4, 8)[0] - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(pixel(out, W, 7, 11)[0] - 128)).toBeLessThanOrEqual(1);
    expect(pixel(out, W, 8, 8)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 4, 12)).toEqual([0, 0, 0, 0]);
    expect(() => sim.step([], Array.from({ length: 256 }, (_, i) => ({ cellX: i % 16, cellY: Math.floor(i / 16), rgb: [0, 1, 0] as [number, number, number] })))).not.toThrow();
  });

  it('setCellSize clears the food map, which is laid out in the old blocks', async () => {
    const sim = await makeSim();
    sim.step([], [{ cellX: 0, cellY: 0, rgb: [1, 0, 0] }]);
    sim.setCellSize(8);
    const out = await readTexture(await getDevice(), sim.foodTexture, W, W);
    expect(pixel(out, W, 3, 3)).toEqual([0, 0, 0, 0]);
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

  it('diffuses and swaps only every blurInterval steps; other steps deposit into the same trail', async () => {
    const device = await getDevice();
    const sim = await makeSim();
    sim.params.blurInterval = 2;
    sim.params.fadeDecrement = 0.1;
    // A pixel away from the actor, so only fading (never deposit) can change it.
    const trail = solidTexels(W, W, [0, 0, 0, 255]);
    setPixel(trail, W, 20, 20, [255, 255, 255, 255]);
    writeTexture(device, sim.trail, W, W, trail);

    const green = { x: 5.5, y: 7.5, color: [0, 1, 0, 1] as [number, number, number, number], seed: [0, 1, 0, 1] as [number, number, number, number] };
    const faded = [255, 230, 230, 204, 204];
    const observe = async (step: number) => {
      const out = await readTexture(device, sim.trail, W, W);
      expect(pixel(out, W, 5, 7), `actor pixel after step ${step}`).toEqual([0, 255, 0, 255]);
      expect(Math.abs(pixel(out, W, 20, 20)[0] - faded[step + 1]), `other pixel after step ${step}`).toBeLessThanOrEqual(2);
    };
    sim.step([actor(green)], []); // step 0 diffuses
    await observe(0);
    sim.step([], []); // step 1 does not
    await observe(1);
    sim.step([], []); // step 2 diffuses
    await observe(2);
    sim.step([], []); // step 3 does not
    await observe(3);
  });

  it('fades food only every foodFadeInterval steps', async () => {
    const device = await getDevice();
    const sim = await makeSim();
    sim.params.foodFadeInterval = 2;
    sim.params.foodFadeDecrement = 0.1;
    const alpha = async () => pixel(await readTexture(device, sim.foodTexture, W, W), W, 20, 36)[3];

    sim.step([], [{ cellX: 1, cellY: 2, rgb: [1, 0, 0] }]); // step 0: seeded, then faded
    const afterFirstFade = await alpha();
    expect(afterFirstFade).toBeGreaterThan(60);
    sim.step([], []); // step 1: no fade
    expect(await alpha()).toBe(afterFirstFade);
    sim.step([], []); // step 2: fade
    const afterSecondFade = await alpha();
    expect(Math.abs(afterFirstFade - afterSecondFade - 26)).toBeLessThanOrEqual(2);
    sim.step([], []); // step 3: no fade
    expect(await alpha()).toBe(afterSecondFade);
  });
});
