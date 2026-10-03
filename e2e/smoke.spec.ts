import { test, expect } from '@playwright/test';

test('loads, renders, and logs no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#field')).toBeVisible();
  await expect(page.locator('#message')).toBeHidden();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('shows a message when WebGPU is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined });
  });
  await page.goto('/');
  await expect(page.locator('#message')).toContainText('WebGPU is not available');
  await expect(page.locator('#field')).toBeHidden();
});
