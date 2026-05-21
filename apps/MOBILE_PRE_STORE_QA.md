# Football Player Mobile Pre-Store QA

This checklist covers both Expo apps before TestFlight, Google internal testing, or store review.

Use `MOBILE_DEVICE_TESTING.md` for the physical device test runbook.

## Apps

- Coach app: `apps/coach-mobile`
- Parent app: `apps/parent-mobile`
- Shared code: `apps/mobile-core`
- Privacy questionnaire draft: `MOBILE_PRIVACY_QUESTIONNAIRE.md`
- Reviewer handoff draft: `MOBILE_REVIEWER_HANDOFF.md`
- Store account setup: `MOBILE_STORE_ACCOUNT_SETUP.md`
- Test database only until live release approval is given.

## Required secrets

Set these in Expo EAS for both apps:

- `EXPO_PUBLIC_SUPABASE_ENV=test`
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_EAS_PROJECT_ID`

Set these in the Netlify test environment:

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`

## Test accounts

- Coach test account with staff access.
- Parent test account with at least one linked child.
- The linked child should have a team, a matchday record, a message, and an open parent poll.
- At least one real iPhone and one real Android device should be available.

## Build checks

Run the full local release check from the repo root:

```bash
npm run mobile:release-check
```

Or run the checks individually:

```bash
npm run lint
npm run build
npm run mobile:prestore
npm run mobile:doctor
npm run mobile:export:web
git diff --check
```

Run from each mobile app folder:

```bash
npx eas-cli build --profile internal --platform android
npx eas-cli build --profile store-test --platform ios
npx eas-cli build --profile store-test --platform android
```

## Store policy checks

- Apps are free to download.
- Login is required.
- No billing, checkout, subscription management, or Stripe controls are present in either app.
- Subscription management remains on the desktop web platform.
- Reviewer notes must explain that payments are handled outside the mobile app.
- Android blocked permissions must remain aligned with the privacy questionnaire.
- Coach app is for club staff only.
- Parents app is for linked parent and family access only.
- Privacy answers should be checked against `MOBILE_PRIVACY_QUESTIONNAIRE.md`.

## Native notification QA

- Parent app can register a device token.
- Coach app can register a device token.
- Parent app can disable device notifications.
- Coach app can disable device notifications.
- Coach goal sends parent push.
- Coach half time sends parent push.
- Coach full time sends parent push.
- Coach score correction sends parent push.
- Parent scorer volunteer sends coach push.
- Immediate parent message sends parent push.
- Scheduled parent message sends parent push when it is actually sent.
- Parent poll creation sends parent push.
- Notification taps open the relevant mobile app area.

## App workflow QA

- Coach app shows assigned teams and respects the selected team.
- Coach app lets club-wide roles view all teams.
- Parent app shows linked children and respects the selected child.
- Parent app keeps matchday, messages, polls, and notification registration scoped to the selected child.

## Remaining app-store readiness work

- Run `npm run mobile:release-check` immediately before creating native builds.
- Complete `MOBILE_STORE_ACCOUNT_SETUP.md`.
- Create Expo EAS projects for both apps.
- Add real EAS project IDs to each app environment.
- Keep `.env.example` files test-only and empty of real secrets.
- Build real Android internal test builds.
- Build real iOS TestFlight builds.
- Run physical device push tests on iPhone and Android.
- Prepare store screenshots for both apps.
- Prepare reviewer credentials for both apps.
- Confirm final app names, icons, bundle identifiers, package names, privacy wording, and support URLs.
- Confirm final live release approval before changing any mobile Supabase setting to live.

## Release gate

Do not switch either app to live Supabase until all of the following are true:

- TestFlight build passes iPhone QA.
- Google internal build passes Android QA.
- Push notifications have been verified on physical iOS and Android devices.
- Store screenshots and reviewer credentials are ready.
- Reviewer notes have been prepared from `MOBILE_REVIEWER_HANDOFF.md`.
- The live Supabase approval has been given explicitly.
