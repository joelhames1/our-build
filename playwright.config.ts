import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a production build with the demo AI and in-browser storage.
 * E2E_BASE_URL points them at a server that is already running (say, `npm run dev`).
 */
const port = 3210;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
// A second build with (placeholder) Supabase settings, for the sign-in screens and route protection.
const accountsPort = 3211;
const accountsURL = process.env.E2E_ACCOUNTS_URL ?? `http://localhost:${accountsPort}`;
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
    { name: 'desktop', testIgnore: /accounts\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: 'ipad', testIgnore: /accounts\.spec/, grep: /@ipad/, use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium', deviceScaleFactor: 1, launchOptions } },
    { name: 'accounts', testMatch: /accounts\.spec/, use: { ...devices['Desktop Chrome'], baseURL: accountsURL, launchOptions } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `npm run build && npm run start -- -p ${port}`,
          url: baseURL,
          timeout: 600_000,
          reuseExistingServer: true,
          env: { AI_MODE: 'mock', NEXT_PUBLIC_SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: '' },
        },
        {
          command: `npm run build && npm run start -- -p ${accountsPort}`,
          url: accountsURL,
          timeout: 600_000,
          reuseExistingServer: true,
          // Supabase "configured" but unreachable and with no server key: enough to see the screens and redirects.
          env: { NEXT_DIST_DIR: '.next-accounts', AI_MODE: 'mock', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder', SUPABASE_SERVICE_ROLE_KEY: '' },
        },
      ],
});
