# Football Player Mobile Device Testing

Use this runbook for physical iOS and Android QA before the PR is marked ready.

## Before building

- Confirm the PR deploy preview is green.
- Confirm both apps use test Supabase only.
- Run `npm run mobile:prestore` from the repo root.
- Run `npm run mobile:export:web` from the repo root.
- Confirm these EAS secrets exist for both apps:
  - `EXPO_PUBLIC_SUPABASE_ENV=test`
  - `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - `EXPO_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_EAS_PROJECT_ID`
- Confirm Netlify test environment has:
  - `VITE_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `WEB_PUSH_PUBLIC_KEY`
  - `WEB_PUSH_PRIVATE_KEY`
  - `WEB_PUSH_SUBJECT`

## Build Coach app

```bash
cd apps/coach-mobile
npm install
npm run build:android:internal
npm run build:ios:store-test
```

## Build Parents app

```bash
cd apps/parent-mobile
npm install
npm run build:android:internal
npm run build:ios:store-test
```

## Android install test

- Install the Coach APK on a real Android phone.
- Install the Parents APK on a second real Android phone, or uninstall and swap accounts if only one device is available.
- Login to Coach with the test coach account.
- Login to Parents with the test parent account.
- In Coach, switch team context if the account has more than one assigned team.
- In Parents, switch linked child if the account has more than one linked child.
- Enable notifications in both apps.
- Confirm Android notification permission is granted.
- Disable notifications in both apps, then enable them again.
- Confirm biometric unlock can be enabled where supported.

## iPhone install test

- Install the Coach build through TestFlight.
- Install the Parents build through TestFlight.
- Login to Coach with the test coach account.
- Login to Parents with the test parent account.
- In Coach, switch team context if the account has more than one assigned team.
- In Parents, switch linked child if the account has more than one linked child.
- Enable notifications in both apps.
- Confirm iOS notification permission is granted.
- Disable notifications in both apps, then enable them again.
- Confirm Face ID or Touch ID unlock can be enabled where supported.

## Notification test matrix

- Coach starts match, parent app still loads the live match.
- Coach records Goal For, parent device receives a goal notification.
- Coach records Goal Against, parent device receives a goal update notification.
- Coach records Half Time, parent device receives a half time notification.
- Coach records Full Time, parent device receives a full time notification.
- Coach uses Undo Last Goal, parent app shows a score correction.
- Parent taps Volunteer As Scorer, coach device receives a scorer volunteer notification.
- Staff sends a parent message immediately, parent device receives a message notification.
- Staff schedules a parent message, parent device receives a notification only when it is sent.
- Staff creates a parent poll, parent device receives a poll notification.

## Pass criteria

- Both apps install on Android and iPhone.
- Both apps login with test accounts.
- Parent account cannot open the Coach app.
- Coach-only account cannot open the Parents app without a parent link.
- Native push registration succeeds in both apps.
- Native push opt out succeeds in both apps.
- Notification events are recorded in `notification_events`.
- Apps remain on test Supabase.
- No mobile billing, checkout, subscription management, or bulk email controls are visible.
