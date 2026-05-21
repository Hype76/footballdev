# Football Player Mobile Screenshot Plan

Use this plan when preparing App Store Connect and Google Play screenshots for the Coach and Parents apps.

Screenshots must come from real store builds, TestFlight builds, or Google internal builds. Do not use web export screenshots for store submission.

## Data rules

- Use test database data only.
- Do not show real child, parent, coach, player, club, email, phone, or address details.
- Use a test club name, test teams, test players, and test parent accounts.
- Keep push notification permission prompts out of the main screenshots unless the store specifically requests them.
- Keep screenshots consistent with the app name being submitted.
- Capture fresh screenshots after any visible app change.

## Apple App Store

Capture the required iPhone sizes from TestFlight or an installed iOS release candidate.

- Minimum set: 6.7 inch iPhone display screenshots.
- Add 6.5 inch iPhone screenshots if App Store Connect asks for them.
- Use screenshots from a physical device or TestFlight build where possible.
- Keep each uploaded screenshot under 10 MB.
- Use PNG or JPEG files only.
- Use portrait screenshots.
- Do not show the Expo Go shell, browser chrome, or debug overlays.

## Google Play

Capture Android phone screenshots from the internal test build or release candidate.

- Minimum set: phone screenshots.
- Upload at least two screenshots per app listing.
- Keep each screenshot between 320 px and 3840 px on each side.
- Use PNG or JPEG files only.
- Use portrait screenshots.
- Do not show Android debug overlays, emulator controls, or browser chrome.
- Keep the status bar clean and avoid low battery indicators.

## Coach App Shots

Use this order:

1. Login screen.
2. Coach home with Matchday Mode visible.
3. Matchday screen with live score controls.
4. Goal details form.
5. Players list.
6. Quick assessment screen.
7. Settings screen with notifications and biometric unlock.

## Parents App Shots

Use this order:

1. Login screen.
2. Parent home with linked child context.
3. Matchday updates screen.
4. Messages screen.
5. Polls screen.
6. Child switcher when the test account has more than one linked child.
7. Settings screen with notifications and biometric unlock.

## File Naming

Use clear names before upload so the two apps do not get mixed up.

Coach iOS:

- `coach-ios-01-login.png`
- `coach-ios-02-home.png`
- `coach-ios-03-matchday.png`
- `coach-ios-04-goal-details.png`
- `coach-ios-05-players.png`
- `coach-ios-06-assessment.png`
- `coach-ios-07-settings.png`

Coach Android:

- `coach-android-01-login.png`
- `coach-android-02-home.png`
- `coach-android-03-matchday.png`
- `coach-android-04-goal-details.png`
- `coach-android-05-players.png`
- `coach-android-06-assessment.png`
- `coach-android-07-settings.png`

Parents iOS:

- `parents-ios-01-login.png`
- `parents-ios-02-home.png`
- `parents-ios-03-matchday.png`
- `parents-ios-04-messages.png`
- `parents-ios-05-polls.png`
- `parents-ios-06-child-switcher.png`
- `parents-ios-07-settings.png`

Parents Android:

- `parents-android-01-login.png`
- `parents-android-02-home.png`
- `parents-android-03-matchday.png`
- `parents-android-04-messages.png`
- `parents-android-05-polls.png`
- `parents-android-06-child-switcher.png`
- `parents-android-07-settings.png`

Keep all rejected or alternate screenshots outside the final upload folder so the wrong app or platform image is not selected during submission.

## Screenshot Evidence Folders

Use separate folders for the final upload set:

- `coach-ios-final`
- `coach-android-final`
- `parents-ios-final`
- `parents-android-final`

Each folder should contain only the screenshots intended for that specific store listing. Keep draft captures, failed captures, screenshots with private data, and screenshots from the wrong app outside these folders.

## Final Check

- App name and screenshots match.
- Screenshots use test data only.
- No private credentials are visible.
- No live production data is visible.
- No billing, checkout, subscription, Stripe, or bulk email screens are shown.
- Support, privacy, and terms URLs match the store metadata.
- Screenshot folders are recorded in `MOBILE_EXTERNAL_RELEASE_EVIDENCE.md`.
- Screenshots were captured after the final visible app change.
