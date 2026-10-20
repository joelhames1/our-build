import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a production build with the demo AI and in-browser storage.
 * E2E_BASE_URL points them at a server that is already running (say, `npm run dev`).
 */
const port = 3210;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
// Software WebGL in CI containers; harmless on a machine with a GPU.
const launchOptions = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL, launchOptions, trace: 'retain-on-failure', acceptDownloads: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: 'ipad', grep: /@ipad/, use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium', deviceScaleFactor: 1, launchOptions } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npm run start -- -p ${port}`,
        url: baseURL,
        timeout: 600_000,
        reuseExistingServer: true,
        env: { AI_MODE: 'mock', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
      },
});
