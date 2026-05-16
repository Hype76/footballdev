# Store Submission Checklist

## App Review Position

Player Feedback mobile is a free, login-only companion app for existing club staff.

The app does not show billing, checkout, subscription management, plan upgrades, Stripe, invoices, or payment links. Subscription purchase and account billing are handled outside the mobile app by authorised club administrators.

## Review Notes

Use these points in Apple App Review and Google Play review notes:

- This app is free to download.
- Users must already have a Player Feedback club account.
- The mobile app provides club operations tools for sessions, players, assessments, team access, templates, settings, and feedback.
- Payments, subscriptions, checkout, invoices, and billing management are not available in the app.
- Biometric login is optional and only unlocks a locally saved session on supported devices.

## Test Account

Local development test account:

```text
Email: mobile.test@playerfeedback.test
Password: TestMobile123!
Workspace: Codex Test FC
```

Store review needs a real review account on the live production database before submission.

## Data Safety

Expected disclosures:

- Account information: email address, display name, staff role.
- User content: player records, assessments, session notes, template content.
- App activity: audit log actions required for club administration.
- Security practices: authentication through Supabase, optional biometric unlock, no advertising tracking.

Not used by the mobile app:

- Location
- Camera
- Contacts
- Photos or media library
- Microphone
- Advertising ID
- In-app purchases

## Pre-Submission Commands

Run before building:

```bash
npm run doctor
npm run export:web
npx expo config --type public
```

Store-format test builds:

```bash
npm run build:android:store-test
npm run build:ios:store-test
```

Production builds only after live mobile Supabase access is approved:

```bash
npm run build:android:production
npm run build:ios:production
```
