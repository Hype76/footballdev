# Mobile tooling security review, 02:10:2026

Base: main `b40b5935e46a49caf22b84bbbb02f36975a3f1ff` (PR 163). Scope: compatible mobile tooling patches, local exports and publisher assessment. Simon's approval is recorded in Slack C0C5N2XEQHM thread 1790940565.773129, reply 1790947904.233679. No release was performed.

## Applied changes

Both apps retain Expo `~54.0.37`, React Native `0.81.5`, every direct dependency, app version, native asset, plugin, permission, EAS project/channel, code-signing setting and `appVersion` runtime policy. Only these eight transitive lock entries per app changed:

| Package line | Before | After |
| --- | --- | --- |
| brace-expansion 1.x, four nested entries | 1.1.18 | 1.1.21 |
| brace-expansion 2.x under Expo | 2.1.4 | 2.1.7 |
| brace-expansion 5.x | 5.0.9 | 5.0.12 |
| js-yaml 4.x under @expo/xcpretty | 4.3.1 | 4.3.2 |
| undici 6.x | 6.28.0 | 6.28.1 |

Existing js-yaml 3.15.2 remains. Overrides are bounded to existing package lines. No `npm audit fix`, Expo 44, expo-updates 0.11.7 or datetimepicker 8.1.1 downgrade was used.

## Audits and residual exposure

The original archive's lock SHA256 values match this branch's unchanged baseline byte for byte. Node 22.21.0/npm 11.7.0 were used for new audits and clean root/Coach/Parent installs.

| Graph | Archived full / omit-dev High | Patched full / omit-dev High |
| --- | --- | --- |
| Coach | 11 / 11 | 7 / 7 |
| Parent | 10 / 10 | 6 / 6 |

Fresh pre-install Coach full/omit-dev responses were 10/11, differing on propagated minimatch; the baseline lock hash did not change. Parent fresh responses were 10/10. Raw results are retained alongside the archived baseline. Package counts are not distinct handset exploits.

Patched Coach retains image-size, node-forge and propagated @expo/cli, @expo/code-signing-certificates, expo, expo-updates and datetimepicker findings. Parent retains the same findings except datetimepicker. Mobile audits still exit 1. There are no suppressions, exceptions or altered root gates. Existing root supply-chain gate and production audit pass with zero vulnerabilities.

`image-size` 1.2.1 remains reachable in Metro asset processing on the build machine. Metro 0.83.3 calls both its synchronous buffer API and its synchronous filename API. A direct 2.x override is incompatible. Crafted asset bytes can be a build-machine input even when an allowed filename extension is used; repository-controlled assets lower the exposure but do not fix the parser.

The [official Metro 0.83.8 release](https://github.com/react/metro/releases/tag/v0.83.8) replaces image-size with bounded vendored parsers. Registry metadata confirms Expo SDK 54's latest patch is 54.0.37, @expo/metro 54.2.0 still pins the Metro family to 0.83.3, and no newer stable SDK 54 wrapper is available. No unsupported wrapper override was applied.

A coherent follow-up integration must update the complete 14-package @expo/metro dependency cohort and its mutually pinned transitive Metro packages to 0.83.8. Updating only `metro` leaves split private APIs. This also moves the shipped pure-JavaScript `metro-runtime` and Hermes parser dependencies, so it must not be described as having zero bundle effects. Keep Expo/RN/native modules and appVersion policy fixed; compare module inventories and native inputs; run Doctor, clean installs, supported/malformed asset tests and all-platform exports. Seek an Expo 54 maintainer backport or explicit compatibility review before adopting that graph. That candidate was documented, not integrated or validated here.

## Actual exported JavaScript membership

Fresh `expo export --platform all --source-maps --clear` exports use production bundling, Hermes for iOS/Android and a local noncredential environment. They are security-analysis artifacts, not authenticated production-environment release artifacts.

| App | Android modules | iOS modules | Web modules |
| --- | --- | --- | --- |
| Coach 1.0.25 | 1053 | 1045 | 848 |
| Parent 1.0.22 | 1020 | 1020 | 813 |

All six source-map inventories contain **none** of brace-expansion, image-size, js-yaml, node-forge or undici. Runtime-facing expo/expo-updates, and Coach datetimepicker, may ship while their vulnerable tooling children do not. The evidence JSON records package membership, bundle/map hashes and exact residual advisory URLs; full normalized module inventories are in the local archive.

All exports were repeated after the root install completed, using two workers. Coach bundle/map hashes were identical; Parent retained the same module counts and audited-package membership but produced different bundle/map hashes. The evidence JSON contains the final complete-environment hashes and source commit. No claim of byte-identical exports across the two environments/worker settings is made.

Installed expo-updates uses `SecKeyVerifySignature` in iOS CodeSigningConfiguration.swift and `Signature.getInstance("SHA256withRSA")` in Android CodeSigningConfiguration.kt. This supports a distinction between native signature checks and Node tooling; it does not prove every native/runtime path safe or prove code signing is configured for deployed binaries.

The standalone inventory check is separate from audit/release gates:

```text
node apps/scripts/mobile-security-inventory.mjs <source-map-export-directory> <inventory.json>
```

It fails if maps/module inventories are absent, handles indexed maps, identifies nested/scoped packages and records source-map and bundle hashes. Tests are added to existing CI. It never changes npm audit exit status or creates an advisory acceptance.

## Publisher assessment

Official registry stable EAS CLI is exactly **24.8.0**. A separate clean review installation reports `eas-cli/24.8.0 win32-x64 node-v22.21.0`; it was installed/audited without executing lifecycle scripts, login, credential generation or publication. Its locked audit has **9 High, 11 Moderate and 1 Low** findings across 21 package entries. Direct advisory-bearing roots include node-forge, joi, minimatch, nanoid, tar, ajv, diff, ts-deepmerge, uuid and yaml; propagated certificate/PKCS12/JKS/EAS/config findings must not be counted as additional exploits.

node-forge 1.4.0 has [no patched version for GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Expo's certificate tooling calls certificate/CSR/public-key verification and signing helpers. EAS imports that tooling for code signing and also uses forge through credential-format tooling. An audit is not proof those branches are exercised by the current configuration, but this is real Node-side reachability and not a handset library claim.

The current guarded publisher still uses unpinned `npx eas-cli`; it is unchanged. Version 24.8.0 is a deterministic reviewed CLI reference, not a patched/safe publisher or a reproducible dependency graph by itself. A future locked publisher installation and shared exact executable policy should cover authentication, env:exec and update together, retain the existing login/account/credential storage and every guard, and receive its own dependency/security review. Do not import this vulnerable graph into the root app just to pin a version. No invented forge patch, crypto replacement, credential changes, code-signing changes or gate bypass is proposed.

## Existing native runtime parity and Parent 1.0.23 delivery

Read-only comparisons against served source commits show:

- Coach 1.0.25 `00067db408d69ac4cb60dcafe4e5150d7fc2c578`: no added/changed/removed direct dependencies or native config/assets.
- Parent 1.0.22 `8b931bc7333afbd4b9a8882e5f0f20930a2e9d30`: the same.
- Parent 1.0.23 `461305128dcad533d856f8912878ede781d844c6`: no added/changed direct dependencies, removal of expo-calendar/expo-clipboard, and app config/version difference. Current JS does not require those removed modules.

Only the eight audited tooling lock entries changed from current main; native module package versions did not. These are source/lock comparisons, not independent native-binary or handset validation.

PR 162's six existing Hermes exports were read and every on-disk bundle SHA256 and both platform runtime resolutions verified against its manifests for source `f50a9e61c525749e09cfb726d0bb71e4b5df444c`. They belong to PR 162, not this tooling branch, and contain no source maps. Do not claim this branch's inventories establish PR 162 bundle membership. Existing build/channel evidence confirms Parent 1.0.23 on both platforms/project 7e0906f3-64f4-42d9-b45d-0ee68f599baa/production: Android 570a221d-2a65-456c-9656-cd3593c693d9; iOS 3ac2b600-1024-4d6d-a140-35cbfc45a7f8. Corresponding 1.0.22 and Coach evidence is recorded in sanitized JSON.

**No Parent 1.0.23 publishing option was implemented.** Its prepared copies select an explicit runtime while retaining appVersion metadata 1.0.22. The current guard/release checks attest tracked appVersion 1.0.22 and exact origin/main; they do not attest that generated alternate configuration. Native-binary/handset evidence and the metadata discrepancy remain unresolved. Simply adding a runtime override or invoking EAS on those copies would evade that provenance boundary. EAS update offers --input-dir/--skip-bundler, not a --runtime-version flag.

Proposed reviewed design: introduce an allowlisted target descriptor for existing Parent 1.0.23 only, with project/channel, both completed native build IDs, baseline source/native dependency/plugin/asset hashes and expected appVersion metadata. Validate current native requirements are a permitted subset of that binary's inputs, fail closed on additions/changes/unknown evidence, and obtain the reviewed metadata policy. Retain confirmation/message validation, clean exact origin/main, EAS account/environment boundary, every root/mobile release/security gate and final artifact/source hashes. Only then construct an isolated export configuration from that verified exact source and assert Expo's resolved runtime for both platforms. Recheck descriptors, source and artifact hashes immediately before a guarded EAS invocation; preserve credentials and channel state. Keep arbitrary runtime/path selection unavailable. Add positive and tampered-source/config/project/native-dependency/artifact tests. This is a design for review, not publication clearance.

## Validation and release recommendation

Clean installs passed for root and both apps. Affected tests: 102 passed. Both Doctor runs: 18/18. All-platform exports and source-map inventories passed. Metro processed six Coach and nine Parent tracked image assets on each platform (30 checks); empty and malformed images were rejected. Lint, build, mobile config, prestore, evidence check, root supply-chain/audit, secret scan and migration gates passed. Required exact-head CI is reported in the PR after its terminal result.

C: was full during the first Coach install. Only this task's newly created worktree/toolchain/cache/evidence were relocated to E:, and that task's Git metadata repaired. Clean installs then passed. No other worktree, feature branch or archive was changed. Initial checks attempted during root installation lacked eslint/vite/metadata; all were rerun successfully after installation completed.

Safe recommendation: review these compatible tooling patches as an OTA-compatible dependency preparation. They do not require or justify a native/store build; the five audited roots are absent from the validated handset exports. Retain image-size and publisher risks visibly; do not claim a clean mobile/publisher audit. Parent 1.0.23 guarded delivery, final integrated production exports, native/handset checks and publisher risk review remain release blockers. No merge, OTA, native build, production deploy, live data/migration, credentials/settings change or real message was performed.

Machine-readable evidence: `security/mobile-tooling-review-02-10-2026.json`. Local full evidence: `E:/FP-MOBILE-SECURITY-02102026-TASK8/evidence/`.
