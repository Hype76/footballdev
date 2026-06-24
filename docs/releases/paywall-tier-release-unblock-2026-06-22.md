# Paywall Release Unblock Status

Date: 2026-06-22

Reference: FP-PAYWALL-UNBLOCK-12

Previous stop: FP-PAYWALL-PROD-11

Status: Amber.

This is a release-unblock report, not a production deployment approval. No production deploy, production Supabase migration, production environment edit, live Stripe object change, subscription migration, customer announcement, or staging cleanup was performed.

## 1. Executive Summary

FP-PAYWALL-PROD-11 stopped correctly before production changes. This pass resolved several unknowns through read-only inspection and validation, but it did not make the production retry Green.

A later production retry is possible only after these manual confirmations:

- Steve approves the clean release artifact and exact Git branch or PR path for the paywall release commits.
- Steve confirms whether the unrelated staging-retirement cleanup should be separately committed, stashed, or left out through a clean worktree.
- Stripe live objects for the existing Single Team and Small Club Price IDs are verified in Stripe Dashboard or through a trusted unmasked Stripe API path.
- Steve accepts that Development Club checkout remains fail-closed, or supplies a real live Development Club `price_` ID through approved secret handling.
- Steve approves linking this checkout or a clean release checkout to Supabase production before migration dry-run and application.

Recommended verdict: Amber. Do not retry production deployment until the listed decisions are complete.

## 2. Actions Taken

- Re-read the FP-PAYWALL-PROD-11 stop report and current release runbook.
- Fetched and pruned origin refs.
- Inspected current branch, HEAD, remotes, remote containment, local status, and release commit ancestry.
- Classified the dirty worktree.
- Inspected Netlify site link and production environment variable presence without printing secrets.
- Confirmed Supabase production project inventory and latest backup.
- Inspected paywall migration files and checkout fail-closed behavior.
- Ran local validation on the current checkout.
- Created this unblock addendum.

## 3. Actions Deliberately Not Taken

- No deploy was run.
- No production Supabase migration was applied.
- No production Supabase project link was created.
- No production environment variable was edited.
- No Stripe product, price, webhook, or secret was created or changed.
- No Stripe Price ID was guessed.
- No subscription was migrated or repriced.
- No customer announcement was sent.
- No unrelated dirty file was staged.
- No staging-retirement cleanup was committed in this paywall release pass.
- No branch was pushed automatically.

## 4. Git And Deploy Ref Readiness

Current local state inspected:

- Branch: `football-os-staging`.
- HEAD before this addendum: `bbc68fae5c344e0c0df5a497b5f3862ca8b96641`.
- HEAD subject: `docs: prepare paywall release runbook`.
- Remote: `origin https://github.com/Hype76/footballdev.git`.
- `origin/main`: `ac514c4a78f257f35d7b0aed03eb913e5af65a48`.
- `bbc68fae5c344e0c0df5a497b5f3862ca8b96641` is not contained in `origin/main`.
- `origin/main` is an ancestor of `bbc68fae5c344e0c0df5a497b5f3862ca8b96641`.
- `origin/football-os-staging` was not present after fetch and prune.
- No upstream is configured for local `football-os-staging`.

Release commit stack present locally:

- `426af5a` docs: record approved paywall tier model.
- `80c23d3` feat: normalize paywall plan keys.
- `abb5c73` feat: centralize paywall feature access.
- `5a73cb6` feat: align paywall UI and routes.
- `ce68a64` feat: enforce paywall access server side.
- `453d986` feat: align pricing and checkout tiers.
- `746fd66` test: harden tier and paywall access.
- `bbc68fa` docs: prepare paywall release runbook.

Safe upstream recommendation:

Do not recreate or push `football-os-staging` as the production release upstream. The name is staging-oriented and conflicts with the retired V1 staging cleanup direction. Use a fresh release branch or PR branch from the clean paywall commit stack, for example:

```powershell
git push origin bbc68fae5c344e0c0df5a497b5f3862ca8b96641:refs/heads/codex/paywall-release
```

Only run that after Steve confirms `codex/paywall-release` is the intended review branch. That command pushes only the committed release stack, not the dirty worktree.

## 5. Dirty Worktree Classification

Current dirty files are deploy-affecting, but they are not required for the paywall release. They appear to be staging-retirement cleanup and should not enter the paywall production release artifact unless Steve explicitly approves that separate cleanup.

| File | Classification | Deploy impact | Recommendation |
| --- | --- | --- | --- |
| `.env.staging` | Staging-retirement related | Build or local config reference | Leave untouched for now. Separate cleanup decision. |
| `PROJECT_PLAN.md` | Staging-retirement related documentation | No runtime impact | Separate cleanup commit or leave untouched. |
| `docs/live-backup-baseline-2026-05-25.md` | Staging-retirement related documentation | No runtime impact | Separate cleanup commit or leave untouched. |
| `docs/staging-verification-2026-05-27.md` | Staging-retirement related documentation | No runtime impact | Separate cleanup commit or leave untouched. |
| `netlify.toml` | Staging-retirement related, deploy-affecting | Production and branch deploy build behavior | Do not include in paywall artifact unless separately approved. |
| `netlify/functions/_stripe-billing.js` | Staging-retirement related, deploy-affecting | Checkout function behavior | Do not include in paywall artifact unless separately approved. |
| `netlify/functions/_supabase.js` | Staging-retirement related, deploy-affecting | Function Supabase resolution | Do not include in paywall artifact unless separately approved. |
| `netlify/functions/create-parent-account.js` | Staging-retirement related, deploy-affecting | Parent account link host behavior | Do not include in paywall artifact unless separately approved. |
| `netlify/functions/prepare-staging-test-signup.js` | Staging-retirement related, deploy-affecting | Staging test signup endpoint | Do not include in paywall artifact unless separately approved. |
| `package.json` | Staging-retirement related, deploy-affecting | Build and safety scripts | Do not include in paywall artifact unless separately approved. |
| `scripts/netlify-deploy-safety-check.mjs` | Staging-retirement related, deploy-affecting | Deploy safety checks | Do not include in paywall artifact unless separately approved. |
| `scripts/staging-click-audit.mjs` | Staging-retirement related | Audit tooling only | Separate cleanup commit or leave untouched. |
| `scripts/verify-web-build-env.mjs` | Staging-retirement related, deploy-affecting | Build verification behavior | Do not include in paywall artifact unless separately approved. |
| `src/lib/app-origins.js` | Staging-retirement related, deploy-affecting | Runtime origin routing | Do not include in paywall artifact unless separately approved. |
| `supabase/config.toml` | Staging-retirement related | Auth redirect config source | Separate cleanup decision, do not apply to production without approval. |
| `tests/netlify-deploy-safety.test.mjs` | Staging-retirement related | Test behavior | Separate cleanup commit or leave untouched. |
| `scripts/staging-retired.mjs` | Staging-retirement related | Script helper | Separate cleanup commit or leave untouched. |

Deploy-safe repo-state recommendation:

Use a clean worktree or clean clone checked out at the approved paywall release commit for any production retry. Do not deploy from this working directory while these dirty files are present unless Steve separately approves and commits the staging-retirement cleanup first.

## 6. Netlify Production Deploy Safety

Confirmed:

- Local Netlify state is linked to site id `264c7a36-8b0d-4a35-bedd-9d18482aaf69`.
- `netlify status` reports current project `footballplayer-online`.
- Project URL is `https://footballplayer.online`.
- Netlify production env inspection succeeded without printing secret values.
- Local live validation passed and confirmed `dist` contains `hvapkizujvsahvgspser` and not `llpufwzvgxyczxcjwupu`.

Not fully confirmed:

- `netlify api getSite` was attempted for build settings, but the CLI rejected the PowerShell JSON payload. Earlier concurrent Netlify status/API attempts also hit local CLI config rename locks.
- Automatic Git deployment branch settings therefore need Dashboard confirmation before production retry.

Deployment safety recommendation:

Preferred retry path is a clean manual artifact deploy from the approved release commit after all gates pass:

```powershell
npm.cmd run build
npm.cmd run check:local-live-validation-safety
npx.cmd netlify deploy --prod --dir=dist --no-build
```

Do not run that in this unblock pass. Before a real retry, confirm Netlify Dashboard build settings and whether Git auto-deploy is connected to `main` only.

## 7. Stripe Live Verification Status

Required variables:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID`
- `VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID`
- `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID`, only if Development Club checkout is enabled.
- Optional annual compatibility variables for Single Team, Small Club, and Development Club.

Confirmed through Netlify production env inspection:

- `STRIPE_SECRET_KEY` exists but is masked.
- `STRIPE_WEBHOOK_SECRET` exists but is masked.
- `SUPABASE_SERVICE_ROLE_KEY` exists but is masked.
- `VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID` is present and has `price_` format.
- `VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID` is present and has `price_` format.
- `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` is missing.
- Single Team and Small Club annual Price IDs are present and have `price_` format, although annual pricing is not publicly advertised by this release.
- `VITE_PAYMENTS_DISABLED` is present.
- `VITE_SUPABASE_URL` points at `hvapkizujvsahvgspser`.

Still not verified:

- Live Stripe mode of the secret key.
- Stripe account ownership.
- Product active state.
- Price active state.
- Price amounts and currency.
- Price recurring intervals.
- Webhook endpoint URL.
- Webhook enabled state.
- Webhook event subscriptions.
- Webhook signing secret match.

Manual Stripe verification required:

Steve or a Stripe operator must verify in the live Stripe Dashboard that:

- Single Team monthly Price ID matches GBP 12.99 monthly and is active.
- Small Club monthly Price ID matches GBP 34.99 monthly and is active.
- Both Prices belong to the intended Jeluma Labs live Stripe account and active Products.
- The production webhook endpoint points to `https://footballplayer.online/.netlify/functions/stripe-webhook`.
- The webhook is enabled and includes `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- The Netlify `STRIPE_WEBHOOK_SECRET` belongs to that endpoint.

No Stripe connector result was used as authoritative because the exposed connector returned an unknown-tool error in the previous release attempt.

## 8. Development Club Checkout Handling

Current status: fail-closed.

Source behavior:

- Public pricing includes Development Club as a visible self-service tier.
- Checkout code recognizes `development_club` as a self-service plan key.
- `getCheckoutPriceId('development_club', 'monthly')` depends on `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID`.
- If the env var is missing, `create-checkout-session.js` returns `400` with `This plan is not available for checkout yet`.
- Tests cover the unconfigured Development Club fail-closed path.

Product risk:

Development Club is visible as self-service but cannot start live checkout until a real live Price ID is configured. That is safe from a billing integrity perspective, but it is not a fully polished purchase flow unless Steve accepts the temporary visible-but-disabled behavior.

Recommendation:

Keep Development Club checkout disabled for the next retry unless Steve supplies and verifies a real live `price_` ID. If Steve wants visible-but-contact/admin-only behavior, make a small explicit UI copy change before production retry so customers are not sent into a broken purchase attempt.

## 9. Supabase Release Readiness

Confirmed:

- Production Supabase ref is `hvapkizujvsahvgspser`.
- Project name is `FootballDev`.
- Region is `eu-west-2`.
- Project status is `ACTIVE_HEALTHY`.
- Postgres is `17.6.1.104`.
- Latest physical backup is completed at `2026-06-22T03:56:11.220Z`.
- Local Supabase CLI version is `2.65.5`.
- The checkout is not linked to a Supabase project.
- Supabase changelog review did not show a release-specific blocker for these migration files, but the CLI warns that a newer version exists.

Safe link command, not run:

```powershell
supabase link --project-ref hvapkizujvsahvgspser
```

Enter the production database password only through the CLI prompt or another approved secure path. After linking, verify:

```powershell
supabase migration list --linked --output json
supabase db push --dry-run --linked
```

Do not run `supabase db push --linked` until Steve approves the migration window.

## 10. Migration Readiness

Migration order:

1. `supabase/migrations/20260622043000_paywall_plan_key_foundation.sql`
2. `supabase/migrations/20260622050850_paywall_server_enforcement.sql`

Foundation migration purpose:

- Adds `development_club` as a first-class SQL plan key.
- Replaces plan key constraints on `clubs`, `tester_access_codes`, and `club_owner_invites`.
- Adds and grants `normalize_subscription_plan_key`.
- Replaces plan helper functions for features, teams, players, and staff.
- Caps Large Club team creation at 10 unless comped, preserving no-unlimited-by-default behavior.

Foundation compatibility:

Mostly backward-compatible for recognized plan keys because it expands allowed plan keys and replaces helper logic. It can tighten behavior for unknown or malformed values because normalization now fails closed.

Server enforcement migration purpose:

- Replaces `can_use_plan_feature`.
- Adds `can_insert_evaluation_for_plan`.
- Adds overloaded `can_insert_player_for_plan`.
- Adds `can_insert_staff_invite_for_plan`.
- Replaces RLS policies for calendar, parent links, club invites, email templates, audit logs, form fields, and storage logo objects.
- Adds `enforce_club_plan_update_features`.
- Grants helper execution to authenticated users.

Server enforcement compatibility:

This is not purely cosmetic. It is intended enforcement and can deny flows that were previously allowed when feature, role, ownership, or plan context is missing. Run only with approval and immediate validation.

Destructive review:

No `drop table`, `truncate`, `delete from`, or `drop column` operations were found in the paywall migrations. The second migration does drop and recreate RLS and storage policies, which is behavior-changing and must be treated as high-risk authorization work.

Post-migration validation queries:

```sql
select version
from supabase_migrations.schema_migrations
where version in ('20260622043000', '20260622050850')
order by version;

select public.normalize_subscription_plan_key('Development Club') as development_key;
select public.normalize_subscription_plan_key('../large_club') as hostile_large_key;
select public.normalize_subscription_plan_key('<script>large_club</script>') as hostile_script_key;

select conname
from pg_constraint
where conname in (
  'clubs_plan_key_check',
  'tester_access_codes_plan_key_check',
  'club_owner_invites_plan_key_check'
)
order by conname;

select public.can_use_plan_feature(id, 'advancedDevelopmentAnalytics') as development_analytics_allowed
from public.clubs
where plan_key = 'development_club'
limit 5;

select public.can_use_plan_feature(id, 'integrations') as development_integrations_allowed
from public.clubs
where plan_key = 'development_club'
limit 5;

select public.can_use_plan_feature(id, 'integrations') as large_integrations_allowed
from public.clubs
where plan_key = 'large_club'
limit 5;

select schemaname, tablename, policyname
from pg_policies
where schemaname in ('public', 'storage')
  and tablename in (
    'calendar_events',
    'parent_player_links',
    'club_user_invites',
    'parent_email_templates',
    'audit_logs',
    'form_fields',
    'objects'
  )
order by schemaname, tablename, policyname;
```

Also run the existing unknown-plan report before migration:

```powershell
node scripts/report-unknown-plan-values.mjs
```

That requires approved secure production Supabase env values and must not print secrets.

## 11. Validation Results

Safe validation run on the current checkout:

- `git status --short`: dirty with staging-retirement files and this release addendum.
- `git branch -vv`: local `football-os-staging` at `bbc68fa` before this addendum, no upstream.
- `git remote -v`: origin is `https://github.com/Hype76/footballdev.git`.
- `git log --oneline --decorate -n 20`: paywall release stack present locally through `bbc68fa`.
- `git diff --check`: passed, with line-ending warnings only.
- `npm.cmd run build`: passed. Postbuild verified live Supabase project in web build.
- Paywall tests: 36 passed.
- `npm.cmd run test:platform`: 102 passed.
- `npm.cmd run test:v1-stabilise`: 47 passed.
- `npm.cmd run check:local-live-validation-safety`: passed. `dist` has live Supabase ref and no retired staging ref.

These validations do not make the release Green because they ran against a dirty checkout that contains deploy-affecting staging-retirement changes.

## 12. Current Deploy Readiness

Current retry status: Amber.

Safe to retry production deployment now: No.

Safe to prepare a retry: Yes, after manual decisions.

Minimum required before retry:

1. Choose and publish the intended release ref, preferably a new branch such as `codex/paywall-release` from the clean paywall commit stack.
2. Use a clean worktree or clean clone at the approved release ref.
3. Keep staging-retirement dirty files out of the paywall artifact, unless Steve separately approves and commits them first.
4. Verify Stripe live Products, Prices, amounts, intervals, and webhook endpoint manually or through a trusted unmasked API path.
5. Confirm Development Club remains fail-closed or configure a verified live Price ID.
6. Link Supabase production only in the clean release context, then run migration list and dry-run.
7. Apply migrations only after explicit approval and backup confirmation.
8. Run the production deployment retry prompt from the clean release context.

## 13. Recommended Next Prompt

Use this only after Steve has made the remaining decisions:

```text
Proceed with FP-PAYWALL-PROD-RETRY from a clean checkout. Use release ref <approved branch or commit>. Confirm Stripe live Prices and webhook from the approved secure path, link Supabase production hvapkizujvsahvgspser only after confirmation, run migration dry-run, stop before applying migrations or deploy if any gate fails, and do not include staging-retirement cleanup unless separately committed and approved.
```

If Steve wants to resolve the dirty tree first, use this separate prompt:

```text
Review the staging-retirement dirty worktree as a standalone cleanup. Do not deploy. Decide whether to commit, stash, or leave each dirty file, and keep it separate from the paywall release.
```

## 14. Final Recommendation

Amber: production retry is possible only after the manual confirmations above. Do not retry deployment from the current dirty checkout.
