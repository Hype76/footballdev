# Football Player Coach Store Checklist

This app is test-only until the mobile release is explicitly approved for live Supabase.

## App identity

- App name: Football Player Coach
- iOS bundle identifier: com.footballplayer.coach
- Android package: com.footballplayer.coach
- Scheme: footballplayercoach
- Billing, checkout, subscription management, and bulk email are not included.

## Required before TestFlight or Google internal testing

- Verify `STORE_METADATA.md` matches the current app name, restricted-login access model, support URL, privacy URL, and terms URL.
- Verify `../MOBILE_PRIVACY_QUESTIONNAIRE.md` matches the current app permissions, notification behaviour, no-purchase model, and test-data review build.
- Prepare reviewer notes and screenshot list from `../MOBILE_REVIEWER_HANDOFF.md`.
- Complete store account setup from `../MOBILE_STORE_ACCOUNT_SETUP.md`.
- Check EAS and API values against `../MOBILE_ENVIRONMENT_RUNBOOK.md`.
- Check native push requirements against `../MOBILE_NOTIFICATION_RUNBOOK.md`.
- Prepare screenshots from `../MOBILE_SCREENSHOT_PLAN.md`.
- Check build numbering against `../MOBILE_VERSIONING.md`.
- Follow release phase ownership from `../MOBILE_RELEASE_PHASES.md`.
- Record external build, device, screenshot, and submission evidence in a private copy of `../MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` inside `../mobile-release-evidence/`.
- Create the Expo EAS project and set `EXPO_PUBLIC_EAS_PROJECT_ID`.
- Add test Supabase URL and publishable key as EAS secrets.
- Add the Netlify test API base URL as `EXPO_PUBLIC_API_BASE_URL`.
- Confirm `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Confirm `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Create an Apple App Store Connect app record.
- Create a Google Play Console app record.
- Confirm app icons and splash assets match the current Football Player brand for review builds.
- Confirm Android notification icon renders clearly in the status bar and notification drawer.
- Confirm a real test coach account exists for reviewer login.
- Keep reviewer email and password out of git. Add them only inside App Store Connect and Google Play Console.
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
- Notification flows follow `../MOBILE_NOTIFICATION_RUNBOOK.md`.
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
npm run mobile:build:coach:android:internal
npm run mobile:build:coach:ios:store-test
npm run mobile:build:coach:android:store-test
```

## Submit commands

Run only after store records, reviewer credentials, screenshots, reviewer notes, device QA, notification QA, and private release evidence are complete.

The guarded submit commands require `MOBILE_SUBMISSION_CONFIRMED=true`.

```bash
npm run mobile:submit:coach:ios:store-test
npm run mobile:submit:coach:android:store-test
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
- Record build IDs and device results in `../MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Capture final store screenshots from `../MOBILE_SCREENSHOT_PLAN.md`.
- Supply reviewer credentials for the test coach account.
- Do not paste reviewer credentials into repo files.
- Add reviewer notes in App Store Connect and Google Play Console.
- Add app access instructions from `../MOBILE_REVIEWER_HANDOFF.md`.
- Confirm the public support route is monitored and the privacy policy URL opens correctly.
