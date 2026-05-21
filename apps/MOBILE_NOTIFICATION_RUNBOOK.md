# Football Player Mobile Notification Runbook

Use this when testing native push notifications for the Coach and Parents apps.

Native push must be tested on real iOS and Android devices. Simulators, emulators, Expo Go, and web export are not enough for store release approval.

## Client Setup

- Both apps use `expo-notifications`.
- Android uses the `matchday` notification channel.
- Both app configs use `./assets/notification-icon.png`.
- Device registration sends the Expo push token to `/.netlify/functions/register-mobile-push-device`.
- Device registration stores the selected team or child context locally and asks the user to refresh notifications after that context changes.
- Notification disable sends a DELETE request to `/.netlify/functions/register-mobile-push-device`.
- Notification taps route users back to the relevant app area.
- App badge count is cleared when notification setup runs.
- Expo tickets that report `DeviceNotRegistered` revoke the matching mobile device token so future sends do not keep retrying stale devices.

## Server Setup

Required Netlify functions:

- `register-mobile-push-device`
- `send-match-day-push`
- `send-coach-mobile-push`
- `send-parent-mobile-push`

Required database tables:

- `mobile_push_devices`
- `notification_events`

Required test environment values:

- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`
- `SUPABASE_SERVICE_ROLE_KEY`

## Coach To Parent Flows

- Goal For sends a parent goal notification.
- Goal Against sends a parent goal update notification.
- Score correction sends a parent correction notification.
- Half Time sends a parent phase notification.
- Second Half sends a parent phase notification.
- Full Time sends a parent phase notification.

## Parent To Coach Flows

- Volunteer As Scorer sends a coach notification.

## Web To Parent Flows

- Immediate parent message sends a parent notification.
- Scheduled parent message sends a parent notification when the message is sent.
- Parent poll creation sends a parent notification.

## QA Evidence

Record these results in a private evidence copy under `apps/mobile-release-evidence/`.

Before store submission, confirm:

- Both apps can register a real device token.
- Both apps can disable notifications and re-enable them.
- Android notification channel name is visible as Matchday alerts.
- iOS and Android notification taps open the right app area.
- `notification_events` records sent or failed outcomes.
- Stale or uninstalled-device tokens are marked revoked in `mobile_push_devices` after Expo reports `DeviceNotRegistered`.
- Parent notifications stay scoped to the selected linked child.
- Coach notifications stay scoped to the relevant club and team.
- Switching the selected team or child after notification registration shows a refresh prompt before the device is treated as registered for the new context.
- Notification tap routes are checked for matchday, parent messages, parent polls, and scorer volunteer flows.
- Any failed `notification_events` rows are reviewed before submission.
