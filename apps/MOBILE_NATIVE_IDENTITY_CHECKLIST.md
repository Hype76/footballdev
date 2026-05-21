# Football Player Mobile Native Identity Checklist

Use this before EAS builds, store record setup, screenshot capture, and final submission for both mobile apps.

## Apps

- Coach app name: `Football Player Coach`.
- Coach Expo slug: `football-player-coach`.
- Coach scheme: `footballplayercoach`.
- Coach iOS bundle ID: `com.footballplayer.coach`.
- Coach Android package: `com.footballplayer.coach`.
- Parents app name: `Football Player Parents`.
- Parents Expo slug: `football-player-parents`.
- Parents scheme: `footballplayerparents`.
- Parents iOS bundle ID: `com.footballplayer.parents`.
- Parents Android package: `com.footballplayer.parents`.

## Brand Assets

- Coach icon: `apps/coach-mobile/assets/icon.png`.
- Coach adaptive icon: `apps/coach-mobile/assets/adaptive-icon.png`.
- Coach splash icon: `apps/coach-mobile/assets/splash-icon.png`.
- Coach notification icon: `apps/coach-mobile/assets/notification-icon.png`.
- Parents icon: `apps/parent-mobile/assets/icon.png`.
- Parents adaptive icon: `apps/parent-mobile/assets/adaptive-icon.png`.
- Parents splash icon: `apps/parent-mobile/assets/splash-icon.png`.
- Parents notification icon: `apps/parent-mobile/assets/notification-icon.png`.
- Store listings must use current Football Player artwork only.
- Store screenshots must come from real native builds and test data only.

## Public URLs

- Website and support URL: `https://footballplayer.online/`.
- Privacy URL: `https://footballplayer.online/gdpr`.
- Terms URL: `https://footballplayer.online/terms`.

## Store Identity Gate

- Do not use old Player Feedback naming in app names, subtitles, screenshots, review notes, or store metadata.
- Do not commit private reviewer credentials, store account emails, build links, provisioning files, or service account files.
- Keep EAS project IDs in EAS environment values, not in `app.config.js`.
- Keep both apps on `EXPO_PUBLIC_SUPABASE_ENV=test`.
- Keep both apps on `EXPO_PUBLIC_ALLOW_LIVE_SUPABASE=false`.
- Record final EAS project IDs, store record links, screenshot folder paths, and reviewer credential locations only in `apps/mobile-release-evidence/`.
