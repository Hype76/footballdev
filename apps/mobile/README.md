# Football Player Mobile

Expo mobile app for Football Player.

## Local Preview

```bash
npm run web
```

The current local preview uses `http://localhost:8082` when started with:

```bash
npx expo start --web --port 8082 --clear
```

## Database Safety

The mobile app is locked to test Supabase by default.

Use local Supabase for development:

```text
EXPO_PUBLIC_SUPABASE_ENV=test
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
EXPO_PUBLIC_SUPABASE_ANON_KEY=local anon key
EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false
```

Do not set `EXPO_PUBLIC_SUPABASE_ENV=live` or `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=true` until live mobile access is explicitly approved.

## Store Build Commands

Run validation first:

```bash
npm run doctor
npm run export:web
```

Build internal Android preview:

```bash
npm run build:android:preview
```

Build store-format test binaries that still block live Supabase:

```bash
npm run build:android:store-test
npm run build:ios:store-test
```

Build production binaries:

```bash
npm run build:android:production
npm run build:ios:production
```

Submit production builds:

```bash
npm run submit:android
npm run submit:ios
```

Before store upload, connect the Expo project to the correct Apple Developer and Google Play Console accounts. Keep `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false` until live mobile access is explicitly approved.
