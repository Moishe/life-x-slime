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

test('the field has a visible outline that stays inside the window and does not shift clicks', async ({ page }) => {
  await page.goto('/?seed=7&size=64');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  const field = page.locator('#field');
  const outline = await field.evaluate(el => {
    const s = getComputedStyle(el);
    return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, color: s.outlineColor };
  });
  expect(outline.width).toBeGreaterThanOrEqual(1);
  expect(outline.style).not.toBe('none');
  expect(outline.color).not.toBe('rgb(0, 0, 0)');
  const box = (await field.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y - outline.width).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height + outline.width).toBeLessThanOrEqual(viewport.height);
  expect(box.x + box.width + outline.width).toBeLessThanOrEqual(viewport.width);
  // The outline must not move the canvas's pointer mapping: the top-left and
  // bottom-left corner cells are still at the corners. (The right edge sits
  // under the control panel.) Toggling each on then off proves both clicks landed.
  await page.getByRole('button', { name: 'play / pause' }).click();
  await page.getByRole('button', { name: 'Paint cells', exact: true }).click();
  const s = box.width / 64;
  for (const cellY of [0, 63]) {
    await page.mouse.click(box.x + 0.5 * s, box.y + (cellY + 0.5) * s);
    await expect(page.getByTestId('readout-organisms')).toHaveText('1');
    await page.mouse.click(box.x + 0.5 * s, box.y + (cellY + 0.5) * s);
    await expect(page.getByTestId('readout-organisms')).toHaveText('0');
  }
});
