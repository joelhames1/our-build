// Walk-mode smoke test. Usage: node scripts/dev/walk.mjs <outDir> [base]
import { chromium } from '@playwright/test';

const [out, base = 'http://localhost:3100'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && logs.push(`console: ${m.text()}`));
const where = async () => JSON.stringify(await page.evaluate(() => { const w = window.__walk; return w && { x: +w.x.toFixed(1), y: +w.y.toFixed(1), z: +w.z.toFixed(1), level: w.level }; }));
const shot = async (n) => { await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n, (await page.getByTestId('walk-where').innerText().catch(() => '')).replace(/\s+/g, ' '), await where()); };

await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.getByLabel('Describe your design').fill('A white two-story farmhouse with a metal roof and a wraparound porch');
await page.getByRole('button', { name: /Begin/ }).click();
await page.waitForURL(/\/p\//);
await page.getByTestId('assistant-reply').waitFor({ timeout: 60000 });
if (process.env.AO) {
  // Reload with ambient occlusion forced (swiftshader is too slow for the automatic setting).
  await page.waitForTimeout(1500);
  await page.goto(page.url().split('?')[0] + '?ao=' + process.env.AO, { waitUntil: 'networkidle' });
}
await page.waitForTimeout(2500);
await page.getByTestId('view-walk').click();
await page.waitForTimeout(3000);
await shot('w1-front-yard');
await page.keyboard.down('KeyW');
await page.waitForTimeout(2600);
await page.keyboard.up('KeyW');
await page.waitForTimeout(800);
await shot('w2-walked-forward');
await page.getByTestId('walk-where').click();
await page.getByRole('button', { name: /^Living/ }).click();
await page.waitForTimeout(1500);
await shot('w3-living');
await page.getByTestId('walk-where').click();
await page.getByRole('button', { name: /^Primary Bedroom/ }).click();
await page.waitForTimeout(1500);
await shot('w4-primary-bedroom');
if (logs.length) console.log(logs.slice(0, 10).join('\n'));
await browser.close();
