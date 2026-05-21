# Football Player Mobile Environment Runbook

Use this when setting up local mobile development, EAS builds, TestFlight, Google internal testing, or store review builds.

Do not commit real Supabase keys, EAS project IDs, API URLs for private environments, service role keys, Apple keys, Google service account files, provisioning profiles, or passwords.

Do not commit EAS project IDs into `app.config.js`. The shared Expo config reads `EXPO_PUBLIC_EAS_PROJECT_ID` from the app environment.

Both mobile app `.gitignore` files must ignore native build artifacts and private credential files such as `.apk`, `.aab`, `.ipa`, `.p8`, `.mobileprovision`, `.keystore`, `.jks`, `GoogleService-Info.plist`, `google-services.json`, and `credentials.json`.

## Local Development

Local `.env` files may be created beside each app, but must not be committed.

`npm run mobile:prestore` fails if a mobile `.env` file, native build artifact, or private store credential file is tracked by git.

Use each app's `.env.example` as the template:

```bash
EXPO_PUBLIC_SUPABASE_ENV=test
EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_API_BASE_URL=http://localhost:8888
EXPO_PUBLIC_EAS_PROJECT_ID=
```

Local development can use `http://localhost:8888` for Netlify functions when the local test stack is running.

## EAS Build Environment

Set these values separately for both apps inside Expo EAS:

- `EXPO_PUBLIC_SUPABASE_ENV=test`
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_EAS_PROJECT_ID`

For TestFlight and Google internal builds, `EXPO_PUBLIC_API_BASE_URL` must point at the test API host, not localhost.

Verify these EAS profiles for both apps before building:

- `development` may use the test API host or a local development URL for local device testing.
- `internal` must use the HTTPS test API host.
- `store-test` must use the HTTPS test API host.

Every profile must keep `EXPO_PUBLIC_SUPABASE_ENV=test` and `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.

List the remote EAS project values without exposing sensitive values:

```bash
npm run mobile:eas:env:coach
npm run mobile:eas:env:parent
```

The guarded env list commands print the expected profile values before listing remote EAS values.

## Netlify Test Environment

Set these in the test Netlify environment used by the mobile apps:

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`

The mobile apps must call a test API environment while the apps remain locked to test Supabase.

## Before Native Builds

Check both apps:

- Run `npm run mobile:build:preflight` and confirm the working tree is clean.
- EAS project ID exists in EAS, not in git.
- Supabase URL is the test project URL.
- Supabase publishable key belongs to the test project.
- API base URL points at the test API host.
- `EXPO_PUBLIC_SUPABASE_ENV` is `test`.
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE` is `false`.
- No real secrets were added to `.env.example`, docs, or source files.
- Set `MOBILE_NATIVE_BUILD_CONFIRMED=true` only for the build command after the EAS project values have been verified.

## Live Gate

Do not set live Supabase values for either mobile app until live release approval is explicitly given.
