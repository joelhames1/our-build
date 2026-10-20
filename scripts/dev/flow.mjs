// Drive the full flow: home → describe → studio → edits. Usage: node scripts/dev/flow.mjs <outDir> [base]
import { chromium } from '@playwright/test';

const [out, base = 'http://localhost:3100'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
const shot = async (n) => { await page.screenshot({ path: `${out}/${n}.png` }); console.log('shot', n); };

await page.goto(base + '/', { waitUntil: 'networkidle' });
await shot('01-home');
await page.getByLabel('Describe your design').fill('A cozy two-bedroom stone cottage on a small island in a lake, with a porch facing the water');
await page.getByRole('button', { name: /Begin/ }).click();
await page.waitForURL(/\/p\//);
await page.waitForTimeout(1500);
await shot('02-designing');
await page.getByTestId('assistant-reply').waitFor({ timeout: 60000 });
await page.waitForTimeout(3500);
await shot('03-designed');
const edit = async (text, name) => {
  await page.getByTestId('composer-input').fill(text);
  await page.getByTestId('send').click();
  await page.getByTestId('assistant-reply').waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot(name);
};
await edit('add a second story', '04-second-story');
await edit('make the kitchen bigger', '05-kitchen-bigger');
await page.getByTestId('view-dollhouse').click();
await page.waitForTimeout(3500);
await shot('06-dollhouse');
await page.getByTestId('view-plan').click();
await page.waitForTimeout(1500);
await shot('07-plan');
await page.getByTestId('details-toggle').click();
await page.getByTestId('tab-notes').click();
await page.waitForTimeout(500);
await shot('08-notes');
if (logs.length) console.log(logs.slice(0, 20).join('\n'));
await browser.close();
