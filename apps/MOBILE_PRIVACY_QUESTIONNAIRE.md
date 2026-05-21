# Football Player Mobile Privacy Questionnaire Draft

Use this draft when completing App Store Connect app privacy, Google Play Data Safety, and reviewer questionnaires.

This is not legal advice. Confirm final answers against the live privacy policy and the real production configuration before submission.

## Applies to both apps

- Apps require login.
- Apps do not include third-party advertising.
- Apps do not sell user data.
- Apps do not include in-app purchases.
- Apps do not include checkout, subscription management, or billing controls.
- Apps use Supabase for authentication and app data.
- Apps use Expo push notification services when native notifications are enabled.
- Apps may use device biometric APIs for local session unlock when the user enables biometric unlock.
- Apps do not collect precise location.
- Apps do not access contacts, photos, camera, microphone, health data, calendar, or Bluetooth.
- Android builds explicitly block location, camera, microphone, contacts, media, and Bluetooth permissions.
- Apps do not include public social networking or public chat.

## Data linked to user identity

The following data may be linked to a logged-in account because the app is account based:

- Email address.
- Account profile details.
- Club, team, and role access details.
- App activity needed to provide football club workflows.
- Push notification token when notifications are enabled.

## Coach app data

The Coach app may display or submit:

- Staff profile and role details.
- Club and team records.
- Player names, shirt numbers, team assignments, and player profile details.
- Matchday records, scores, goal events, score corrections, and scorer details.
- Assessment responses and coach notes.
- Session records.
- Device push token when coach notifications are enabled.

Purpose:

- App functionality.
- Account authentication.
- Staff access control.
- Club and team workflow operation.
- Notifications requested by the user.

## Parents app data

The Parents app may display or submit:

- Parent account and parent portal access details.
- Linked child names and team context.
- Matchday records, scores, updates, and scorer volunteer actions.
- Club messages sent to the parent portal.
- Parent poll answers.
- Device push token when parent notifications are enabled.

Purpose:

- App functionality.
- Account authentication.
- Parent access control.
- Club communication.
- Notifications requested by the user.

## Data not collected by the mobile apps

- Payment card details.
- In-app purchase history.
- Advertising identifiers.
- Contacts.
- Photos or videos.
- Camera input.
- Microphone audio.
- Precise location.
- Health or fitness data.
- Browsing history outside the app.

## Apple privacy labels draft

Likely categories to review:

- Contact Info: email address.
- User Content: assessment notes, messages, poll answers, and matchday records where entered by users.
- Identifiers: user ID and push token.
- Usage Data: app interactions required for app functionality, if tracked in production.

Likely purposes:

- App Functionality.
- Account Management.
- Notifications.

Tracking:

- No third-party advertising tracking is intended.
- Confirm no production analytics or marketing SDK has been added before submission.

## Google Play Data Safety draft

Likely data types to review:

- Personal info: email address and name where provided.
- App activity: app interactions needed for authenticated club workflows.
- App info and performance: crash or diagnostic data only if enabled by the build or platform.
- Messages: club messages shown to parents, where applicable.
- User-generated content: assessments, poll answers, matchday updates, and notes created in the app.
- Device or other IDs: push notification token.

Security and deletion:

- Data is transmitted over HTTPS.
- Users access data through authenticated accounts.
- Clubs manage staff and parent access through the web platform.
- Data deletion and subject requests should follow the published GDPR and data protection notice.

## Public policy URLs

- Privacy and data protection: `https://footballplayer.online/gdpr`
- Terms: `https://footballplayer.online/terms`
- Website and support URL: `https://footballplayer.online/`

Confirm the public support route is monitored before submitting production builds.
