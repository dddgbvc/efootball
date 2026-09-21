# منصة بطولات eFootball

Arabic-first, RTL tournament platform for eFootball: double round-robin leagues,
official server-side draws, home-and-away knockout ties, and result verification
built on **two screenshots** — one from each player — cross-checked by an AI
vision pass, with a human administrator as the final authority.

Next.js (App Router) + Supabase (PostgreSQL, Auth, Storage, Realtime, RLS),
deployable to Vercel with no long-running server.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Where the guarantees live](#where-the-guarantees-live)
4. [Local development](#local-development)
5. [Supabase setup](#supabase-setup)
6. [Telegram setup](#telegram-setup)
7. [AI setup](#ai-setup)
8. [Vercel deployment](#vercel-deployment)
9. [Testing](#testing)
10. [Project structure](#project-structure)
11. [Security review](#security-review)
12. [Known limitations](#known-limitations)

---

## What it does

**Tournament engine**
- 8- or 16-player tournaments, capacity enforced as a hard database ceiling.
- Double round robin — 8 players produce 14 rounds, 56 fixtures, 14 matches each.
- Configurable points and tie-break chain (points → goal difference → goals for
  → head-to-head, reorderable), with unresolved ties surfaced rather than
  silently ordered.
- Qualification zones: 1–2 straight to the semifinal, 3–6 to the playoffs, 7–8 out.
- Official playoff and semifinal draws, randomised on the server with a CSPRNG
  and committed before the client sees anything.
- Home-and-away knockout ties decided on aggregate, then extra time, then
  penalties. Away goals off by default.

**Joining**
- The organiser shares an eight-character code (`ABCD-1234`, no I/O/0/1). It
  lives in an admin-only table, so no participant can read their own
  tournament's code, and it can be rotated at any time.
- A player signs in, enters the code, and sees the tournament named before
  committing to anything — including "التسجيل لم يُفتح بعد", so a correct code
  is never reported as a wrong one.
- The request is then the organiser's to answer in «الطلبات». A pending request
  occupies no seat; approval is the single atomic act that adds the roster row,
  under the same row lock and capacity ceiling as everything else. There is no
  automatic approval and no way to join without one.

**Result verification**
- Each participant uploads their own screenshot of the result screen.
- Evidence is immutable: it can never be edited, replaced or deleted. A mistake
  goes through *طلب تصحيح التوثيق*, which an admin approves and which creates a
  new version while keeping the original and its extraction.
- The AI reads the **whole screen** — names, teams, crests, score and every
  visible statistic — into an open, extensible schema, and returns confidence
  bands.
- Both extractions are cross-verified. A matching score is never sufficient:
  identity, teams, logo detection, statistics and confidence must all agree.
- Disagreement, low confidence or an unreadable screenshot opens a dispute. The
  standings do not move and nobody advances.
- The administrator resolves every uncertain case, with a mandatory reason
  written to an immutable audit log.

**Community**
- Tournament news feed with two sources: player posts and an AI sports reporter
  that only ever receives verified, structured facts.
- Event classification is deterministic — the model is told *that* a result is
  an اكتساح, it never decides so itself.
- Tournament group chat and private one-to-one messages, both gated by real
  membership rows, plus notifications, reports and moderation.

---

## Architecture

```
Browser ──► Next.js (Vercel)
              ├── Server Components ──► Supabase (as the user, under RLS)
              ├── Route Handlers ─────► authorization check ──► service role
              │                           │
              │                           ├──► Anthropic vision + reporter
              │                           └──► Telegram Bot API (outbox)
              └── Realtime channels ───► Supabase Realtime (RLS-filtered)
```

Two Supabase clients, used for two different jobs:

| Client | Runs as | Used for |
|---|---|---|
| `lib/supabase/server.ts` | the signed-in user | reads and the few writes RLS should govern directly |
| `lib/supabase/admin.ts` | `service_role` | privileged work, **only** after `lib/permissions` has established who the caller is |

`lib/supabase/admin.ts` imports `server-only`, so a client component that reaches
for the service key fails the build rather than shipping it to a browser.

---

## Where the guarantees live

The rules that matter are enforced in the database, not in the application, so
they hold no matter what any client does.

| Guarantee | Enforced by |
|---|---|
| Capacity is never exceeded | Row lock on `tournaments` in `join_tournament()` + `tournaments_player_count_within_capacity` CHECK |
| A player joins once | `unique (tournament_id, user_id)` |
| Tournament state cannot be forced | `app.guard_tournament_status()` validates every transition |
| Structural rules freeze once matches exist | `app.guard_locked_rules()` + `rules_locked` |
| Evidence is immutable | `app.guard_evidence_immutability()` — no UPDATE of content, no direct DELETE; only a parent cascade may remove it |
| Audit log is append-only | `app.block_mutation()` on UPDATE and DELETE |
| Players cannot write results | `REVOKE INSERT/UPDATE/DELETE` on `matches`, `knockout_ties`, `draws`, `standings_snapshots` |
| System messages cannot be forged | `chat_system_has_no_sender` CHECK + an insert policy requiring `sender_id = auth.uid()` + `app.guard_chat_message_update()` |
| A draw cannot be re-rolled | `unique (tournament_id, kind)` on `draws` |
| One AI article per event | `unique (event_key)` on `news_posts` |
| One verification per evidence pair | `unique (idempotency_key)` on `verification_runs` |
| Telegram is never delivered twice | `unique (event_key)` on `telegram_outbox`; `update_id` PK on `telegram_updates` |
| A private conversation stays private | `chat_room_members` membership on every chat policy |

All of these are asserted in `supabase/tests/10_invariants.sql`, which runs
against a real PostgreSQL server.

---

## Local development

Requires Node 20+ and a Supabase project (or any PostgreSQL 15+ for the SQL
suites).

```bash
npm install
cp .env.example .env.local     # then fill it in — see the sections below
npm run dev                    # http://localhost:3000
```

Quality gates:

```bash
npm run lint       # ESLint (flat config, next/core-web-vitals + next/typescript)
npm run typecheck  # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test           # unit suite — engines, verification, classification
npm run build      # production build
```

---

## Supabase setup

### 1. The project

`EFootball` is live: project ref `ygxjdgttedyioxgxutvj`, region `eu-central-1`
(Frankfurt), API URL `https://ygxjdgttedyioxgxutvj.supabase.co`. All twelve
migrations are applied, the five buckets exist, Realtime is published and the
demo seed is loaded.

To stand up a second environment, create a project and collect:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- Publishable (anon) key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- Service role key → `SUPABASE_SERVICE_ROLE_KEY`
- Connection string → `SUPABASE_DB_URL`
- Project ref → `SUPABASE_PROJECT_ID`

### 2. Apply the migrations

In order. They are ordinary SQL files, so either the CLI or `psql` works:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_ID"
supabase db push

# or, without the CLI:
for f in supabase/migrations/*.sql; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

| Migration | Contents |
|---|---|
| `…0100_extensions_and_enums` | extensions, the private `app` schema, every enum |
| `…0200_core_tables` | profiles, tournaments, rules, participation, invitations, audit log |
| `…0300_competition_tables` | league rounds, draws, knockout ties, matches, standings snapshots |
| `…0400_evidence_tables` | submissions, evidence, AI extractions, verification runs and cases |
| `…0500_community_tables` | news, chat, notifications, Telegram, moderation, activity |
| `…0600_functions` | auth helpers, capacity enforcement, `join_tournament`, `apply_official_result` |
| `…0700_triggers` | capacity, state machine, immutability and guard triggers |
| `…0800_rls` | RLS on every table, deny-by-default, plus grants |
| `…0900_storage` | five buckets and their object policies |
| `…1000_realtime` | publication + private-channel authorization |
| `…1100_immutability_cascade_fixes` | guards block erasure, allow parent cascades |
| `…1200_revoke_rpc_execute_from_anon` | closes the RPC surface to signed-out callers |

### 3. Storage buckets

Created by migration `0900`:

| Bucket | Public | Limit | Write rule |
|---|---|---|---|
| `avatars` | yes | 2 MB | owner only, under `<user_id>/` |
| `tournament-media` | yes | 5 MB | tournament admins |
| `match-evidence` | yes | 10 MB | the two participants of that match, into `<tournament>/<match>/<uid>/`; **no update or delete policy at all** |
| `news-media` | yes | 5 MB | tournament members |
| `chat-attachments` | **no** | 5 MB | room members only, read *and* write |

Match evidence is public by design — §38 requires anyone to be able to see what
a result was based on. Chat attachments are private: a leaked object path is
worthless to a non-member because the read policy checks room membership.

### 4. Realtime

Migration `1000` publishes only tables whose SELECT policies already restrict
rows correctly, so a subscriber receives exactly what they could have queried.
Private broadcast/presence channels follow `tournament:<id>` and `room:<id>`,
authorized through `realtime.messages` policies.

### 5. Seed (optional)

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed/seed.sql
```

Creates two fictional tournaments: `friday-cup-demo` (8 players, full league
schedule, first four rounds verified) and `sixteen-invite-demo` (15 of 16 seats
taken, for exercising the last-seat capacity race). The second one carries the
fixed join code `DEMO-2026`, so the join-by-code flow can be walked without
looking anything up in the database. The seeded accounts have
an unusable password hash and cannot sign in — there are no default credentials
and no admin backdoor.

### 6. Advisors

The security advisor was run against the live project. What remains is
deliberate, with one item left for you in the dashboard:

| Finding | Status |
|---|---|
| `anon` could execute four `SECURITY DEFINER` RPCs | **Fixed** in migration `…1200`. They already returned `UNAUTHENTICATED`, but Supabase's default privileges grant `EXECUTE` to `anon` explicitly and `revoke ... from public` does not undo it. |
| `authenticated` can execute those four RPCs | **Intended.** `join_tournament`, `check_in_tournament`, `open_direct_room` and `mark_room_read` exist precisely to be called by signed-in users, and each re-derives the caller from `auth.uid()`. |
| `telegram_outbox` / `telegram_updates` have RLS on with no policy | **Intended.** RLS enabled with no policy is a total deny for every non-service role — which is exactly right for a delivery queue holding chat ids. |
| Leaked-password protection disabled | **Action for you.** Enable it under Authentication → Policies; it checks new passwords against HaveIBeenPwned. It is an Auth setting, not SQL, so it cannot be applied from a migration. |

---

## Telegram setup

Telegram is an **alert and deep-link channel only**. No command can change
tournament state; the database stays the source of truth.

1. Create a bot with [@BotFather](https://t.me/botfather).
   - token → `TELEGRAM_BOT_TOKEN`
   - username (no `@`) → `TELEGRAM_BOT_USERNAME`
2. Generate a webhook secret (32+ random characters) → `TELEGRAM_WEBHOOK_SECRET`.
3. Register the webhook once the app is deployed:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"$NEXT_PUBLIC_APP_URL/api/telegram/webhook\",
       \"secret_token\":\"$TELEGRAM_WEBHOOK_SECRET\",
       \"allowed_updates\":[\"message\"]}"
```

4. Each admin links their own account: **الملف الشخصي → ربط Telegram**, which
   issues a single-use token valid for 15 minutes and opens the bot with
   `/start <token>`. The webhook trades it for the chat id and clears it.

Every delivery goes through `telegram_outbox`, keyed by event, so a retried
pipeline run never double-sends and an outage leaves a pending row. A Vercel
Cron entry drains it via `/api/telegram/retry`, protected by `CRON_SECRET`.

`vercel.json` schedules that drain daily (`0 3 * * *`), because a Hobby account
rejects any cron expression that fires more than once a day. On Pro, change it
to `*/10 * * * *` — a ten-minute drain is what the outbox is sized for, and the
route is idempotent, so running it more often is always safe. The schedule only
governs retries: the first delivery attempt happens inline with the event.

**Alerts sent:** player joined, tournament full, check-in started, first
evidence, second evidence, verified result, mismatch, low confidence, AI
unavailable, correction request, draw completed, champion. Each carries a
deep-link button to the exact admin page.

---

## AI setup

Set `AI_API_KEY` to an Anthropic API key. Two separate components:

**AI Result Verifier** (`lib/ai/vision.ts`) reads a screenshot into a structured
extraction: both players, both teams, crest detection, the score, penalties and
every visible statistic, plus four confidence bands. Statistics are an open
record — a metric the game adds tomorrow is captured without a schema change.
Output is validated with Zod before anything is stored; it is untrusted data
until it passes.

**AI Match Reporter** (`lib/ai/reporter.ts`) receives *only* verified structured
facts and writes Arabic sports copy. It is never given raw evidence and never
sees an unverified result.

**Failure behaviour.** If the provider is unavailable, evidence stays stored and
the match moves to `awaiting_verification` for an idempotent retry. After
`MAX_AI_ATTEMPTS` it becomes a manual-review case. A missing key never
auto-approves anything. If the reporter fails, a deterministic fallback article
is used that states only the classified facts.

**Thresholds** are per tournament: `ai_min_confidence` (default 0.85) and
`ai_statistic_tolerance` (default 0.15).

---

## Vercel deployment

Live at **https://efootball-iota.vercel.app**.

The project is **`efootball`**, framework `nextjs`, root directory `efootball/`,
functions in `fra1` (same region as the Supabase project, so a query does not
cross the Atlantic twice), linked to `dddgbvc/Soufyan-Store`. Vercel
Authentication is off, so the production URL is publicly reachable — the app's
own auth and RLS are the security boundary, not a login wall in front of the
whole site.

The production branch is `claude/new-session-07dkbq`, which is where the
application lives; `main` does not carry it. Set that as the project's
production branch in the Vercel dashboard (or merge the branch into `main`)
for a push to redeploy on its own.

Already set in the project's environment: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`
and `TELEGRAM_WEBHOOK_SECRET` (the last two generated as 32 random bytes).

Still to add, because they are credentials this repository must never see:

| Variable | Where it comes from |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys |
| `AI_API_KEY` | Anthropic Console |
| `TELEGRAM_BOT_TOKEN` | @BotFather |
| `TELEGRAM_BOT_USERNAME` | the bot's username, without the `@` |

None of them may carry the `NEXT_PUBLIC_` prefix. Without `AI_API_KEY` the
platform still runs: evidence is stored and matches park in manual review. The
two Telegram values only gate alerts.

`NEXT_PUBLIC_APP_URL` is already the production origin. It is a
`NEXT_PUBLIC_` variable, so it is inlined at build time: changing it needs a
redeploy, not just a restart. The Telegram webhook has to be re-registered
against that origin once a bot token exists.

**If Vercel ever reports `git_info_fail`**, the account has lost its GitHub
login connection (`vercel.com/account/login-connections`). Vercel then cannot
read the repository at all and the deployment fails at source retrieval,
before any build starts.

`vercel.json` declares the cron entry and the longer timeouts the evidence and
verification routes need.

Nothing requires a persistent process, a VPS, Docker or a separate Express
server.

---

## Testing

```bash
npm test         # 80 unit tests — no database needed
npm run test:sql # migrations + seed + SQL invariants on a throwaway database
npm run test:db  # RELEASE BLOCKER: registration concurrency, needs SUPABASE_DB_URL
```

**Unit suite** (`tests/`) covers schedule generation (fixture counts, ordered
pairs, per-round uniqueness, determinism), standings and the full tie-break
chain, qualification zones, knockout aggregate/ET/penalties/away-goals, the
official draw, AI schema validation, dual-screenshot cross verification
(including mirrored screenshots and screenshots from a different match), event
classification, and the tournament state machine.

**SQL suite** (`supabase/tests/`) applies every migration to a scratch database
and asserts the database-level guarantees, including that an unrelated user is
denied the tournament group, that changing a conversation id never exposes
another conversation, that system messages cannot be forged, and that RLS is
enabled on every table in `public`.

**Integration suite** (`tests/integration/`) is the §8 release blocker. It runs
real concurrent `join_tournament()` calls against a real server:

```bash
SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres" \
  npm run test:db
```

With capacity 8 and 7 players registered, two simultaneous requests produce
exactly one success and exactly one `TOURNAMENT_FULL`, and the final count is
exactly 8. A wider stampede for the last two slots behaves the same. Without
`SUPABASE_DB_URL` the suite **skips** rather than passing silently.

A local PostgreSQL is enough for both SQL suites — `supabase/tests/00_supabase_shim.sql`
recreates just the pieces of Supabase (roles, `auth.uid()`, `storage.foldername`)
that the migrations depend on.

---

## Project structure

```
app/                      routes — public, dashboard, admin, API
components/               UI, including the Tournament Flow Rail
  admin/                  command-centre components
lib/
  ai/                     vision adapter, schema, cross-verification, pipeline, reporter
  api/                    route helpers, rate limiting
  bracket/                draw, knockout aggregate engine
  league/                 scheduler, standings + tie-breaks
  news/                   deterministic classification, publishing
  permissions/            server-side authorization, audit logging
  supabase/               browser / server / service-role clients, middleware
  telegram/               client, message composition, outbox
  tournament/             types, presets, lifecycle, queries, engine
  validation/             Zod schemas for every input
supabase/
  migrations/             ordered schema, RLS, storage, realtime
  seed/                   demo data
  tests/                  Supabase shim + SQL invariant assertions
tests/                    unit suite
  integration/            database concurrency suite
scripts/verify-sql.sh     apply + assert against a throwaway database
types/database.ts         database types (regenerate with npm run db:types)
```

---

## Security review

Reviewed adversarially before delivery. Findings and their resolutions:

| Area | Result |
|---|---|
| Capacity bypass / race conditions | Row lock + CHECK; proven by the concurrency suite |
| Join code abuse | Eight characters from a 32-letter alphabet, in an admin-only table no participant can read; lookups rate limited per account; a code alone admits nobody — the organiser approves every request |
| RLS bypass / IDOR | Every policy joins back to a real membership or ownership row; verified for group chat, DMs, attachments and join requests |
| Privilege escalation | `is_platform_admin` cannot be self-raised (trigger); self-approval impossible (no player UPDATE policy) |
| Result manipulation | Players hold no write privilege on `matches`; scores only change through `apply_official_result` |
| Bracket / standings tampering | Same; standings are derived from verified matches only |
| Evidence tampering | Storage has no update/delete policy; the table has an immutability trigger; the server re-hashes the stored bytes instead of trusting the client's hash |
| Telegram spoofing | Webhook secret compared in constant time; unsigned payloads rejected before parsing |
| Webhook replay | `update_id` is the primary key of `telegram_updates` |
| AI output manipulation | Zod-validated before storage; a matching score alone never verifies a result |
| Secret leakage | Service role and AI keys behind `server-only`; no secret under `NEXT_PUBLIC_` |
| Private chat leakage | Membership-gated policies; asserted in the SQL suite |
| Public storage leakage | Chat attachments in a private bucket with a membership read policy |
| XSS | No `dangerouslySetInnerHTML` on user content; the one use is a server-generated QR SVG |
| Realtime | Only RLS-safe tables published; private channels authorized via `realtime.messages` |

Four real defects were found and fixed — the last three only surfaced when the
schema was applied to a live project and the delete paths were actually
exercised:

1. **`REGISTRATION_CLOSED` masked `TOURNAMENT_FULL`.** Once the last slot was
   taken the status flipped to `registration_full`, so the next player was told
   registration had closed. §8 requires `Tournament Full`. The status gate now
   lets `registration_full` through to the capacity check, which also means a
   withdrawal correctly reopens the slot.
2. **Audit immutability made tournaments undeletable.** `audit_logs` referenced
   `tournaments` with `ON DELETE SET NULL`; that update is exactly what the
   immutability trigger refuses, so the delete policy could never succeed. The
   ledger now stores plain uuids — it is meant to outlive what it describes.
3. **Evidence immutability blocked parent cascades.** Deleting a tournament
   cascades to its matches and then to their evidence, and the guard refused
   that too — so any tournament that had ever received a screenshot could never
   be deleted. A cascade is now distinguished from an erasure by checking
   whether the parent row still exists; a direct delete is still refused. The
   same applied one level down, to `ai_extractions`.
4. **A user who had ever sent a message could not be deleted.** `sender_id` is
   `ON DELETE SET NULL` so a conversation survives when one side leaves, but the
   chat identity guard refused the null-ing. Anonymising a departed author is
   now allowed — and only when their profile is genuinely gone. Reassigning
   authorship to a live user, and promoting a user message into a trusted system
   message, are both still refused.

---

## Known limitations

- **Presets not yet production-ready.** `knockout8`, `knockout16` and
  `groups_knockout` are visible but disabled, because their bracket generation
  is not implemented or tested. `league8_double_playoffs`, `league8_double` and
  `custom` are complete. The API rejects a request for a non-ready preset.
- **Rate limiting is per instance.** `lib/api/rateLimit.ts` is in-process, so it
  blunts hammering rather than enforcing a quota across serverless instances.
  Every real invariant is in the database, not here.
- **Chat read receipts and typing indicators** are modelled (`chat_read_state`)
  and used for unread counts, but per-message read state and typing presence are
  not surfaced in the UI yet.
- **AI behaviour is untested against real screenshots.** The extraction schema,
  the cross-verification rules and every failure path are covered by tests with
  synthetic extractions; the prompt itself needs tuning against real eFootball
  result screens before a first live tournament.
