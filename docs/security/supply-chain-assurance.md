# Supply chain assurance

Reference: `FP-V1-SECURITY-M3-SUPPLY-GOVERNANCE-ASSURANCE-IMPLEMENT-01`

Finding closed in candidate: `FP-SPR-014`

## Dependency boundary

### Netlify tooling update, 02:10:2026

The root build graph no longer installs `netlify-cli`. Its local image server
pulled in `@netlify/images@2.0.1 -> ipx@3.1.1 -> listhen@1.10.1 -> node-forge@1.4.0`.
The full root audit reported six High findings rooted in
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
At verification, node-forge's latest published version was still 1.4.0 and
[upstream PR 1152](https://github.com/digitalbazaar/forge/pull/1152) was open.
The latest stable Netlify CLI 27.10.2 and images 2.0.3 retained this chain;
IPX 4 was only available as a prerelease. No unsupported override or advisory
exception was introduced.

`npm run functions:build` now calls Netlify's official
`@netlify/zip-it-and-ship-it@16.2.3` directly. The same bundler API is used by
Netlify CLI and Netlify production builds. It reads the existing function
configuration from `netlify.toml`, retains per-function Chromium externals and
schedule metadata, and writes a fresh archive and manifest for every function.
The required Functions build check also inspects the resulting archives.
All seven required check names and the full-graph dependency review fallback
remain in place. The security policy is unchanged.

The root lock shrinks from 1,654 to 934 package entries: 721 entries removed,
one added, and only the retained bundler version changes. The candidate root
audit and unchanged supply-chain gate report zero vulnerabilities. These results
supersede the historical development advisory inventory below.

The `deploy:live` CLI shortcut is retired along with the dependency. Release
through the existing Git-connected Netlify build after separate release approval:
merge the reviewed commit to `main`, verify the Netlify production deploy's
commit identity and Ready state, then verify the site and functions. Netlify
continues to use the existing `netlify.toml` build, redirects, headers, scheduled
functions and PDF packaging. Do not install a global CLI or use `npx netlify`
to sidestep the audited dependency graph. A manual upload release would require
a separately reviewed supported workflow. Local Vite development is unchanged;
full Netlify local dev/image emulation is unavailable in this candidate.

This root audit does not cover the separate Coach and Parent Expo lockfiles.
Their existing advisories and release gates must be assessed independently;
successful exports do not establish that their dependency graphs are clear.
No mobile lockfile, runtime version, production provider setting or release
permission is changed by this tooling update.

Rollback: revert the tooling commit, including the lockfile, CI invocation and
packaging verifier, as one change. This restores the vulnerable CLI graph and
the security checks should block release again. Retain the last verified
production deployment and OTA groups while reviewing a safe roll-forward.


The application uses npm 11 with lockfile version 3 and Node 22. The package manager and supported engine range are declared in `package.json`. `package-lock.json` is authoritative for the build. The gate rejects Git, linked and non-registry package resolutions.

The only runtime remote import is the Supabase Edge Function import `https://esm.sh/@supabase/supabase-js@2.110.8`. It is exact-version pinned and allowlisted. No unpinned Git dependency is present.

## Direct production inventory

| Package | Resolved version | Reachability and regression area |
| --- | ---: | --- |
| `@sparticuz/chromium` | 148.0.0 | PDF function runtime and Chromium launch |
| `@supabase/supabase-js` | 2.110.8 | Browser, Netlify functions, Auth, Database and Storage |
| `@tailwindcss/vite` | 4.2.2 | Build-only CSS integration |
| `exceljs` | 4.4.0 | Data transfer workbook generation and parsing |
| `jszip` | 3.10.1 | Workbook and archive processing |
| `puppeteer-core` | 24.43.1 | PDF renderer runtime |
| `react` | 19.2.4 | Browser runtime |
| `react-dom` | 19.2.4 | Browser runtime and application bootstrap |
| `react-router-dom` | 7.18.1 | Browser routing and protected route behavior |
| `resend` | 6.18.0 | Server email delivery only |
| `sharp` | 0.35.3 | Server image validation and processing |
| `stripe` | 22.1.1 | Server billing functions, payments remain gated by context |
| `tailwindcss` | 4.2.2 | Build-only CSS compiler |
| `web-push` | 3.6.7 | Server push delivery only |

Production audit after remediation: 0 Critical, 0 High, 0 Moderate and 0 Low.

## Development and transitive inventory

Development dependencies cover PGlite database tests, ESLint, Vite, Playwright, Netlify CLI and PWA build tooling. The full installed graph has 0 Critical, 6 High, 10 Moderate and 1 Low advisories. These are all confined to build or local CLI paths and resolve to three explicit advisory roots.

The resolved graph is emitted to `.security-artifacts/dependency-inventory.json`. It records direct dependencies, all resolved license counts, install lifecycle packages and the remote import inventory. The production CycloneDX SBOM is emitted to `.security-artifacts/sbom.cdx.json`.

Approved install lifecycle packages are limited to `esbuild`, `fsevents`, `netlify-cli`, `sharp` and `unix-dgram`. `fsevents` appears in platform-specific optional branches. Native optional packages for Sharp, Rollup, Tailwind, Lightning CSS, esbuild and Netlify are lockfile entries for other supported platforms and are not installed on Windows unless applicable.

Duplicate transitive versions are retained only where upstream ranges differ. No duplicate direct production package is declared. All direct production packages have confirmed source reachability. Type packages, lint packages, PGlite, Playwright, Vite, PWA tooling and Netlify CLI are development or build-only.

On Windows, npm 11 installs `@emnapi/runtime` from Tailwind's optional bundled WASM branch but reports that one package as extraneous through `npm ls`. It is present in `package-lock.json`, is not an advisory, is not imported by application source and is omitted from the shipped production graph. No direct dependency was added merely to suppress this npm metadata result.

## Advisory remediation

Compatible current-major upgrades were applied for Supabase, Puppeteer, React Router, Resend, Vite and Netlify CLI. Narrow overrides select patched transitive versions for affected parsing, proxy, archive, WebSocket and build packages. Sharp is locked and globally overridden to `0.35.3`, so no older Sharp node remains in either the production or development graph. No `--force` operation, unsafe downgrade or broad dependency rewrite was used.

| Advisory | Package chain | Production reachability | Compensating control | Owner | Review and expiry |
| --- | --- | --- | --- | --- | --- |
| `GHSA-4x5r-pxfx-6jf8` Low | Vite and React build tooling to `@babel/core` | No | Production audit and SBOM exclude development tooling; the compiler runs only during controlled builds | Steve | 2026-08-21 |
| `GHSA-8988-4f7v-96qf` Moderate | `netlify-cli` to `@netlify/blobs` to `@netlify/otel` to `@opentelemetry/core` | No | Netlify CLI is development and CI tooling only and is excluded from production functions and browser bundles | Steve | 2026-08-21 |
| `GHSA-v2hh-gcrm-f6hx` High | `netlify-cli` to Fastify and `vite-plugin-pwa` to Workbox, then AJV or `fast-json-stringify` to `fast-uri` | No | The affected parser is confined to local and CI build tooling; production audit, SBOM, function bundles and browser artifacts exclude it | Steve | 2026-08-21 |
| Five packages without standard license metadata | Transitive Netlify or legacy utility metadata only | No | The lifecycle and licence gate remains mandatory | Steve | 2026-08-21 |

No production or Critical exception is accepted. The one root High exception is development-only, owner-approved, time-bounded and automatically rejected if it becomes production-reachable or remains after the advisory is resolved. `GHSA-f88m-g3jw-g9cj` is resolved throughout the graph and is not an exception.

## Required gate

The `Supply chain` check performs a clean install, lock and source validation, a zero-tolerance production audit, a full-graph audit with exact development-only advisory enforcement, high-confidence secret scan, lifecycle allowlist, license inventory and production SBOM generation. The gate fails for an undocumented, expired, stale or production-reachable exception. The pull request-only `Dependency review` check uses GitHub-native review when the Dependency graph is enabled. Until then, a mandatory repository fallback applies the same complete-graph advisory, package-source, lifecycle and licence gates.

The production build also emits an artifact manifest with the package-lock digest and SHA-256 digest for every built web file and Netlify function source file. Evidence is tied to the Git commit SHA by the workflow artifact name.
