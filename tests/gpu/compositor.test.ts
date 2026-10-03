import { describe, it, expect } from 'vitest';
import { Compositor } from '../../src/render/compositor';
import { createFieldTexture } from '../../src/physarum/buffers';
import { getDevice, pixel, readTexture, solidTexels, writeTexture } from './helpers';

describe('Compositor', () => {
  it('draws the field, then Life cells, then the ghost', async () => {
    const device = await getDevice();
    const compositor = new Compositor(device, 'rgba8unorm', 2);
    const field = createFieldTexture(device, 64, 64, 'field');
    writeTexture(device, field, 64, 64, solidTexels(64, 64, [255, 0, 0, 255]));
    const life = new Uint8Array(2 * 2 * 4);
    life.set([0, 255, 0, 255], 0); // cell (0, 0)
    compositor.setLife(life);
    const ghost = new Uint8Array(2 * 2 * 4);
    ghost.set([0, 0, 255, 255], 3 * 4); // cell (1, 1), fully opaque
    compositor.setGhost(ghost);
    const target = createFieldTexture(device, 64, 64, 'target');

    compositor.render(target.createView(), field, 1, 1);
    let out = await readTexture(device, target, 64, 64);
    expect(pixel(out, 64, 10, 10)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, 64, 40, 10)).toEqual([255, 0, 0, 255]);
    expect(pixel(out, 64, 40, 40)).toEqual([0, 0, 255, 255]);

    compositor.render(target.createView(), field, 0.5, 0);
    out = await readTexture(device, target, 64, 64);
    const p = pixel(out, 64, 10, 10);
    expect(Math.abs(p[0] - 128)).toBeLessThanOrEqual(1);
    expect(p[1]).toBe(0);
  });
});

describe('Compositor board size', () => {
  it('draws Life cells at the new grid size after setGridSize', async () => {
    const device = await getDevice();
    const compositor = new Compositor(device, 'rgba8unorm', 2);
    compositor.setGridSize(4);
    const field = createFieldTexture(device, 64, 64, 'field');
    const life = new Uint8Array(4 * 4 * 4);
    life.set([0, 255, 0, 255], 3 * 4); // cell (3, 0): pixels x 48..63, y 0..15
    compositor.setLife(life);
    compositor.setGhost(new Uint8Array(4 * 4 * 4));
    const target = createFieldTexture(device, 64, 64, 'target');
    compositor.render(target.createView(), field, 1, 1);
    const out = await readTexture(device, target, 64, 64);
    expect(pixel(out, 64, 50, 5)).toEqual([0, 255, 0, 255]);
    expect(pixel(out, 64, 40, 5)).toEqual([0, 0, 0, 255]);
    expect(pixel(out, 64, 50, 20)).toEqual([0, 0, 0, 255]);
  });
});
