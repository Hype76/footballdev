# Paywall Config Gate Status

Date: 2026-06-22

Reference: FP-PAYWALL-CONFIG-GATES-14

Status: Amber.

This is a config-gate preparation report only. No production deploy, Netlify production trigger, Supabase production migration, production environment edit, Stripe product or Price change, subscription migration, customer announcement, staging cleanup, or football-os-staging use occurred.

## 1. Release Ref

Clean release worktree:

`E:\Project Manager\Footbal_Development_paywall_release`

Branch:

`codex/paywall-release`

Starting HEAD:

`0744354354b807bcf6e3e2e0641646ebaf9b10c5`

Remote branch confirmed:

`origin/codex/paywall-release`

Pre-change status:

- `git status --short`: clean.
- `git branch -vv`: current branch was `codex/paywall-release`.
- `HEAD` matched `origin/codex/paywall-release`.
- `football-os-staging` was not present as a remote head and was not used.

## 2. Stripe Gate Status

Status: Amber.

Production Netlify environment metadata for site `264c7a36-8b0d-4a35-bedd-9d18482aaf69` confirms:

| Item | Production status |
| --- | --- |
| `STRIPE_SECRET_KEY` | Present as a masked secret |
| `STRIPE_WEBHOOK_SECRET` | Present as a masked secret |
| `VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID` | Present and has `price_` format |
| `VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID` | Present and has `price_` format |
| `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` | Missing |
| `VITE_PAYMENTS_DISABLED` | `false` in production |
| `VITE_SUPABASE_URL` | Points to `hvapkizujvsahvgspser` |
| `VITE_APP_URL` | Points to `https://footballplayer.online` |

The available Stripe connector exposed read-only Price and Product operations, but calls returned a connector routing error:

`Unknown tool: list_prices`

Because the Stripe secret is masked in Netlify and no approved unmasked Stripe API path was available, Stripe live object verification remains a manual Steve gate.

Steve manual Stripe verification steps:

1. Open Stripe Dashboard in live mode for the Jeluma Labs account.
2. Open Products, then verify the Single Team production Price ID from Netlify:
   - Product is the intended Single Team product.
   - Price is active.
   - Currency is GBP.
   - Amount is GBP 12.99 monthly.
   - Recurring interval is monthly.
3. Open Products, then verify the Small Club production Price ID from Netlify:
   - Product is the intended Small Club product.
   - Price is active.
   - Currency is GBP.
   - Amount is GBP 34.99 monthly.
   - Recurring interval is monthly.
4. Confirm there is no Development Club production Price ID configured unless Steve has approved one.
5. Open Developers, then Webhooks.
6. Confirm the live webhook endpoint exists, is enabled, and points to:

`https://footballplayer.online/.netlify/functions/stripe-webhook`

7. Confirm the endpoint sends these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
8. Confirm the Netlify production `STRIPE_WEBHOOK_SECRET` belongs to that endpoint without printing the secret.
9. Confirm the Stripe account is live mode, not test mode.

Stop condition:

Do not deploy if either live Price is inactive, has the wrong amount, has the wrong interval, belongs to the wrong Product, is in test mode, or the webhook endpoint cannot be matched to the Netlify production webhook secret.

## 3. Development Club Checkout Gate Status

Status: Green for temporary fail-closed behavior.

Production behavior after this task:

- Development Club public pricing remains visible at GBP 59.99 per month.
- Development Club does not start checkout unless `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` exists and begins with `price_`.
- When the Price ID is missing, the public CTA becomes `Request demo`.
- Clicking it opens the demo request flow and shows:

`Development Club checkout is not open yet. Request a demo and we will help set up the right plan.`

- The Netlify checkout function still fails closed if called directly without the Price ID.
- Missing Development Club Price ID is a controlled unavailable state, not a 500-style user path.
- Large Club remains contact-sales only.
- Free checkout remains blocked from Stripe checkout.

Code changed:

- `src/lib/login-pricing.js`
- `src/pages/PublicPricingPage.jsx`
- `tests/paywall-commerce-alignment.test.mjs`

Focused validation:

- `node --test tests/paywall-commerce-alignment.test.mjs`: passed, 7 of 7.

## 4. Supabase Migration Gate Status

Status: Amber.

Verified production project:

| Item | Status |
| --- | --- |
| Production ref | `hvapkizujvsahvgspser` |
| Production project name | `FootballDev` |
| Region | `eu-west-2` |
| Status | `ACTIVE_HEALTHY` |
| Postgres | 17.6.1.104 |
| Local worktree linked | No |

Latest backup evidence:

- `2026-06-22T03:56:11.220Z`
- Physical backup: yes
- Status: `COMPLETED`
- PITR: false
- Region: `eu-west-2`

This backup is acceptable for a controlled deployment retry if Steve accepts daily physical backup recovery rather than point-in-time recovery. Because PITR is false, any serious production database issue should be handled by a forward-fix migration first, with physical backup restore as the heavier recovery path.

Supabase CLI status:

- Installed CLI: `2.65.5`
- Current CLI advertised by Supabase: `2.107.0`
- The installed CLI supports `supabase link`, `supabase migration list`, and `supabase db push --dry-run`.
- Because Supabase changes frequently, update or explicitly accept this CLI version before applying production migrations.

Relevant Supabase changelog notes reviewed:

- `2026-04-28`: new tables may no longer be automatically exposed to the Data API. These paywall migrations do not create new tables, but this reinforces the need to verify grants and RLS after any future table-creating migration.
- `2026-05-25`: pg_graphql introspection change. Not relevant to these paywall migrations.
- `2026-05-12`: Postgres 14 support removal. Production is Postgres 17, so not relevant.

Required migration files and order:

1. `supabase/migrations/20260622043000_paywall_plan_key_foundation.sql`
2. `supabase/migrations/20260622050850_paywall_server_enforcement.sql`

Migration compatibility assessment:

- `20260622043000_paywall_plan_key_foundation.sql` adds `development_club` to plan constraints and replaces helper functions. It does not mutate production plan data.
- `20260622050850_paywall_server_enforcement.sql` replaces paywall feature helper logic and RLS/storage policies. It does not mutate production plan data.
- Both migrations are intended to be forward-compatible with existing `individual`, `single_team`, `small_club`, and `large_club` rows.
- Migration before app deploy is preferred.
- App deploy before migration is not recommended because the release expects canonical `development_club` support and server-side paywall enforcement to exist in production.
- Migration can run before app deploy because existing plan keys remain valid and the new functions preserve core access paths.

Safe manual Supabase command path:

```powershell
supabase projects list -o json
```

Confirm the target project is exactly:

`hvapkizujvsahvgspser`

Then link the clean worktree only after confirmation:

```powershell
supabase link --project-ref hvapkizujvsahvgspser
```

Confirm the local link:

```powershell
Get-Content -LiteralPath supabase\.temp\project-ref
```

Expected output:

`hvapkizujvsahvgspser`

List remote and local migration status:

```powershell
supabase migration list --linked
```

Dry-run pending migrations:

```powershell
supabase db push --dry-run --linked
```

Stop if the dry-run includes any migration before:

`20260622043000_paywall_plan_key_foundation.sql`

Stop if the dry-run omits either required paywall migration.

Apply only in the production deploy retry task after Steve approval:

```powershell
supabase db push --linked
```

Alternative secret-safe path if Steve does not want to link the worktree:

```powershell
supabase migration list --db-url "$env:SUPABASE_PRODUCTION_DB_URL"
supabase db push --dry-run --db-url "$env:SUPABASE_PRODUCTION_DB_URL"
supabase db push --db-url "$env:SUPABASE_PRODUCTION_DB_URL"
```

Do not print the database URL.

Post-migration validation queries:

```sql
select public.normalize_subscription_plan_key('Development Club') as development_key;
```

Expected:

`development_club`

```sql
select public.normalize_subscription_plan_key('Large Club') as large_key;
```

Expected:

`large_club`

```sql
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.clubs'::regclass,
  'public.tester_access_codes'::regclass,
  'public.club_owner_invites'::regclass
)
and conname like '%plan_key%';
```

Expected:

Each plan key check includes `development_club`.

```sql
select public.can_use_plan_feature(id, 'advancedDevelopmentAnalytics') as development_analytics_allowed
from public.clubs
where plan_key = 'development_club'
limit 5;
```

Expected:

Returns true for active or comped Development Club rows.

```sql
select public.can_use_plan_feature(id, 'integrations') as integrations_allowed
from public.clubs
where plan_key = 'development_club'
limit 5;
```

Expected:

Returns false.

```sql
select polname, tablename
from pg_policies
where schemaname = 'public'
and polname in (
  'calendar_events_insert_scoped',
  'calendar_events_update_scoped',
  'calendar_events_delete_scoped',
  'parent_player_links_insert_scoped',
  'club_user_invites_insert_scoped',
  'parent_email_templates_select_scoped',
  'parent_email_templates_insert_scoped',
  'parent_email_templates_update_scoped',
  'audit_logs_select_scoped',
  'form_fields_insert_scoped',
  'form_fields_update_scoped',
  'form_fields_delete_scoped'
)
order by tablename, polname;
```

Expected:

All listed policies exist.

Rollback or forward-fix strategy:

- Preferred: forward-fix with a new migration that restores the previous function or policy body.
- Do not run ad hoc production SQL unless Steve approves the exact SQL.
- Do not remove migration history rows as a rollback.
- If a severe database-level issue occurs and forward-fix is unsafe, use Supabase physical backup restore according to the Supabase Dashboard recovery path. PITR is not enabled.

## 5. Netlify Release Gate Status

Status: Green for site identity and source discipline, Amber overall because deploy still depends on Stripe and Supabase manual gates.

Netlify project confirmed through the Netlify connector:

| Item | Status |
| --- | --- |
| Site name | `footballplayer-online` |
| Site ID | `264c7a36-8b0d-4a35-bedd-9d18482aaf69` |
| Primary URL | `https://footballplayer.online` |
| Project URL | `https://app.netlify.com/projects/footballplayer-online` |
| Current deploy state | ready |
| Forms | not enabled |
| Visitor password | not required |
| Team SSO | not required |

Release source recommendation:

Use one of these only:

1. `origin/codex/paywall-release`.
2. A manual deploy artifact built from `E:\Project Manager\Footbal_Development_paywall_release` after all validation passes.

Do not use:

- Dirty original checkout `E:\Project Manager\Footbal_Development`.
- `football-os-staging`.
- Any branch deploy artifact.
- Any stale `dist` folder built before this gate task.

No Netlify deploy was triggered in this task.

## 6. Remaining Manual Actions For Steve

1. Verify Stripe live Single Team and Small Club Prices in Dashboard.
2. Verify the live Stripe webhook endpoint and signing secret relationship in Dashboard.
3. Accept Development Club as visible but demo-request gated until a real live Price ID is approved, or provide the approved live Development Club Price ID through secret-safe handling.
4. Decide whether the `2026-06-22T03:56:11.220Z` physical backup is acceptable for the deploy retry, or request a fresher backup checkpoint.
5. Approve linking the clean worktree to Supabase production, or provide a secret-safe database URL path.
6. Approve the production migration dry-run in the deploy retry task.

## 7. Validation Results

Validation commands run in this task:

| Command | Result |
| --- | --- |
| `git status --short` | Clean before changes |
| `git branch -vv` | Current branch `codex/paywall-release` |
| `git rev-parse HEAD` | Started at `0744354354b807bcf6e3e2e0641646ebaf9b10c5` |
| `git ls-remote --heads origin codex/paywall-release football-os-staging main` | `codex/paywall-release` and `main` returned; `football-os-staging` did not |
| `supabase projects list -o json` | `FootballDev` production ref `hvapkizujvsahvgspser` returned `ACTIVE_HEALTHY` |
| `supabase backups list --project-ref hvapkizujvsahvgspser -o json` | Latest physical backup completed at `2026-06-22T03:56:11.220Z` |
| `node --test tests/paywall-commerce-alignment.test.mjs` | Passed, 7 of 7 |
| `npm.cmd run build` | Passed, including live Supabase build verification |
| `node --test tests/paywall-plan-normalization.test.mjs tests/paywall-access-model.test.mjs tests/paywall-ui-alignment.test.mjs tests/paywall-server-enforcement.test.mjs tests/paywall-commerce-alignment.test.mjs tests/paywall-hardening-matrix.test.mjs` | Passed, 37 of 37 |
| `npm.cmd run test:platform` | Passed, 102 of 102 |
| `npm.cmd run test:v1-stabilise` | Passed, 47 of 47 |
| `npm.cmd run check:local-live-validation-safety` | Passed |
| `git diff --check` | Passed |
| Forbidden character scan for em dash and smilies | Passed |

Required final checks before commit:

- `git diff --cached --check`

## 8. Branch Push Status

Prepared for push to:

`origin/codex/paywall-release`

The release branch is intended to be pushed after the final cached diff check and commit complete. The pushed HEAD is the commit containing this document and the Development Club checkout handling change.

Expected commit message for this task:

`fix: handle missing development club checkout config safely`

## 9. Final Recommendation

Amber: the controlled production deploy retry can proceed only after Steve completes the listed Stripe and Supabase manual confirmations. Development Club checkout behavior is now safe for the temporary missing-Price-ID production state, but Stripe live object details and migration approval remain release gates.
