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
npm run mobile:config
```

From the repo root:

```bash
npm run mobile:export:web
npm run mobile:build:parent:android:internal
npm run mobile:build:parent:ios:store-test
npm run mobile:build:parent:android:store-test
```

## Submit

Run only after the store records, reviewer credentials, screenshots, reviewer notes, physical device QA, and `STORE_SUBMISSION_CHECKLIST.md` are complete.

```bash
npm run mobile:submit:parent:ios:store-test
npm run mobile:submit:parent:android:store-test
```

## Store readiness

- App checklist: `STORE_SUBMISSION_CHECKLIST.md`
- Store metadata: `STORE_METADATA.md`
- Environment runbook: `../MOBILE_ENVIRONMENT_RUNBOOK.md`
- Notification runbook: `../MOBILE_NOTIFICATION_RUNBOOK.md`
- Screenshot plan: `../MOBILE_SCREENSHOT_PLAN.md`
- Versioning guide: `../MOBILE_VERSIONING.md`
- Shared mobile QA: `../MOBILE_PRE_STORE_QA.md`
- Device testing runbook: `../MOBILE_DEVICE_TESTING.md`
- Reviewer handoff: `../MOBILE_REVIEWER_HANDOFF.md`
- Keep `EXPO_PUBLIC_SUPABASE_ENV=test` and `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false` until live release approval is given.
