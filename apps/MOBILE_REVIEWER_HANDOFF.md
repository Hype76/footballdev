# Football Player Mobile Reviewer Handoff

Use this as the working handoff for App Store Connect and Google Play review. Do not commit real passwords or private test account secrets.

## Review build status

- Coach app: Football Player Coach
- Parents app: Football Player Parents
- Store account setup: `MOBILE_STORE_ACCOUNT_SETUP.md`
- Database: test Supabase only
- Billing: not available in either mobile app
- Login: required for both apps
- Push notifications: require real iOS and Android devices
- Biometric unlock: visible only on devices with enrolled biometric security

## Reviewer account template

Store reviewer credentials should be supplied inside App Store Connect and Google Play Console review notes, not in this repository.

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

## Apple review notes draft

This app requires login because it is used by authorised football club users connected to an existing Football Player workspace.

Use the reviewer credentials supplied in this review note. The supplied account is connected to a test club workspace with sample teams, players, matchday data, messages, polls, and assessment records.

Payments are handled outside the mobile app and are not available in this app. The mobile app does not include checkout, in-app purchases, subscription management, club billing controls, or bulk email.

Push notifications require a real iOS device. Biometric unlock appears only when the device supports enrolled Face ID or Touch ID.

This review build uses the test database.

## Google Play review notes draft

This app requires login because it is used by authorised football club users connected to an existing Football Player workspace.

Use the reviewer credentials supplied in this review note. The supplied account is connected to a test club workspace with sample teams, players, matchday data, messages, polls, and assessment records.

Payments are handled outside the mobile app and are not available in this app. The mobile app does not include checkout, in-app purchases, subscription management, club billing controls, or bulk email.

Push notifications require a real Android device. Biometric unlock appears only when the device supports enrolled screen lock or biometric security.

This review build uses the test database.

## Screenshot checklist

Capture screenshots from real store builds or installed internal builds, not from the web export.

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
- Confirm both apps still use `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Confirm both apps still use `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Confirm the supplied review notes match the app being submitted.
- Confirm the screenshots do not show real child, parent, coach, or club data.
- Confirm privacy answers match `MOBILE_PRIVACY_QUESTIONNAIRE.md`.
