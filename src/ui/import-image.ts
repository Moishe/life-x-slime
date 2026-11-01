import { fitImage, type SeedImage } from '../bridge/image-seed';

// Decodes an image source (a file, or a video element showing a frame) and
// scales it to its fit on the field (longer side = fieldSize). Transparent
// areas land on black. Throws if the source is not an image the browser can read.
export async function decodeImage(source: Blob | HTMLVideoElement, fieldSize: number): Promise<SeedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    throw new Error('This file is not an image the browser can read.');
  }
  const fit = fitImage(bitmap.width, bitmap.height, fieldSize);
  const canvas = new OffscreenCanvas(fit.width, fit.height);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#000';
  context.fillRect(0, 0, fit.width, fit.height);
  context.drawImage(bitmap, 0, 0, fit.width, fit.height);
  bitmap.close();
  return { pixels: context.getImageData(0, 0, fit.width, fit.height).data, fit };
}
