import { expect, test } from '@playwright/test';
import { ask, createDesign, levelNames } from './helpers';

test('describes a house, then sees it from outside, as a dollhouse, walking and in plan @ipad', async ({ page }) => {
  await createDesign(page, 'A stone cottage on a little island with two bedrooms and a porch facing the water');
  await expect(page.getByTestId('view-exterior')).toBeVisible();
  await page.getByTestId('view-dollhouse').click();
  await page.getByTestId('view-plan').click();
  await expect(page.getByTestId('plan-svg')).toBeVisible();
  await expect(page.locator('[data-kind="window"]').first()).toBeVisible();
  await page.getByTestId('view-walk').click();
  await expect(page.getByTestId('walk-where')).toContainText('Outside');
  // Jump inside with the "Go to" menu.
  await page.getByTestId('walk-where').click();
  await page.getByRole('button', { name: /^Kitchen/ }).first().click();
  await expect(page.getByTestId('walk-where')).toContainText('Kitchen');
});

test('adds a third story, and undo takes it back', async ({ page }) => {
  await createDesign(page, 'A white two-story farmhouse with a metal roof');
  expect(await levelNames(page)).toHaveLength(2);
  await ask(page, 'Add a third story', /third floor/i);
  expect(await levelNames(page)).toHaveLength(3);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('level-name')).toHaveCount(2);
});

test('trades the second story for a bigger first floor', async ({ page }) => {
  await createDesign(page, 'A white two-story farmhouse with a metal roof');
  await ask(page, 'Remove the second story and expand the first floor by 1,000 square feet', /1,000/);
  expect(await levelNames(page)).toHaveLength(1);
});

test('moves the sink to the island', async ({ page }) => {
  await createDesign(page, 'A two-story farmhouse with a big kitchen');
  await ask(page, 'Move the sink to the island', /island/i);
  await page.getByTestId('view-plan').click();
  await expect(page.locator('[data-fixture="island_sink"]')).toHaveCount(1);
  await expect(page.locator('[data-fixture="sink"]')).toHaveCount(0);
});

test('taps a window and makes it bigger @ipad', async ({ page }) => {
  await createDesign(page, 'A cozy cottage in the woods');
  await page.getByTestId('view-plan').click();
  const win = page.locator('[data-kind="window"]').first();
  const before = Number(await win.getAttribute('data-width'));
  await win.click();
  await expect(page.getByText('Talking about')).toBeVisible();
  await ask(page, 'Make this bigger', /bigger/i);
  const widths = (await page.locator('[data-kind="window"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-width')))));
  expect(widths).toContain(before + 1);
  // Still talking about the same window, even though editing pinned it under a new id.
  await expect(page.getByText('Talking about')).toBeVisible();
});

test('exports a PDF plan set and a DXF', async ({ page }) => {
  await createDesign(page, 'A lake house with a wraparound porch');
  for (const [kind, magic] of [
    ['pdf', '%PDF'],
    ['dxf', '0\nSECTION'],
  ] as const) {
    await page.getByTestId('export').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId(`export-${kind}`).click()]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    expect(body.length).toBeGreaterThan(20_000);
    expect(body.subarray(0, magic.length).toString('latin1')).toBe(magic);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Export' })).toHaveCount(0);
  }
});
