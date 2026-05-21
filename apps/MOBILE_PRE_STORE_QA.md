# Football Player Mobile Pre-Store QA

This checklist covers both Expo apps before TestFlight, Google internal testing, or store review.

Use `MOBILE_DEVICE_TESTING.md` for the physical device test runbook.

## Apps

- Coach app: `apps/coach-mobile`
- Parent app: `apps/parent-mobile`
- Shared code: `apps/mobile-core`
- Privacy questionnaire: `MOBILE_PRIVACY_QUESTIONNAIRE.md`
- Environment runbook: `MOBILE_ENVIRONMENT_RUNBOOK.md`
- EAS setup: `MOBILE_EAS_SETUP_CHECKLIST.md`
- Notification runbook: `MOBILE_NOTIFICATION_RUNBOOK.md`
- Reviewer handoff: `MOBILE_REVIEWER_HANDOFF.md`
- Screenshot plan: `MOBILE_SCREENSHOT_PLAN.md`
- Store account setup: `MOBILE_STORE_ACCOUNT_SETUP.md`
- Versioning guide: `MOBILE_VERSIONING.md`
- Release status: `MOBILE_RELEASE_STATUS.md`
- Release phases: `MOBILE_RELEASE_PHASES.md`
- External evidence template: `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`
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
npm run mobile:config
npm run mobile:prestore
npm run mobile:doctor
npm run mobile:export:web
git diff --check
```

Run from each mobile app folder:

```bash
npm run build:android:internal
npm run build:ios:store-test
npm run build:android:store-test
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
- Notification QA follows `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Coach goal sends parent push.
- Coach detailed goal minute input rejects non-numeric values.
- Coach half time sends parent push.
- Coach full time sends parent push.
- Coach score correction sends parent push.
- Parent scorer volunteer sends coach push.
- Immediate parent message sends parent push.
- Scheduled parent message sends parent push when it is actually sent.
- Parent poll creation sends parent push.
- Notification taps open the relevant mobile app area.
- Notification route handling is case-insensitive and supports message, poll, and matchday aliases.

## App workflow QA

- Coach app shows assigned teams and respects the selected team.
- Coach app lets club-wide roles view all teams.
- Coach matchday status changes are restricted to valid match statuses.
- Coach matchday status changes follow the mobile match phase sequence.
- Coach matchday goal recording is blocked after full time, postponed, or cancelled statuses.
- Coach matchday score corrections are blocked on postponed or cancelled matches.
- Coach quick assessment blocks missing required answers and invalid score values.
- Parent app shows linked children and respects the selected child.
- Parent app keeps matchday, messages, polls, and notification registration scoped to the selected child.
- Parent message read actions require a valid selected child and message.
- Parent matchday cards only show scorer volunteering while the match is available for scorer requests.
- Parent poll cards disable voting after an answer is sent or when a poll is closed.
- Parent poll cards show a clear unavailable state when a poll has no answer options.
- Shared mobile UI renders consistently across both apps for login, headers, tabs, overview, cards, lists, settings, choice controls, and segmented controls.
- Shared mobile device controls behave consistently across both apps for notifications and biometric unlock.
- Biometric unlock locks the app again after the app is backgrounded and reopened.
- Sign out clears the local biometric setting and revokes the local mobile push registration when possible.
- Pull-to-refresh reloads Coach matchday, player, session, and assessment data.
- Pull-to-refresh reloads Parents matchday, message, and poll data.
- Reopening either app refreshes the current selected data without requiring sign out.

## Remaining app-store readiness work

- Run `npm run mobile:release-check` immediately before creating native builds.
- Complete `MOBILE_STORE_ACCOUNT_SETUP.md`.
- Check `MOBILE_ENVIRONMENT_RUNBOOK.md` before creating EAS builds.
- Complete `MOBILE_EAS_SETUP_CHECKLIST.md` before creating EAS builds.
- Check `MOBILE_VERSIONING.md` before creating native builds.
- Create Expo EAS projects for both apps.
- Add real EAS project IDs to each app environment.
- Keep `.env.example` files test-only and empty of real secrets.
- Build real Android internal test builds.
- Build real iOS TestFlight builds.
- Run physical device push tests on iPhone and Android.
- Record external QA evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Prepare store screenshots for both apps from `MOBILE_SCREENSHOT_PLAN.md`.
- Confirm screenshot files meet the current Apple and Google size and format rules in `MOBILE_SCREENSHOT_PLAN.md`.
- Prepare reviewer credentials for both apps.
- Verify store records match the current app identities:
  - Coach app name: `Football Player Coach`
  - Coach bundle ID and package name: `com.footballplayer.coach`
  - Parents app name: `Football Player Parents`
  - Parents bundle ID and package name: `com.footballplayer.parents`
- Verify each store listing uses the current icons from the app assets.
- Verify privacy wording matches `MOBILE_PRIVACY_QUESTIONNAIRE.md`.
- Verify the public support route `https://footballplayer.online/` is monitored before submission.
- Confirm final live release approval before changing any mobile Supabase setting to live.

## Release gate

Do not switch either app to live Supabase until all of the following are true:

- TestFlight build passes iPhone QA.
- Google internal build passes Android QA.
- Push notifications have been verified on physical iOS and Android devices.
- Store screenshots from `MOBILE_SCREENSHOT_PLAN.md` and reviewer credentials are ready.
- Reviewer notes have been prepared from `MOBILE_REVIEWER_HANDOFF.md`.
- The live Supabase approval has been given explicitly.
