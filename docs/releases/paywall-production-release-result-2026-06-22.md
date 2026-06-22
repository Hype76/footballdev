# Paywall Production Release Result

Date: 2026-06-22 08:09:23 +01:00

Goal: FP-PAYWALL-PROD-FINAL-17

Release branch: `codex/paywall-release`

Release commit checked: `7e2820f86597a8bd567119da0a7b7e52cbb4c016`

Production Supabase ref: `hvapkizujvsahvgspser`

Netlify site: `footballplayer-online` / `264c7a36-8b0d-4a35-bedd-9d18482aaf69`

Status: Red

## Verdict

The final controlled Footballplayer.online paywall production release stopped during the production Supabase migration step.

The production deployment did not happen. The Netlify production deploy was not triggered because the first approved Supabase migration failed.

No Netlify production deploy, Stripe object change, subscription migration, repricing, environment variable edit, customer announcement, staging cleanup, or `football-os-staging` use occurred.

## Gates Completed

| Gate | Result | Evidence |
| --- | --- | --- |
| Clean release worktree | Passed | `git status --short` returned clean before production changes. |
| Release branch | Passed | Current branch was `codex/paywall-release`. |
| Release commit | Passed | Local HEAD and `origin/codex/paywall-release` both matched `7e2820f86597a8bd567119da0a7b7e52cbb4c016`. |
| Required release documents | Passed | All required paywall decision, audit, runbook, config, release, and reconciliation documents were present. |
| Approved migration files | Passed | `20260622043000_paywall_plan_key_foundation.sql` SHA-256 `6A89486915B89B673D4280AA934908BEF737106E7A6A0382B06C5CBF8E13FE61`; `20260622050850_paywall_server_enforcement.sql` SHA-256 `2FE5B059D9FCB46DAAE2579076392627C685AE5E3FE16F0040A1E82888078A40`. |
| Local build | Passed | `npm.cmd run build` passed and `verify-web-build-env.mjs` confirmed the live Supabase project in the web build. |
| Paywall tests | Passed | `node --test tests/paywall-plan-normalization.test.mjs tests/paywall-access-model.test.mjs tests/paywall-ui-alignment.test.mjs tests/paywall-server-enforcement.test.mjs tests/paywall-commerce-alignment.test.mjs tests/paywall-hardening-matrix.test.mjs` passed 37 of 37. |
| Platform tests | Passed | `npm.cmd run test:platform` passed 102 of 102. |
| V1 stabilization tests | Passed | `npm.cmd run test:v1-stabilise` passed 47 of 47. |
| Local live safety | Passed | `npm.cmd run check:local-live-validation-safety` passed; live ref present in `dist`, retired staging ref absent. |
| Diff check | Passed | `git diff --check` passed. |
| Supabase project identity | Passed | `supabase projects list -o json` showed `FootballDev` ref `hvapkizujvsahvgspser`, region `eu-west-2`, status `ACTIVE_HEALTHY`, and linked `true`. |
| Supabase backup visibility | Passed | `supabase backups list --project-ref hvapkizujvsahvgspser -o json` showed latest completed physical backup at `2026-06-22T03:56:11.220Z`; PITR was `false`. |
| Final migration dry-run | Passed | `supabase db push --dry-run --linked` showed only `20260622043000_paywall_plan_key_foundation.sql` and `20260622050850_paywall_server_enforcement.sql`. |
| Netlify project identity | Passed | Netlify project reader confirmed `footballplayer-online`, primary URL `https://footballplayer.online`, site id `264c7a36-8b0d-4a35-bedd-9d18482aaf69`, current ready deploy `6a3628095179a5d5dbf1d34e`. |
| Netlify CLI state | Amber | CLI was authenticated, but the clean release worktree was not linked. The deploy would have used explicit site id if migration had succeeded. |
| Stripe production env gate | Amber accepted | Netlify environment metadata confirmed Single Team and Small Club production price variables exist with `price_` format, Stripe secret and webhook secret are present as masked secrets, and no Development Club production price id is configured. Live Stripe object verification remains an accepted Amber condition because secrets are masked. |

## Stop Evidence

The approved deploy rule says to stop and not deploy the application if the production migration fails.

The final dry-run was clean, but the live migration apply failed while applying the first approved migration:

```text
Applying migration 20260622043000_paywall_plan_key_foundation.sql...
ERROR: cannot change name of input parameter "feature_name" (SQLSTATE 42P13)
At statement: 7
create or replace function public.can_use_plan_feature(target_club_id uuid, feature_key text)
```

Read-only production inspection showed the existing function signature is:

```text
can_use_plan_feature(uuid,text)
proargnames: target_club_id, feature_name
```

The approved migration attempts to replace the same function signature using the second input parameter name `feature_key`. PostgreSQL rejects that parameter-name change through `CREATE OR REPLACE FUNCTION`.

## Production State After Stop

Read-only checks after the failed apply confirmed the failed migration was not recorded in migration history:

- Remote migration history still omits `20260622043000`.
- Remote migration history still omits `20260622050850`.
- `supabase migration list --linked` still shows both approved paywall migrations as local-only and pending.

Read-only schema checks also showed no partial paywall foundation state persisted from the failed attempt:

- `public.normalize_subscription_plan_key(text)` does not exist.
- `public.clubs` plan constraint still allows only `individual`, `single_team`, `small_club`, and `large_club`.
- `public.tester_access_codes` plan constraint still allows only `individual`, `single_team`, `small_club`, and `large_club`.
- `public.club_owner_invites` plan constraint still allows only `individual`, `single_team`, `small_club`, and `large_club`.

## Steps Not Run

These steps were intentionally not run after the migration failed:

- `supabase db push` retry or workaround.
- Any unapproved migration edit or production SQL repair.
- Post-migration validation queries that depend on the approved migrations being applied.
- Netlify production deploy.
- Production checkout smoke.
- Production route smoke.
- Function log monitoring for a new deploy.
- Stripe object creation or price creation.
- Subscription migration or repricing.
- Customer or investor announcement.

## Stripe And Checkout Status

No Stripe objects or prices were created.

Netlify production environment metadata remains:

- Single Team production price variable exists and has `price_` format.
- Small Club production price variable exists and has `price_` format.
- `STRIPE_SECRET_KEY` is present as a masked secret.
- `STRIPE_WEBHOOK_SECRET` is present as a masked secret.
- Development Club production price variable is missing.

Development Club must remain visible in pricing but demo-request gated. Direct Development Club checkout must remain fail-closed until a real approved live Price ID is configured.

## Rollback Readiness

Application rollback path: no new Netlify deploy occurred. The previous production deploy remains `6a3628095179a5d5dbf1d34e`.

Database rollback path: no migration history entry was added for the failed migration. Read-only checks showed the first migration did not leave the paywall foundation state in place. If later evidence shows otherwise, use a reviewed forward-fix migration rather than manual console edits.

Stripe rollback path: no Stripe or Netlify env changes were made, so no Stripe rollback is required.

Rollback threshold for any future retry: stop immediately if migration apply fails, migration history diverges, live checkout errors spike, protected routes become public, or any unexpected Stripe checkout path opens.

## Required Next Action

Create a separate approved database-release fix for the first paywall migration. The fix should preserve the existing `can_use_plan_feature(uuid, text)` parameter identity or explicitly drop and recreate the function in a reviewed migration path before retrying production release.

Do not deploy the paywall app artifact to production before the approved migrations apply cleanly to `hvapkizujvsahvgspser`.

Final status: Red.
