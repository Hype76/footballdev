# Football Player Parents Store Checklist

This app is test-only until the mobile release is explicitly approved for live Supabase.

## App identity

- App name: Football Player Parents
- iOS bundle identifier: com.footballplayer.parents
- Android package: com.footballplayer.parents
- Scheme: footballplayerparents
- Billing, checkout, subscription management, club admin tools, staff workflows, and bulk email are not included.

## Required before TestFlight or Google internal testing

- Review `STORE_METADATA.md` and confirm final public copy.
- Review `../MOBILE_PRIVACY_QUESTIONNAIRE.md` and confirm final privacy answers.
- Prepare reviewer notes and screenshot list from `../MOBILE_REVIEWER_HANDOFF.md`.
- Create the Expo EAS project and set `EXPO_PUBLIC_EAS_PROJECT_ID`.
- Add test Supabase URL and publishable key as EAS secrets.
- Add the Netlify test API base URL as `EXPO_PUBLIC_API_BASE_URL`.
- Confirm `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Confirm `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Create an Apple App Store Connect app record.
- Create a Google Play Console app record.
- Confirm app icons and splash assets are final enough for review builds.
- Confirm Android notification icon renders clearly in the status bar and notification drawer.
- Confirm a real test parent account exists for reviewer login.
- Confirm the parent account has at least one linked player with matchday data.
- Confirm the linked player has at least one portal message and one open parent poll.

## Native device QA

- Login succeeds on a real iPhone.
- Login succeeds on a real Android phone.
- App blocks access for a coach-only account without parent links.
- App blocks access when Supabase environment is set to live without explicit approval.
- Notification permission prompt appears on a real device.
- Parent device can register for notifications.
- Parent device can disable notifications and re-enable them.
- Biometric unlock can be enabled when the device supports it.
- Biometric unlock does not appear as enabled when the device has no enrolled security.
- Sign out clears the active session.

## Parent workflow QA

- Linked child summary loads.
- Child switcher appears for accounts with more than one linked child.
- Matchday, messages, polls, and notifications follow the selected child.
- Matchday tab loads fixtures and recent events.
- Refresh Matchday reloads the latest score.
- Goal push notifications arrive from coach mobile actions.
- Score correction appears clearly after Undo Last Goal.
- Volunteer As Scorer sends interest and notifies coach devices.
- Messages tab shows unread messages.
- Mark Read clears the unread state.
- Polls tab shows unanswered poll count.
- Voting saves and clears the unanswered state.
- Parent message push notifications arrive after immediate email sends.
- Parent message push notifications arrive after scheduled email sends.
- Parent poll push notifications arrive after parent polls are created.

## Build commands

```bash
cd apps/parent-mobile
npm install
npx eas-cli build --profile internal --platform android
npx eas-cli build --profile store-test --platform ios
npx eas-cli build --profile store-test --platform android
```

## Reviewer notes

- Login is required.
- Use the supplied test parent account.
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
- Supply reviewer credentials for the test parent account.
- Add reviewer notes in App Store Connect and Google Play Console.
- Confirm final support URL and privacy policy URL.
