import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

const PALETTE_HUES = [0, 45, 90, 135, 180, 225, 270, 315];

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=7');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.getByRole('button', { name: 'play / pause' }).click(); // starts playing; pause it
}

async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#field').boundingBox())!;
  const s = box.width / 128;
  await page.mouse.click(box.x + (x + 0.5) * s, box.y + (y + 0.5) * s);
}

async function cellPixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = PNG.sync.read(await page.locator('#field').screenshot());
  const s = shot.width / 128;
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
