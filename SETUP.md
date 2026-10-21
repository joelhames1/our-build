# Setting up Our Build

About 45 minutes, start to finish: Supabase (accounts and the shared library), Google Cloud (Google sign-in), Resend (email), Anthropic (the AI) and Vercel (hosting), then a first sign-in as the admin.

Dashboards rename their menus now and then. If a label below doesn't match exactly, look for the nearest equivalent.

## How accounts work

- **Invite-only.** You're the admin (your email goes in `ADMIN_EMAILS`). From **People** in the account menu you invite someone by email; they get a message with a button, or they can simply choose **Continue with Google** with that address.
- **Two ways in:** Google, or a one-time sign-in link by email for people without Google. Both work on any device.
- **Anyone else is turned away** with a polite note, and their stray login is removed. Their attempt shows up in People's activity with an **Invite** button, in case you meant to let them in.
- **Pause, archive, delete.** Pausing locks someone out right away (reversible). Archiving retires them to a collapsed list (reversible with Restore). Deleting removes the login for good, only after pausing or archiving, and only once you type their email. Designs always stay: they belong to the household.
- You can't pause, archive or delete yourself, and the last admin can't be demoted. Anyone in `ADMIN_EMAILS` can always get back in.

## 1. Supabase

Create a new project at [supabase.com](https://supabase.com) for Our Build (the free tier is plenty). Keep it separate from your other product's project.

1. **SQL Editor → New query.** Paste `supabase/migrations/0001_init.sql` and run it, then do the same with `supabase/migrations/0002_members.sql`.
2. **Authentication → Sign In / Providers:**
   - Leave **Allow new users to sign up** **on**. Google needs it to make the first login for someone you invited; the members list, not this switch, decides who gets in, and refused logins are deleted.
   - **Email**: enabled. Set **Email OTP Expiration** to `86400` (24 hours, the maximum) so invite buttons last a day.
   - **Google**: enable it. Leave this tab open; you'll paste the Client ID and Client Secret from step 2 here. Copy the **Callback URL** it shows (`https://<project>.supabase.co/auth/v1/callback`) for Google Cloud.
3. **Authentication → URL Configuration:**
   - **Site URL**: your Vercel address, e.g. `https://our-build.vercel.app`.
   - **Redirect URLs**: `https://our-build.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`. (Want sign-in on Vercel preview deployments too? Add `https://*-<your-team>.vercel.app/**`.)
4. **Leave email (SMTP) settings alone.** Our Build sends its own email through Resend. Keeping Supabase on its built-in mailer, which only reaches your Supabase team, means nobody can use the public Supabase API to send mail that looks like yours.
5. **Project Settings → API Keys:** copy the **Project URL**, the **anon / publishable** key and the **service_role / secret** key. The last one is a master key: it only ever goes into Vercel's settings, never into the code or a browser.

## 2. Google Cloud (Google sign-in)

Use a separate Google Cloud project for Our Build so Google's sign-in screen says "Our Build" rather than your other product's name.

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project** → "Our Build".
2. **Google Auth Platform → Branding** (the OAuth consent screen): app name **Our Build**, your support email, audience **External**. Sign-in only asks for name and email, so you can **Publish** it without Google's review. (If you leave it in Testing, only the test users you list can sign in.)
3. **Clients → Create client → Web application.** Under **Authorized redirect URIs** paste Supabase's Callback URL from step 1.2. No JavaScript origins needed.
4. Copy the **Client ID** and **Client secret** into Supabase's Google provider and save.

## 3. Resend (email)

Reuse the Resend account and verified domain from your other product.

1. **API Keys → Create API key**, name it "Our Build", **Sending access**, limited to your verified domain.
2. Pick a From address on that domain, e.g. `Our Build <build@yourdomain.com>`.

## 4. Anthropic (the design assistant)

1. In the [Anthropic Console](https://console.anthropic.com), create an API key.
2. **Set a monthly spend limit** (Settings → Limits). Creating a whole house takes more thinking than nudging a window, so a limit is cheap insurance; the usage page shows what each day cost.
3. The app uses `claude-opus-5-5` by default; set `OUR_BUILD_MODEL` to try another model.

Without a key the app still works with a small rule-based demo assistant.

## 5. Vercel (hosting)

1. **Add New → Project**, import the `our-build` repo. The defaults (Next.js, `npm run build`) are right.
2. **Environment Variables** (mark the keys as Sensitive):

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key |
   | `RESEND_API_KEY` | the Resend key from step 3 |
   | `EMAIL_FROM` | e.g. `Our Build <build@yourdomain.com>` |
   | `ADMIN_EMAILS` | your own email (comma-separate to add more admins who can never be locked out) |
   | `ANTHROPIC_API_KEY` | the key from step 4 |
   | `SITE_URL` | optional: your production address, so invite links always point there (handy with a custom domain) |
   | `OUR_BUILD_MODEL` | optional, defaults to `claude-opus-5-5` |

3. Deploy. If the address differs from what you put in Supabase's URL Configuration, update it there.

The design endpoint streams for up to 5 minutes on big requests (`maxDuration = 300`). If your plan caps functions lower, very large "design me a whole house" turns can get cut off; edits are much quicker.

## 6. First sign-in

1. Open the site and choose **Continue with Google** with the address in `ADMIN_EMAILS`. You're in, as the admin.
2. Account menu (top right) → **People** → invite her. The email arrives from `EMAIL_FROM` within a minute.
3. On the iPad she taps **Open Our Build** in the email, then **Sign in to Our Build** (or picks **Continue with Google** with that address). People now shows her as Active.

Anyone who was signed in before this version signs in once more.

## On the iPad

- Use it **in a Safari tab**. Don't use "Add to Home Screen": Safari doesn't allow speech recognition in home-screen web apps, so the microphone wouldn't work.
- Allow microphone access the first time you hold the mic button.
- Walk mode: left thumb on the joystick to move, drag on the right to look, or tap the floor to walk there. The room name at the top opens a "Go to…" menu.
- Exports land in the Files app (Downloads).

## Checking it all works

After setup, a ten-minute pass through the whole cycle:

1. Sign in with Google as the admin; the account menu shows **Admin** and **People**.
2. Invite someone; the email arrives and People shows **Invited · invite sent just now**.
3. They tap the button in the email (or use Google with that address); People shows **Active** and the activity log says they joined.
4. Sign out from the account menu; the sign-in page says you're signed out, and the next Google sign-in asks which account to use.
5. Sign in with a Google account that wasn't invited: it's turned away, the attempt appears in People's activity with an **Invite** button, and no stray user is left in Supabase → Authentication → Users.
6. Ask for an email link with an address that isn't invited: the page says "check your email", and nothing arrives.
7. **Pause** them: their next page load signs them out with a "paused" note, and their data access stops immediately. **Turn back on**: they can sign in again.
8. **Archive**, then **Restore**.
9. Pause or archive, then **Delete account…**, typing their email: they're gone from People and from Supabase's users; designs remain.
10. **Sign out on every device** from the account menu signs out the iPad too.

## Running it on your laptop

```bash
npm install
cp .env.example .env.local   # optional: fill in keys to use Claude, accounts and email locally
npm run dev                  # http://localhost:3000
```

With an empty `.env.local` you get the demo assistant and designs saved in the browser, with no accounts at all.

## Checks

```bash
npm run typecheck && npm run lint && npm test   # types, lint, unit tests (including the account rules)
npm run e2e                                     # two production builds, driven in Chromium: the app (desktop + iPad sizes) and the sign-in screens
npm run eval                                    # a dozen briefs and edits against the live API → eval-out/index.html
```

`npm run eval` uses your API key and costs real (small) money; `npm run eval -- --mock` runs it against the demo assistant. The first `npm run e2e` needs `npx playwright install chromium`.
