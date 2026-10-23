import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const PALETTE_HUES = [0, 45, 90, 135, 180, 225, 270, 315];

// Life board size the cell helpers map to; boot() sets it.
let grid = 128;

// Types a value into a lil-gui number control, found by its label.
async function setNumber(page: Page, label: string, value: number): Promise<void> {
  const input = page.locator('.lil-controller', { hasText: label }).locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

async function boot(page: Page, size = 128): Promise<void> {
  grid = size;
  await page.goto(`/?seed=7&size=${size}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'play / pause' }).click(); // starts playing; pause it
  // Color checks need Life cells clearly visible over the trail.
  await setNumber(page, 'lifeOpacity', 0.6);
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // move focus off the panel input
}

async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#field').boundingBox())!;
  const s = box.width / grid;
  await page.mouse.click(box.x + (x + 0.5) * s, box.y + (y + 0.5) * s);
}

async function cellPixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = PNG.sync.read(await page.locator('#field').screenshot());
  const s = shot.width / grid;
  const o = (Math.floor((y + 0.5) * s) * shot.width + Math.floor((x + 0.5) * s)) * 4;
  return [shot.data[o], shot.data[o + 1], shot.data[o + 2]];
}

function hueDegrees([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

const alive = (page: Page) => async () => Number(await page.getByTestId('readout-alive').textContent());

test('a placed glider is one organism and spawns actors in its color', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await expect(page.getByTestId('readout-organisms')).toHaveText('1');
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.mouse.move(0, 0); // leave the canvas so the ghost disappears
  await page.waitForTimeout(200);
  // (61, 62) is alive in both the first and second glider phases.
  const rgb = await cellPixel(page, 61, 62);
  expect(Math.max(...rgb)).toBeGreaterThan(100);
  expect(Math.min(...PALETTE_HUES.map(h => hueDiff(h, hueDegrees(rgb))))).toBeLessThan(12);
});

test('dead Life cells leave food in their organism color', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Blinker', exact: true }).click();
  await clickCell(page, 60, 64); // cells (60..62, 64)
  await page.getByRole('button', { name: 'step', exact: true }).click(); // (60,64) and (62,64) die
  await page.mouse.move(0, 0);
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  const live = await cellPixel(page, 61, 64); // still alive: Life color, no food beneath
  const food = await cellPixel(page, 60, 64); // died: food only
  expect(Math.max(...food)).toBeGreaterThan(60);
  expect(hueDiff(hueDegrees(food), hueDegrees(live))).toBeLessThan(12);
});

test('changing the pool size clears the actors', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.getByTestId('pool-size').locator('select').selectOption({ label: '16384' });
  await expect.poll(alive(page), { timeout: 5000 }).toBe(0);
});

const isGhostTinted = ([r, , b]: [number, number, number]) => b > 100 && b > r + 50;

async function hoverCell(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#field').boundingBox())!;
  const s = box.width / grid;
  await page.mouse.move(box.x + (x + 0.5) * s, box.y + (y + 0.5) * s);
}

test('R rotates the placement ghost', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Blinker', exact: true }).click();
  await hoverCell(page, 60, 64);
  await page.waitForTimeout(200);
  expect(isGhostTinted(await cellPixel(page, 61, 64))).toBe(true);
  expect(isGhostTinted(await cellPixel(page, 60, 65))).toBe(false);
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  expect(isGhostTinted(await cellPixel(page, 60, 65))).toBe(true);
  expect(isGhostTinted(await cellPixel(page, 61, 64))).toBe(false);
});

test('paint mode toggles a cell', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Paint cells', exact: true }).click();
  await clickCell(page, 30, 30);
  await expect(page.getByTestId('readout-organisms')).toHaveText('1');
  await clickCell(page, 30, 30);
  await expect(page.getByTestId('readout-organisms')).toHaveText('0');
});

test('placing a pattern spawns no actors until a Life step', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('readout-alive')).toHaveText('0');
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
});

test('hotkeys are ignored while typing in a panel input', async ({ page }) => {
  await boot(page);
  const foodView = page.locator('.lil-gui .lil-controller', { hasText: 'food view' }).locator('input[type="checkbox"]');
  await expect(foodView).not.toBeChecked();
  await page.locator('.lil-gui .lil-controller', { hasText: 'lookDistance' }).locator('input[type="text"], input[type="number"]').first().focus();
  await page.keyboard.press('t');
  await page.waitForTimeout(200);
  await expect(foodView).not.toBeChecked();
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // move focus off the input
  await page.keyboard.press('t');
  await expect(foodView).toBeChecked();
});

test('changing the board size clears the board and rescales placement', async ({ page }) => {
  await boot(page, 128);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await expect(page.getByTestId('readout-organisms')).toHaveText('1');
  await page.getByTestId('board-size').locator('select').selectOption({ label: '256' });
  await expect(page.getByTestId('readout-organisms')).toHaveText('0');
  grid = 256;
  await clickCell(page, 120, 120); // glider cells (121,120) (122,121) (120,122) (121,122) (122,122)
  await expect(page.getByTestId('readout-organisms')).toHaveText('1');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  expect(Math.max(...(await cellPixel(page, 121, 120)))).toBeGreaterThan(100);
  expect(Math.max(...(await cellPixel(page, 121, 121)))).toBeLessThan(40);
});

test('starts at 64x64 and keeps running with a randomly filled board', async ({ page }) => {
  await page.goto('/?seed=7');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('board-size').locator('select')).toHaveValue(/./);
  expect(await page.getByTestId('board-size').locator('select option:checked').textContent()).toBe('64');
  await page.getByRole('button', { name: 'random fill' }).click();
  await expect.poll(async () => Number(await page.getByTestId('readout-organisms').textContent())).toBeGreaterThan(5);
  await page.waitForTimeout(3000);
  expect(Number(await page.getByTestId('readout-fps').textContent())).toBeGreaterThan(10);
  expect(Number(await page.getByTestId('readout-steps').textContent())).toBeGreaterThan(10);
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
});

test('save settings downloads the current panel values', async ({ page }) => {
  await boot(page, 128);
  await setNumber(page, 'lookDistance', 23);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'save settings' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('life-x-physarum-settings.json');
  const data = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(data.version).toBe(1);
  expect(data.physarum.lookDistance).toBe(23);
  expect(data.settings.lifeSize).toBe(128);
  expect(data.settings.lifeOpacity).toBe(0.6);
  expect(data.settings).not.toHaveProperty('playing');
});

async function loadSettingsFile(page: Page, contents: string): Promise<void> {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'load settings' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
}

test('load settings applies the file to the panel and the board', async ({ page }) => {
  await boot(page, 128);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60);
  await expect(page.getByTestId('readout-organisms')).toHaveText('1');
  await loadSettingsFile(page, JSON.stringify({ version: 1, settings: { lifeSize: 256 }, physarum: { lookDistance: 33 } }));
  await expect(page.locator('.lil-controller', { hasText: 'lookDistance' }).locator('input')).toHaveValue('33');
  await expect(page.getByTestId('board-size').locator('select option:checked')).toHaveText('256');
  await expect(page.getByTestId('readout-organisms')).toHaveText('0');
  await expect(page.locator('#message')).toBeHidden();
});

test('loading a bad settings file shows a message that can be closed', async ({ page }) => {
  await boot(page, 128);
  await loadSettingsFile(page, 'not json {');
  await expect(page.locator('#message')).toContainText('This file is not a Life x Physarum settings file.');
  await page.locator('#message').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#message')).toBeHidden();
});

test('save images downloads the Life, Physarum and mixed images at full size', async ({ page }) => {
  await boot(page, 128);
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await clickCell(page, 60, 60); // live cells include (61, 60)
  await page.mouse.move(0, 0);
  const downloads: Map<string, Buffer> = new Map();
  const collected = new Promise<void>(resolve => {
    page.on('download', async download => {
      downloads.set(download.suggestedFilename(), await readFile(await download.path()));
      if (downloads.size === 3) resolve();
    });
  });
  await page.getByRole('button', { name: 'save images' }).click();
  await collected;

  const names = [...downloads.keys()].sort();
  expect(names).toHaveLength(3);
  for (const [name, suffix] of names.map((n, i) => [n, ['life', 'mix', 'physarum'][i]])) {
    expect(name).toMatch(new RegExp(`^life-x-physarum-\\d{4}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-\\d{2}-${suffix}\\.png$`));
  }
  const image = (suffix: string) => PNG.sync.read(downloads.get(names.find(n => n.endsWith(`-${suffix}.png`))!)!);
  const at = (png: PNG, cellX: number, cellY: number) => {
    const s = png.width / grid;
    const o = (Math.floor((cellY + 0.5) * s) * png.width + Math.floor((cellX + 0.5) * s)) * 4;
    return [png.data[o], png.data[o + 1], png.data[o + 2]];
  };
  const life = image('life');
  const physarum = image('physarum');
  const mix = image('mix');
  for (const png of [life, physarum, mix]) expect([png.width, png.height]).toEqual([2048, 2048]);

  // Life image: the live cell is a fully saturated palette color; an empty cell is black.
  const cell = at(life, 61, 60);
  expect(Math.max(...cell)).toBe(255);
  expect(Math.min(...PALETTE_HUES.map(h => hueDiff(h, hueDegrees(cell as [number, number, number]))))).toBeLessThan(2);
  expect(at(life, 10, 10)).toEqual([0, 0, 0]);
  // Physarum image: no actors yet (Life is paused), so the trail under the cell is empty.
  expect(at(physarum, 61, 60)).toEqual([0, 0, 0]);
  // Mix image: Life at the panel's 0.6 opacity over the empty trail.
  at(mix, 61, 60).forEach((v, i) => expect(Math.abs(v - Math.round(cell[i] * 0.6))).toBeLessThanOrEqual(2));
});

test('recording downloads an MP4 and toggles the start and end buttons', async ({ page }) => {
  await boot(page, 128);
  const start = page.getByRole('button', { name: 'start recording' });
  const end = page.getByRole('button', { name: 'end recording' });
  await expect(start).toBeEnabled();
  await expect(end).toBeDisabled();
  await expect(page.getByTestId('readout-recording')).toHaveText('off');

  await start.click();
  await expect(end).toBeEnabled();
  await expect(start).toBeDisabled();
  await expect(page.getByTestId('readout-recording')).toHaveText(/^\d+\.\d s \(\d+ frames\)$/);
  await page.waitForTimeout(1000);

  const downloadPromise = page.waitForEvent('download');
  await end.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^life-x-physarum-\d{4}(-\d{2}){5}\.mp4$/);
  const bytes = await readFile(await download.path());
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
  await expect(start).toBeEnabled();
  await expect(end).toBeDisabled();
  await expect(page.getByTestId('readout-recording')).toHaveText('off');
});

// Types a value into the lil-gui number control whose label is exactly `name`.
async function setNamed(page: Page, name: string, value: number): Promise<void> {
  const input = page.locator('.lil-controller', { has: page.locator('.lil-name', { hasText: new RegExp(`^${name}$`) }) }).locator('input');
  await input.fill(String(value));
  await input.press('Enter');
}

async function fieldPixels(page: Page): Promise<Uint8Array> {
  return PNG.sync.read(await page.locator('#field').screenshot()).data;
}

const differingPixels = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) n++;
  return n;
};

test('relief shading changes the rendered field once actors have piled up', async ({ page }) => {
  await page.goto('/?seed=7&size=64');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'random fill' }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'play / pause' }).click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const flat = await fieldPixels(page);
  await setNamed(page, 'relief', 1);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  const shaded = await fieldPixels(page);
  expect(differingPixels(flat, shaded)).toBeGreaterThan(flat.length / 4 / 100);
  await setNamed(page, 'relief', 0);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(300);
  // Actors keep moving, so allow drift, but turning relief off must undo most of the change.
  expect(differingPixels(flat, await fieldPixels(page))).toBeLessThan(differingPixels(flat, shaded) / 4);
});

test('relief settings are saved to and loaded from the settings file', async ({ page }) => {
  await boot(page, 128);
  await setNamed(page, 'relief', 0.4);
  await setNamed(page, 'lightAngle', 2.5);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'save settings' }).click();
  const data = JSON.parse(await readFile(await (await downloadPromise).path(), 'utf8'));
  expect(data.settings.relief).toBe(0.4);
  expect(data.settings.lightAngle).toBe(2.5);
  await loadSettingsFile(page, JSON.stringify({ version: 1, settings: { relief: 0.7, heightDecay: 0.05 }, physarum: {} }));
  await expect(page.locator('.lil-controller', { has: page.locator('.lil-name', { hasText: /^relief$/ }) }).locator('input')).toHaveValue('0.7');
  await expect(page.locator('.lil-controller', { has: page.locator('.lil-name', { hasText: /^heightDecay$/ }) }).locator('input')).toHaveValue('0.05');
  await expect(page.locator('#message')).toBeHidden();
});
