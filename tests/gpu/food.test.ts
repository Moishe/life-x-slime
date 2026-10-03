import { describe, it, expect } from 'vitest';
import { FoodPass } from '../../src/physarum/food-pass';
import { createFieldTexture, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { FOOD_SEED_BYTES, packFoodSeeds, type FoodSeed } from '../../src/physarum/layout';
import { FADE_PARAMS_BYTES, FOOD_PARAMS_BYTES, packFadeParams, packFoodParams } from '../../src/physarum/params';
import { getDevice, pixel, readTexture, solidTexels, writeTexture } from './helpers';

const W = 64;
const near = (actual: number[], expected: number[]) =>
  expected.forEach((e, i) => expect(Math.abs(actual[i] - e)).toBeLessThanOrEqual(1));

async function seed(seeds: FoodSeed[], initial?: Uint8Array): Promise<Uint8Array> {
  const device = await getDevice();
  const target = createFieldTexture(device, W, W, 'food');
  if (initial) writeTexture(device, target, W, W, initial);
  const foodParams = createUniformBuffer(device, FOOD_PARAMS_BYTES, 'food params');
  device.queue.writeBuffer(foodParams, 0, packFoodParams(16, 0.5, W, W));
  const seedBuf = createStorageBuffer(device, seeds.length * FOOD_SEED_BYTES, 'seeds');
  device.queue.writeBuffer(seedBuf, 0, packFoodSeeds(seeds));
  const encoder = device.createCommandEncoder();
  new FoodPass(device).encodeSeeds(encoder, { foodParams, seeds: seedBuf, target }, seeds.length);
  device.queue.submit([encoder.finish()]);
  return readTexture(device, target, W, W);
}

describe('FoodPass seeds', () => {
  it('adds color * foodPerDeath and alpha foodPerDeath over exactly the 16x16 block', async () => {
    const out = await seed([{ cellX: 1, cellY: 2, rgb: [1, 0, 0] }]);
    near(pixel(out, W, 16, 32), [128, 0, 0, 128]);
    near(pixel(out, W, 31, 47), [128, 0, 0, 128]);
    expect(pixel(out, W, 15, 32)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 32, 32)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 16, 31)).toEqual([0, 0, 0, 0]);
    expect(pixel(out, W, 16, 48)).toEqual([0, 0, 0, 0]);
  });

  it('accumulates additively', async () => {
    const out = await seed([{ cellX: 0, cellY: 0, rgb: [0, 1, 0] }, { cellX: 0, cellY: 0, rgb: [0, 1, 0] }]);
    near(pixel(out, W, 3, 3), [0, 255, 0, 255]);
  });
});

describe('FoodPass fade', () => {
  it('subtracts the decrement from every channel and clamps at 0', async () => {
    const device = await getDevice();
    const target = createFieldTexture(device, W, W, 'food');
    const initial = solidTexels(W, W, [100, 50, 0, 200]);
    writeTexture(device, target, W, W, initial);
    const fadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'fade');
    device.queue.writeBuffer(fadeParams, 0, packFadeParams(0.02, 0));
    const encoder = device.createCommandEncoder();
    new FoodPass(device).encodeFade(encoder, { fadeParams, target });
    device.queue.submit([encoder.finish()]);
    const out = await readTexture(device, target, W, W);
    near(pixel(out, W, 7, 7), [95, 45, 0, 195]);
  });
});
