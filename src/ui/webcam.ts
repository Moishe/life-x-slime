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

// Opens the camera via `getStream` and, without showing it, hands `onFrame` a
// frame fitted to the field right away and then every `intervalSec()` seconds
// (read before each wait, so changes take effect at the next capture).
// Resolves with a function that stops capturing and releases the camera;
// rejects if the camera cannot be opened. If a frame cannot be captured or
// `onFrame` throws, capturing stops and `onError` gets the error.
export async function startAutoCapture(
  getStream: () => Promise<MediaStream>,
  fieldSize: number,
  intervalSec: () => number,
  onFrame: (image: SeedImage) => void,
  onError: (error: unknown) => void,
): Promise<() => void> {
  const stream = await getStream();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  };
  // Once stopped, a decode or playback failure caused by the stop (and any
  // frame that was mid-decode) is dropped rather than reported or delivered.
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    onError(error);
  };
  const capture = async () => {
    if (stopped) return;
    try {
      const image = await decodeImage(video, fieldSize);
      if (stopped) return;
      onFrame(image);
    } catch (error) {
      fail(error);
      return;
    }
    if (!stopped) timer = setTimeout(capture, intervalSec() * 1000);
  };
  // A frame can only be grabbed once playback has actually started.
  video.addEventListener('playing', () => void capture(), { once: true });
  video.play().catch(fail);
  return stop;
}

// A readable explanation of a getUserMedia failure.
export function webcamErrorText(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError') return 'Camera access was denied.';
  if (name === 'NotFoundError') return 'No camera was found.';
  if (name === 'NotReadableError') return 'The camera is in use by another app.';
  return `Could not open the camera: ${error instanceof Error ? error.message : String(error)}`;
}
