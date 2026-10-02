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

The initial exports below used local noncredential configuration. The review correction adds a clean-source producer for production-environment exports through the exact locked EAS installation; final hash-bound results are recorded separately below.

| App | Android modules | iOS modules | Web modules |
| --- | --- | --- | --- |
| Coach 1.0.25 | 1053 | 1045 | 848 |
| Parent 1.0.22 | 1020 | 1020 | 813 |

All six source-map inventories contain **none** of brace-expansion, image-size, js-yaml, node-forge or undici. Runtime-facing expo/expo-updates, and Coach datetimepicker, may ship while their vulnerable tooling children do not. The evidence JSON records package membership, bundle/map hashes and exact residual advisory URLs; full normalized module inventories are in the local archive.

All exports were repeated after the root install completed, using two workers. Coach bundle/map hashes were identical; Parent retained the same module counts and audited-package membership but produced different bundle/map hashes. The evidence JSON contains the final complete-environment hashes and source commit. No claim of byte-identical exports across the two environments/worker settings is made.

Installed expo-updates uses `SecKeyVerifySignature` in iOS CodeSigningConfiguration.swift and `Signature.getInstance("SHA256withRSA")` in Android CodeSigningConfiguration.kt. This supports a distinction between native signature checks and Node tooling; it does not prove every native/runtime path safe or prove code signing is configured for deployed binaries.

The standalone inventory check is separate from audit/release gates:

```text
node apps/scripts/mobile-security-inventory.mjs <export-directory> <manifest.json> <inventory.json> <expected-commit> <expected-runtime> <expected-platforms-csv> <trusted-manifest-sha256> <expected-appVersion> <expected-runtime-policy>
```

It requires complete paired bundles/maps, trusted manifest and metadata hashes, expected source/runtime/appVersion/policy/platforms and resolved native runtimes. Missing, duplicate, extra, swapped or tampered artifacts fail closed. It handles indexed maps and nested/scoped package paths. Tests are added to existing CI. It never changes npm audit exit status or creates an advisory acceptance.

## Publisher assessment

Official registry stable EAS CLI is exactly **24.8.0**. A separate clean review installation reports `eas-cli/24.8.0 win32-x64 node-v22.21.0`; it was installed/audited without executing lifecycle scripts, login, credential generation or publication. Its locked audit has **9 High, 11 Moderate and 1 Low** findings across 21 package entries. Direct advisory-bearing roots include node-forge, joi, minimatch, nanoid, tar, ajv, diff, ts-deepmerge, uuid and yaml; propagated certificate/PKCS12/JKS/EAS/config findings must not be counted as additional exploits.

node-forge 1.4.0 has [no patched version for GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv). Expo's certificate tooling calls certificate/CSR/public-key verification and signing helpers. EAS imports that tooling for code signing and also uses forge through credential-format tooling. An audit is not proof those branches are exercised by the current configuration, but this is real Node-side reachability and not a handset library claim.

The OTA guard now binds whoami, env:exec and update to one isolated `apps/mobile-publisher` installation. Install with `npm run mobile:publisher:install`: npm ci uses the committed exact dependency graph with integrity hashes and no lifecycle scripts. Before each command the adapter verifies the installed graph, package versions, full artifact tree digest and local installation receipt against the committed lock and current Node/platform. Existing credential storage is preserved. The receipt detects later changes; it is not an independent signed attestation against a compromised host. The graph retains vulnerabilities and is separate from root/app dependency trees. Other build/submission commands are outside this OTA assessment. TypeScript 5.9.3 is explicitly pinned to satisfy the graph's TypeScript 5 peer range; the first inherited lock's TypeScript 7 clean-install failure was corrected and the resulting graph re-audited. No crypto, advisory suppression or credential/security setting changes were made.

## Existing native runtime parity and Parent 1.0.23 delivery

Read-only comparisons against served source commits show:

- Coach 1.0.25 `00067db408d69ac4cb60dcafe4e5150d7fc2c578`: no added/changed/removed direct dependencies or native config/assets.
- Parent 1.0.22 `8b931bc7333afbd4b9a8882e5f0f20930a2e9d30`: the same.
- Parent 1.0.23 `461305128dcad533d856f8912878ede781d844c6`: no added/changed direct dependencies, removal of expo-calendar/expo-clipboard, and app config/version difference. Current JS does not require those removed modules.

Only the eight audited tooling lock entries changed from current main; native module package versions did not. These are source/lock comparisons, not independent native-binary or handset validation.

PR 162's six existing Hermes exports were read and every on-disk bundle SHA256 and both platform runtime resolutions verified against its manifests for source `f50a9e61c525749e09cfb726d0bb71e4b5df444c`. They belong to PR 162, not this tooling branch, and contain no source maps. Do not claim this branch's inventories establish PR 162 bundle membership. Existing build/channel evidence confirms Parent 1.0.23 on both platforms/project 7e0906f3-64f4-42d9-b45d-0ee68f599baa/production: Android 570a221d-2a65-456c-9656-cd3593c693d9; iOS 3ac2b600-1024-4d6d-a140-35cbfc45a7f8. Corresponding 1.0.22 and Coach evidence is recorded in sanitized JSON.

**No Parent 1.0.23 publishing option was implemented.** Prior prepared copies selected explicit runtime 1.0.23 with appVersion metadata 1.0.22. Expo permits differing explicit runtime and appVersion; that inequality alone is not a blocker. The reviewed native source includes a compatible superset of the current native requirements. The current guard/release checks attest tracked appVersion 1.0.22 and exact origin/main; they do not attest that generated alternate configuration. A narrow target-specific provenance and matching metadata implementation remains to be integrated and reviewed; device acceptance remains separate. Simply adding a runtime override or invoking EAS on those copies would evade that provenance boundary. EAS update offers --input-dir/--skip-bundler, not a --runtime-version flag.

Proposed reviewed design: introduce an allowlisted target descriptor for existing Parent 1.0.23 only, with project/channel, both completed native build IDs, baseline source/native dependency/plugin/asset hashes and expected appVersion metadata. Validate current native requirements are a permitted subset of that binary's inputs, fail closed on additions/changes/unknown evidence, and obtain the reviewed metadata policy. Retain confirmation/message validation, clean exact origin/main, EAS account/environment boundary, every root/mobile release/security gate and final artifact/source hashes. Only then construct an isolated export configuration from that verified exact source and assert Expo's resolved runtime for both platforms. Recheck descriptors, source and artifact hashes immediately before a guarded EAS invocation; preserve credentials and channel state. Keep arbitrary runtime/path selection unavailable. Add positive and tampered-source/config/project/native-dependency/artifact tests. This is a design for review, not publication clearance.

## Validation and release recommendation

Clean installs passed for root and both apps. Affected tests: 102 passed. Both Doctor runs: 18/18. All-platform exports and source-map inventories passed. Metro processed six Coach and nine Parent tracked image assets on each platform (30 checks); empty and malformed images were rejected. Lint, build, mobile config, prestore, evidence check, root supply-chain/audit, secret scan and migration gates passed. Required exact-head CI is reported in the PR after its terminal result.

C: was full during the first Coach install. Only this task's newly created worktree/toolchain/cache/evidence were relocated to E:, and that task's Git metadata repaired. Clean installs then passed. No other worktree, feature branch or archive was changed. Initial checks attempted during root installation lacked eslint/vite/metadata; all were rerun successfully after installation completed.

Safe recommendation: these compatible tooling patches preserve the existing native runtimes and can proceed through OTA release review for Coach 1.0.25 and Parent 1.0.22 after final production artifacts, exact-head CI and device acceptance are verified. Unresolved audits must remain visible, but their presence alone is not proof of an exploitable unsigned OTA operation. Assess the exact command/configuration and trusted input boundaries. The separate Parent 1.0.23 target implementation need not block preparation of those two tracked runtimes. Its native superset supports compatibility review, while target provenance and device acceptance still need completing. No clean-audit or blanket publisher safety claim is made. No merge, OTA, native build, production deploy, live data/migration, credentials/settings change or real message was performed.

Machine-readable evidence: `security/mobile-tooling-review-02-10-2026.json`. Local full evidence: `E:/FP-MOBILE-SECURITY-02102026-TASK8/evidence/`.

## Operation-specific review correction

Both resolved private production configurations were checked through the locked EAS production env:exec operation without printing values. Neither has updates.codeSigningCertificate or codeSigningMetadata; appVersion policy remains set. Expo public config removes those fields, so public-config absence is not evidence of unsigned publishing. The export producer records presence using private config separately.

The exact EAS update command passes expPrivate and privateKeyPath to getCodeSigningInfoAsync. The current guard supplies no private-key argument. A local probe of the reviewed helper returns undefined before certificate parsing, validation or signing when certificate configuration is absent; a private-key argument without a certificate rejects. Instrumented certificate operations were called zero times. Helper SHA256 4390a4483a166dd12b9f86f45c8c0224f467e9e525d623ad3d3cc12f690c5c7e; update command SHA256 772c68ac57714a5566bf58e57d0e3d760b5ac149d27139398072e6adada1a6e2. This narrows node-forge exposure for this unsigned operation, without clearing credential import/creation, alternative signing settings or all publisher paths. Do not invent a patched forge version or make its unavailable patch an automatic unsigned OTA stop.

Residual publisher advisories remain 9 High, 11 Moderate and 1 Low in full and omit-dev audits. Joi/schema validation, glob/minimatch, tar/archive and identifier/config helpers can be imported by EAS tooling. Their full adversarial input reachability is not established by the certificate branch proof. The bounded candidate uses reviewed repository/config/asset inputs, fixed command arguments, trusted EAS production environment retrieval and the exact installed graph. Stop for unexpected signing configuration, credential operations, untrusted assets/config/globs/archive inputs, graph drift or any failed gate. This is an operation-specific candidate for human risk review, not a clean publisher certificate.

The strengthened producer creates only a new output directory from clean exact source, validates the production boundary and tracked runtime policy, resolves both native runtimes with Expo, exports iOS/Android Hermes plus web, checks source hashes before and after, then binds complete pairs to metadata and trusted manifest hashes. Final production manifests, paired inventories, command binding, private presence proof and exact-head CI are supplied in the refreshed local evidence archive and PR description. Initial noncredential exports and the first production pass are historical evidence only. Native parity is unchanged by these script-only corrections.
