import './style.css';
import { App } from './app/app';
import { DEFAULT_SETTINGS, FIELD_SIZE, seedFromUrl, sizeFromUrl } from './app/settings';
import { parseSettings, serializeSettings } from './app/settings-file';
import { initGpu } from './gpu/device';
import { onShaderError } from './gpu/shader';
import type { Cell } from './life/engine';
import { DEFAULT_PARAMS } from './physarum/params';
import { buildPanel } from './ui/panel';
import { buildPatternBar, type Tool } from './ui/pattern-bar';
import { cellFromPointer, ghostCells } from './ui/placement';
import { downloadBlob, encodePng, snapshotFilenames } from './ui/export-images';
import { createReadouts } from './ui/readouts';
import { chooseMovieConfig, movieFilename, movieNotice, recordingStatus } from './record/movie-config';
import { canEncodeVideo } from 'mediabunny';
import type { Controller } from 'lil-gui';

const canvas = document.querySelector<HTMLCanvasElement>('#field')!;
const message = document.querySelector<HTMLDivElement>('#message')!;

// Shows a message over the canvas. Fatal problems offer Reload; recoverable
// ones (like a bad settings file) offer Close.
function showMessage(text: string, action: 'none' | 'reload' | 'close' = 'none'): void {
  // Append when already visible so several errors can all be read.
  if (message.hidden) message.textContent = text;
  else message.append('\n', text);
  message.hidden = false;
  if (action === 'none') return;
  const button = document.createElement('button');
  button.textContent = action === 'reload' ? 'Reload' : 'Close';
  button.addEventListener('click', () => {
    if (action === 'reload') {
      location.reload();
    } else {
      message.hidden = true;
      message.textContent = '';
    }
  });
  message.append(' ', button);
}

const SETTINGS_FILENAME = 'life-x-physarum-settings.json';

function saveSettingsFile(app: App): void {
  downloadBlob(new Blob([serializeSettings(app.settings, app.sim.params)], { type: 'application/json' }), SETTINGS_FILENAME);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Start/end recording, keeping the two buttons' enabled state in step.
function createMovieControls(app: App, startButton: Controller, endButton: Controller) {
  let startedAt = new Date();

  const reset = () => {
    startButton.enable();
    endButton.disable();
  };

  app.onRecordingError = error => {
    reset();
    showMessage(`Recording stopped: ${errorText(error)}`, 'close');
  };

  return {
    async start(): Promise<void> {
      if (!('VideoEncoder' in window)) {
        showMessage('This browser cannot record video.', 'close');
        return;
      }
      startButton.disable();
      try {
        const config = await chooseMovieConfig((codec, size, bitrate) => canEncodeVideo(codec, { width: size, height: size, bitrate }));
        if (!config) {
          showMessage('This browser cannot record video.', 'close');
          reset();
          return;
        }
        const notice = movieNotice(config);
        if (notice) showMessage(notice, 'close');
        startedAt = new Date();
        await app.startRecording(config);
        endButton.enable();
      } catch (error) {
        reset();
        showMessage(`Could not start recording: ${errorText(error)}`, 'close');
      }
    },
    async end(): Promise<void> {
      endButton.disable();
      try {
        downloadBlob(await app.finishRecording(), movieFilename(startedAt));
      } catch (error) {
        showMessage(`Could not finish the movie: ${errorText(error)}`, 'close');
      }
      reset();
    },
  };
}

// Downloads the Life layer, the Physarum trail and their mix as three PNGs.
async function saveImages(app: App): Promise<void> {
  try {
    const names = snapshotFilenames(new Date());
    const images = await app.snapshot();
    for (const part of ['life', 'physarum', 'mix'] as const) {
      downloadBlob(await encodePng(images[part], FIELD_SIZE), names[part]);
    }
  } catch (error) {
    showMessage(`Could not save images: ${errorText(error)}`, 'close');
  }
}

// Asks for a settings file, applies it, and calls `onApplied` so the panel can refresh.
function loadSettingsFile(app: App, poolSizes: number[], onApplied: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const loaded = parseSettings(await file.text(), poolSizes);
      app.applySettings(loaded);
      onApplied();
      if (loaded.warnings.length > 0) showMessage(`Loaded ${file.name} with problems:\n${loaded.warnings.join('\n')}`, 'close');
    } catch (error) {
      showMessage(errorText(error), 'close');
    }
  });
  input.click();
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

function attachUi(app: App, poolSizes: number[]): void {
  const gui = buildPanel(app.settings, app.sim.params, poolSizes, {
    playPause: () => {
      app.settings.playing = !app.settings.playing;
    },
    step: () => app.lifeTick(),
    clear: () => app.editWorld(w => w.clear()),
    randomFill: () => app.editWorld(w => w.randomFill(app.settings.randomDensity)),
    clearTrail: () => app.sim.clearTrail(),
    clearFood: () => app.sim.clearFood(),
    clearActors: () => app.clearActors(),
    poolSizeChanged: n => app.setPoolSize(n),
    lifeSizeChanged: n => app.setLifeSize(n),
    seedChanged: seed => app.reseed(seed),
    saveSettings: () => saveSettingsFile(app),
    saveImages: () => void saveImages(app),
    startRecording: () => void movie.start(),
    endRecording: () => void movie.end(),
    loadSettings: () => loadSettingsFile(app, poolSizes, () => gui.controllersRecursive().forEach(c => c.updateDisplay())),
  });

  const button = (property: string) => gui.controllersRecursive().find(c => c.property === property)!;
  const movie = createMovieControls(app, button('startRecording'), button('endRecording'));

  let tool: Tool = { kind: 'paint' };
  let quarterTurns = 0;
  let hover: Cell | null = null;
  const refreshGhost = () => {
    const pattern = tool.kind === 'pattern' ? tool.pattern : null;
    app.setGhost(hover ? ghostCells(pattern, quarterTurns, hover, app.settings.lifeSize) : []);
  };

  buildPatternBar(document.querySelector<HTMLElement>('#patterns')!, selected => {
    tool = selected;
    quarterTurns = 0;
    refreshGhost();
  });

  canvas.addEventListener('pointermove', e => {
    hover = cellFromPointer(e.clientX, e.clientY, canvas.getBoundingClientRect(), app.settings.lifeSize);
    refreshGhost();
  });
  canvas.addEventListener('pointerleave', () => {
    hover = null;
    refreshGhost();
  });
  canvas.addEventListener('click', e => {
    const cell = cellFromPointer(e.clientX, e.clientY, canvas.getBoundingClientRect(), app.settings.lifeSize);
    if (!cell) return;
    const current = tool;
    app.editWorld(w => {
      if (current.kind === 'pattern') w.place(current.pattern, cell.x, cell.y, quarterTurns);
      else w.toggle(cell.x, cell.y);
    });
  });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const key = e.key.toLowerCase();
    if (key === 'r') {
      quarterTurns = (quarterTurns + 1) % 4;
      refreshGhost();
    } else if (key === 't') {
      app.settings.foodView = !app.settings.foodView;
      gui.controllersRecursive().forEach(c => c.updateDisplay());
    }
    // Capture phase: lil-gui stops keydown propagation from inside the panel.
  }, true);

  const updateReadouts = createReadouts(document.querySelector<HTMLElement>('#readouts')!);
  const readoutTimer = setInterval(async () => {
    try {
      await app.pollCounters();
      const now = performance.now();
      updateReadouts({
        fps: app.stats.frames.sample(now),
        physStepsPerSec: app.stats.physSteps.sample(now),
        alive: app.alive,
        organisms: app.world.organismCount(),
        lifeInsertsPerSec: app.stats.lifeInserts.sample(now),
        childInsertsPerSec: app.stats.childInserts.sample(now),
        recording: recordingStatus(app.recordedFrames),
      });
    } catch (error) {
      clearInterval(readoutTimer);
      console.error('Readout polling stopped:', error);
    }
  }, 250);
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
    if (info.reason !== 'destroyed') showMessage(`The GPU device was lost: ${info.message}`, 'reload');
  });

  const context = canvas.getContext('webgpu')!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  fitCanvas();

  const app = new App(
    device, context,
    seedFromUrl(location.search, DEFAULT_PARAMS.rngSeed),
    sizeFromUrl(location.search, DEFAULT_SETTINGS.lifeSize),
  );
  attachUi(app, gpu.poolSizes);

  let last = performance.now();
  const loop = (now: number) => {
    try {
      app.frame(now - last);
    } catch (error) {
      showMessage(`Rendering stopped: ${errorText(error)}`);
      return;
    }
    last = now;
    document.body.dataset.ready = 'true';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start().catch(error => showMessage(`Failed to start: ${errorText(error)}`));
