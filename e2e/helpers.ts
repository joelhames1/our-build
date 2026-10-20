import { type Page, expect } from '@playwright/test';

/** Start a new design from a description and wait for the first sketch. */
export async function createDesign(page: Page, brief: string) {
  await page.goto('/');
  await page.getByLabel('Describe your design').fill(brief);
  await page.getByRole('button', { name: /Begin/ }).click();
  await page.waitForURL(/\/p\//);
  await expect(page.getByTestId('assistant-reply')).toContainText(/first sketch/i, { timeout: 90_000 });
  // Reload in test mode (no ambient occlusion or animation) so software WebGL keeps up.
  await page.goto(`${page.url().split('?')[0]}?test=1`);
  await expect(page.getByTestId('composer-input')).toBeVisible();
}

/** Type a request, send it, and wait for the reply that matches. */
export async function ask(page: Page, text: string, reply: RegExp) {
  const input = page.getByTestId('composer-input');
  await input.fill(text);
  await page.getByTestId('send').click();
  await expect(page.getByTestId('assistant-reply')).toContainText(reply, { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
}

export async function levelNames(page: Page): Promise<string[]> {
  if (!(await page.getByTestId('level-name').first().isVisible().catch(() => false))) {
    await page.getByTestId('details-toggle').click();
    await page.getByTestId('tab-overview').click();
  }
  return page.getByTestId('level-name').allInnerTexts();
}
