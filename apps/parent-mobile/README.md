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
- Encrypted offline family information and durable action sync

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

## Offline storage

The Parent app uses one user-scoped encrypted document for cached profile, child, Matchday, calendar, message, poll, and pending action data.

- `expo-crypto` supplies operating-system random bytes and command UUIDs.
- `@noble/ciphers` supplies maintained XChaCha20-Poly1305 authenticated encryption without adding a native module.
- `@react-native-community/netinfo` supplies Expo-compatible connectivity state and restoration events.
- The 256-bit encryption key is protected by SecureStore. AsyncStorage contains only versioned nonce and ciphertext envelopes.
- Message read and poll response replay use the existing server-authoritative Parent RPCs. No mobile permission or role claim is trusted.

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
