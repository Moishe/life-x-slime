import { describe, it, expect } from 'vitest';
import { DiffusePass } from '../../src/physarum/diffuse-pass';
import { createFieldTexture, createUniformBuffer } from '../../src/physarum/buffers';
import { FADE_PARAMS_BYTES, packFadeParams } from '../../src/physarum/params';
import { getDevice, pixel, readTexture, setPixel, solidTexels, writeTexture } from './helpers';

const W = 64;

async function diffuse(input: Uint8Array, decrement: number, blurMultiplier: number): Promise<Uint8Array> {
  const device = await getDevice();
  const source = createFieldTexture(device, W, W, 'source');
  const target = createFieldTexture(device, W, W, 'target');
  writeTexture(device, source, W, W, input);
  const fadeParams = createUniformBuffer(device, FADE_PARAMS_BYTES, 'fade');
  device.queue.writeBuffer(fadeParams, 0, packFadeParams(decrement, blurMultiplier));
  const encoder = device.createCommandEncoder();
  new DiffusePass(device).encode(encoder, { fadeParams, source, target });
  device.queue.submit([encoder.finish()]);
  return readTexture(device, target, W, W);
}

const near = (actual: number[], expected: number[]) =>
  expected.forEach((e, i) => expect(Math.abs(actual[i] - e)).toBeLessThanOrEqual(1));

describe('DiffusePass', () => {
  it('only fades when blurMultiplier is 0', async () => {
    const input = solidTexels(W, W, [0, 0, 0, 255]);
    setPixel(input, W, 5, 5, [128, 64, 0, 255]);
    const out = await diffuse(input, 0.01, 0);
    near(pixel(out, W, 5, 5), [125, 61, 0, 255]);
    near(pixel(out, W, 6, 5), [0, 0, 0, 255]);
  });

  it('blurs 3x3 with a weighted center, then fades', async () => {
    const input = solidTexels(W, W, [0, 0, 0, 255]);
    setPixel(input, W, 10, 10, [255, 0, 0, 255]);
    const out = await diffuse(input, 0.01, 1);
    // center: (1 + 1*1) / 10 - 0.01 = 0.19 -> 48; neighbour: 1/10 - 0.01 = 0.09 -> 23
    near(pixel(out, W, 10, 10), [48, 0, 0, 255]);
    near(pixel(out, W, 11, 11), [23, 0, 0, 255]);
    near(pixel(out, W, 12, 10), [0, 0, 0, 255]);
  });

  it('treats pixels outside the texture as zero at the edge', async () => {
    const input = solidTexels(W, W, [255, 255, 255, 255]);
    const out = await diffuse(input, 0, 1);
    // corner sees 4 of 9 neighbours plus the weighted center: (4 + 1) / 10 = 0.5
    near(pixel(out, W, 0, 0), [128, 128, 128, 255]);
    near(pixel(out, W, 30, 30), [255, 255, 255, 255]);
  });
});
