import type { Compositor } from './compositor';

// Composites the field and Life layer (no placement ghost) into an offscreen
// size×size image and returns its RGBA pixels, row by row from the top.
export async function captureImage(
  device: GPUDevice,
  compositor: Compositor,
  field: GPUTexture,
  physarumOpacity: number,
  lifeOpacity: number,
  size = 2048,
): Promise<Uint8Array> {
  const target = device.createTexture({
    label: 'snapshot',
    size: [size, size],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  compositor.render(target, field, physarumOpacity, lifeOpacity, 0);

  // Rows are copied at the 256-byte alignment copyTextureToBuffer requires.
  const bytesPerRow = Math.ceil((size * 4) / 256) * 256;
  const staging = device.createBuffer({ size: bytesPerRow * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder({ label: 'snapshot readback' });
  encoder.copyTextureToBuffer({ texture: target }, { buffer: staging, bytesPerRow }, [size, size]);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const padded = new Uint8Array(staging.getMappedRange());
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) pixels.set(padded.subarray(y * bytesPerRow, y * bytesPerRow + size * 4), y * size * 4);
  staging.unmap();
  staging.destroy();
  target.destroy();
  return pixels;
}
