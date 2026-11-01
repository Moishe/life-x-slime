import { test, expect } from '@playwright/test';

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
