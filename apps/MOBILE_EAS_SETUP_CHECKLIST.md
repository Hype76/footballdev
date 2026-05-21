# Football Player Mobile EAS Setup Checklist

Use this checklist when creating the Expo EAS projects and setting build-time environment values for the Coach and Parents apps.

Do not commit EAS project IDs, Supabase keys, API URLs for private environments, Apple keys, Google service account files, provisioning profiles, passwords, or reviewer credentials.

## Before You Start

- Confirm this work is for the test database only.
- Confirm `npm run mobile:release-check` passes locally.
- Confirm you are logged in to the correct Expo account.
- Confirm no local `.env` files, build artifacts, or credential files are tracked by git.

## Coach App

- EAS project name: Football Player Coach
- App path: `apps/coach-mobile`
- iOS bundle identifier: `com.footballplayer.coach`
- Android package: `com.footballplayer.coach`
- Scheme: `footballplayercoach`

Create the project from the app folder:

```bash
cd apps/coach-mobile
npx eas-cli project:init
```

If EAS offers to write the project ID into `app.config.js`, do not keep that change. Set the project ID in EAS as `EXPO_PUBLIC_EAS_PROJECT_ID`.

## Parents App

- EAS project name: Football Player Parents
- App path: `apps/parent-mobile`
- iOS bundle identifier: `com.footballplayer.parents`
- Android package: `com.footballplayer.parents`
- Scheme: `footballplayerparents`

Create the project from the app folder:

```bash
cd apps/parent-mobile
npx eas-cli project:init
```

If EAS offers to write the project ID into `app.config.js`, do not keep that change. Set the project ID in EAS as `EXPO_PUBLIC_EAS_PROJECT_ID`.

## EAS Environment Values

Set these values separately for both apps in Expo EAS:

- `EXPO_PUBLIC_SUPABASE_ENV=test`
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_EAS_PROJECT_ID`

Set and verify them for every build profile that can create reviewer builds:

- `development`
- `internal`
- `store-test`

Rules:

- `EXPO_PUBLIC_SUPABASE_URL` must point at the test Supabase project.
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` must belong to the test Supabase project.
- `EXPO_PUBLIC_API_BASE_URL` must be HTTPS for TestFlight and Google internal builds.
- `EXPO_PUBLIC_API_BASE_URL` must not be localhost for TestFlight or Google internal builds.
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE` must stay `false`.
- `EXPO_PUBLIC_SUPABASE_ENV` must stay `test`.

## Profile Verification

Before the first native build for each app, verify these profile values in Expo EAS:

| Profile | Supabase env | Live allowed | API URL | Project ID |
| --- | --- | --- | --- | --- |
| development | `test` | `false` | test or local dev URL | set in EAS only |
| internal | `test` | `false` | HTTPS test URL | set in EAS only |
| store-test | `test` | `false` | HTTPS test URL | set in EAS only |

Do not create TestFlight or Google internal builds until `internal` and `store-test` both use the HTTPS test API URL.

## After EAS Project Setup

- Run `npm run mobile:release-check` again.
- Confirm no EAS project ID was committed to either `app.config.js`.
- Confirm no real keys or private URLs were committed to `.env.example`, docs, or source files.
- Confirm both apps still resolve with test Supabase defaults through `npm run mobile:config`.

## Build Gate

Do not start native builds until:

- Both EAS projects exist.
- Both apps have EAS environment values set.
- The test API host is reachable over HTTPS.
- `npm run mobile:release-check` passes.
- `MOBILE_RELEASE_PHASES.md` still shows Phase 2 as the active external step.

## Live Database Gate

Do not set live Supabase values for either mobile app until live release approval is explicitly given.
