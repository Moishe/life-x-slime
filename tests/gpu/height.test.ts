import { describe, it, expect } from 'vitest';
import { HeightPass } from '../../src/physarum/height-pass';
import { createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { HEIGHT_PARAMS_BYTES, packHeightParams } from '../../src/physarum/params';
import { getDevice, readBuffer, writeTextureF16 } from './helpers';

const W = 128; // r16float rows must copy at a 256-byte alignment

async function runHeight(pileValues: Float32Array, heightValues: Float32Array, gain: number, decay: number): Promise<Float32Array> {
  const device = await getDevice();
  // Like createPileTexture, but writable from the CPU.
  const pile = device.createTexture({ size: [W, W], format: 'r16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  writeTextureF16(device, pile, W, W, pileValues);
  const height = createStorageBuffer(device, W * W * 4, 'height');
  device.queue.writeBuffer(height, 0, heightValues);
  const params = createUniformBuffer(device, HEIGHT_PARAMS_BYTES, 'height params');
  device.queue.writeBuffer(params, 0, packHeightParams(gain, decay));
  const encoder = device.createCommandEncoder();
  new HeightPass(device).encode(encoder, { params, pile, height });
  device.queue.submit([encoder.finish()]);
  return new Float32Array(await readBuffer(device, height, W * W * 4));
}

const at = (x: number, y: number) => y * W + x;

describe('HeightPass', () => {
  it('adds the 3x3 mean of the pile times the gain to the height', async () => {
    const pile = new Float32Array(W * W);
    pile[at(10, 10)] = 9;
    const out = await runHeight(pile, new Float32Array(W * W), 0.1, 0);
    expect(out[at(10, 10)]).toBeCloseTo(0.1, 5);
    expect(out[at(11, 10)]).toBeCloseTo(0.1, 5);
    expect(out[at(9, 11)]).toBeCloseTo(0.1, 5);
    expect(out[at(12, 10)]).toBe(0);
    expect(out[at(10, 8)]).toBe(0);
  });

  it('decays the existing height by the decay fraction', async () => {
    const height = new Float32Array(W * W);
    height[at(3, 3)] = 0.5;
    const out = await runHeight(new Float32Array(W * W), height, 0.1, 0.2);
    expect(out[at(3, 3)]).toBeCloseTo(0.4, 5);
  });

  it('clamps the height to one', async () => {
    const pile = new Float32Array(W * W);
    pile[at(20, 20)] = 90;
    const height = new Float32Array(W * W);
    height[at(20, 20)] = 0.9;
    const out = await runHeight(pile, height, 0.1, 0);
    expect(out[at(20, 20)]).toBe(1);
  });

  it('treats pixels outside the field as empty', async () => {
    const pile = new Float32Array(W * W);
    pile[at(0, 0)] = 9;
    const out = await runHeight(pile, new Float32Array(W * W), 0.1, 0);
    expect(out[at(0, 0)]).toBeCloseTo(0.1, 5);
    expect(out[at(W - 1, W - 1)]).toBe(0);
    expect(out[at(W - 1, 0)]).toBe(0);
  });
});
