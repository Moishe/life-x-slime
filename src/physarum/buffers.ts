import { ACTOR_BYTES, COUNTERS_BYTES } from './layout';

// Storage buffers are never smaller than one actor so that a runtime-sized
// array<Actor> binding is always valid, even for an empty spawn list.
export function createStorageBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(size, ACTOR_BYTES),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

export function createUniformBuffer(device: GPUDevice, size: number, label: string): GPUBuffer {
  return device.createBuffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
}

export function createCountersBuffer(device: GPUDevice): GPUBuffer {
  return device.createBuffer({
    label: 'counters',
    size: COUNTERS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
}

// Trail, food and test textures: rgba8unorm, usable by every pass.
export function createFieldTexture(device: GPUDevice, width: number, height: number, label: string): GPUTexture {
  return device.createTexture({
    label,
    size: [width, height],
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.COPY_DST,
  });
}
