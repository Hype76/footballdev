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

- Run `npm run mobile:release-check` immediately before builds.
- Build Coach Android internal build.
- Build Coach iOS TestFlight build.
- Build Parents Android internal build.
- Build Parents iOS TestFlight build.
- Confirm remote EAS build numbers and version codes are valid for store submission.

## Phase 5: Real Device QA

Status: external after native builds.

- Install Coach and Parents on real Android devices.
- Install Coach and Parents on real iPhones through TestFlight.
- Complete `MOBILE_DEVICE_TESTING.md`.
- Complete notification tests from `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Record the external evidence log for tested build IDs, devices, accounts, push rows, failures, and retests.
- Confirm both apps remain on test Supabase.

## Phase 6: Screenshots And Final Store Submission

Status: external after device QA.

- Capture screenshots from real store or internal builds using `MOBILE_SCREENSHOT_PLAN.md`.
- Confirm screenshots show test data only.
- Confirm reviewer credentials work immediately before submission.
- Run `npm run mobile:release-check` one final time.
- Submit Coach to Apple and Google.
- Submit Parents to Apple and Google.

## Live Database Gate

Status: blocked until explicit approval.

- Do not switch either app to live Supabase until live release approval is explicitly given.
- Do not set `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=true` until live release approval is explicitly given.
