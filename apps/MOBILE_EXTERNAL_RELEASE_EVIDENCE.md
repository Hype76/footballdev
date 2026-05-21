# Football Player Mobile External Release Evidence

Use this template outside git when recording real EAS, device, notification, screenshot, and store submission evidence.

Recommended private folder: `apps/mobile-release-evidence/`.

That folder is ignored by git. Store completed evidence copies, reviewer credential notes, build links, push token notes, and store submission records there.

Create a private working copy with:

```bash
npm run mobile:evidence:init
```

Do not commit a completed copy of this file if it contains reviewer credentials, private URLs, build links, device identifiers, account emails, push tokens, or personal data.

## Release Candidate

- Date tested:
- Tester:
- Branch or commit:
- Coach app version:
- Parents app version:
- Test Supabase project confirmed:
- Live Supabase disabled:
- `npm run mobile:release-check` result:

## EAS Projects

### Coach

- EAS project name:
- EAS project ID recorded in Expo only:
- `EXPO_PUBLIC_SUPABASE_ENV=test` confirmed:
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false` confirmed:
- Test API HTTPS URL confirmed:

### Parents

- EAS project name:
- EAS project ID recorded in Expo only:
- `EXPO_PUBLIC_SUPABASE_ENV=test` confirmed:
- `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false` confirmed:
- Test API HTTPS URL confirmed:

## Native Builds

### Coach

- Android internal build ID:
- Android install result:
- iOS TestFlight build ID:
- iOS install result:

### Parents

- Android internal build ID:
- Android install result:
- iOS TestFlight build ID:
- iOS install result:

## Device QA

### Android

- Device model:
- OS version:
- Coach login:
- Coach refresh:
- Coach notifications:
- Coach biometric unlock:
- Parents login:
- Parents refresh:
- Parents notifications:
- Parents biometric unlock:

### iOS

- Device model:
- OS version:
- Coach login:
- Coach refresh:
- Coach notifications:
- Coach biometric unlock:
- Parents login:
- Parents refresh:
- Parents notifications:
- Parents biometric unlock:

## Notification Evidence

- Coach device registered in `mobile_push_devices`:
- Parents device registered in `mobile_push_devices`:
- Goal For parent notification:
- Goal Against parent notification:
- Half Time parent notification:
- Full Time parent notification:
- Undo Last Goal correction notification:
- Parent scorer volunteer coach notification:
- Immediate parent message notification:
- Scheduled parent message notification:
- Parent poll notification:
- Failed notification rows reviewed in `notification_events`:
- Stale tokens revoked after `DeviceNotRegistered`:

## Screenshot Evidence

- Coach iOS screenshot folder:
- Coach Android screenshot folder:
- Parents iOS screenshot folder:
- Parents Android screenshot folder:
- Test data only confirmed:
- No private credentials visible:
- No live production data visible:
- No billing, checkout, subscription, Stripe, or bulk email screens visible:

## Store Submission Evidence

### Apple

- Coach App Store Connect record:
- Parents App Store Connect record:
- Coach reviewer credentials entered in App Store Connect only:
- Parents reviewer credentials entered in App Store Connect only:
- Privacy answers copied from `MOBILE_PRIVACY_QUESTIONNAIRE.md`:
- Review notes copied from `MOBILE_REVIEWER_HANDOFF.md`:

### Google

- Coach Google Play record:
- Parents Google Play record:
- Coach reviewer credentials entered in Google Play Console only:
- Parents reviewer credentials entered in Google Play Console only:
- Data Safety answers copied from `MOBILE_PRIVACY_QUESTIONNAIRE.md`:
- Review notes copied from `MOBILE_REVIEWER_HANDOFF.md`:

## Final Decision

- Ready to submit:
- Blockers:
- Retest required:
- Retest build IDs:
- Final tester sign-off:
