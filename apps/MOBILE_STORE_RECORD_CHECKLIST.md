# Football Player Mobile Store Record Checklist

Use this when creating the four Apple and Google store records. Keep credentials, account emails, private notes, and build links out of git.

Create or update the private release evidence file first:

```bash
npm run mobile:evidence:init
```

Record completed store record links only in the ignored `apps/mobile-release-evidence/` folder.

## Records To Create

- Apple App Store Connect: Football Player Coach, bundle ID `com.footballplayer.coach`.
- Apple App Store Connect: Football Player Parents, bundle ID `com.footballplayer.parents`.
- Google Play Console: Football Player Coach, package `com.footballplayer.coach`.
- Google Play Console: Football Player Parents, package `com.footballplayer.parents`.

## Shared Store Settings

- App type: App.
- Category: Sports.
- Pricing: Free.
- Login required: Yes.
- In-app purchases: None.
- Payments, checkout, subscription management, and billing controls in mobile app: No.
- Reviewer credentials: enter only in Apple and Google consoles.
- Privacy answers: copy from `MOBILE_PRIVACY_QUESTIONNAIRE.md`.
- Review notes: copy from `MOBILE_REVIEWER_HANDOFF.md`.
- Screenshots: capture later from real builds using `MOBILE_SCREENSHOT_PLAN.md`.
- Support URL: `https://footballplayer.online/`.
- Privacy URL: `https://footballplayer.online/gdpr`.
- Terms URL: `https://footballplayer.online/terms`.

## Coach Record Copy

Use `apps/coach-mobile/STORE_METADATA.md`.

- App name: Football Player Coach.
- Short description: Matchday and player tools for football coaches.
- Restricted access note: authorised football club staff only.
- Reviewer account: test coach account in store console only.
- Required test data: team, player, matchday record, session, and assessment form.

## Parents Record Copy

Use `apps/parent-mobile/STORE_METADATA.md`.

- App name: Football Player Parents.
- Short description: Matchday updates and club messages for parents.
- Restricted access note: linked parents and guardians only.
- Reviewer account: test parent account in store console only.
- Required test data: linked child, matchday record, message, and open parent poll.

## Before Marking Store Records Ready

- Store records use current app names, not old Player Feedback naming.
- Bundle IDs and package names match `MOBILE_STORE_ACCOUNT_SETUP.md`.
- Review notes explain that payments are handled outside the mobile app.
- App access explains login-only restricted access with no in-app signup.
- Privacy and data safety answers match `MOBILE_PRIVACY_QUESTIONNAIRE.md`.
- No live production data, private account emails, passwords, or build links were committed.
- Store record links are recorded in a private evidence file under `apps/mobile-release-evidence/`.
