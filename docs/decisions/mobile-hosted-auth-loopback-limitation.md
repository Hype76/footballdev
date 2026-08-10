# Mobile Hosted Auth Loopback Limitation

Reference: `FP-MOBILE-TEST-AUTH-LIMITATION-CLOSURE-06`

Steve accepts the hosted Supabase Auth loopback exception for `exp://127.0.0.1` and `exps://127.0.0.1`, including arbitrary loopback ports, for the current Footballplayer.online mobile product state.

This is an accepted and controlled platform limitation. It is not resolved, and the loopback destinations are not approved Footballplayer.online application destinations.

## Current product basis

- Coach and Parent use password sign-in only.
- Neither app supplies `redirectTo` or `emailRedirectTo`.
- Neither app implements password recovery, magic links, OTP email links, invitation links, Auth URL callbacks, Expo Go Auth callbacks, or URL-session parsing.
- `detectSessionInUrl` remains `false`.
- The Auth Site URL is the dedicated test API origin only: `https://footballplayer-mobile-test-api.netlify.app`.
- The configured redirect allow-list is empty.
- Leaked-password protection is enabled.
- Production redirects are not approved.

## Prohibited mobile Auth capabilities

- Password recovery links
- Magic links
- OTP email links
- Invite links
- Auth URL callbacks
- Expo Go Auth callbacks
- URL-session parsing or URL-provided session authority

Any introduction of a prohibited capability requires a new named security reference and explicit review before implementation or release. The automated mobile Auth boundary guard must remain enabled in repository checks.

This acceptance may be revoked if Supabase changes the hosted redirect behaviour, or if the Coach or Parent Auth scope changes from the current password-sign-in-only model.
