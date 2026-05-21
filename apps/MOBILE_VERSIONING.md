# Football Player Mobile Versioning

Use this before creating TestFlight, Google internal, or store review builds for either mobile app.

## Current Version

- Coach app version: `0.1.0`
- Parents app version: `0.1.0`
- iOS initial build number: `1`
- Android initial version code: `1`

Both apps use Expo EAS remote app versioning:

- `cli.appVersionSource` is `remote`.
- The `store-test` profile has `autoIncrement` enabled.
- Store and TestFlight builds should be created through EAS, not by manually editing native project files.

## Release Rules

- Keep both apps on `EXPO_PUBLIC_SUPABASE_ENV=test` until live release approval is explicit.
- Do not manually bump `ios.buildNumber` or `android.versionCode` for normal EAS builds.
- Let EAS auto-increment store-test builds.
- Bump `expo.version` only when the user-facing app release version changes.
- Keep Coach and Parents version numbers aligned unless there is a clear release reason to split them.
- Record any version split in this file before submitting.

## Build Order

Run from the repo root:

```bash
npm run mobile:release-check
```

Then build each app through its package scripts:

```bash
cd apps/coach-mobile
npm run build:ios:store-test
npm run build:android:store-test
```

```bash
cd apps/parent-mobile
npm run build:ios:store-test
npm run build:android:store-test
```

## Submission Check

- App Store Connect build number is higher than the previous submitted Coach build.
- Google Play version code is higher than the previous submitted Coach build.
- App Store Connect build number is higher than the previous submitted Parents build.
- Google Play version code is higher than the previous submitted Parents build.
- Both app records still point at the test database until live release approval is explicit.
