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
- Earlier migration security runs failed on reconciliation mismatches. Release-readiness investigation below establishes that the preparation clone used a stale local `origin/main`; the gate passes against freshly verified GitHub main, without migration or gate changes.

Raw local evidence is under `output/fan-regression.txt`, `output/fan-access-tests.txt`, `output/fan-browser.txt`, `output/fan-dual-access-browser.txt`, `output/fan-lint.txt`, `output/fan-parent-export.txt`, `output/fan-supply-chain.txt`, `output/fan-audit.json`, and `output/fan-migration-gate.txt`. These generated files remain local and ignored. Focused success is not full-green approval. All release gates remain held. Parent owns Slack delivery and Activity Log.

## Simon release decision packet, 04 October 2026

**Current decision: HOLD ON GATES, timing confirmed.** Steve gave permission to release when ready in the original Slack thread, message `1791099514.673139`, then explicitly selected **16:00 Europe/London on Sunday 04 October 2026** in message `1791099566.884339` after the timing question. This is a one-off Sunday release permission for this repair, contingent on all gates; it does not waive failures or authorize a new native/store build. The parent scheduled the guarded release. Do not deploy early. Simon's requested readiness confirmation remains pending. No release action has been executed.

### Exact source and affected app

- Original reviewed fix: `469cdad79a22b1c298a78ee5fc53bd46e90fac44`, unchanged in `football-fan-notifications`.
- Release source candidate: `def86b7dd4bc6e21b51dca5f519e052b39b74f70`, branch `codex/fan-release-readiness-20261004`, checkout `football-release-readiness`. This adds only rollback consent compatibility and its tests to the original fix. GitHub main was rechecked through the authorized GitHub connector and remains `7ccbc41591569a7b7723a4fba7b28fbfa44cf50b`.
- Three application source files relative to main: `apps/parent-mobile/src/FansScreen.js`, `apps/parent-mobile/src/fanDeviceNotifications.js`, and `apps/parent-mobile/src/useFanDeviceNotifications.js`. Remaining candidate differences are this technical packet and three test files. No backend, schema, native configuration, app version, dependency, lockfile or asset changes.
- Intended OTA is **Parent app only**, EAS project `7e0906f3-64f4-42d9-b45d-0ee68f599baa`, iOS/Android identity `com.footballplayer.parents`. Its binary hosts Fan and Player accounts and the embedded Parent Fans screen. Matching Parent installations receive the bundle; this cannot be treated as a separate Fan-only binary. Ordinary Parent notification implementation is unchanged. No Coach OTA, Netlify deploy, store build or database operation is part of this candidate.
- Held Parent/Coach work was not cherry-picked. Original checkout HEAD remains `df79af6e5fd5c554fca30e2101ea8f0e71cfd1ac`; original Fan commit and league draft `b445c093fa992069f5c44926a623ed16e7548075` remain unchanged.

### OTA compatibility evidence and missing checks

Repository Parent version is `1.0.22`, runtime policy is `appVersion`, and `store-live` uses production channel/environment. The draft only uses already-present Expo Notifications, SecureStore and React Native APIs. Native package/config files are byte-identical to main. SDK/Doctor checks and local iOS/Android Hermes exports succeed. Expo requires an update to match the installed native runtime and capabilities: https://docs.expo.dev/eas-update/runtime-versions/ .

**Installed compatibility is unproven.** The local private evidence file dates from May, leaves app-version fields blank, and its available Android artifacts are old test builds. No currently installed handset runtime, current production update group/channel mapping, or equivalent iOS/Android native build provenance was established. No callable local EAS/ADB executable was found. A repository version or a JS-displayed version is not proof of the installed runtime; the startup recovery screen can prefer the Expo config version.

Before publication, record each affected platform's native app version/build, `Updates.runtimeVersion`, native module/build provenance, project/channel, active update group and known-good rollback group. Confirm the actual production environment through the existing redacted environment checker. Production environment resolution was not run here. If installed runtime differs from `1.0.22`, remain held and prepare a verified compatible-runtime OTA plan; do not change runtime/version just to force delivery. A new store binary would require an explicit named exception to the repo's OTA-only rule.

Local native artifacts were compiled under **synthetic internal/test configuration**, not production configuration. They are compilation evidence, not files approved for publishing. Manifest `output/readiness-artifact-manifest.json` records source commit and SHA-256 values:

| Platform | Local bundle SHA-256 |
| --- | --- |
| iOS | `e66a47673e9ac4d8ec8ad90b43e3f7d7aa81904b0aae2a84cd58ad8c4cbc8986` |
| Android | `8e553bcf32c9487862bd90b57dfcda2948b0f8998e0c5242fd3a3d06b6c0eaaf` |

### Gates and bounded remedies

| Check | Verified result and disposition |
| --- | --- |
| Focused Fan and cross-app behaviour | 21/21 pass, including legacy rollback readback and an older client's pause surviving return to the fix |
| Fan browser | Pass: startup/foreground/token repair, account isolation, delayed-auth cancellation, explicit pause, retry, sign-out, rollback pause and existing invite/selection/permission/navigation flows; services are synthetic |
| Dual-access browser | Six scenarios pass on the final source candidate |
| Selected broader regression set | 271/273 pass; unchanged baseline formation and Coach on-behalf tests still fail on the source candidate |
| Full `mobile:release-check` | Pass: repository lint/web build, mobile config/pre-store, evidence initializer check, Doctor, both mobile web exports and whitespace checks. This wrapper is not the full security/regression suite, and its evidence initializer check does not validate completed handset evidence |
| Expo Doctor | Coach and Parent each 18/18 pass. The first run stopped on a broken shared npm cache; a fresh workspace-only cache fixed execution without deleting the shared cache or changing dependencies |
| Migration security | Pass for 440 ordered files on verified main base; no SQL or allowlist changes |
| Secret scan | Pass for 2456 tracked files |
| Dependency security | FAIL: four high-severity development findings rooted at braces `GHSA-VFJ7-8CJW-P6XM`; no exception or waiver |
| Physical device/update/real delivery | Not performed. Steve's phone/build/control clarification remains unanswered and actual incident reproduction is not proven |

**Baseline regression remedy:** separate branch `codex/release-gate-remedies-20261004`, checkout `football-release-gates`, commit `711c7c83f3149de179260376755ff15ea3d1dffb`, based directly on verified main. Untouched main reproduced 27/29 with the two failures. The remedy updates the obsolete singular formation assertion to require the existing plural plans and safe singular fallback, adds the missing truthful Coach staff-response explanation, and follows the relocated availability helper while requiring its club/team/match filters. It removes no safety assertion. Its 34 focused tests pass, including Parent formation privacy, and the Coach invitation browser passes with the explanation visibly asserted. No RPC, permission or data logic changed. This prerequisite is **not merged or bundled into the Fan candidate**; it needs separate review/integration and combined post-integration regression checks. No Coach release was requested or performed.

**Migration remedy:** the original local preparation clone pointed `origin` at Steve's local checkout with stale `origin/main` `9a9d768b...`. A new isolated release-review clone retains local-preparation provenance, has canonical GitHub `origin`, and records the freshly connector-verified main SHA. The unchanged gate now passes. The old preparation repository and its refs were left intact; no migration-manifest relaxation was used. Authorized release integration must re-fetch canonical main and rerun the gate against the actual final release head.

**Security remedy requires wider work:** GitHub lists braces through 3.0.3 as affected and no patched release, https://github.com/advisories/GHSA-vfj7-8cjw-p6xm . The root lock traces the chain through development package `@netlify/zip-it-and-ship-it@16.2.3` -> `fast-glob@3.3.3` -> `micromatch@4.0.8` -> `braces@3.0.3`. There is no safe published patched-version override to apply. The concrete next work is an isolated toolchain remediation: adopt a reviewed upstream depth-guard patch once published, or replace the bundling/glob dependency path with a supported alternative and pinned lockfile. Validate lifecycle/license inventory, full and production audits, function packaging, web/mobile exports and release tests. Audit's suggested major downgrade to old zip-it-and-ship-it is not an equivalent safe fix. This broader dependency change is not included in this app repair; retain the hold and have Steve select the separate remediation approach. No invented patched version, suppression, vendor edit or security waiver was introduced.

### Rollback and verification plan, not executed

1. Before a permitted release, capture the currently serving Parent production branch/channel, platform/runtime-specific update groups, native build identities and prior known-good **published** groups. Review/integrate approved prerequisites and this source through the normal process, then rerun required gates on the actual clean main head. The update guard requires exact equality with freshly fetched canonical main. Approval does not bypass that guard or the separate failed security/regression gates.
2. Resolve the production environment with the existing checker without printing secrets. Generate and hash the production artifact from the approved head. The synthetic local export above cannot be reused as a production artifact. Keep Coach and server deployments excluded.
3. Verify on authorized matching-runtime installations that the Parent binary opens Fan, Player and ordinary Parent flows correctly, existing OS permission is reported accurately, and existing Game Day choices survive restart/update/foreground. Verify account switching/sign-out, explicit pause, registration readback and token recovery using controlled synthetic services. Any new permission change or real notification delivery test requires separate authorization; none was carried out here.
4. Stop on wrong environment/runtime, crashes, login or parent-isolation regression, altered Game Day choices, failure to keep paused notifications off, or duplicate/stale registrations. Use the documented Expo rollback to the recorded prior published group for the same Parent runtime/channel/platform; do not guess an update ID or republish an unpublished draft. See https://docs.expo.dev/eas-update/rollbacks/ . No rollback command was run.
5. The rollback addition retains the server-verified current token in the older client's legacy key while enabled, clears that key before attempted pause cleanup, and recognises a later legacy-key removal as an older client's pause/sign-out when returning to this fix. The scoped record remains; no SQL/data rollback is required. Backend registrations remain governed by the existing authenticated endpoint. Rollback reintroduces the older refresh gap, so do not promise that it resolves the original incident. A first Enable may still be required where a pre-fix invalid token was already deleted and prior consent cannot be proved.

**Simon readiness confirmation:** once security, final integrated regressions, installed runtime, production environment and rollback evidence are green, confirm readiness for the Parent/Fan/Player-only OTA at Steve's authorized 16:00 Europe/London time. Until then this is a tested local repair ready for review, not a green deployment packet. The approval is contingent on the gates, not a failure waiver. If blockers remain at the scheduled time, hold and report them; do not choose an earlier or later release. Parent owns scheduling, Slack and Activity Log delivery.

Release-readiness raw evidence: `output/readiness-regressions.txt`, `output/readiness-focused.txt`, `output/readiness-fan-browser.txt`, `output/readiness-dual-access.txt`, `output/readiness-release-check.txt`, `output/readiness-doctor.txt`, `output/readiness-parent-native-export.txt`, `output/readiness-artifact-manifest.json`, `output/readiness-security.txt`, `output/readiness-migrations.txt`, and `output/readiness-secret-scan.txt`. The separate remedy checkout retains `output/readiness-baseline.txt`, `output/readiness-remedies.txt` and `output/readiness-coach-browser.txt`.
