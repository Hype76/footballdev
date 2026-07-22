# Supply chain assurance

Reference: `FP-V1-SECURITY-M3-SUPPLY-GOVERNANCE-ASSURANCE-IMPLEMENT-01`

Finding closed in candidate: `FP-SPR-014`

## Dependency boundary

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
