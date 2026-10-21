import { expect, test } from '@playwright/test';

/**
 * Sign-in screens and route protection, against a build with Supabase "configured" (an address that
 * doesn't answer, and no server key). Real sign-ins need a live Supabase project; see SETUP.md.
 */

test('signed-out visitors are sent to sign in, keeping where they were going', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/p/some-design');
  await expect(page).toHaveURL(/\/login\?next=%2Fp%2Fsome-design$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
});

test('the sign-in page offers Google and an email link, and explains refusals', async ({ page }) => {
  await page.goto('/login?signin=disabled');
  await expect(page.getByTestId('google-sign-in')).toBeVisible();
  await expect(page.getByTestId('email-link')).toBeVisible();
  await expect(page.getByTestId('signin-message')).toContainText('paused');
  await page.goto('/login?signin=not-invited');
  await expect(page.getByTestId('signin-message')).toContainText('isn’t on the list');
});

test('Continue with Google goes to Supabase with our callback and an account picker', async ({ page }) => {
  await page.goto('/login?next=%2Fp%2Fabc');
  const [req] = await Promise.all([page.waitForRequest((r) => r.url().includes('/auth/v1/authorize')), page.getByTestId('google-sign-in').click()]);
  const url = new URL(req.url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('prompt')).toBe('select_account');
  expect(url.searchParams.get('redirect_to')).toMatch(/\/auth\/callback\?next=%2Fp%2Fabc$/);
  expect(url.searchParams.get('code_challenge')).toBeTruthy();
});

test('email links land on a page with a button, so scanners can’t use them up', async ({ page }) => {
  await page.goto('/auth/confirm?token_hash=abc123&type=magiclink&next=%2Fp%2Fx');
  await expect(page.getByTestId('confirm-sign-in')).toBeVisible();
  await expect(page.locator('input[name="token_hash"]')).toHaveValue('abc123');
  await expect(page.locator('input[name="next"]')).toHaveValue('/p/x');
  await page.goto('/auth/confirm');
  await expect(page.getByText('That link is missing a piece')).toBeVisible();
});

test('the account APIs refuse politely when accounts aren’t fully set up or nobody is signed in', async ({ request, baseURL }) => {
  const origin = { origin: baseURL!, 'sec-fetch-site': 'same-origin' };
  expect((await request.post('/api/auth/link', { data: { email: 'a@b.co' }, headers: origin })).status()).toBe(503);
  expect((await request.get('/api/me')).status()).toBe(503);
  expect((await request.get('/api/admin/members')).status()).toBe(503);
  // A sign-in link posted from another site is turned away.
  expect((await request.post('/api/auth/link', { data: { email: 'a@b.co' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })).status()).toBe(403);
  // A Google callback with no code goes back to sign-in.
  const cb = await request.get('/auth/callback?error=access_denied', { maxRedirects: 0 });
  expect(cb.status()).toBe(303);
  expect(cb.headers().location).toContain('/login?signin=cancelled');
  // Signing out always lands on the sign-in page.
  const out = await request.post('/api/auth/signout', { form: { scope: 'local' }, headers: origin, maxRedirects: 0 });
  expect(out.status()).toBe(303);
  expect(out.headers().location).toContain('/login?signin=signed-out');
});
