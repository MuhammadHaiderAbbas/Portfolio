# Haider Abbas: portfolio

The source for Muhammad Haider Abbas's portfolio: fast pre-built pages over a live 3D background, with an admin panel that controls everything on the site.

- **Fast:** every page is pre-built HTML with its CSS inlined. Images are right-sized WebP and lazy-loaded. The 3D background is about 4 KB of hand-written canvas code (no libraries); it pauses in hidden tabs and stays still for visitors who prefer reduced motion.
- **Everything is editable** at `/admin/`:
  - **Content:** profile (photo, CV, roles, intro, about, contact details, social links), projects, blog posts, certifications, experience and education, skills (with % bars), services (prices and what's included), snapshot numbers and "What I do".
  - **Site text & settings:** every heading, button, menu label, form label and footer line; accent colour, default theme, 3D background on/off and detail, card tilt, and showing or hiding each homepage section.
  - **Uploads:** images are resized and converted to WebP in the browser before upload.
  - **Dashboard** (opens first): live "watching now" count, visitors, page views, time on page, a visits chart, a world map of approximate visitor areas, top pages, sources, devices, browsers, languages, a live visit feed, site health checks and the latest inbox.
  - **Top bar:** a Messages button and a notification bell (new messages, job opportunities, publishes, deploy results, content changes and site problems), updated live.
  - **Job opportunities** sent by companies from the public **Hire me** page, tracked through New → Reviewing → Interview → Offer → Declined/Closed with private notes.
  - **Adaptive IDS enquiries** from the adaptiveids.com request form, tracked through New → Contacted → Call booked → In evaluation → Won/Declined/Closed with private notes.
  - **Messages** from the contact form.
  - **AI writer (autopilot):** every morning and evening it collects what is trending in your fields (Google Trends UK, Hacker News, dev.to, GitHub, CISA security advisories), writes one researched, search-friendly article, and has a separate editor pass check it for safety and quality (with one rewrite if needed). Articles that pass are emailed to you and publish themselves after 1 hour unless you press **Hold**; anything flagged waits for you. Off-limits subjects (politics, religion, crime, health, celebrities, gambling, adult) are never written. If Claude has no credit it falls back to free AI models automatically. Each article gets a branded cover.
  - **Email alerts:** new and published articles, job opportunities, messages and problems, sent through Resend (free).
- **Publishing:** saving in the admin panel stores the change. **Publish site** rebuilds the pages, and the change is live in about a minute.

```
Admin panel ──save──▶ Supabase (database, login, uploads, messages)
     │                         │
     └──Publish──▶ GitHub Actions ──reads content──┘
                          │
                          ▼
                 GitHub Pages (custom domain or username.github.io/Portfolio/)
```

The site works before Supabase is connected: it then builds from `src/data/seed.json`, which holds all the content from the original site.

---

## Setup

### 1. Turn on GitHub Pages

Repository → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

Then **Actions → Deploy site → Run workflow** (or push to `main`). The site goes live at `https://muhammadhaiderabbas.github.io/Portfolio/`.

### 2. Create the Supabase database

1. Create a free project at [supabase.com](https://supabase.com) (region **London, eu-west-2**).
2. **SQL Editor → New query:** paste all of [`supabase/schema.sql`](supabase/schema.sql), then **Run**. Then do the same with [`supabase/dashboard.sql`](supabase/dashboard.sql) (visit statistics, notifications and job opportunities), [`supabase/writer.sql`](supabase/writer.sql) (AI writer) and [`supabase/autopilot.sql`](supabase/autopilot.sql) (auto-publish timer and email alerts), and finally [`supabase/adaptive-ids.sql`](supabase/adaptive-ids.sql) (Adaptive IDS enquiries; needs the adaptiveids.com requests table).
3. **New query:** paste all of [`supabase/seed.sql`](supabase/seed.sql), then **Run**. This imports all the content: projects, profile, contact details, experience, education, skills, certifications, services, snapshot numbers and "What I do".

### 3. Create your admin login

1. **Authentication → Users → Add user → Create new user:** your email and a strong password; tick **Auto confirm user**.
2. **Authentication → Sign In / Providers:** turn off **Allow new users to sign up**.
3. **Authentication → URL Configuration:** set **Site URL** to your site address and add `<your site address>/admin/` under **Redirect URLs** (needed for password-reset emails).
4. **SQL Editor**, with your email:

   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```

### 4. Connect the site to the database

In Supabase: **Project Settings → API Keys.** Copy the **Project URL** and the **anon** (or **publishable**) key, and put them in [`supabase.config.json`](supabase.config.json):

```json
{ "url": "https://abcd1234.supabase.co", "anonKey": "eyJ…" }
```

This key is designed to be public; the security rules in `schema.sql` decide what it can do. **Never put the `service_role` or secret key here.**

(Instead of the file you can set GitHub repository variables `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`; they take priority.)

### 5. Turn on the Publish button

1. GitHub: **profile picture → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.**
   - Repository access: **Only select repositories → Portfolio**.
   - Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
2. Supabase **SQL Editor**:

   ```sql
   select vault.create_secret('github_pat_PASTE_YOUR_TOKEN', 'github_token');
   select vault.create_secret('MuhammadHaiderAbbas/Portfolio', 'github_repo');
   ```

   To replace an expired token later, press **Publish site**: when GitHub rejects the old token, a box appears in the publish bar to paste a new one (it is stored encrypted in Supabase Vault). Or, in the SQL Editor:

   ```sql
   select vault.update_secret(id, 'github_pat_NEW_TOKEN') from vault.secrets where name = 'github_token';
   ```

### 6. Turn on the AI writer (optional)

Admin → **AI writer** shows these steps with a ready-made token and copy buttons.

1. Create a Claude API key at [console.anthropic.com](https://console.anthropic.com/settings/keys) and add some credit (an article costs a few pence).
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret**:
   - `ANTHROPIC_API_KEY`: the Claude key.
   - `AGENT_TOKEN`: a long random value (the admin page makes one for you).
3. Supabase → SQL Editor, store the same token: `select vault.create_secret('THE-SAME-VALUE', 'agent_token');`
4. Admin → AI writer → **Find trending topics**.

Optional: set a repository variable `AI_MODEL` to choose the Claude model (default `claude-sonnet-5-5`). Schedule, days, auto-publish delay, article length, fields, audience and tone are in Admin → Site text & settings → **AI writer**.

**Keeps running when credit runs out.** Providers are tried in order: Claude → GitHub Models (free, uses the workflow's own token, nothing to set up) → Google Gemini (`GEMINI_API_KEY`, free tier from [AI Studio](https://aistudio.google.com/apikey)) → Groq (`GROQ_API_KEY`, free tier) → OpenRouter (`OPENROUTER_API_KEY`, free models) → OpenAI (`OPENAI_API_KEY`). Add any of the optional keys as repository secrets for more headroom. If no trending topic qualifies, it writes an evergreen topic in your fields instead.

**Auto-publish.** A database timer (pg_cron) checks every 5 minutes. Only articles the editor marked safe with quality 7/10 or more are scheduled; at most 3 publish automatically in 24 hours. The email has **Publish now** and **Hold** buttons that work without signing in (each link has its own secret token, valid 14 days).

### 7. Email alerts

Admin → **Email alerts**: create a free [Resend](https://resend.com) account with the address you want alerts at, create an API key, paste it in, and press **Send a test email**. Without verifying a domain, Resend only delivers to your own sign-up address; verify personalportfolio.website in Resend (DNS records in Namecheap) to send from your own domain to any address. GitHub also emails you when a deploy fails.

How it stays safe: the writer never gets a Supabase secret key. It can only call the `agent_*` functions, which check the token, read public context and save **drafts**. Articles are told to rely only on the source material for news facts, never to invent figures or experiences, and to cover security topics defensively. Published AI-assisted posts show a short note saying they were reviewed by you (editable or removable in Site text).

### 8. Use your own domain (when you're ready)

GitHub lets only one repository use a domain at a time.

1. In the **old** repository: **Settings → Pages → Custom domain**: remove `personalportfolio.website`.
2. In **this** repository: **Settings → Pages → Custom domain**: enter `personalportfolio.website` and save; tick **Enforce HTTPS** once it's offered.
3. **Actions → Deploy site → Run workflow.** The build picks up the new address automatically.
4. In Supabase, update **Site URL** and **Redirect URLs** (step 3.3) to the domain.

Old addresses such as `/resume.html`, `/portfolio.html`, the old project pages and the CV link redirect or keep working.

---

## Everyday use

| To… | Do this |
| --- | --- |
| Change any wording on the site | Admin → **Site text & settings**. Use the search box to find it. |
| Change the colour or the 3D background | Admin → **Site text & settings → Look and feel** |
| Hide a homepage section | Admin → **Site text & settings → Homepage** |
| Add a project or blog post | Admin → Projects / Blog posts → **Add**. Turn on **Show on the website**, save, then **Publish site**. |
| Keep a draft | Leave **Show on the website** off. |
| Change the order of anything | Set **Position** (lower first). |
| Feature a project on the homepage | Tick **Feature on the homepage** (up to 3 are shown). |
| Update your CV or photo | Admin → Profile → **Upload**, save, publish. |
| Read messages | Admin → Messages, or the envelope in the top bar. |
| See who is on the site | Admin → **Dashboard**. Pick 24 hours, 7, 30 or 90 days. |
| Handle a job offer | Admin → **Job opportunities**: change the stage, add notes, reply by email. |
| Handle an Adaptive IDS enquiry | Admin → **Adaptive IDS enquiries**: requests from the adaptiveids.com form. Reply by email, move it through the stages, keep private notes. |
| Give recruiters a pre-filled form | Share `/hire/?company=Acme&role=Developer` (also `name`, `email`, `type`, `mode`, `location`, `salary`, `url`). |
| Stop counting visits | Admin → Site text & settings → **Privacy and statistics**. |
| Get a new AI article | Admin → AI writer → pick a topic → **Write now** (or add your own topic). |
| Approve an AI draft | Admin → AI writer → **Read and edit**, then **Approve and publish**. |

## Developing locally

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # production build into dist/
```

After editing `src/data/seed.json`, run `npm run seed-sql` to regenerate `supabase/seed.sql`.

## How it fits together

| Path | What it is |
| --- | --- |
| `src/pages/` | Public pages, the admin page, and redirects from old addresses |
| `src/lib/site-text.ts` | Every editable label and setting, with its default |
| `src/admin/schema.ts` | Every editable content field |
| `src/admin/app.ts` | The admin panel |
| `src/admin/dashboard.ts`, `live.ts`, `opportunities.ts` | Dashboard, top-bar notifications and live updates, job opportunities |
| `src/admin/evaluations.ts`, `supabase/adaptive-ids.sql` | Adaptive IDS enquiries from adaptiveids.com |
| `src/scripts/track.ts` | The cookie-free visit counter |
| `scripts/writer.mjs`, `.github/workflows/writer.yml` | The AI writer and its schedule |
| `scripts/covers.mjs` | Branded cover images for posts without one (runs before each build) |
| `src/admin/writer.ts` | The AI writer page in the admin panel |
| `scripts/gen-geo.mjs` | Rebuilds the dashboard's world map and time-zone table |
| `src/scripts/bg3d.ts` | The 3D background |
| `src/lib/content.ts` | Loads content from Supabase (or `seed.json`) at build time |
| `supabase/schema.sql` | Tables, security rules, uploads and the publish function |
| `supabase/dashboard.sql` | Visit statistics, notifications and job opportunities |
| `supabase/writer.sql` | Trending topics, AI drafts, writer runs |
| `supabase/autopilot.sql` | Auto-publish timer, draft reviews and email links, email alerts |
| `src/pages/review.astro` | The page behind the Publish now / Hold email buttons |
| `.github/workflows/deploy.yml` | Builds and deploys on push, on Publish, on demand and nightly |

### Security

- Visitors can read published content and send contact messages, nothing else. Drafts, messages, uploads and all changes are limited to accounts in the `admins` table.
- The contact form refuses new messages after 30 in an hour; the Hire me form after 20 in an hour.
- **Visit statistics are privacy-friendly:** no cookies, no IP addresses, no exact location and no third parties. Location is approximate, taken from the visitor's device time zone. Nothing is recorded for Do Not Track / Global Privacy Control, bots, or your own browser once you have signed in to the admin. Visitors can only add views; only admins can read them. Views are kept for 13 months. The public `/privacy/` page explains this.
- The GitHub token is stored encrypted in Supabase Vault and is only used by `publish_site()`, which checks that the caller is an admin.

### Free-plan notes

- Supabase pauses free projects after a week without activity; the nightly rebuild queries the database daily, which should keep it active. Even if it pauses, the public pages and images keep working; only the contact form and admin panel need it.
- GitHub turns off scheduled workflows after 60 days without commits. Publish still works either way.
