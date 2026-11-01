import { describe, it, expect } from 'vitest';
import { openWebcam } from '../../src/ui/webcam';

// A live video stream of a width x height picture whose left half is red and
// right half blue, as a camera would deliver it.
function halvesStream(width: number, height: number): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  const draw = () => {
    context.fillStyle = '#ff0000';
    context.fillRect(0, 0, width / 2, height);
    context.fillStyle = '#0000ff';
    context.fillRect(width / 2, 0, width / 2, height);
  };
  draw();
  const stream = canvas.captureStream(10);
  // Keep frames flowing: captureStream only emits a frame when the canvas is drawn.
  const timer = setInterval(draw, 50);
  stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
  return stream;
}

const rgb = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => Array.from(pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3));

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('timed out waiting');
    await new Promise(r => setTimeout(r, 20));
  }
}

const expectNear = (actual: number[], expected: number[]) => actual.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(8));

const button = (parent: HTMLElement, name: string) => Array.from(parent.querySelectorAll('button')).find(b => b.textContent === name)!;

describe('openWebcam', () => {
  it('previews the camera and captures a frame fitted to the field', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const stream = halvesStream(4, 2);
    const result = openWebcam(parent, async () => stream, 32);

    await until(() => parent.querySelector('video') !== null);
    const video = parent.querySelector('video')!;
    expect(video.srcObject).toBe(stream);
    const capture = button(parent, 'capture');
    await until(() => !capture.disabled);
    capture.click();

    const image = (await result)!;
    expect(image.fit).toEqual({ width: 32, height: 16, offsetX: 0, offsetY: 8 });
    // Video frames pass through YUV conversion, so colors come back a few units off.
    expectNear(rgb(image.pixels, 32, 4, 8), [255, 0, 0]);
    expectNear(rgb(image.pixels, 32, 28, 8), [0, 0, 255]);
    expect(parent.querySelector('video')).toBeNull();
    expect(stream.getVideoTracks()[0].readyState).toBe('ended');
    parent.remove();
  });

  it('returns null and stops the camera when cancelled', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const stream = halvesStream(4, 2);
    const result = openWebcam(parent, async () => stream, 32);

    await until(() => parent.querySelector('video') !== null);
    button(parent, 'cancel').click();

    expect(await result).toBeNull();
    expect(parent.querySelector('video')).toBeNull();
    expect(stream.getVideoTracks()[0].readyState).toBe('ended');
    parent.remove();
  });

  it('rejects and shows nothing when the camera cannot be opened', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    const failure = new Error('no camera');
    await expect(openWebcam(parent, async () => { throw failure; }, 32)).rejects.toBe(failure);
    expect(parent.children).toHaveLength(0);
    parent.remove();
  });
});
