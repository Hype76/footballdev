# Football Player Coach App

Clean Expo rebuild for club staff and coaches.

This app is locked to test Supabase by default.

## Scope

- Matchday mode
- Players
- Sessions
- Assessments
- Coach notifications
- Biometric unlock

Not included:

- Billing
- Checkout
- Subscription management
- Bulk email

## Local start

```bash
cd apps/coach-mobile
npm install
npm run start
```

## Checks

```bash
npm run export:web
npm run build:android:internal
npm run build:ios:store-test
npm run build:android:store-test
```

## Store readiness

- App checklist: `STORE_SUBMISSION_CHECKLIST.md`
- Shared mobile QA: `../MOBILE_PRE_STORE_QA.md`
- Keep `EXPO_PUBLIC_SUPABASE_ENV=test` and `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false` until live release approval is given.
