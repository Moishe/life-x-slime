import { describe, it, expect } from 'vitest';
import { decodeImage } from '../../src/ui/import-image';

// A PNG blob of a width x height image whose left half is red and right half blue.
async function halvesPng(width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, width / 2, height);
  context.fillStyle = '#0000ff';
  context.fillRect(width / 2, 0, width / 2, height);
  return canvas.convertToBlob({ type: 'image/png' });
}

const rgb = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));

describe('decodeImage', () => {
  it('scales the image to fit the field and returns its pixels', async () => {
    const image = await decodeImage(await halvesPng(4, 2), 32);
    expect(image.fit).toEqual({ width: 32, height: 16, offsetX: 0, offsetY: 8 });
    expect(image.pixels).toHaveLength(32 * 16 * 4);
    expect(rgb(image.pixels, 32, 4, 8)).toEqual([255, 0, 0]);
    expect(rgb(image.pixels, 32, 28, 8)).toEqual([0, 0, 255]);
  });

  it('rejects a file that is not an image', async () => {
    await expect(decodeImage(new Blob(['not an image'], { type: 'text/plain' }), 32)).rejects.toThrow();
  });
});
