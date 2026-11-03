import { test, expect, type Page } from '@playwright/test';

const intervalControl = (page: Page) => page.getByTestId('capture-interval');

// Drags the capture interval slider to a fraction of its width; 0 and 1 drag
// past the ends, which the slider clamps.
async function dragIntervalTo(page: Page, fraction: number): Promise<void> {
  const box = (await intervalControl(page).locator('.lil-slider').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * fraction + (fraction === 0 ? -5 : fraction === 1 ? 5 : 0), y, { steps: 3 });
  await page.mouse.up();
}

// Chromium's fake camera (see playwright.config.ts) shows a moving test pattern.
test.use({ permissions: ['camera'] });

test('a captured webcam frame seeds actors and switches to image seeding', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const alive = page.getByTestId('readout-alive');
  await expect(alive).toHaveText('0');

  await page.getByRole('button', { name: 'use webcam' }).click();
  const preview = page.locator('#webcam video');
  await expect(preview).toBeVisible();
  const capture = page.getByRole('button', { name: 'capture' });
  await expect(capture).toBeEnabled();
  await capture.click();

  await expect(page.locator('#webcam')).toHaveCount(0);
  await expect(page.getByTestId('seed-source').locator('select')).toHaveValue('image');
  await expect.poll(async () => Number(await alive.textContent()), { timeout: 5000 }).toBeGreaterThan(0);
  await expect(page.locator('#message')).toBeHidden();
});

test('cancelling the webcam preview leaves the field untouched', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');

  await page.getByRole('button', { name: 'use webcam' }).click();
  await expect(page.locator('#webcam video')).toBeVisible();
  await page.getByRole('button', { name: 'cancel' }).click();

  await expect(page.locator('#webcam')).toHaveCount(0);
  await expect(page.getByTestId('seed-source').locator('select')).toHaveValue('life');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('readout-alive')).toHaveText('0');
});

test('auto capture reseeds from the webcam at the chosen interval and W toggles it', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await page.locator('.lil-controller', { hasText: 'spawnMode' }).locator('select').selectOption('burst');
  await dragIntervalTo(page, 0.5); // a capture every 0.46 s
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // move focus off the panel
  const alive = page.getByTestId('readout-alive');
  const auto = page.locator('.lil-controller', { hasText: 'auto capture' }).locator('input[type="checkbox"]');
  await expect(auto).not.toBeChecked();

  await auto.click();
  await expect(page.getByTestId('seed-source').locator('select')).toHaveValue('image');
  await expect.poll(async () => Number(await alive.textContent()), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  const afterFirst = Number(await alive.textContent());
  await expect.poll(async () => Number(await alive.textContent()), { timeout: 5000 }).toBeGreaterThan(afterFirst * 1.5);

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('w');
  await expect(auto).not.toBeChecked();
  await page.keyboard.press('w');
  await expect(auto).toBeChecked();
  await page.keyboard.press('w');
  await expect(auto).not.toBeChecked();
  await expect(page.locator('#message')).toBeHidden();
});

test('the capture interval slider runs logarithmically from 24 fps to every 5 seconds', async ({ page }) => {
  await page.goto('/?seed=7&size=128');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const label = intervalControl(page).locator('.lil-name');
  await expect(label).toHaveText('capture every 5 s');
  await expect(intervalControl(page).locator('input')).toBeHidden();

  await dragIntervalTo(page, 0.5);
  await expect(label).toHaveText(/^capture every [1-3]\.\d fps$/); // a linear slider would read 2.5 s here
  await dragIntervalTo(page, 0);
  await expect(label).toHaveText('capture every 24 fps');
  await dragIntervalTo(page, 1);
  await expect(label).toHaveText('capture every 5 s');
});
