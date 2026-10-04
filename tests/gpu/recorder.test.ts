import { describe, it, expect } from 'vitest';
import { ALL_FORMATS, BlobSource, Input, canEncodeVideo } from 'mediabunny';
import { MovieRecorder } from '../../src/record/recorder';
import { Compositor } from '../../src/render/compositor';
import { createFieldTexture } from '../../src/physarum/buffers';
import { getDevice, solidTexels, writeTexture } from './helpers';

const SIZE = 128;

async function waitUntilReady(recorder: MovieRecorder): Promise<void> {
  while (recorder.busy) await new Promise(resolve => setTimeout(resolve, 5));
}

describe('MovieRecorder', () => {
  it('records each added frame into a playable MP4 of the configured size', async () => {
    const device = await getDevice();
    const compositor = new Compositor(device, 2);
    const field = createFieldTexture(device, 64, 64, 'field');
    writeTexture(device, field, 64, 64, solidTexels(64, 64, [255, 0, 0, 255]));
    compositor.setLife(new Uint8Array(2 * 2 * 4));
    compositor.setGhost(new Uint8Array(2 * 2 * 4));
    // Some Chromium builds have no H.264 encoder; the recorder works with either codec.
    const codec = (await canEncodeVideo('avc', { width: SIZE, height: SIZE, bitrate: 1_000_000 })) ? 'avc' : 'vp9';

    const recorder = await MovieRecorder.start(device, compositor, { codec, size: SIZE, bitrate: 1_000_000 });
    for (let i = 0; i < 10; i++) {
      recorder.addFrame(field, 1, 1);
      await waitUntilReady(recorder);
    }
    expect(recorder.frameCount).toBe(10);
    const blob = await recorder.finish();

    expect(blob.type).toBe('video/mp4');
    const header = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(4, 8));
    expect(header).toBe('ftyp');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = (await input.getPrimaryVideoTrack())!;
    expect(await track.getDisplayWidth()).toBe(SIZE);
    expect(await track.getDisplayHeight()).toBe(SIZE);
    expect((await track.computePacketStats()).packetCount).toBe(10);
    expect(await input.computeDuration()).toBeCloseTo(10 / 30, 2);
  });
});
