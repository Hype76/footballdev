# Football Player Mobile Release Status

This records the current state of the Coach and Parents mobile app rebuild.

## Complete in this branch

- Coach Expo app exists at `apps/coach-mobile`.
- Parents Expo app exists at `apps/parent-mobile`.
- Shared mobile code exists at `apps/mobile-core`.
- Both apps are locked to test Supabase by default.
- Live Supabase is blocked unless explicitly enabled.
- Billing, checkout, subscription management, Stripe controls, and bulk email are excluded from mobile source.
- Native push registration, opt out, notification routing, Android notification channel setup, and Android notification icons are implemented.
- Biometric unlock support is implemented where the device supports enrolled security.
- Coach app supports matchday, players, quick assessments, sessions, team switching, and club-wide All Teams for eligible roles.
- Parents app supports linked child switching, matchday updates, messages, polls, and scorer volunteer actions.
- Android sensitive permissions that are not used are explicitly blocked.
- Store metadata, privacy questionnaire, reviewer handoff, store account setup, and device testing docs are present.
- `npm run mobile:release-check` passes locally.

## Still external before store submission

- Create Expo EAS projects for both apps.
- Add each final `EXPO_PUBLIC_EAS_PROJECT_ID` in EAS, not in git.
- Add test Supabase and test Netlify API environment values in EAS.
- Create Apple App Store Connect records.
- Create Google Play Console records.
- Create reviewer test accounts and supply credentials only inside store consoles.
- Build real Android internal builds.
- Build real iOS TestFlight builds.
- Install builds on real Android and iOS devices.
- Verify push notifications on real Android and iOS devices.
- Capture store screenshots using test data only.
- Confirm final support URL and privacy wording before submission.

## Release gate

Do not submit either app until all of these are true:

- `npm run mobile:release-check` passes immediately before native builds.
- Android internal QA passes on a real device.
- iOS TestFlight QA passes on a real device.
- Push notification flows pass on both platforms.
- Store screenshots show test data only.
- Reviewer credentials work immediately before submission.
- Review notes explain that payments are handled outside the mobile app.
- Both apps remain on `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Both apps remain on `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.

## Live database gate

Do not switch either mobile app to live Supabase until live release approval is explicitly given.
