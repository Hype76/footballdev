# Football Player Mobile Device Testing

Use this runbook for physical iOS and Android QA before the PR is marked ready.

## Before building

- Confirm the PR deploy preview is green.
- Confirm both apps use test Supabase only.
- Confirm EAS environment values match `MOBILE_ENVIRONMENT_RUNBOOK.md`.
- Confirm EAS project setup matches `MOBILE_EAS_SETUP_CHECKLIST.md`.
- Confirm notification checks follow `MOBILE_NOTIFICATION_RUNBOOK.md`.
- Run `npm run mobile:release-check` from the repo root.
- Run `npm run mobile:config` from the repo root.
- Run `npm run mobile:prestore` from the repo root.
- Run `npm run mobile:doctor` from the repo root.
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
- Pull down to refresh the Coach home screen and confirm the latest matchday and player data reloads.
- Pull down to refresh the Parents home screen and confirm the latest matchday, messages, and polls reload.
- Send each app to the background, reopen it, and confirm the current data refreshes without signing out.
- In Coach, save a quick assessment with valid required answers.
- In Coach, try saving a quick assessment with a missing required answer and confirm it is blocked.
- Enable notifications in both apps.
- Confirm Android notification permission is granted.
- Disable notifications in both apps, then enable them again.
- Confirm biometric unlock can be enabled where supported.
- With biometric unlock enabled, send each app to the background, reopen it, and confirm the unlock screen appears.
- Sign out, then confirm notifications and biometric unlock are no longer enabled for that signed-out session.

## iPhone install test

- Install the Coach build through TestFlight.
- Install the Parents build through TestFlight.
- Login to Coach with the test coach account.
- Login to Parents with the test parent account.
- In Coach, switch team context if the account has more than one assigned team.
- In Parents, switch linked child if the account has more than one linked child.
- Pull down to refresh the Coach home screen and confirm the latest matchday and player data reloads.
- Pull down to refresh the Parents home screen and confirm the latest matchday, messages, and polls reload.
- Send each app to the background, reopen it, and confirm the current data refreshes without signing out.
- Enable notifications in both apps.
- Confirm iOS notification permission is granted.
- Disable notifications in both apps, then enable them again.
- Confirm Face ID or Touch ID unlock can be enabled where supported.
- With biometric unlock enabled, send each app to the background, reopen it, and confirm the unlock screen appears.
- Sign out, then confirm notifications and biometric unlock are no longer enabled for that signed-out session.

## Notification test matrix

- Coach starts match, parent app still loads the live match.
- Coach cannot save an invalid match status.
- Coach cannot skip straight to full time before the match has started.
- Coach records Goal For, parent device receives a goal notification.
- Coach records a detailed goal with a valid minute, scorer, and assist.
- Coach tries a non-numeric detailed goal minute and sees a validation message instead of saving invalid data.
- Coach cannot add a goal after a match is full time, postponed, or cancelled.
- Coach records Goal Against, parent device receives a goal update notification.
- Coach records Half Time, parent device receives a half time notification.
- Coach records Full Time, parent device receives a full time notification.
- Coach uses Undo Last Goal, parent app shows a score correction.
- Coach cannot use Undo Last Goal on postponed or cancelled matches.
- Parent taps Volunteer As Scorer, coach device receives a scorer volunteer notification.
- Parent cannot volunteer as scorer after the match is no longer available for scorer requests.
- Staff sends a parent message immediately, parent device receives a message notification.
- Staff schedules a parent message, parent device receives a notification only when it is sent.
- Staff creates a parent poll, parent device receives a poll notification.
- Parent answers an open poll once and then sees the answer as sent.
- Parent cannot answer a closed poll.

## Evidence log

Record this outside the repo for each test run. Use `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md` as the template:

- Build IDs for Coach iOS, Coach Android, Parents iOS, and Parents Android.
- Device model, operating system version, and app version for each installed build.
- Test account role used for each app.
- Pass or fail result for login, refresh, foreground reload, notifications, biometric unlock, and role restriction checks.
- `mobile_push_devices` rows created or revoked during the run.
- `notification_events` rows for each push test, including failed outcomes.
- Screenshot folder path used for store captures.
- Any failure notes, retest date, and fixed build ID.

## Pass criteria

- Both apps install on Android and iPhone.
- Both apps login with test accounts.
- Pull-to-refresh reloads the current Coach and Parents app data.
- Reopening either app refreshes the current Coach and Parents app data.
- Parent account cannot open the Coach app.
- Coach-only account cannot open the Parents app without a parent link.
- Native push registration succeeds in both apps.
- Native push opt out succeeds in both apps.
- Notification events are recorded in `notification_events`.
- Evidence log is complete for the tested builds.
- Apps remain on test Supabase.
- No mobile billing, checkout, subscription management, or bulk email controls are visible.
