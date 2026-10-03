import './style.css';
import { App } from './app/app';
import { seedFromUrl } from './app/settings';
import { initGpu } from './gpu/device';
import { onShaderError } from './gpu/shader';
import { DEFAULT_PARAMS } from './physarum/params';

const canvas = document.querySelector<HTMLCanvasElement>('#field')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

function showMessage(text: string, offerReload = false): void {
  message.hidden = false;
  message.textContent = text;
  if (offerReload) {
    const button = document.createElement('button');
    button.textContent = 'Reload';
    button.addEventListener('click', () => location.reload());
    message.append(' ', button);
  }
}

// Keeps the canvas backing store matched to its on-screen size (max 2048).
function fitCanvas(): void {
  const resize = () => {
    const size = Math.max(1, Math.min(2048, Math.round(canvas.getBoundingClientRect().width * devicePixelRatio)));
    canvas.width = size;
    canvas.height = size;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
}

async function start(): Promise<void> {
  onShaderError(text => showMessage(text));
  const gpu = await initGpu();
  if (!gpu.ok) {
    canvas.hidden = true;
    showMessage(gpu.reason);
    return;
  }
  const { device } = gpu;
  device.addEventListener('uncapturederror', event => console.error((event as GPUUncapturedErrorEvent).error.message));
  void device.lost.then(info => {
    if (info.reason !== 'destroyed') showMessage(`The GPU device was lost: ${info.message}`, true);
  });

  const context = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  fitCanvas();

  const app = new App(device, context, format, seedFromUrl(location.search, DEFAULT_PARAMS.rngSeed));
  let last = performance.now();
  const loop = (now: number) => {
    app.frame(now - last);
    last = now;
    document.body.dataset.ready = 'true';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void start();
