# Setting up Our Build

About 30 minutes, start to finish. You'll create three accounts' worth of settings (Supabase for sign-in and storage, Anthropic for the AI, Vercel for hosting), then open it on the iPad.

Dashboards change their menus now and then. If a label below doesn't match exactly, look for the nearest equivalent.

## 1. Supabase (sign-in and the shared library)

1. Create a project at [supabase.com](https://supabase.com). The free tier is plenty.
2. **SQL Editor → New query.** Paste the whole of `supabase/migrations/0001_init.sql` and run it.
3. Still in the SQL editor, add the two of you to the household (this is the actual access list; being signed in isn't enough on its own):
   ```sql
   insert into public.household (email) values ('you@example.com'), ('her@example.com');
   ```
4. **Authentication → Sign In / Providers:** keep **Email** enabled and turn **off** "Allow new users to sign up".
5. **Authentication → Users → Add user → Send invitation** (or "Create new user" with "Auto confirm"): add both emails. The app only signs in people who already exist here.
6. **Authentication → URL Configuration:** set **Site URL** to your Vercel address (step 3 gives you one, e.g. `https://our-build.vercel.app`) and add these **Redirect URLs**:
   - `https://our-build.vercel.app/**` (your real address)
   - `http://localhost:3000/**` (for running it on your laptop)
7. **Project Settings → API:** copy the **Project URL** and the **anon / publishable key**. You'll paste them into Vercel.

Sign-in is a magic link: type your email, tap the link in the message, done. Sessions last a long time, so you won't do this often.

## 2. Anthropic (the design assistant)

1. In the [Anthropic Console](https://console.anthropic.com), create an API key.
2. **Set a monthly spend limit** (Settings → Limits). Each request sends the design summary plus a long, cached set of instructions, and creating a whole new house takes more thinking than nudging a window, so a limit is cheap insurance against surprises. The console's usage page shows what each day actually cost.
3. The app uses `claude-opus-5-5` by default. To try a different model, set `OUR_BUILD_MODEL`.

Without a key the app still works: a small rule-based demo assistant understands the common requests ("add a third story", "make the kitchen bigger", "move the sink to the island", tap a window and "make this bigger") so you can click around before paying for anything.

## 3. Vercel (hosting)

1. **Add New → Project**, import the `our-build` GitHub repo. The defaults (Next.js, `npm run build`) are right.
2. Before the first deploy, add **Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `ANTHROPIC_API_KEY` | the key from step 2 |
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
   | `OUR_BUILD_MODEL` | optional, defaults to `claude-opus-5-5` |

3. Deploy, then put the resulting address into Supabase's URL Configuration (step 1.6) if you haven't yet.

The design endpoint streams for up to 5 minutes on big requests (`maxDuration = 300`). If your Vercel plan caps functions lower, very large "design me a whole house" turns can get cut off; edits are much quicker.

Safety net: a deployment with no Supabase configured refuses AI requests, so a public URL can't spend your API key. (For a private test deployment you can instead set `DESIGN_API_SECRET` and send it as an `x-design-secret` header, or set `ALLOW_OPEN_DESIGN_API=1` if you really mean it.)

## 4. On the iPad

- Open the address **in a Safari tab**. Don't use "Add to Home Screen": Safari doesn't allow speech recognition in home-screen web apps, so the microphone button wouldn't work there.
- The first time you hold the mic button, allow microphone access (and, if asked, speech recognition).
- Walk mode: left thumb on the joystick to move, right side drag to look, or tap the floor to walk there. The room name at the top opens a "Go to…" menu.
- Exports download to the Files app (Downloads). The PDF opens nicely in Files or Books.

## Running it on your laptop

```bash
npm install
cp .env.example .env.local   # optional: add keys to use Claude and Supabase locally
npm run dev                  # http://localhost:3000
```

With an empty `.env.local` you get the demo assistant and designs saved in the browser (IndexedDB), no accounts needed.

## Checks

```bash
npm run typecheck && npm run lint && npm test   # fast: types, lint, unit tests
npm run e2e                                     # builds, starts, and drives the app in Chromium (desktop + iPad sizes)
npm run eval                                    # runs a dozen briefs and edits against the live API → eval-out/index.html
```

`npm run eval` uses your API key and costs real (small) money; `npm run eval -- --mock` runs the same script against the demo assistant.
