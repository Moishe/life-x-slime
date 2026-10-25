import { fitImage, type SeedImage } from '../bridge/image-seed';

// Decodes an image file and scales it to its fit on the field (longer side =
// fieldSize). Transparent areas land on black. Throws if the file is not an image.
export async function decodeImage(file: Blob, fieldSize: number): Promise<SeedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
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
