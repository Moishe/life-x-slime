import { BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny';
import { MOVIE_FPS, type MovieConfig } from './movie-config';
import type { Compositor } from '../render/compositor';

// Frames handed to the encoder but not yet accepted. Above this the caller
// should hold off on new frames (see `busy`) instead of dropping any.
const MAX_PENDING_FRAMES = 3;

// Records composited frames into an MP4, one frame per addFrame() call at
// MOVIE_FPS, entirely in memory.
export class MovieRecorder {
  frameCount = 0;
  private pending = 0;
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown = null;

  private constructor(
    private readonly compositor: Compositor,
    private readonly canvas: OffscreenCanvas,
    private readonly context: GPUCanvasContext,
    private readonly output: Output<Mp4OutputFormat, BufferTarget>,
    private readonly source: VideoSampleSource,
  ) {}

  static async start(device: GPUDevice, compositor: Compositor, config: MovieConfig): Promise<MovieRecorder> {
    const canvas = new OffscreenCanvas(config.size, config.size);
    const context = canvas.getContext('webgpu')!;
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    const source = new VideoSampleSource({ codec: config.codec, bitrate: config.bitrate });
    output.addVideoTrack(source, { frameRate: MOVIE_FPS });
    await output.start();
    return new MovieRecorder(compositor, canvas, context, output, source);
  }

  // True while the encoder is behind; callers should wait before adding frames.
  get busy(): boolean {
    return this.pending >= MAX_PENDING_FRAMES;
  }

  // Composites `field` and the Life layer (no ghost) and appends it as the next frame.
  addFrame(field: GPUTexture, physarumOpacity: number, lifeOpacity: number): void {
    if (this.failure) throw this.failure;
    this.compositor.render(this.context.getCurrentTexture(), field, physarumOpacity, lifeOpacity, 0);
    // Capture now, before the next render replaces the canvas contents.
    const sample = new VideoSample(new VideoFrame(this.canvas, { timestamp: 0 }), {
      timestamp: this.frameCount / MOVIE_FPS,
      duration: 1 / MOVIE_FPS,
    });
    this.frameCount++;
    this.pending++;
    // Samples are added one at a time, in order.
    this.queue = this.queue
      .then(() => this.source.add(sample))
      .catch(error => {
        this.failure ??= error;
      })
      .finally(() => {
        sample.close();
        this.pending--;
      });
  }

  // Waits for queued frames, finishes the file and returns it.
  async finish(): Promise<Blob> {
    await this.queue;
    if (this.failure) {
      await this.output.cancel();
      throw this.failure;
    }
    await this.output.finalize();
    return new Blob([this.output.target.buffer!], { type: 'video/mp4' });
  }

  // Abandons the recording and releases the encoder. Best effort: callers
  // fire and forget it, so a failing encoder must not surface as an unhandled rejection.
  async cancel(): Promise<void> {
    await this.queue;
    await this.output.cancel().catch(() => {});
  }
}
