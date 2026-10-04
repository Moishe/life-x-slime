import './style.css';
import { App } from './app/app';
import { DEFAULT_SETTINGS, seedFromUrl, sizeFromUrl } from './app/settings';
import { parseSettings, serializeSettings } from './app/settings-file';
import { initGpu } from './gpu/device';
import { onShaderError } from './gpu/shader';
import type { Cell } from './life/engine';
import { DEFAULT_PARAMS } from './physarum/params';
import { buildPanel } from './ui/panel';
import { buildPatternBar, type Tool } from './ui/pattern-bar';
import { cellFromPointer, ghostCells } from './ui/placement';
import { createReadouts } from './ui/readouts';

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
  const blob = new Blob([serializeSettings(app.settings, app.sim.params)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = SETTINGS_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
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
      showMessage(error instanceof Error ? error.message : String(error), 'close');
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
    loadSettings: () => loadSettingsFile(app, poolSizes, () => gui.controllersRecursive().forEach(c => c.updateDisplay())),
  });

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
    device, context, format,
    seedFromUrl(location.search, DEFAULT_PARAMS.rngSeed),
    sizeFromUrl(location.search, DEFAULT_SETTINGS.lifeSize),
  );
  attachUi(app, gpu.poolSizes);

  let last = performance.now();
  const loop = (now: number) => {
    try {
      app.frame(now - last);
    } catch (error) {
      showMessage(`Rendering stopped: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    last = now;
    document.body.dataset.ready = 'true';
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start().catch(error => showMessage(`Failed to start: ${error instanceof Error ? error.message : String(error)}`));
