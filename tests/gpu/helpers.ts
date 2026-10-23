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

// Reads an r16float texture as floats, row by row from the top.
export async function readTextureF16(device: GPUDevice, texture: GPUTexture, width: number, height: number): Promise<Float32Array> {
  if ((width * 2) % 256 !== 0) throw new Error('readTextureF16 needs width * 2 to be a multiple of 256');
  const size = width * height * 2;
  const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: width * 2 }, [width, height]);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return Float32Array.from(halves, halfToFloat);
}

function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exponent = (h >> 10) & 0x1f;
  const fraction = h & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

// Writes floats into an r16float texture, row by row from the top.
export function writeTextureF16(device: GPUDevice, texture: GPUTexture, width: number, height: number, data: Float32Array): void {
  device.queue.writeTexture({ texture }, Uint16Array.from(data, floatToHalf), { bytesPerRow: width * 2 }, [width, height]);
}

// Round-to-nearest half conversion for finite values within the half range.
function floatToHalf(value: number): number {
  const f = new Float32Array([value]);
  const bits = new Uint32Array(f.buffer)[0];
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x7fffff;
  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >> (1 - exponent);
    return sign | ((mantissa + 0x1000) >> 13);
  }
  if (exponent >= 0x1f) return sign | 0x7c00;
  const half = sign | (exponent << 10) | (mantissa >> 13);
  return mantissa & 0x1fff ? half + ((mantissa & 0x1000) ? 1 : 0) : half;
}
