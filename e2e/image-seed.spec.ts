import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

// Types a value into a lil-gui number control, found by its exact label.
async function setNumber(page: Page, label: string, value: number): Promise<void> {
  const input = page.getByRole('textbox', { name: label, exact: true });
  await input.fill(String(value));
  await input.press('Enter');
}

// A PNG whose left half is one color and right half another.
function halvesPng(width: number, height: number, left = [255, 0, 0], right = [0, 0, 255]): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      png.data.set([...(x < width / 2 ? left : right), 255], (y * width + x) * 4);
    }
  }
  return PNG.sync.write(png);
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

// Average color of a block of the field around a fractional position.
async function regionColor(page: Page, fx: number, fy: number): Promise<[number, number, number]> {
  const shot = PNG.sync.read(await page.locator('#field').screenshot());
  const half = 20;
  const cx = Math.floor(fx * shot.width);
  const cy = Math.floor(fy * shot.height);
  const sum = [0, 0, 0];
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      const o = (y * shot.width + x) * 4;
      sum[0] += shot.data[o];
      sum[1] += shot.data[o + 1];
      sum[2] += shot.data[o + 2];
    }
  }
  const n = (2 * half) ** 2;
  return [sum[0] / n, sum[1] / n, sum[2] / n];
}

const alive = (page: Page) => async () => Number(await page.getByTestId('readout-alive').textContent());

test('an uploaded image seeds actors in its colors where it sits on the field', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('seed-source').locator('select').selectOption('image');
  await setNumber(page, 'seed density (%)', 5);
  await page.getByRole('button', { name: 'random fill' }).click(); // Life must stay still in image mode
  const organisms = page.getByTestId('readout-organisms');
  await expect.poll(async () => Number(await organisms.textContent())).toBeGreaterThan(0);
  const organismsBefore = await organisms.textContent();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'choose image' }).click();
  await (await chooser).setFiles({ name: 'halves.png', mimeType: 'image/png', buffer: halvesPng(64, 32) });

  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  expect(await organisms.textContent()).toBe(organismsBefore);
  const left = await regionColor(page, 0.25, 0.5);
  const right = await regionColor(page, 0.75, 0.5);
  const margin = await regionColor(page, 0.5, 0.08);
  expect(left[0]).toBeGreaterThan(5);
  expect(left[0]).toBeGreaterThan(left[2] * 3);
  expect(right[2]).toBeGreaterThan(5);
  expect(right[2]).toBeGreaterThan(right[0] * 3);
  expect(Math.max(...margin)).toBeLessThan(20);
});

test('in hybrid mode Life births take the image color under their cell', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'play / pause' }).click(); // pause Life so only our step runs
  await setNumber(page, 'lifeOpacity', 0); // hide the Life layer so only the trail is sampled
  await page.getByTestId('seed-source').locator('select').selectOption('hybrid');

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'choose image' }).click();
  // Left hue 15 (orange-red), right hue 200 (sky blue); neither is a rainbow palette hue.
  await (await chooser).setFiles({ name: 'halves.png', mimeType: 'image/png', buffer: halvesPng(64, 64, [255, 64, 0], [0, 170, 255]) });

  const box = (await page.locator('#field').boundingBox())!;
  const cell = box.width / 128;
  await page.getByRole('button', { name: 'Glider', exact: true }).click();
  await page.mouse.click(box.x + 30.5 * cell, box.y + 64.5 * cell);
  await page.mouse.click(box.x + 98.5 * cell, box.y + 64.5 * cell);
  await expect(page.getByTestId('readout-organisms')).toHaveText('2');
  await page.getByRole('button', { name: 'step', exact: true }).click();
  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  expect(await alive(page)()).toBeLessThan(2000); // choosing the image did not seed from it
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);

  const left = await regionColor(page, 31 / 128, 65 / 128);
  const right = await regionColor(page, 99 / 128, 65 / 128);
  expect(Math.max(...left)).toBeGreaterThan(5);
  expect(hueDiff(hueDegrees(left), 15)).toBeLessThan(12);
  expect(Math.max(...right)).toBeGreaterThan(5);
  expect(hueDiff(hueDegrees(right), 200)).toBeLessThan(12);
});

test('a steep intensity curve seeds only the bright part of the image', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('seed-source').locator('select').selectOption('image');
  await setNumber(page, 'seed density (%)', 5);
  await setNumber(page, 'intensity steepness', 20);
  await setNumber(page, 'intensity midpoint', 0.9);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'choose image' }).click();
  // Left half mid grey, which unweighted seeding would light up; right half white.
  await (await chooser).setFiles({ name: 'halves.png', mimeType: 'image/png', buffer: halvesPng(64, 32, [100, 100, 100], [255, 255, 255]) });

  await expect.poll(alive(page), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const left = await regionColor(page, 0.25, 0.5);
  const right = await regionColor(page, 0.75, 0.5);
  expect(Math.max(...right)).toBeGreaterThan(5);
  expect(Math.max(...left)).toBeLessThan(2);
});
