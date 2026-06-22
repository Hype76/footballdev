# Paywall Production Release Result

Date: 2026-06-22 08:38:58 +01:00

Goal: FP-PAYWALL-PROD-FINAL-19

Release branch: `codex/paywall-release`

Release commit deployed: `92abe69a20722d44d28b7674ef584228a3097b82`

Production Supabase ref: `hvapkizujvsahvgspser`

Netlify site: `footballplayer-online` / `264c7a36-8b0d-4a35-bedd-9d18482aaf69`

Production URL: `https://footballplayer.online`

Netlify deploy ID: `6a38e4f96f569ab451b69eaa`

Status: Amber

## Verdict

The final controlled Footballplayer.online paywall production release was executed.

The two approved Supabase migrations were applied to production, the corrected server function signature was verified, and the release branch artifact was deployed to Netlify production.

The release is operationally Green for migration, deployment, bundle targeting, route protection, and checkout gating. Overall status remains Amber because live Stripe price object verification through the Stripe connector was not available, and the Supabase postgres log endpoint returned an internal MCP error during monitoring.

No Stripe products, Stripe prices, subscriptions, repricing, environment variables, customer announcements, staging cleanup, or `football-os-staging` changes were made.

## Production Release Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Clean release worktree | Passed | `git status --short` returned clean before production changes. |
| Release branch | Passed | Current branch was `codex/paywall-release`. |
| Release commit | Passed | Local HEAD and `origin/codex/paywall-release` both matched `92abe69a20722d44d28b7674ef584228a3097b82`. |
| Approved migration files | Passed | `20260622043000_paywall_plan_key_foundation.sql` SHA-256 `AA67BB7627D0819C585224C41B2195E980C61663075E87C57B6172F3393B99A6`; `20260622050850_paywall_server_enforcement.sql` SHA-256 `E5CD902DD429B1A4C9B3409D83F93A4919F34A80DD3695F9BF4CCA77A6B30F2E`. |
| Local build | Passed | `npm.cmd run build` passed and `verify-web-build-env.mjs` confirmed the live Supabase project in the web build. |
| Paywall tests | Passed | Paywall suite passed 37 of 37. |
| Platform tests | Passed | `npm.cmd run test:platform` passed 102 of 102. |
| V1 stabilization tests | Passed | `npm.cmd run test:v1-stabilise` passed 47 of 47. |
| Local live safety | Passed | `npm.cmd run check:local-live-validation-safety` passed; live ref present in `dist`, retired staging ref absent. |
| Diff check | Passed | `git diff --check` passed. |
| Supabase project identity | Passed | `supabase projects list -o json` showed `FootballDev` ref `hvapkizujvsahvgspser`, region `eu-west-2`, status `ACTIVE_HEALTHY`, and linked `true`. |
| Supabase backup visibility | Passed | Latest completed physical backup was `2026-06-22T03:56:11.220Z`; PITR was `false`. |
| Final migration dry-run | Passed | `supabase db push --dry-run --linked` showed only the two approved migrations. |
| Production migration apply | Passed | `supabase db push --linked --yes` applied `20260622043000_paywall_plan_key_foundation.sql` and `20260622050850_paywall_server_enforcement.sql`. |
| Netlify project identity | Passed | Netlify project reader confirmed `footballplayer-online`, primary URL `https://footballplayer.online`, site id `264c7a36-8b0d-4a35-bedd-9d18482aaf69`. |
| Netlify production deploy | Passed | Deploy `6a38e4f96f569ab451b69eaa` reached `ready`, published at `2026-06-22T07:36:04.759Z`, production URL `https://footballplayer.online`. |
| Stripe production env gate | Amber accepted | Netlify environment metadata confirmed Single Team and Small Club production price variables exist with `price_` format, Stripe secret and webhook secret are masked production secrets, and no Development Club production price id is configured. Stripe connector price-id lookup was unavailable. |

## Production Migration Verification

Remote migration history now includes:

- `20260622043000` / `paywall_plan_key_foundation`
- `20260622050850` / `paywall_server_enforcement`

Read-only production SQL verified:

- `public.can_use_plan_feature(target_club_id uuid, feature_name text)` remains the active function signature.
- `public.normalize_subscription_plan_key('Development Club')` returns `development_club`.
- Missing plan values normalize to `individual`.
- Unknown malformed plan values fail closed to an empty value.
- `clubs`, `tester_access_codes`, and `club_owner_invites` plan constraints now include `development_club`.
- Unknown feature checks return `false`.

## Deploy Verification

Netlify deployed the release through the production context using:

```text
npx.cmd netlify deploy --prod --dir=dist --site 264c7a36-8b0d-4a35-bedd-9d18482aaf69 --message "Paywall release 92abe69"
```

Netlify build evidence:

- Production context used.
- `npm run build:live && npm run verify:build-env` passed.
- `verify-web-build-env.mjs` confirmed the live Supabase project.
- 49 Netlify functions deployed.
- Current production deploy is `6a38e4f96f569ab451b69eaa`.

Bundle and public asset checks:

- `https://footballplayer.online` returned HTTP 200.
- Live Supabase ref `hvapkizujvsahvgspser` is present in public bundle assets.
- Retired staging ref `llpufwzvgxyczxcjwupu` is absent from public bundle assets.
- Public bundle scan did not find `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `sk_live_`, or `whsec_`.

## Production Smoke Tests

Live checkout smoke against `https://footballplayer.online/.netlify/functions/create-checkout-session`:

| Plan | Billing cycle | Result |
| --- | --- | --- |
| Single Team | Monthly | HTTP 200 with Stripe Checkout URL. |
| Single Team | Annual | HTTP 200 with Stripe Checkout URL. |
| Small Club | Monthly | HTTP 200 with Stripe Checkout URL. |
| Small Club | Annual | HTTP 200 with Stripe Checkout URL. |
| Development Club | Monthly | HTTP 400, no Stripe Checkout URL, message `This plan is not available for checkout yet`. |
| Large Club | Monthly | HTTP 400, no Stripe Checkout URL, message `This plan is not available for self-service checkout.` |
| Individual Coach - Free | Monthly | HTTP 400, no Stripe Checkout URL, message `This plan is not available for self-service checkout.` |
| Unknown plan | Monthly | HTTP 400, no Stripe Checkout URL, message `Choose a valid billing plan.` |
| Single Team | Invalid weekly cycle | HTTP 400, no Stripe Checkout URL, message `Choose a valid billing cycle.` |

Four live Stripe Checkout sessions were created as smoke artifacts for Single Team and Small Club monthly and annual plans. No payment was made, and no subscription, product, or price was created by Codex.

Playwright production route smoke:

- `/pricing` showed all five approved pricing tiers and Development Club `Request demo` copy.
- `/sign-in` showed the sign-in surface and no protected app content flash.
- `/parent-login` redirected to `https://parent.footballplayer.online/parent-login`, showed the parent login surface, and no staff app content flash.
- `/platform-admin` redirected unauthenticated users to `/sign-in` and did not expose Platform Admin content.

## Monitoring

Netlify deploy monitoring:

- Deploy `6a38e4f96f569ab451b69eaa` state is `ready`.
- Current project deploy is `6a38e4f96f569ab451b69eaa`.
- Netlify summary reported 54 new files uploaded, 2 redirect rules processed, 5 header rules processed, and 49 functions deployed.

Supabase monitoring:

- API logs showed successful `200` scheduled email queue reads and CLI health checks around the release window.
- Auth logs returned no entries.
- Postgres log retrieval via MCP returned an internal error, so postgres-log monitoring remains an Amber limitation.

Netlify function log stream was not read from CLI because the release worktree is not linked to the Netlify site. Deploy metadata and live function smoke were used instead.

## Rollback Readiness

Application rollback path:

- Previous production deploy before this release was `6a3628095179a5d5dbf1d34e`.
- Current production deploy is `6a38e4f96f569ab451b69eaa`.
- If rollback is needed, restore production alias to `6a3628095179a5d5dbf1d34e` from Netlify.

Database rollback path:

- The approved migrations are forward changes now recorded in production migration history.
- If a database issue appears, use a reviewed forward-fix migration rather than manual console edits.

Stripe rollback path:

- No products, prices, subscriptions, repricing, or environment variables were changed.
- No Stripe rollback is required for this release.

Rollback threshold:

- Roll back or forward-fix immediately if live checkout errors spike, protected routes expose authenticated content, migration history diverges, Development Club checkout opens before an approved live price is configured, or the retired staging Supabase ref appears in production assets.

## Remaining Amber Items

- Stripe live price object lookup could not be completed through the available Stripe connector because the exposed price and subscription tools returned `Unknown tool`, and Stripe Search does not support direct `id` lookup for prices.
- Postgres log retrieval via Supabase MCP returned an internal error.
- The Netlify CLI is authenticated but the clean release worktree is not linked to the site, so future CLI log commands should either link the worktree intentionally or use Netlify dashboard logs.

## Required Next Action

Monitor production checkout and protected-route access for the next release window. Do not configure Development Club self-service checkout until an approved live Stripe Price ID is created and added to production environment variables.

Final status: Amber.
