# Fan phone notification persistence, local draft

Prepared 04 October 2026 for Steve's report in Slack channel C0C5N2XEQHM, thread 1791095286.056079. Base: verified GitHub main `7ccbc41591569a7b7723a4fba7b28fbfa44cf50b`. Isolated branch: `codex/fan-notification-persistence-20261004`. Original checkout and previous fixture, chat, league and notification branches are preserved.

## Finding and limits

On main, Fan Phone notifications stores only a global SecureStore token. Settings checks OS permission and that cached token's current-account server registration. It does not fetch the current Expo token during reads, subscribe to token changes, persist explicit account-specific consent, or repair registration on startup. `_fan-push.js` deletes invalid tokens from `fan_devices`; it does not turn off a player's `fan_connections.notifications_enabled` Game Day preference. A missing or obsolete registration can therefore require manual enabling even while OS permission and the player's Game Day preference remain on.

`apps/mobile-core/src/updates.js` checks/fetches an Expo update and reloads the app. No preference-clear or notification-unregister call was found in that update path. This is a reproducible registration gap, not proof that Steve's update changed his OS permission, Game Day preference or phone setting. His platform, app/build, and which control or delivery behaviour resets are still unconfirmed. No live device, logs or account data were changed or used to establish his exact cause.

Expo documents that tokens can rotate, that the old token then becomes invalid, and that a push-token listener receives the native APNs/FCM token. The draft converts that native token with `getExpoPushTokenAsync`, rather than sending it directly to the Fan Expo-token endpoint. See https://docs.expo.dev/versions/latest/sdk/notifications/ .

## Comparison on verified main

| Experience | Existing safeguards | Remaining gap or uncertainty |
| --- | --- | --- |
| Fan | Current-account endpoint checks; independent server Game Day preferences | Global cached device token, no explicit scoped phone consent, no startup/current-token repair or token listener |
| Player | Uses the Fan connection and FansScreen route, including its phone control; per-player Game Day choice stored on server | Shares the Fan phone-registration gap; no separate Player push implementation found |
| Parent | Stable environment-specific installation ID and detail choice; startup/foreground server and OS read; token listener while enabled | Reads do not refresh the SDK token or re-register a missing/revoked installation. Invalid-token cleanup clears owner/token and sets enabled false; the enabled-only listener then stops. A rotation while closed can also leave a still-active server row using the old token |
| Coach | Stable environment-specific installation and detail choice; server-owned choice preservation; startup, foreground and token listeners; conditional registration/context/preference repair | Healthy server state does not trigger fresh-token lookup on startup. Silent preservation accepts only active existing registrations, not revoked rows. Thus more recovery logic is present, but this is not evidence that every revoked-token or update symptom is repaired, or that Coach is unaffected |

Relevant Parent held fixes are `ff470a6b` (checks that setup is still current after obtaining an auth token) and `a95ebc58` (separates cached registration and OS status), on `origin/codex/parent-notification-explainer-20261002`, not main. They do not repair the separate Fan path. Neither was cherry-picked. Parent/Coach source and server delivery code are unchanged by this draft.

## Draft behaviour

- Persist explicit phone opt-in/out in SecureStore under a stable key scoped to API environment and authenticated account. The key does not include app version or OTA ID.
- Silently check the current Expo token and repair a previously opted-in registration on FansScreen mount, foregrounding, opening Settings, and native token changes. Automatic reads never request OS permission or alter per-player Game Day choices.
- Migrate a legacy global token only after current-account server ownership is confirmed. If cleanup already removed an old token before this fix, that token alone cannot prove consent; the first explicit Enable is still needed.
- Preserve opt-in while OS permission is denied. Treat iOS provisional permission as quiet delivery, not Off. Distinguish OS blocking, deliberate in-app pause, missing registration, and an unknown read/network state in existing Settings rows.
- Persist an explicit pause before unregistering. Retain attempted-token history if cleanup fails, so later reads retry removal without opting back in. Serialise operations per account/environment so a queued pause wins over an in-flight refresh. Remove older tokens only after the new registration is verified.
- Recheck account lifetime after async operations and after acquiring the Bearer token. Account switches and unmounts cancel stale work. Sign-out cleanup persists a pause to preserve the existing unbind behaviour; an explicit Enable is needed after sign-out.

No backend/schema/dependency changes, migration application, live notifications/emails, device OS permission changes, push, merge, deploy, OTA or store release were performed. All browser notification/network services are synthetic mocks. No private marketing website changes.

## Validation and holds

- 17 focused Fan core tests pass: restart/server cleanup, token rotation and conversion, legacy ownership, explicit pause, failed cleanup retry, denied/provisional/ephemeral OS authorisation, offline registration and server readback, environment/account isolation, async cancellation, queued disable and corrupt preferences.
- Expanded real FansScreen mocked browser suite passes, including startup/foreground/token repair, explicit pause, failed registration/retry, account switch after auth lookup and sign-out cleanup, plus existing invitation, child selection, conversion and navigation checks.
- Selected Match Day, Parent isolation, calendar recurrence, email queue and login/session/notification regression set: 211/213 pass. The failures are the unchanged main failures in `matchday-parent-calendar-safety.test.mjs` (formation-plan source assertion) and `mobile-open-chat-invite-on-behalf-114.test.mjs` (Coach on-behalf wording assertion). Baseline reproduction evidence is retained in the earlier isolated preparation; base/source files are unchanged here. No waiver.
- 56 Fan endpoint/account/attendance/plan/access tests pass. Three additional executable comparison tests cover Parent revocation, Coach healthy-state repair conditions and Coach revoked preference preservation.
- Six filtered dual-access auth browser scenarios pass. Full repository lint, secret scan and Parent/Fan web export pass. A native device/iOS/Android build and real push delivery were not performed.
- `npm run security:supply-chain` fails with four undocumented high-severity development advisory findings rooted at braces `GHSA-VFJ7-8CJW-P6XM`. Direct npm audit confirms four high findings, zero critical. An initial direct script invocation did not yield JSON on Windows; rerunning through npm reproduced the substantive advisory failure.
- Migration security gate fails on the existing reconciliation changed-path and active-file manifest mismatches. It only read local SQL and Git history; no SQL was applied.

Raw local evidence is under `output/fan-regression.txt`, `output/fan-access-tests.txt`, `output/fan-browser.txt`, `output/fan-dual-access-browser.txt`, `output/fan-lint.txt`, `output/fan-parent-export.txt`, `output/fan-supply-chain.txt`, `output/fan-audit.json`, and `output/fan-migration-gate.txt`. These generated files remain local and ignored. Focused success is not full-green approval. All release gates remain held. Parent owns Slack delivery and Activity Log.
