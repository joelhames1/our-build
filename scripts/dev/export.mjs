// Export smoke test: create a design, download the PDF and DXF. Usage: node scripts/dev/export.mjs <outDir> [base]
import { chromium } from '@playwright/test';

const [out, base = 'http://localhost:3100'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push(`console ${m.type()}: ${m.text()}`));
page.on('dialog', (d) => { logs.push(`dialog: ${d.message()}`); d.dismiss(); });
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.getByLabel('Describe your design').fill('A lake house with a wraparound porch and a stone chimney');
await page.getByRole('button', { name: /Begin/ }).click();
await page.waitForURL(/\/p\//);
await page.getByTestId('assistant-reply').waitFor({ timeout: 60000 });
await page.waitForTimeout(2500);
for (const kind of ['pdf', 'dxf']) {
  await page.getByTestId('export').click();
  const t0 = Date.now();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.getByTestId(`export-${kind}`).click()]);
  await dl.saveAs(`${out}/app.${kind}`);
  console.log(kind, dl.suggestedFilename(), `${Date.now() - t0} ms`);
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 790);
  await page.waitForTimeout(500);
}
if (logs.length) console.log(logs.join('\n'));
await browser.close();
