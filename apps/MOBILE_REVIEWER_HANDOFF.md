# Football Player Mobile Reviewer Handoff

Use this as the working handoff for App Store Connect and Google Play review. Do not commit real passwords or private test account secrets.

## Review build status

- Coach app: Football Player Coach
- Parents app: Football Player Parents
- Store account setup: `MOBILE_STORE_ACCOUNT_SETUP.md`
- Screenshot plan: `MOBILE_SCREENSHOT_PLAN.md`
- Database: test Supabase only
- Billing: not available in either mobile app
- Login: required for both apps
- Push notifications: require real iOS and Android devices
- Biometric unlock: visible only on devices with enrolled biometric security

## Reviewer account template

Store reviewer credentials should be supplied inside App Store Connect and Google Play Console review notes, not in this repository.

Do not paste reviewer email addresses, passwords, one-time codes, or private account notes into this file.

### Coach reviewer account

- Email: add in store console only
- Password: add in store console only
- Role: authorised club staff
- Workspace: test club workspace
- Required data: at least one team, one player, one matchday record, one session, and one assessment form

### Parent reviewer account

- Email: add in store console only
- Password: add in store console only
- Role: linked parent or guardian
- Workspace: test club workspace
- Required data: at least one linked child, one matchday record, one message, and one open parent poll

## App access instructions

Use these instructions in App Store Connect and Google Play Console where the store asks how reviewers can access the app.

### Coach app access

This app is restricted to authorised club staff. Reviewers should sign in with the supplied test coach account. No signup, payment, purchase, subscription, or invite flow is available inside the mobile app. The supplied test account already has staff access to a test club workspace.

The test coach account should be able to open Matchday Mode, view players, submit a quick assessment, open sessions, enable notifications on a real device, and use biometric unlock when supported by the device.

### Parents app access

This app is restricted to linked parents and guardians. Reviewers should sign in with the supplied test parent account. No signup, payment, purchase, subscription, club admin, or invite flow is available inside the mobile app. The supplied test account is already linked to at least one child in a test club workspace.

The test parent account should be able to view linked child context, matchday updates, club messages, parent polls, notification settings, and biometric unlock when supported by the device.

## Apple Review Notes

### Coach app

Football Player Coach requires login because it is used by authorised football club staff connected to an existing Football Player workspace.

Use the supplied test coach account. The supplied account is connected to a test club workspace with sample teams, players, matchday data, sessions, and assessment records.

Payments are handled outside the mobile app and are not available in this app. The mobile app does not include checkout, in-app purchases, subscription management, club billing controls, or bulk email.

Push notifications require a real iOS device. Biometric unlock appears only when the device supports enrolled Face ID or Touch ID.

This review build uses the test database.

App access: restricted staff login. Use the supplied test coach account. The app has no in-app signup, purchase, subscription, or billing flow.

### Parents app

Football Player Parents requires login because it is used by parents and guardians linked to an existing Football Player workspace.

Use the supplied test parent account. The supplied account is connected to at least one linked child in a test club workspace with matchday data, club messages, and an open parent poll.

Payments are handled outside the mobile app and are not available in this app. The mobile app does not include checkout, in-app purchases, subscription management, club billing controls, staff workflows, club admin tools, or bulk email.

Push notifications require a real iOS device. Biometric unlock appears only when the device supports enrolled Face ID or Touch ID.

This review build uses the test database.

App access: restricted parent login. Use the supplied test parent account. The app has no in-app signup, purchase, subscription, or billing flow.

## Google Play Review Notes

### Coach app

Football Player Coach requires login because it is used by authorised football club staff connected to an existing Football Player workspace.

Use the supplied test coach account. The supplied account is connected to a test club workspace with sample teams, players, matchday data, sessions, and assessment records.

Payments are handled outside the mobile app and are not available in this app. The mobile app does not include checkout, in-app purchases, subscription management, club billing controls, or bulk email.

Push notifications require a real Android device. Biometric unlock appears only when the device supports enrolled screen lock or biometric security.

This review build uses the test database.

App access: restricted staff login. Use the supplied test coach account. The app has no in-app signup, purchase, subscription, or billing flow.

### Parents app

Football Player Parents requires login because it is used by parents and guardians linked to an existing Football Player workspace.

Use the supplied test parent account. The supplied account is connected to at least one linked child in a test club workspace with matchday data, club messages, and an open parent poll.

Payments are handled outside the mobile app and are not available in this app. The mobile app does not include checkout, in-app purchases, subscription management, club billing controls, staff workflows, club admin tools, or bulk email.

Push notifications require a real Android device. Biometric unlock appears only when the device supports enrolled screen lock or biometric security.

This review build uses the test database.

App access: restricted parent login. Use the supplied test parent account. The app has no in-app signup, purchase, subscription, or billing flow.

## Screenshot checklist

Capture screenshots from real store builds or installed internal builds, not from the web export. Use `MOBILE_SCREENSHOT_PLAN.md` for device classes, naming, ordering, and test-data rules.

Record the final screenshot folder paths in `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` before uploading them to Apple or Google.

### Coach app screenshots

- Login screen
- Coach home with Matchday Mode visible
- Matchday screen with live score controls
- Goal details form
- Players list
- Quick assessment screen
- Settings screen with notifications and biometric unlock

### Parents app screenshots

- Login screen
- Parent home with linked child context
- Matchday updates screen
- Messages screen
- Polls screen
- Child switcher when the test account has more than one linked child
- Settings screen with notifications and biometric unlock

## Final submission checks

- Confirm the reviewer accounts work immediately before submission.
- Confirm reviewer credentials are entered only in App Store Connect and Google Play Console.
- Confirm both apps still use `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Confirm both apps still use `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Confirm the supplied review notes match the app being submitted.
- Confirm the screenshots do not show real child, parent, coach, or club data.
- Confirm final screenshot folder paths are recorded in `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Confirm privacy answers match `MOBILE_PRIVACY_QUESTIONNAIRE.md`.
