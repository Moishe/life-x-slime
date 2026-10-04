export interface SnapshotFilenames {
  life: string;
  physarum: string;
  mix: string;
}

const twoDigits = (n: number): string => String(n).padStart(2, '0');

// Local-time stamp used in exported file names, e.g. 2026-10-03-19-30-12.
export function exportTimestamp(when: Date): string {
  return [
    when.getFullYear(), twoDigits(when.getMonth() + 1), twoDigits(when.getDate()),
    twoDigits(when.getHours()), twoDigits(when.getMinutes()), twoDigits(when.getSeconds()),
  ].join('-');
}

// File names for one snapshot, sharing a local-time stamp so the three sort together.
export function snapshotFilenames(when: Date): SnapshotFilenames {
  const stamp = exportTimestamp(when);
  const name = (part: string) => `life-x-physarum-${stamp}-${part}.png`;
  return { life: name('life'), physarum: name('physarum'), mix: name('mix') };
}

// Encodes RGBA pixels as a PNG using the browser's canvas encoder.
export async function encodePng(pixels: Uint8Array, size: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d')!;
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), size, size), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
