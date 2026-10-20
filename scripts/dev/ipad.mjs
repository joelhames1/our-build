// iPad layout check. Usage: node scripts/dev/ipad.mjs <outDir> [base]
import { chromium, devices } from '@playwright/test';

const [out, base = 'http://localhost:3100'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, dev] of [['portrait', devices['iPad Pro 11']], ['landscape', devices['iPad Pro 11 landscape']]]) {
  const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && logs.push(`console: ${m.text()}`));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${out}/ipad-${name}-home.png` });
  await page.getByLabel('Describe your design').fill('A cozy cottage on an island with a stone chimney');
  await page.getByRole('button', { name: /Begin/ }).tap();
  await page.waitForURL(/\/p\//);
  await page.getByTestId('assistant-reply').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  // Test mode: no AO or shadows, so the software GPU here can keep up.
  await page.goto(page.url().split('?')[0] + '?test=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/ipad-${name}-studio.png` });
  await page.getByTestId('view-plan').tap().catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/ipad-${name}-plan.png` });
  await page.getByTestId('view-walk').tap().catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/ipad-${name}-walk.png` });
  console.log(name, logs.slice(0, 5).join('\n'));
  await ctx.close();
}
await browser.close();
