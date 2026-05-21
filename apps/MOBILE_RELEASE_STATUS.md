# Football Player Mobile Release Status

This records the current state of the Coach and Parents mobile app rebuild.

For phase ownership and remaining external work, use `MOBILE_RELEASE_PHASES.md`.

## Complete in this branch

- Coach Expo app exists at `apps/coach-mobile`.
- Parents Expo app exists at `apps/parent-mobile`.
- Shared mobile code exists at `apps/mobile-core`.
- Shared Expo native app config exists at `apps/mobile-core/appConfig.cjs`.
- Both apps are locked to test Supabase by default.
- Live Supabase is blocked unless explicitly enabled.
- Billing, checkout, subscription management, Stripe controls, and bulk email are excluded from mobile source.
- Native push registration, opt out, notification routing, Android notification channel setup, and Android notification icons are implemented.
- Biometric unlock support is implemented where the device supports enrolled security.
- Coach app supports matchday, players, quick assessments, sessions, team switching, and club-wide All Teams for eligible roles.
- Parents app supports linked child switching, matchday updates, messages, polls, and scorer volunteer actions.
- Shared mobile UI now covers login, fallback screens, screen chrome, overview, tab rail, settings, layout panels, lists, choice controls, and segmented controls.
- Shared mobile device controls now cover push notification registration, push notification opt out, device notification state, and biometric setting changes.
- Shared Expo config now owns native permissions, notification plugin setup, biometric permission text, runtime version policy, and test database defaults for both apps.
- Resolved Expo app config is checked by `npm run mobile:config`.
- Android sensitive permissions that are not used are explicitly blocked.
- Store metadata, privacy questionnaire, environment runbook, notification runbook, reviewer handoff, screenshot plan, store account setup, versioning guide, and device testing docs are present.
- Focused EAS setup checklist is present at `MOBILE_EAS_SETUP_CHECKLIST.md`.
- External release evidence template is present at `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Mobile release phase tracker is present at `MOBILE_RELEASE_PHASES.md`.
- EAS remote app versioning and store-test auto-increment are configured for both apps.
- `npm run mobile:release-check` passes locally.

## Still external before store submission

Complete these in order, and record the outcome in a private copy of `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` inside `apps/mobile-release-evidence/`.

- Create the ignored private evidence file with `npm run mobile:evidence:init`.
- Create Expo EAS projects for both apps using `MOBILE_EAS_SETUP_CHECKLIST.md`.
- Add each final `EXPO_PUBLIC_EAS_PROJECT_ID` in EAS, not in git.
- Add test Supabase and test Netlify API environment values in EAS using `MOBILE_ENVIRONMENT_RUNBOOK.md`.
- Confirm EAS remote build numbers and version codes are ready for the next store submissions.
- Create Apple App Store Connect records.
- Create Google Play Console records.
- Create reviewer test accounts and supply credentials only inside store consoles.
- Build real Android internal builds with the root mobile build commands.
- Build real iOS TestFlight builds with the root mobile build commands.
- Install builds on real Android and iOS devices.
- Verify push notifications on real Android and iOS devices using `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Record external QA and submission evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Capture store screenshots using `MOBILE_SCREENSHOT_PLAN.md` and test data only.
- Confirm the public support route is monitored and privacy wording still matches production before submission.

## Next external action checklist

- Run `npm run mobile:release-check` from the repo root and record the passing commit.
- Create or confirm the two Expo EAS projects.
- Add EAS environment values for both apps with `EXPO_PUBLIC_SUPABASE_ENV=test` and `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Verify EAS project values with `npm run mobile:eas:env:coach` and `npm run mobile:eas:env:parent`.
- Create the four store records: Coach iOS, Coach Android, Parents iOS, and Parents Android.
- Enter reviewer credentials only in App Store Connect and Google Play Console.
- Set `MOBILE_NATIVE_BUILD_CONFIRMED=true` only for native build commands after EAS values are verified.
- Create one Android internal build and one iOS TestFlight build for each app with the root mobile build commands.
- Install all four builds on real devices.
- Complete `MOBILE_DEVICE_TESTING.md`, with push notification evidence from `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Capture screenshots from the real builds using `MOBILE_SCREENSHOT_PLAN.md`.
- Run `npm run mobile:release-check` again immediately before final store submission.
- Submit with the root mobile submit commands only after device QA, notification QA, screenshots, reviewer notes, store records, reviewer credentials, and private release evidence are complete.
- Set `MOBILE_SUBMISSION_CONFIRMED=true` only for the final submit command.

## Release gate

Do not submit either app until all of these are true:

- `npm run mobile:release-check` passes immediately before native builds.
- Android internal QA passes on a real device.
- iOS TestFlight QA passes on a real device.
- Push notification flows pass on both platforms.
- Store screenshots follow `MOBILE_SCREENSHOT_PLAN.md` and show test data only.
- Reviewer credentials work immediately before submission.
- Review notes explain that payments are handled outside the mobile app.
- Both apps remain on `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Both apps remain on `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.

## Live database gate

Do not switch either mobile app to live Supabase until live release approval is explicitly given.
