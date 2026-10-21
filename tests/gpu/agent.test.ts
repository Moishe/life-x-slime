import { describe, it, expect } from 'vitest';
import { AgentPass } from '../../src/physarum/agent-pass';
import { createCountersBuffer, createFieldTexture, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { ACTOR_BYTES, COUNTERS_BYTES, packActors, unpackActors, unpackCounters, type ActorRecord } from '../../src/physarum/layout';
import { DEFAULT_PARAMS, SIM_PARAMS_BYTES, packSimParams, type PhysarumParams } from '../../src/physarum/params';
import { hsvMix, rgb2hsv } from '../../src/color';
import { actor, getDevice, readBuffer, setPixel, solidTexels, writeTexture } from './helpers';

const W = 64;
// Deterministic baseline: no randomness in turning, no reproduction, no food.
// Sensor geometry is pinned (3 slices, 1 radian, distance 10) because the
// sensing tests place pixels at those sensor positions.
const BASE: Partial<PhysarumParams> = {
  directionRandomization: 0, spawnProbability: 0, foodSensitivity: 0, foodExhaustion: 0,
  minSpeed: 0, maxSpeed: 0, alwaysSpawnFromParent: -1,
  lookSlices: 3, lookRadians: 1, lookDistance: 10,
};

async function runAgent(actors: ActorRecord[], overrides: Partial<PhysarumParams>, opts: { trail?: Uint8Array; food?: Uint8Array; maxChildren?: number } = {}) {
  const device = await getDevice();
  const poolSize = actors.length;
  const maxChildren = opts.maxChildren ?? 8;
  const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
  device.queue.writeBuffer(params, 0, packSimParams({ ...DEFAULT_PARAMS, ...BASE, ...overrides }, {
    width: W, height: W, step: 0, poolSize, maxChildren, spawnCount: 0,
  }));
  const actorBuf = createStorageBuffer(device, poolSize * ACTOR_BYTES, 'actors');
  device.queue.writeBuffer(actorBuf, 0, packActors(actors));
  const children = createStorageBuffer(device, maxChildren * ACTOR_BYTES, 'children');
  const counters = createCountersBuffer(device);
  const trail = createFieldTexture(device, W, W, 'trail');
  const food = createFieldTexture(device, W, W, 'food');
  const density = createStorageBuffer(device, W * W * 4, 'density');
  if (opts.trail) writeTexture(device, trail, W, W, opts.trail);
  if (opts.food) writeTexture(device, food, W, W, opts.food);

  const encoder = device.createCommandEncoder();
  new AgentPass(device).encode(encoder, { params, actors: actorBuf, children, counters, trail, food, density }, poolSize);
  device.queue.submit([encoder.finish()]);

  return {
    actors: unpackActors(await readBuffer(device, actorBuf, poolSize * ACTOR_BYTES)),
    children: unpackActors(await readBuffer(device, children, maxChildren * ACTOR_BYTES)),
    counters: unpackCounters(await readBuffer(device, counters, COUNTERS_BYTES)),
  };
}

// Mirror of the shader's xorshift32 + rand(), to predict the first random draw.
function firstRand(state: number): number {
  let x = state >>> 0;
  x = (x ^ (x << 13)) >>> 0;
  x = (x ^ (x >>> 17)) >>> 0;
  x = (x ^ (x << 5)) >>> 0;
  return (x >>> 8) / 16777216;
}

// The nth (0-based) draw of the shader's rand() from the given state.
function nthRand(state: number, n: number): number {
  let x = state >>> 0;
  let r = 0;
  for (let i = 0; i <= n; i++) {
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    r = (x >>> 8) / 16777216;
  }
  return r;
}

// An rng seed whose first draw selects a parent slot other than 0.
function seedPickingOtherParent(pool: number): number {
  let seed = 1;
  while (Math.floor(firstRand(seed) * pool) % pool === 0) seed++;
  return seed;
}

describe('AgentPass movement and bounds', () => {
  it('moves along its direction and ages by one', async () => {
    const { actors, counters } = await runAgent([actor({ x: 10, y: 10, speed: 1 })], { directionMomentum: 1, maxSpeed: 1 });
    expect(actors[0].x).toBeCloseTo(11, 4);
    expect(actors[0].y).toBeCloseTo(10, 4);
    expect(actors[0].dir).toBeCloseTo(0, 5);
    expect(actors[0].age).toBe(1);
    expect(counters.aliveCount).toBe(1);
  });

  it('wraps across the edge when wrapBounds is on', async () => {
    const { actors } = await runAgent([actor({ x: 63.5, y: 10.5, speed: 1 })], { directionMomentum: 1, maxSpeed: 1, wrapBounds: true });
    expect(actors[0].x).toBeCloseTo(0.5, 3);
    expect(actors[0].alive).toBe(true);
  });

  it('dies leaving the field when wrapBounds is off and respawn is off', async () => {
    const { actors, counters } = await runAgent([actor({ x: 63.5, y: 10.5, speed: 1 })], { directionMomentum: 1, maxSpeed: 1, wrapBounds: false });
    expect(actors[0].alive).toBe(false);
    expect(counters.aliveCount).toBe(0);
  });

  it('ignores slots that are not alive', async () => {
    const { actors, counters } = await runAgent([actor({ alive: false, x: 5 })], {});
    expect(actors[0].x).toBe(5);
    expect(counters.aliveCount).toBe(0);
  });
});

describe('AgentPass death and respawn', () => {
  it('dies of old age only once age exceeds life (checked before aging)', async () => {
    const { actors } = await runAgent([actor({ age: 5, life: 5 }), actor({ age: 6, life: 5 })], {});
    expect(actors[0].alive).toBe(true);
    expect(actors[0].age).toBe(6);
    expect(actors[1].alive).toBe(false);
  });

  it('respawns at a random position with its own color when always_spawn_from_parent = 0', async () => {
    const rng = 4242;
    const { actors } = await runAgent([actor({ x: 10, y: 10, age: 9, life: 5, speed: 2, rng })],
      { alwaysSpawnFromParent: 0, spawnRandomOffset: 0, minSpeed: 0.3, maxSpeed: 5 });
    const a = actors[0];
    expect(a.alive).toBe(true);
    expect(a.age).toBe(1);
    // Reset to minSpeed, then nudged by at most 0.01 (not carried over from the old speed of 2).
    expect(a.speed).toBeGreaterThanOrEqual(0.3);
    expect(a.speed).toBeLessThanOrEqual(0.31);
    // Position draws are x then y.
    expect(a.x).toBeCloseTo(nthRand(rng, 0) * W, 3);
    expect(a.y).toBeCloseTo(nthRand(rng, 1) * W, 3);
    expect(a.seed.slice(0, 3)).toEqual([1, 0, 0]);
  });

  it('gives a respawned actor a fresh life from params', async () => {
    const { actors } = await runAgent([actor({ age: 9, life: 5 })],
      { alwaysSpawnFromParent: 0, spawnRandomOffset: 0, life: 777 });
    expect(actors[0].alive).toBe(true);
    expect(actors[0].age).toBe(1);
    expect(actors[0].life).toBe(777);
  });

  it('respawns from a living parent, adopting its position, direction and color', async () => {
    const pool = 64;
    // Pick an rng seed whose first draw selects a parent other than slot 0.
    let seed = 1;
    while (Math.floor(firstRand(seed) * pool) % pool === 0) seed++;
    const green: [number, number, number, number] = [0, 1, 0, 1];
    const actors = [
      actor({ x: 5, y: 5, age: 9, life: 5, rng: seed }),
      ...Array.from({ length: pool - 1 }, () => actor({ x: 50, y: 50, dir: 1, color: green, seed: green })),
    ];
    const { actors: out } = await runAgent(actors, { alwaysSpawnFromParent: 1, spawnRandomOffset: 0, directionMomentum: 1 });
    expect(out[0].alive).toBe(true);
    expect(out[0].x).toBeCloseTo(50, 3);
    expect(out[0].y).toBeCloseTo(50, 3);
    expect(out[0].dir).toBeCloseTo(1, 4);
    expect(out[0].seed[1]).toBeCloseTo(1, 4);
    expect(out[0].seed[0]).toBeCloseTo(0, 4);
  });

  it('respawns with the parent seed, not its trail-blended color, when spawnWithSeedColor is on', async () => {
    const pool = 64;
    const green: [number, number, number, number] = [0, 1, 0, 1];
    const brown: [number, number, number, number] = [0.4, 0.25, 0.1, 1];
    const actors = [
      actor({ x: 5, y: 5, age: 9, life: 5, rng: seedPickingOtherParent(pool) }),
      ...Array.from({ length: pool - 1 }, () => actor({ x: 50, y: 50, color: brown, seed: green })),
    ];
    const { actors: out } = await runAgent(actors, { alwaysSpawnFromParent: 1, spawnRandomOffset: 0, spawnWithSeedColor: true });
    expect(out[0].seed[0]).toBeCloseTo(0, 4);
    expect(out[0].seed[1]).toBeCloseTo(1, 4);
    expect(out[0].seed[2]).toBeCloseTo(0, 4);
  });

  it('offsets a parent respawn perpendicular to the parent direction by spawnRandomOffset', async () => {
    const pool = 64;
    const rng = seedPickingOtherParent(pool);
    const actors = [
      actor({ x: 5, y: 5, age: 9, life: 5, rng }),
      ...Array.from({ length: pool - 1 }, () => actor({ x: 50, y: 50, dir: 0 })),
    ];
    const { actors: out } = await runAgent(actors, { alwaysSpawnFromParent: 1, spawnRandomOffset: 2, directionMomentum: 1 });
    expect(out[0].x).toBeCloseTo(50, 3);
    expect(Math.abs(out[0].y - 50)).toBeCloseTo(2, 3);
  });

  it('falls back to a random position with its own color when the chosen parent is dead', async () => {
    const pool = 64;
    const actors = [
      actor({ x: 5, y: 5, age: 9, life: 5, rng: seedPickingOtherParent(pool) }),
      ...Array.from({ length: pool - 1 }, () => actor({ alive: false, x: 50, y: 50, seed: [0, 1, 0, 1], color: [0, 1, 0, 1] })),
    ];
    const { actors: out } = await runAgent(actors, { alwaysSpawnFromParent: 1, spawnRandomOffset: 0 });
    expect(out[0].alive).toBe(true);
    expect(out[0].age).toBe(1);
    expect(out[0].seed.slice(0, 3)).toEqual([1, 0, 0]);
    expect(out[0].x).toBeGreaterThanOrEqual(0);
    expect(out[0].x).toBeLessThan(W);
    expect(out[0].y).toBeGreaterThanOrEqual(0);
    expect(out[0].y).toBeLessThan(W);
  });

  it('dies of exhaustion on food with alpha >= food_exhaustion, not below', async () => {
    const food = solidTexels(W, W, [0, 0, 0, 0]);
    setPixel(food, W, 10, 10, [255, 0, 0, 255]);
    setPixel(food, W, 20, 20, [255, 0, 0, 128]);
    const { actors } = await runAgent(
      [actor({ x: 10.5, y: 10.5 }), actor({ x: 20.5, y: 20.5 })],
      { foodExhaustion: 1 },
      { food },
    );
    expect(actors[0].alive).toBe(false);
    expect(actors[1].alive).toBe(true);
  });

  it('never dies of exhaustion when food_exhaustion is 0', async () => {
    const food = solidTexels(W, W, [255, 0, 0, 255]);
    const { actors } = await runAgent([actor({ x: 10.5, y: 10.5 })], { foodExhaustion: 0 }, { food });
    expect(actors[0].alive).toBe(true);
  });
});

describe('AgentPass sensing', () => {
  const sensorPixel = (angle: number) => [Math.floor(32 + 10 * Math.cos(angle)), Math.floor(32 + 10 * Math.sin(angle))];

  it('turns toward trail matching its seed hue', async () => {
    const trail = solidTexels(W, W, [0, 0, 0, 255]);
    const [px, py] = sensorPixel(2 / 3);
    setPixel(trail, W, px, py, [255, 0, 0, 255]);
    const { actors } = await runAgent([actor()], { directionMomentum: 0, lookSlices: 3, lookRadians: 1, lookDistance: 10 }, { trail });
    expect(actors[0].dir).toBeCloseTo(2 / 3, 4);
  });

  it('prefers food of its own hue over food of another hue', async () => {
    const food = solidTexels(W, W, [0, 0, 0, 0]);
    const [rx, ry] = sensorPixel(-1 / 3);
    const [gx, gy] = sensorPixel(1 / 3);
    setPixel(food, W, rx, ry, [255, 0, 0, 255]);
    setPixel(food, W, gx, gy, [0, 255, 0, 255]);
    const { actors } = await runAgent([actor()], { directionMomentum: 0, foodSensitivity: 1 }, { food });
    expect(actors[0].dir).toBeCloseTo(-1 / 3, 4);
  });

  it('keeps its heading when nothing distinguishes the sensors', async () => {
    const { actors } = await runAgent([actor({ dir: 0.5 })], { directionMomentum: 0 });
    expect(actors[0].dir).toBeCloseTo(0.5, 5);
  });
});

describe('AgentPass deposit color', () => {
  it('blends the trail under it toward its own color by intensity', async () => {
    const trail = solidTexels(W, W, [0, 0, 255, 255]);
    const { actors } = await runAgent([actor()], { intensity: 0.5, directionMomentum: 1 }, { trail });
    const expected = hsvMix([0, 0, 1], [1, 0, 0], 0.5);
    expected.forEach((v, k) => expect(actors[0].color[k]).toBeCloseTo(v, 2));
    expect(actors[0].color[3]).toBeCloseTo(0.5, 5);
  });

  it('floors the blended color at minValue', async () => {
    const { actors } = await runAgent([actor()], { intensity: 0.2, minValue: 0.6, directionMomentum: 1 });
    expect(rgb2hsv([actors[0].color[0], actors[0].color[1], actors[0].color[2]])[2]).toBeCloseTo(0.6, 3);
  });
});

describe('AgentPass reproduction', () => {
  it('queues one child per alive actor at spawnProbability 1', async () => {
    const parents = [actor({ x: 10 }), actor({ x: 20 }), actor({ x: 30 }), actor({ x: 40 })];
    const { children, counters } = await runAgent(parents, {
      spawnProbability: 1, spawnRandomOffset: 0, directionVariance: 0, speedVariance: 0, directionMomentum: 1, life: 777,
    });
    expect(counters.childCount).toBe(4);
    const born = children.filter(c => c.alive);
    expect(born).toHaveLength(4);
    expect(new Set(born.map(c => Math.round(c.x)))).toEqual(new Set([10, 20, 30, 40]));
    for (const c of born) {
      expect(c.age).toBe(0);
      expect(c.life).toBe(777);
      expect(c.dir).toBeCloseTo(0, 5);
      expect(c.seed.slice(0, 3)).toEqual([1, 0, 0]);
      expect(c.rng).not.toBe(0);
    }
  });

  it('starts a child at the parent seed color when spawnWithSeedColor is on', async () => {
    const brown: [number, number, number, number] = [0.4, 0.25, 0.1, 1];
    const { children } = await runAgent([actor({ color: brown })], { spawnProbability: 1, spawnWithSeedColor: true });
    expect(children[0].color.slice(0, 3)).toEqual([1, 0, 0]);
  });

  it('queues no children at spawnProbability 0', async () => {
    const { counters } = await runAgent([actor(), actor()], { spawnProbability: 0 });
    expect(counters.childCount).toBe(0);
  });

  it('writes no more than maxChildren children', async () => {
    const { children, counters } = await runAgent([actor(), actor(), actor(), actor()], { spawnProbability: 1 }, { maxChildren: 2 });
    expect(counters.childCount).toBe(4);
    expect(children).toHaveLength(2);
    expect(children.every(c => c.alive)).toBe(true);
  });

  it('lets only crowdingLimit actors on one pixel reproduce', async () => {
    const crowd = [actor(), actor(), actor(), actor(), actor({ x: 10 })];
    const { counters } = await runAgent(crowd, { spawnProbability: 1, crowdingLimit: 2 });
    expect(counters.childCount).toBe(3);
  });
});
