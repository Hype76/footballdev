# Football Player Parent App

Clean Expo rebuild for parents and guardians.

This app is locked to test Supabase by default.

## Scope

- Parent login
- Linked child context
- Live matchday updates
- Native push notifications
- Polls and messages
- Biometric unlock

Not included:

- Billing
- Club admin tools
- Staff workflows
- Bulk email

## Local start

```bash
cd apps/parent-mobile
npm install
npm run start
```

## Checks

```bash
npm run mobile:release-check
```

From this app folder:

```bash
npm run export:web
npm run build:android:internal
npm run build:ios:store-test
npm run build:android:store-test
npm run submit:ios:store-test
npm run submit:android:store-test
```

## Store readiness

- App checklist: `STORE_SUBMISSION_CHECKLIST.md`
- Store metadata draft: `STORE_METADATA.md`
- Shared mobile QA: `../MOBILE_PRE_STORE_QA.md`
- Device testing runbook: `../MOBILE_DEVICE_TESTING.md`
- Keep `EXPO_PUBLIC_SUPABASE_ENV=test` and `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false` until live release approval is given.
