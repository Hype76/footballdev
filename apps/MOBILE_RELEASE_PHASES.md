# Football Player Mobile Release Phases

Use this tracker to separate local repo readiness from external store, Expo, and real-device work.

## Phase 1: Local Repo Readiness

Status: complete in this branch.

- Coach and Parents Expo apps exist.
- Shared mobile code and shared Expo config exist.
- Local release automation is in place.
- Test Supabase is the default and live Supabase is blocked.
- Billing, checkout, subscription management, Stripe controls, and bulk email are excluded from mobile source.
- Store metadata, privacy, reviewer, screenshot, environment, versioning, notification, and device QA docs exist.
- `npm run mobile:release-check` passes locally.

## Phase 2: Expo EAS Setup

Status: external.

Exit criteria: both app projects exist in Expo, each app has its own EAS project ID stored in EAS only, and both apps resolve test Supabase values for store-test builds.

- Create one EAS project for Football Player Coach.
- Create one EAS project for Football Player Parents.
- Use `MOBILE_EAS_SETUP_CHECKLIST.md` for the app-by-app EAS setup steps.
- Set `EXPO_PUBLIC_EAS_PROJECT_ID` in EAS for each app.
- Set test Supabase URL and publishable key in EAS for each app.
- Set the HTTPS test API base URL in EAS for each app.
- Keep `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Keep `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.

## Phase 3: Apple And Google Store Records

Status: external.

Exit criteria: four store records exist, reviewer notes are entered, reviewer credentials are stored only inside the store consoles, and privacy answers match `MOBILE_PRIVACY_QUESTIONNAIRE.md`.

- Create the App Store Connect record for Football Player Coach.
- Create the App Store Connect record for Football Player Parents.
- Create the Google Play Console record for Football Player Coach.
- Create the Google Play Console record for Football Player Parents.
- Add store metadata from each app's `STORE_METADATA.md`.
- Add privacy answers from `MOBILE_PRIVACY_QUESTIONNAIRE.md`.
- Add reviewer access notes from `MOBILE_REVIEWER_HANDOFF.md`.
- Add reviewer credentials only inside Apple and Google consoles.

## Phase 4: Native Builds

Status: external after EAS setup.

Exit criteria: Coach and Parents each have one Android internal build and one iOS TestFlight build created from a commit that passed `npm run mobile:release-check`.

- Run `npm run mobile:release-check` immediately before builds.
- Build Coach Android internal build with `npm run mobile:build:coach:android:internal`.
- Build Coach iOS TestFlight build with `npm run mobile:build:coach:ios:store-test`.
- Build Parents Android internal build with `npm run mobile:build:parent:android:internal`.
- Build Parents iOS TestFlight build with `npm run mobile:build:parent:ios:store-test`.
- Confirm remote EAS build numbers and version codes are valid for store submission.

## Phase 5: Real Device QA

Status: external after native builds.

Exit criteria: both apps pass Android and iOS device testing, including login, refresh, biometric unlock where supported, and all required push notification flows.

- Install Coach and Parents on real Android devices.
- Install Coach and Parents on real iPhones through TestFlight.
- Complete `MOBILE_DEVICE_TESTING.md`.
- Complete notification tests from `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Record release evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Record the external evidence log for tested build IDs, devices, accounts, push rows, failures, and retests.
- Confirm both apps remain on test Supabase.

## Phase 6: Screenshots And Final Store Submission

Status: external after device QA.

Exit criteria: screenshots are captured from real builds with test data only, reviewer credentials still work, and the final local release check passes.

- Capture screenshots from real store or internal builds using `MOBILE_SCREENSHOT_PLAN.md`.
- Confirm screenshots show test data only.
- Confirm reviewer credentials work immediately before submission.
- Run `npm run mobile:release-check` one final time.
- Submit Coach to Apple with `npm run mobile:submit:coach:ios:store-test`.
- Submit Coach to Google with `npm run mobile:submit:coach:android:store-test`.
- Submit Parents to Apple with `npm run mobile:submit:parent:ios:store-test`.
- Submit Parents to Google with `npm run mobile:submit:parent:android:store-test`.

## Live Database Gate

Status: blocked until explicit approval.

- Do not switch either app to live Supabase until live release approval is explicitly given.
- Do not set `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=true` until live release approval is explicitly given.
