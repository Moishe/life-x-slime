import type { ActorRecord } from '../../src/physarum/layout';

let devicePromise: Promise<GPUDevice> | null = null;

// One shared device for every GPU test in the file.
export function getDevice(): Promise<GPUDevice> {
  devicePromise ??= (async () => {
    if (!navigator.gpu) throw new Error('navigator.gpu is missing: WebGPU is not enabled in the test browser');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter available in the test browser');
    return adapter.requestDevice();
  })();
  return devicePromise;
}

export async function readBuffer(device: GPUDevice, source: GPUBuffer, size: number): Promise<ArrayBuffer> {
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.unmap();
  staging.destroy();
  return copy;
}

export async function readTexture(device: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<Uint8Array> {
  if ((width * 4) % 256 !== 0) throw new Error('readTexture needs width * 4 to be a multiple of 256');
  const size = width * height * 4;
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: width * 4 }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = new Uint8Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return copy;
}

export function writeTexture(device: GPUDevice, texture: GPUTexture, width: number, height: number, data: Uint8Array): void {
  device.queue.writeTexture({ texture }, data, { bytesPerRow: width * 4 }, [width, height]);
}

export function solidTexels(width: number, height: number, rgba: number[]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return data;
}

export function setPixel(data: Uint8Array, width: number, x: number, y: number, rgba: number[]): void {
  data.set(rgba, (y * width + x) * 4);
}

export function pixel(data: Uint8Array, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 4;
  return Array.from(data.slice(o, o + 4));
}

// A red, alive, motionless actor at (32, 32); override any field.
export function actor(overrides: Partial<ActorRecord> = {}): ActorRecord {
  return {
    x: 32, y: 32, dir: 0, speed: 0,
    seed: [1, 0, 0, 1], color: [1, 0, 0, 1],
    age: 0, life: 100000, alive: true, rng: 12345,
    ...overrides,
  };
}
