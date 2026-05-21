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
- Use portrait screenshots.
- Do not show the Expo Go shell, browser chrome, or debug overlays.

## Google Play

Capture Android phone screenshots from the internal test build or release candidate.

- Minimum set: phone screenshots.
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

Use clear names before upload so the two apps do not get mixed up:

- `coach-ios-01-login.png`
- `coach-ios-02-home.png`
- `coach-android-01-login.png`
- `parents-ios-01-login.png`
- `parents-ios-02-home.png`
- `parents-android-01-login.png`

## Final Check

- App name and screenshots match.
- Screenshots use test data only.
- No private credentials are visible.
- No live production data is visible.
- No billing, checkout, subscription, Stripe, or bulk email screens are shown.
- Support, privacy, and terms URLs match the store metadata.
