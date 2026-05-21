# Football Player Coach Store Checklist

This app is test-only until the mobile release is explicitly approved for live Supabase.

## App identity

- App name: Football Player Coach
- iOS bundle identifier: com.footballplayer.coach
- Android package: com.footballplayer.coach
- Scheme: footballplayercoach
- Billing, checkout, subscription management, and bulk email are not included.

## Required before TestFlight or Google internal testing

- Review `STORE_METADATA.md` and confirm final public copy.
- Review `../MOBILE_PRIVACY_QUESTIONNAIRE.md` and confirm final privacy answers.
- Prepare reviewer notes and screenshot list from `../MOBILE_REVIEWER_HANDOFF.md`.
- Complete store account setup from `../MOBILE_STORE_ACCOUNT_SETUP.md`.
- Create the Expo EAS project and set `EXPO_PUBLIC_EAS_PROJECT_ID`.
- Add test Supabase URL and publishable key as EAS secrets.
- Add the Netlify test API base URL as `EXPO_PUBLIC_API_BASE_URL`.
- Confirm `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Confirm `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Create an Apple App Store Connect app record.
- Create a Google Play Console app record.
- Confirm app icons and splash assets are final enough for review builds.
- Confirm Android notification icon renders clearly in the status bar and notification drawer.
- Confirm a real test coach account exists for reviewer login.
- Confirm the test coach account has access to at least one team, one player, one match, and one assessment form.
- Confirm store app access notes say this is a restricted-login staff app with no in-app signup.

## Native device QA

- Login succeeds on a real iPhone.
- Login succeeds on a real Android phone.
- App blocks access for a parent account.
- App blocks access when Supabase environment is set to live without explicit approval.
- Notification permission prompt appears on a real device.
- Coach device can register for notifications.
- Coach device can disable notifications and re-enable them.
- Biometric unlock can be enabled when the device supports it.
- Biometric unlock does not appear as enabled when the device has no enrolled security.
- Sign out clears the active session.

## Coach workflow QA

- Matchday list loads from test data.
- Team switcher appears for multi-team access.
- Club-wide roles can use All Teams.
- Regular coaches remain scoped to assigned teams.
- Start match changes a scheduled match to live.
- Goal For updates the score and parent devices receive a push.
- Goal Against updates the score and parent devices receive a clear goal update.
- Add Goal Details saves scorer, assist, minute, and note.
- Undo Last Goal creates a score correction event and reverses the score.
- Half Time sends a parent notification.
- Second Half sends a parent notification.
- Full Time sends a parent notification.
- Player list loads.
- Quick Assessment saves against the club form fields.
- Sessions list loads.

## Build commands

```bash
cd apps/coach-mobile
npm install
npx eas-cli build --profile internal --platform android
npx eas-cli build --profile store-test --platform ios
npx eas-cli build --profile store-test --platform android
```

## Reviewer notes

- Login is required.
- Use the supplied test coach account.
- Payments are handled outside the mobile app and are not available in this app.
- Notifications require a real device.
- Biometric login appears only when the phone supports enrolled biometrics.
- This build uses the test database until the live release is explicitly approved.

## Remaining before store review

- Create the Expo EAS app project.
- Add the final EAS project ID.
- Build and install the Android internal build.
- Build and install the iOS TestFlight build.
- Capture final store screenshots.
- Supply reviewer credentials for the test coach account.
- Add reviewer notes in App Store Connect and Google Play Console.
- Add app access instructions from `../MOBILE_REVIEWER_HANDOFF.md`.
- Confirm the public support route is monitored and the privacy policy URL opens correctly.
