import { describe, it, expect } from 'vitest';
import { captureImage } from '../../src/render/snapshot';
import { Compositor } from '../../src/render/compositor';
import { createFieldTexture } from '../../src/physarum/buffers';
import { getDevice, pixel, solidTexels, writeTexture } from './helpers';

describe('captureImage', () => {
  it('returns RGBA pixels of the composite at the requested size, without the ghost', async () => {
    const device = await getDevice();
    const compositor = new Compositor(device, 2);
    const field = createFieldTexture(device, 64, 64, 'field');
    writeTexture(device, field, 64, 64, solidTexels(64, 64, [255, 0, 0, 255]));
    const life = new Uint8Array(2 * 2 * 4);
    life.set([0, 255, 0, 255], 0); // cell (0, 0)
    compositor.setLife(life);
    const ghost = new Uint8Array(2 * 2 * 4);
    ghost.set([0, 0, 255, 255], 3 * 4); // cell (1, 1)
    compositor.setGhost(ghost);

    const lifeOnly = await captureImage(device, compositor, field, 0, 1, 128);
    expect(lifeOnly).toHaveLength(128 * 128 * 4);
    expect(pixel(lifeOnly, 128, 10, 10)).toEqual([0, 255, 0, 255]);
    expect(pixel(lifeOnly, 128, 100, 10)).toEqual([0, 0, 0, 255]);
    expect(pixel(lifeOnly, 128, 100, 100)).toEqual([0, 0, 0, 255]); // no ghost

    const fieldOnly = await captureImage(device, compositor, field, 1, 0, 128);
    expect(pixel(fieldOnly, 128, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(pixel(fieldOnly, 128, 100, 100)).toEqual([255, 0, 0, 255]);
  });
});
