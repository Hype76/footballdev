# Paywall Release Ref Readiness

Date: 2026-06-22

Reference: FP-PAYWALL-RELEASE-REF-13

Status: Amber.

This is a release-ref preparation report only. No production deploy, Netlify production trigger, Supabase migration, production environment edit, Stripe product or Price change, subscription migration, customer announcement, or staging cleanup was performed.

## 1. Branch And Worktree

Chosen branch:

`codex/paywall-release`

Clean worktree used:

`E:\Project Manager\Footbal_Development_paywall_release`

Original checkout left untouched:

`E:\Project Manager\Footbal_Development`

The branch was created from:

`b2a987e docs: record paywall release unblock status`

Remote branch:

`origin/codex/paywall-release`

Push status:

Pushed after clean validation and documentation commit.

Football staging branch status:

`football-os-staging` was not used as the release ref and was not pushed or revived.

## 2. Included Release Commits

The clean release branch includes the required paywall release stack and required ancestors:

| Commit | Subject |
| --- | --- |
| `426af5a933de875e7bf6a41d991146dd03cf2ce9` | docs: record approved paywall tier model |
| `80c23d3fe736069cfb87b3b5c6b11c65cb75bcda` | feat: normalize paywall plan keys |
| `abb5c735cc88e4eff24914917fd578a42664fca3` | feat: centralize paywall feature access |
| `5a73cb6` | feat: align paywall UI and routes |
| `ce68a64c9c57520052d15a695ea9f714dd410e4f` | feat: enforce paywall access server side |
| `453d986b9d2bf33afe144608bcd27527a282bad0` | feat: align pricing and checkout tiers |
| `746fd660a307ab776295da16c36e720676f23daa` | test: harden tier and paywall access |
| `bbc68fae5c344e0c0df5a497b5f3862ca8b96641` | docs: prepare paywall release runbook |
| `b2a987e` | docs: record paywall release unblock status |

The release stack is linear. `origin/main` is an ancestor of `b2a987e`, and `b2a987e` is not contained in `origin/main`.

## 3. Dirty Original Checkout Classification

The original checkout had pre-existing dirty files. They were not staged, deleted, stashed, cleaned, or included in the clean release branch.

| File | Classification | Deploy impact | Release-ref action |
| --- | --- | --- | --- |
| `.env.staging` | Staging-retirement related | Local config | Excluded |
| `PROJECT_PLAN.md` | Staging-retirement related | No runtime impact | Excluded |
| `docs/live-backup-baseline-2026-05-25.md` | Staging-retirement related | No runtime impact | Excluded |
| `docs/staging-verification-2026-05-27.md` | Staging-retirement related | No runtime impact | Excluded |
| `netlify.toml` | Staging-retirement related | Deploy-affecting | Excluded |
| `netlify/functions/_stripe-billing.js` | Staging-retirement related | Deploy-affecting | Excluded |
| `netlify/functions/_supabase.js` | Staging-retirement related | Deploy-affecting | Excluded |
| `netlify/functions/create-parent-account.js` | Staging-retirement related | Deploy-affecting | Excluded |
| `netlify/functions/prepare-staging-test-signup.js` | Staging-retirement related | Deploy-affecting | Excluded |
| `package.json` | Staging-retirement related | Deploy-affecting | Excluded |
| `scripts/netlify-deploy-safety-check.mjs` | Staging-retirement related | Deploy-affecting | Excluded |
| `scripts/staging-click-audit.mjs` | Staging-retirement related | Tooling | Excluded |
| `scripts/verify-web-build-env.mjs` | Staging-retirement related | Deploy-affecting | Excluded |
| `src/lib/app-origins.js` | Staging-retirement related | Deploy-affecting | Excluded |
| `supabase/config.toml` | Staging-retirement related | Auth redirect config source | Excluded |
| `tests/netlify-deploy-safety.test.mjs` | Staging-retirement related | Test behavior | Excluded |
| `scripts/staging-retired.mjs` | Staging-retirement related | Tooling | Excluded |

The clean release worktree status was clean before validation. `npm.cmd ci` installed ignored dependencies in the clean worktree and did not change tracked files.

## 4. Validation Results

Validation was run from the clean release worktree on branch `codex/paywall-release`.

| Command | Result |
| --- | --- |
| `git status --short` | Clean before validation |
| `git diff --check` | Passed |
| `npm.cmd ci` | Passed, with package deprecation warnings and npm audit warnings |
| `npm.cmd run build` | Passed |
| `node --test tests/paywall-commerce-alignment.test.mjs` | Passed, 6 of 6 |
| `node --test tests/paywall-plan-normalization.test.mjs tests/paywall-access-model.test.mjs tests/paywall-ui-alignment.test.mjs tests/paywall-server-enforcement.test.mjs tests/paywall-commerce-alignment.test.mjs tests/paywall-hardening-matrix.test.mjs` | Passed, 36 of 36 |
| `npm.cmd run test:platform` | Passed, 102 of 102 |
| `npm.cmd run test:v1-stabilise` | Passed, 47 of 47 |
| `npm.cmd run check:local-live-validation-safety` | Passed |
| `rg "llpufwzvgxyczxcjwupu" dist` | No retired staging Supabase ref found |
| `rg "hvapkizujvsahvgspser" dist` | Live Supabase ref found |
| Development Club checkout Price ID assertion | Passed, checkout Price ID empty when env is missing |
| Large Club purchase mode assertion | Passed, contact sales only |

Build proof:

- `dist` contains production Supabase ref `hvapkizujvsahvgspser`.
- `dist` does not contain retired staging Supabase ref `llpufwzvgxyczxcjwupu`.

Release branch proof:

- The dirty staging-retirement files from the original checkout were not present as uncommitted changes in the clean release worktree.
- The clean release branch does not include the staging-retirement dirty changes.

## 5. Remaining Deployment Blockers

The clean release ref is ready, but production deployment is still blocked by manual configuration and migration gates:

1. Stripe live object verification is still required.
   - Single Team and Small Club env vars exist with `price_` format, but live Stripe Product, Price, amount, interval, active state, account ownership, and webhook endpoint must still be verified in Stripe Dashboard or a trusted unmasked API path.

2. Development Club checkout is still intentionally fail-closed.
   - `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` is missing in production env.
   - Production retry is acceptable only if Steve accepts Development Club visible but unavailable for checkout, or provides a real verified live Price ID through approved secret handling.

3. Supabase local link and migration execution path remain pending.
   - Production ref `hvapkizujvsahvgspser` was previously confirmed active healthy.
   - Production backup `2026-06-22T03:56:11Z` was previously confirmed.
   - Local Supabase project remains unlinked in the original checkout.
   - Migrations were not applied in this task.

4. Netlify production deploy must still be a separate controlled retry.
   - This branch preparation did not deploy.
   - A later retry must re-run provider and migration gates before any production action.

## 6. Recommended Next Step

Use `origin/codex/paywall-release` as the clean release ref for the next controlled production retry.

Do not deploy from `football-os-staging`.

Do not deploy from the dirty original checkout.

Recommended next prompt:

```text
Proceed with FP-PAYWALL-PROD-RETRY from origin/codex/paywall-release. Verify Stripe live Products, Prices, and webhook from the approved secure path. Confirm Development Club remains disabled or provide a verified live Price ID. Link Supabase production only after confirmation, run migration list and dry-run, stop before applying migrations or deploy if any gate fails.
```

## 7. Final Recommendation

Amber: clean release ref is ready for a controlled deployment retry, but deployment remains blocked until Stripe verification, Development Club checkout decision, and Supabase migration gates are completed.
