# Staging Verification, 2026-05-27

Scope: staging only. Live was not deployed.

## Deployment

- Branch: `codex/football-club-os-staging-rebuild`
- Latest pushed commit: `3be57b8 Send password resets through Resend`
- Main staging deploy: `6a172d7c1ff983830095a4f6`
- Parent staging deploy: `6a172db55bf127c9e305baca`
- Main staging URL: `https://football-os-staging.staging.footballplayer.online`
- Parent staging URL: `https://parent-staging.staging.footballplayer.online`

## Build Gates

- `npm run lint`: passed
- `npm run build:staging`: passed
- `npm run verify:build-env`: passed
- Deployed bundle check: 5 JavaScript assets inspected, staging Supabase project marker present, live Supabase project marker absent.

## Current Verification Evidence

- Parent invite endpoint on main staging returned 200 for token `656b8ab4-5f73-4dc3-91f5-e6f95f2f417f` and included `Audit Player Individual`.
- Parent invite endpoint on parent staging returned 200 for the same token and included `Audit Player Individual`.
- Password reset function on main staging returned `{ "success": true }`.
- Password reset UI on `/user-settings` posted to `/.netlify/functions/send-password-reset`, received 200, showed `Password reset email sent if that account exists.`, and showed the reset email toast.
- Real audit login runner reports 25 of 25 audit accounts logging in successfully.
- Same-email login update on `/user-settings` is disabled and shows `No change made. Enter a different login email.`
- Active sidebar self-link click stays on the current page and does not add a useless route to browser history.
- Match day fixture setup opens from `Create fixture` into a modal. The page no longer shows the large fixture form upfront. The modal includes arrival options and squad selection language.

## Residual Item

- `https://parent-staging.footballplayer.online` still returns 404 for the valid staging parent invite token. Netlify shows this host is configured as a production domain alias. The working branch alias is `https://parent-staging.staging.footballplayer.online`.

## Notes

- Older audit artifacts include stale failures from before the staging environment fix and from runners that classified active self-links as back-navigation failures. Use this file and the latest generated files as the current status.
