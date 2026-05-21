# Football Player Mobile Store Account Setup

Use this when creating the Expo, Apple, and Google records for the two mobile apps. Do not commit private keys, passwords, API keys, provisioning profiles, or service account files.

See `MOBILE_RELEASE_STATUS.md` for the current done and remaining release state.
Use `MOBILE_ENVIRONMENT_RUNBOOK.md` when setting EAS and test API environment values.
Use `MOBILE_EAS_SETUP_CHECKLIST.md` when creating Expo EAS projects and setting app build environments.
Use `MOBILE_NOTIFICATION_RUNBOOK.md` when testing native push notifications.
Use `MOBILE_SCREENSHOT_PLAN.md` when preparing store screenshots.
Use `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` when recording external QA and submission evidence inside the ignored `apps/mobile-release-evidence/` folder.
Use `MOBILE_VERSIONING.md` before creating native builds.

## Apps

### Coach app

- App name: Football Player Coach
- Expo path: `apps/coach-mobile`
- iOS bundle identifier: `com.footballplayer.coach`
- Android package: `com.footballplayer.coach`
- Scheme: `footballplayercoach`
- EAS profile for internal Android QA: `internal`
- EAS profile for TestFlight and store-style Android QA: `store-test`
- Versioning: EAS remote app versioning with store-test auto-increment

### Parents app

- App name: Football Player Parents
- Expo path: `apps/parent-mobile`
- iOS bundle identifier: `com.footballplayer.parents`
- Android package: `com.footballplayer.parents`
- Scheme: `footballplayerparents`
- EAS profile for internal Android QA: `internal`
- EAS profile for TestFlight and store-style Android QA: `store-test`
- Versioning: EAS remote app versioning with store-test auto-increment

## Expo EAS setup

Create one EAS project per app from inside each app folder.

```bash
npm run mobile:eas:init:coach
```

```bash
npm run mobile:eas:init:parent
```

After each project is created, add its project ID to EAS environment variables as `EXPO_PUBLIC_EAS_PROJECT_ID`.

If `eas project:init` offers to write a project ID into `app.config.js`, keep the app config env-driven and put the value in EAS as `EXPO_PUBLIC_EAS_PROJECT_ID` instead.

The guarded EAS setup commands fail if `app.config.js` is changed during project setup.

Set these EAS environment variables for both apps:

- `EXPO_PUBLIC_SUPABASE_ENV=test`
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_EAS_PROJECT_ID`

For TestFlight and Google internal builds, `EXPO_PUBLIC_API_BASE_URL` must point at the test API host, not localhost.

Keep both apps on test Supabase until live release approval is explicitly given.

Use each app's `.env.example` as the local template. Do not put real Supabase keys, EAS project IDs, or production API URLs in `.env.example`.

## Apple App Store Connect setup

Create two app records:

- Football Player Coach with bundle ID `com.footballplayer.coach`
- Football Player Parents with bundle ID `com.footballplayer.parents`

For each app record:

- Category: Sports
- Pricing: Free
- Login required: Yes
- In-app purchases: None
- Payments or subscription management in app: No
- Review notes: use `MOBILE_REVIEWER_HANDOFF.md`
- Privacy answers: use `MOBILE_PRIVACY_QUESTIONNAIRE.md`
- Screenshots: use `MOBILE_SCREENSHOT_PLAN.md`

## Google Play Console setup

Create two app records:

- Football Player Coach with package `com.footballplayer.coach`
- Football Player Parents with package `com.footballplayer.parents`

For each app record:

- App type: App
- Category: Sports
- Pricing: Free
- Data Safety: use `MOBILE_PRIVACY_QUESTIONNAIRE.md`
- App access: restricted login, provide reviewer account in Play Console only
- Review notes: use `MOBILE_REVIEWER_HANDOFF.md`
- Screenshots: use `MOBILE_SCREENSHOT_PLAN.md`

## Native build order

Run the local release checks first:

```bash
npm run mobile:release-check
```

The guarded build commands require `MOBILE_NATIVE_BUILD_CONFIRMED=true` after EAS setup and test environment verification are complete.

Build Coach:

```bash
npm run mobile:build:coach:android:internal
npm run mobile:build:coach:ios:store-test
npm run mobile:build:coach:android:store-test
```

Submit Coach after store records, credentials, screenshots, reviewer notes, device QA, notification QA, and private release evidence are complete.

The guarded submit commands require `MOBILE_SUBMISSION_CONFIRMED=true`.

```bash
npm run mobile:submit:coach:ios:store-test
npm run mobile:submit:coach:android:store-test
```

Build Parents:

```bash
npm run mobile:build:parent:android:internal
npm run mobile:build:parent:ios:store-test
npm run mobile:build:parent:android:store-test
```

Submit Parents after store records, credentials, screenshots, reviewer notes, device QA, notification QA, and private release evidence are complete.

The guarded submit commands require `MOBILE_SUBMISSION_CONFIRMED=true`.

```bash
npm run mobile:submit:parent:ios:store-test
npm run mobile:submit:parent:android:store-test
```

## Submission gate

Do not submit either app until:

- `npm run mobile:release-check` passes.
- Android internal builds install on real devices.
- TestFlight builds install on real iPhones.
- Push notifications pass on real Android and iOS devices using `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Reviewer accounts have been tested immediately before submission.
- Store screenshots from `MOBILE_SCREENSHOT_PLAN.md` contain only test data.
- Store review notes explain that payments are handled outside the mobile app.
- Both apps still use `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Both apps still use `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- `MOBILE_SUBMISSION_CONFIRMED=true` is set only for the final submit command after the evidence log is complete.
