---
name: growthxai-crm-builder
description: Set up, deploy, extend and troubleshoot GrowthXAi, the multi-tenant WhatsApp CRM SaaS built on the WACRM template (Next.js + Supabase + Meta WhatsApp Cloud API, deployed on Railway). Use whenever the task is installing a new GrowthXAi/WACRM instance, connecting Supabase, Railway or a WhatsApp number, fixing login/webhook/permission errors, configuring the AI Agent, or adding CRM features such as SaaS billing, email, or AI voice calling. Also use when building a new CRM for another client from this codebase.
---

# GrowthXAi CRM builder

GrowthXAi is the product name; the code is a fork of WACRM
(`github.com/ArnasDon/wacrm`, MIT). Our fork: `infinityxsolutions/wacrm`.
It is a **multi-tenant SaaS**: one deployment serves many businesses, each a
separate *account* with its own team, WhatsApp number and data.

## Working rules (owner's standing instructions)

- **Ask before every step.** Explain what the next step does, then wait for a yes.
- **Never ask for secrets in chat.** The owner types service-role keys,
  encryption keys, access tokens, PINs and app secrets directly into
  `.env.local`, Railway or the app. Public values (Supabase URL, publishable
  key, IDs, domains) may be shared.
- **Check every change for multi-tenancy.** New tables need RLS policies
  scoped to the account; nothing may let one business see another's data.
- The owner works on **Windows + PowerShell**, project at `C:\dev\wacrm`.
  Give one command per code block and say which window to run it in.
- Each feature goes on its own branch, with tests, then is merged to `main`
  only after the owner agrees.

## Stack facts that matter

- Next.js 16 (Turbopack). `AGENTS.md`: read `node_modules/next/dist/docs/`
  before writing Next code; APIs differ from older versions.
- Supabase Postgres + Auth + RLS. 60+ migrations in `supabase/migrations/`,
  numbered `NNN_name.sql`, idempotent. Docs on wacrm.tech list only 9 — outdated.
- `NEXT_PUBLIC_*` variables are **baked in at build time** (Dockerfile build
  args). Server secrets are read at runtime.
- WhatsApp access/verify tokens are stored encrypted with `ENCRYPTION_KEY`.
  Every environment that shares a database **must use the same key**.
- Webhook: `GET/POST /api/whatsapp/webhook`. POSTs are rejected unless
  `META_APP_SECRET` is set. Events are routed to the account by `phone_number_id`.
- Product name lives in `messages/{en,es,ko,pt}.json` and `src/app/layout.tsx`.
  Internal identifiers (`wacrm_live_` API keys, `X-Wacrm-Signature`, storage
  keys) are intentionally unchanged — renaming them breaks existing clients.

## Fresh install, in order

1. **Fork + clone.** `git clone https://github.com/<owner>/wacrm.git`, then
   `npm install`. Requires Node ≥ 22.12.
2. **Supabase project.** Create it, pick the nearest region (Mumbai for
   India), save the DB password. Note the Project URL and publishable key
   (`sb_publishable_…` works as `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
3. **Migrations** (Supabase CLI, from the project folder):
   `npx supabase login` → `npx supabase link --project-ref <ref>` →
   `npx supabase db push --remote`. Without `--remote` the CLI targets a local
   Docker stack and fails with `127.0.0.1:54322`. Answer **Yes** at the
   "Apply N migrations … production?" prompt (default is No).
4. **Table grants.** Migration `061_grant_table_privileges.sql` grants
   `authenticated` CRUD on RLS-enabled tables and full access to
   `service_role`. New Supabase projects don't grant these by default; without
   061 every signed-in request fails with `permission denied for table profiles`.
5. **Auth settings** (Supabase → Authentication): turn off *Confirm email* while
   testing (built-in email is rate-limited and often never arrives). Set Site URL
   and add `http://localhost:3000/**` and `https://<live-domain>/**` to Redirect URLs.
6. **`.env.local`**: copy `.env.local.example`. Set the Supabase URL, publishable
   key, service-role key, a fresh `ENCRYPTION_KEY`
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`),
   `NEXT_PUBLIC_SITE_URL`. Run `npm run dev` and keep that window open.
7. **WhatsApp** (in the app: Settings → WhatsApp connection): Phone Number ID,
   WhatsApp Business Account ID, a **System User** permanent token (Business
   settings → Users → System users → assign the app + WABA with full control →
   Generate token, expiry Never, scopes `whatsapp_business_management` +
   `whatsapp_business_messaging`), a made-up Webhook Verify Token (**not** the
   PIN), and the 6-digit two-step PIN.
8. **Railway.** New Project → Deploy from GitHub repo (if the repo doesn't show,
   set the Railway GitHub App to *All repositories*). Settings → Networking →
   Generate Domain or Custom Domain. Variables (Raw Editor): the 3
   `NEXT_PUBLIC_*`, `NEXT_PUBLIC_APP_LOCALE`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ENCRYPTION_KEY` (same as local), `META_APP_SECRET`. Then **Deploy latest
   commit** (Ctrl+K) so it really rebuilds.
9. **Meta webhook** (developers.facebook.com → app → Webhooks → Whatsapp
   Business Account): Callback URL `https://<domain>/api/whatsapp/webhook`,
   the same verify token, *Verify and save*. Subscribe `messages`,
   `message_template_status_update`, `message_template_quality_update`,
   `message_template_components_update`. Test by messaging the business
   number and checking Inbox.
10. **AI Agent** (already built): Settings → Agent setup (provider, model, key,
    business instructions, enable; leave auto-reply off) → Knowledge base docs
    → AI Agents → Playground → then switch auto-reply on.

## Troubleshooting map

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied for table …` (42501), red "Could not load your permissions" | Missing table grants | Apply migration 061 |
| Live login: "Failed to fetch"; Network shows `your-project.supabase.co` | Railway imported placeholders from `.env.local.example` | Replace every placeholder variable, then Deploy latest commit |
| Variable fixed but site unchanged | "Redeploy" reused the old build | Deploy latest commit; build log must run `npm run build`, not `CACHED` |
| Meta "callback URL or verify token couldn't be validated" | Token mismatch (often PIN pasted), wrong service-role key, or `ENCRYPTION_KEY` differs from where settings were saved | Fix keys, re-save WhatsApp settings on the live site, verify again |
| Messages don't arrive | Old callback URL still set, `messages` not subscribed, or `META_APP_SECRET` wrong (401 in logs) | Check Meta page and Railway Deploy Logs |
| `localhost refused to connect` | `npm run dev` window closed or stopped | `cd C:\dev\wacrm` then `npm run dev`, keep open |
| `npm error … C:\Users\<you>\package.json` | Ran npm outside the project | `cd C:\dev\wacrm` first |
| Hydration mismatch mentioning `elang_linkidin_extension` | Browser extension | Harmless; confirm in Incognito |
| Forgot password, reset email never arrives | Built-in Supabase email limits | Use the admin `updateUserById` script with `node --env-file=.env.local` |
| Railway answers `429 rate limited` to cloud checks | Railway edge throttles shared cloud IPs | Verify from the owner's browser instead |

## Roadmap and decisions (as of Nov 2026)

Order: AI Agent → SaaS layer → Email → AI voice calling.
- **SaaS layer:** subscription plans and billing via **Razorpay**, a platform
  super-admin console, plan limits, controlled sign-up, and Meta Embedded
  Signup so customers connect their own numbers.
- **Email:** **Brevo** for campaigns and system emails (sign-up, reset).
- **Voice:** choose the **cheapest reliable** provider after comparing current
  per-minute prices (shortlist: Bolna/Exotel/Plivo for India, Vapi/Twilio global).
- Decide in the SaaS step whether AI keys stay per-business (current) or are
  provided by the platform and billed in plans.

## Current GrowthXAi deployment (non-secret)

- Live: `https://growthxai.adonaidigitals.com` (Railway service `wacrm`).
- Supabase project ref: `ypclkxedmlawdggsvhxj` (project "AiCRM").
- Meta app "GrowthXAi", App ID `1194508892671090`; business portfolio
  `399317527145609`; WhatsApp Business Account probably `4285243185087637`.
- Webhook previously pointed at a retired `growthos-backend` on Railway; now
  points at GrowthXAi.
