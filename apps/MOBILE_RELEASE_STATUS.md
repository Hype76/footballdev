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
- Focused Apple and Google store record checklist is present at `MOBILE_STORE_RECORD_CHECKLIST.md`.
- Focused native identity checklist is present at `MOBILE_NATIVE_IDENTITY_CHECKLIST.md`.
- Focused EAS setup checklist is present at `MOBILE_EAS_SETUP_CHECKLIST.md`.
- External release evidence template is present at `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Mobile release phase tracker is present at `MOBILE_RELEASE_PHASES.md`.
- EAS remote app versioning and store-test auto-increment are configured for both apps.
- Expo EAS projects exist for both apps.
- Development, preview, and production EAS environments are set for both apps with test Supabase and live Supabase disabled.
- Android internal builds are created for both apps and recorded in the private evidence file.
- Android store-test AAB builds are created for both apps and recorded in the private evidence file.
- iOS store-test builds are created for both apps and recorded in the private evidence file.
- `npm run mobile:release-check` passes locally.
- `npm run mobile:preflight` is available for local read-only release readiness checks.

## Still external before store submission

Complete these in order, and record the outcome in a private copy of `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` inside `apps/mobile-release-evidence/`.

- Create the ignored private evidence file with `npm run mobile:evidence:init`.
- Keep Expo EAS project IDs in EAS and ignored local app `.env.local` files only, not in git.
- Use `MOBILE_ENVIRONMENT_RUNBOOK.md` when changing any mobile environment value.
- Recheck EAS values with `npm run mobile:eas:env:coach` and `npm run mobile:eas:env:parent`, including the printed profile matrix, if any test environment value changes.
- Confirm EAS remote build numbers and version codes are ready for the next store submissions.
- Record EAS remote build numbers and version codes in the private evidence file.
- Create Apple App Store Connect records.
- Apple App Store Connect records are created for Coach and Parents.
- Google Play Console records are created for Coach and Parents.
- Complete `MOBILE_STORE_RECORD_CHECKLIST.md` for all four store records.
- Create reviewer test accounts and supply credentials only inside store consoles.
- Run `npm run mobile:reviewer:preflight` before entering credentials in Apple or Google.
- Build real Android internal builds with the root mobile build commands. Complete for both apps on May 21 2026.
- Build real iOS TestFlight builds with the root mobile build commands. Complete for both apps on May 21 2026.
- Install builds on real Android and iOS devices.
- Verify push notifications on real Android and iOS devices using `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Record external QA and submission evidence using `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Capture store screenshots using `MOBILE_SCREENSHOT_PLAN.md` and test data only.
- Confirm the public support route is monitored and privacy wording still matches production before submission.

## Next external action checklist

- Run `npm run mobile:release-check` from the repo root and record the passing commit.
- Run `npm run mobile:preflight` before external EAS, Apple, or Google work.
- Run `npm run mobile:next` and confirm the local readiness snapshot is clean before external setup.
- Run `npm run mobile:eas:whoami` and sign in with `npx eas-cli login` if it reports that Expo EAS is not logged in.
- EAS projects and test-only EAS values are in place for both apps.
- Verify EAS project values again with `npm run mobile:eas:env:coach` and `npm run mobile:eas:env:parent` if any environment value changes.
- Run `npm run mobile:store:preflight` before creating or editing Apple and Google store records.
- Create the four store records: Coach iOS, Coach Android, Parents iOS, and Parents Android. Complete: Apple and Google Play records are created for Coach and Parents.
- Use `MOBILE_STORE_RECORD_CHECKLIST.md` while creating the four store records.
- Use `MOBILE_NATIVE_IDENTITY_CHECKLIST.md` while checking app names, bundle IDs, package names, schemes, icons, splash assets, notification icons, and public URLs.
- Enter reviewer credentials only in App Store Connect and Google Play Console.
- Set `MOBILE_NATIVE_BUILD_CONFIRMED=true` only for native build commands after EAS values are verified.
- Run `npm run mobile:build:preflight` before setting `MOBILE_NATIVE_BUILD_CONFIRMED=true`.
- Create one Android internal build and one iOS TestFlight build for each app with the root mobile build commands.
- Android internal and Android store-test builds have been created for both apps.
- iOS TestFlight builds have been created for both apps.
- Install all four builds on real devices.
- Complete `MOBILE_DEVICE_TESTING.md`, with push notification evidence from `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Capture screenshots from the real builds using `MOBILE_SCREENSHOT_PLAN.md`.
- Run `npm run mobile:screenshot:preflight` before final screenshot capture or upload.
- Run `npm run mobile:release-check` again immediately before final store submission.
- Run `npm run mobile:submit:preflight` before setting `MOBILE_SUBMISSION_CONFIRMED=true`.
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
