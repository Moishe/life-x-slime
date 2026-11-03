import { describe, it, expect } from 'vitest';
import { openWebcam, startAutoCapture } from '../../src/ui/webcam';
import type { SeedImage } from '../../src/bridge/image-seed';

// A live video stream of a width x height picture, as a camera would deliver
// it, that starts as red left half / blue right half; `paint` changes what it
// shows from then on.
function liveStream(width: number, height: number): { stream: MediaStream; paint(left: string, right: string): void } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  let colors = ['#ff0000', '#0000ff'];
  const draw = () => {
    context.fillStyle = colors[0];
    context.fillRect(0, 0, width / 2, height);
    context.fillStyle = colors[1];
    context.fillRect(width / 2, 0, width / 2, height);
  };
  draw();
  const stream = canvas.captureStream(10);
  // Keep frames flowing: captureStream only emits a frame when the canvas is drawn.
  const timer = setInterval(draw, 50);
  stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
  return { stream, paint: (left, right) => { colors = [left, right]; } };
}

const halvesStream = (width: number, height: number) => liveStream(width, height).stream;

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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('startAutoCapture', () => {
  it('captures a frame right away and then one per interval from the live stream', async () => {
    const { stream, paint } = liveStream(4, 2);
    const frames: SeedImage[] = [];
    const stop = await startAutoCapture(async () => stream, 32, () => 0.1, image => frames.push(image), () => {});

    await until(() => frames.length >= 1);
    expect(frames[0].fit).toEqual({ width: 32, height: 16, offsetX: 0, offsetY: 8 });
    expectNear(rgb(frames[0].pixels, 32, 4, 8), [255, 0, 0]);
    paint('#00ff00', '#00ff00');
    await until(() => frames.length >= 4);
    expectNear(rgb(frames[frames.length - 1].pixels, 32, 4, 8), [0, 255, 0]);

    stop();
    expect(stream.getVideoTracks()[0].readyState).toBe('ended');
    const captured = frames.length;
    await sleep(300);
    expect(frames.length).toBe(captured);
  });

  it('stops the camera and reports the error when handling a frame fails', async () => {
    const { stream } = liveStream(4, 2);
    const failure = new Error('cannot use frame');
    const errors: unknown[] = [];
    let frames = 0;
    await startAutoCapture(async () => stream, 32, () => 0.05, () => { if (++frames === 2) throw failure; }, error => errors.push(error));

    await until(() => errors.length > 0);
    expect(errors).toEqual([failure]);
    expect(stream.getVideoTracks()[0].readyState).toBe('ended');
    await sleep(200);
    expect(frames).toBe(2);
  });

  it('stopping right after starting, while playback is still pending, reports no error', async () => {
    const { stream } = liveStream(4, 2);
    const errors: unknown[] = [];
    const stop = await startAutoCapture(async () => stream, 32, () => 1, () => {}, error => errors.push(error));
    stop();
    await sleep(200);
    expect(errors).toEqual([]);
    expect(stream.getVideoTracks()[0].readyState).toBe('ended');
  });

  it('stopping while a frame is being captured neither reports an error nor delivers the frame', async () => {
    const { stream } = liveStream(512, 512); // fitted to a 2048 field, each capture takes several ms
    const errors: unknown[] = [];
    let frames = 0;
    let framesAfterStop = 0;
    let stop: (() => void) | null = null;
    let stopped = false;
    const onFrame = () => {
      if (stopped) framesAfterStop++;
      if (++frames === 2) setTimeout(() => { stop!(); stopped = true; }, 2); // lands inside a later capture
    };
    stop = await startAutoCapture(async () => stream, 2048, () => 0, onFrame, error => errors.push(error));

    await until(() => stopped);
    await sleep(300);
    expect(errors).toEqual([]);
    expect(framesAfterStop).toBe(0);
  });

  it('rejects when the camera cannot be opened', async () => {
    const failure = new Error('no camera');
    await expect(startAutoCapture(async () => { throw failure; }, 32, () => 1, () => {}, () => {})).rejects.toBe(failure);
  });
});
