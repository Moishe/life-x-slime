import { describe, it, expect } from 'vitest';
import { DepositPass } from '../../src/physarum/deposit-pass';
import { createFieldTexture, createPileTexture, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { ACTOR_BYTES, packActors } from '../../src/physarum/layout';
import { DEFAULT_PARAMS, SIM_PARAMS_BYTES, packSimParams } from '../../src/physarum/params';
import { actor, getDevice, pixel, readTexture, readTextureF16, solidTexels, writeTexture } from './helpers';

const W = 64;

describe('DepositPass', () => {
  it('colors exactly the pixel floor(pos) of each alive actor and nothing for dead ones', async () => {
    const device = await getDevice();
    const actors = [
      actor({ x: 5.7, y: 9.2, color: [0, 1, 0, 1] }),
      actor({ x: 40.1, y: 3.9, color: [0, 0, 1, 1], alive: false }),
    ];
    const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
    device.queue.writeBuffer(params, 0, packSimParams(DEFAULT_PARAMS, {
      width: W, height: W, step: 0, poolSize: actors.length, maxChildren: 0, spawnCount: 0,
    }));
    const actorBuf = createStorageBuffer(device, actors.length * ACTOR_BYTES, 'actors');
    device.queue.writeBuffer(actorBuf, 0, packActors(actors));
    const target = createFieldTexture(device, W, W, 'trail');
    writeTexture(device, target, W, W, solidTexels(W, W, [10, 10, 10, 255]));

    const pile = createPileTexture(device, W, W);
    const encoder = device.createCommandEncoder();
    new DepositPass(device).encode(encoder, { params, actors: actorBuf, target, pile }, actors.length);
    device.queue.submit([encoder.finish()]);
    const out = await readTexture(device, target, W, W);

    expect(pixel(out, W, 5, 9)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, W, 5, 54)).toEqual([10, 10, 10, 255]);   // would be hit if y were not flipped
    expect(pixel(out, W, 40, 3)).toEqual([10, 10, 10, 255]);   // dead actor drew nothing
    let changed = 0;
    for (let i = 0; i < W * W; i++) if (out[i * 4 + 1] === 255) changed++;
    expect(changed).toBe(1);
  });
});

describe('DepositPass pile', () => {
  it('counts the alive actors on each pixel, starting from zero every pass', async () => {
    const device = await getDevice();
    const size = 128; // r16float rows must copy at a 256-byte alignment
    const actors = [
      actor({ x: 5.2, y: 9.7 }),
      actor({ x: 5.9, y: 9.1 }),
      actor({ x: 20.5, y: 30.5 }),
      actor({ x: 40.5, y: 3.5, alive: false }),
    ];
    const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
    device.queue.writeBuffer(params, 0, packSimParams(DEFAULT_PARAMS, {
      width: size, height: size, step: 0, poolSize: actors.length, maxChildren: 0, spawnCount: 0,
    }));
    const actorBuf = createStorageBuffer(device, actors.length * ACTOR_BYTES, 'actors');
    device.queue.writeBuffer(actorBuf, 0, packActors(actors));
    const target = createFieldTexture(device, size, size, 'trail');
    const pile = createPileTexture(device, size, size);

    const pass = new DepositPass(device);
    for (let n = 0; n < 2; n++) {
      const encoder = device.createCommandEncoder();
      pass.encode(encoder, { params, actors: actorBuf, target, pile }, actors.length);
      device.queue.submit([encoder.finish()]);
    }
    const out = await readTextureF16(device, pile, size, size);
    expect(out[9 * size + 5]).toBe(2);
    expect(out[30 * size + 20]).toBe(1);
    expect(out[3 * size + 40]).toBe(0);
    expect(out.reduce((a, b) => a + b, 0)).toBe(3);
  });
});
