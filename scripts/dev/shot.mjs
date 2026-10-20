// Usage: node scripts/dev/shot.mjs <url> <out.png> [width] [height] [waitMs] [scale] [clip x,y,w,h]
import { chromium } from '@playwright/test';

const [url, out, w = '1280', h = '800', wait = '4000', scale = '1', clip] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: Number(scale) });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
await page.waitForTimeout(Number(wait));
const [cx, cy, cw, ch] = (clip ?? '').split(',').map(Number);
await page.screenshot({ path: out, ...(clip ? { clip: { x: cx, y: cy, width: cw, height: ch } } : {}) });
if (logs.length) console.log(logs.slice(0, 15).join('\n'));
await browser.close();
