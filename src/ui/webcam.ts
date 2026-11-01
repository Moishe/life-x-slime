import type { SeedImage } from '../bridge/image-seed';
import { decodeImage } from './import-image';

// Opens the camera via `getStream` and shows its live preview inside `parent`
// with capture and cancel buttons. Resolves with the captured frame fitted to
// the field, or null if cancelled; rejects if the camera cannot be opened.
// The camera is released and the preview removed either way.
export async function openWebcam(parent: HTMLElement, getStream: () => Promise<MediaStream>, fieldSize: number): Promise<SeedImage | null> {
  const stream = await getStream();
  const overlay = document.createElement('div');
  overlay.id = 'webcam';
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const capture = document.createElement('button');
  capture.textContent = 'capture';
  capture.disabled = true;
  // A frame can only be grabbed once playback has actually started.
  video.addEventListener('playing', () => { capture.disabled = false; });
  const cancel = document.createElement('button');
  cancel.textContent = 'cancel';
  const buttons = document.createElement('div');
  buttons.append(capture, cancel);
  overlay.append(video, buttons);
  parent.append(overlay);

  const close = () => {
    stream.getTracks().forEach(track => track.stop());
    overlay.remove();
  };
  try {
    return await new Promise<SeedImage | null>((resolve, reject) => {
      capture.addEventListener('click', () => decodeImage(video, fieldSize).then(resolve, reject));
      cancel.addEventListener('click', () => resolve(null));
    });
  } finally {
    close();
  }
}

// A readable explanation of a getUserMedia failure.
export function webcamErrorText(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Camera access was denied.';
  if (name === 'NotFoundError') return 'No camera was found.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return `Could not open the camera: ${error instanceof Error ? error.message : String(error)}`;
}
