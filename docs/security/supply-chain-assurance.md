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
| `sharp` | 0.34.5 | Server image validation and processing |
| `stripe` | 22.1.1 | Server billing functions, payments remain gated by context |
| `tailwindcss` | 4.2.2 | Build-only CSS compiler |
| `web-push` | 3.6.7 | Server push delivery only |

Production audit after remediation: 0 Critical, 0 High, 0 Moderate and 0 Low.

## Development and transitive inventory

Development dependencies cover PGlite database tests, ESLint, Vite, Playwright, Netlify CLI and PWA build tooling. The full installed graph has 0 Critical and 0 High advisories. The remaining audit result is 1 Low and 11 Moderate, all in build or local CLI paths.

The resolved graph is emitted to `.security-artifacts/dependency-inventory.json`. It records direct dependencies, all resolved license counts, install lifecycle packages and the remote import inventory. The production CycloneDX SBOM is emitted to `.security-artifacts/sbom.cdx.json`.

Approved install lifecycle packages are limited to `esbuild`, `fsevents`, `netlify-cli`, `sharp` and `unix-dgram`. `fsevents` appears in platform-specific optional branches. Native optional packages for Sharp, Rollup, Tailwind, Lightning CSS, esbuild and Netlify are lockfile entries for other supported platforms and are not installed on Windows unless applicable.

Duplicate transitive versions are retained only where upstream ranges differ. No duplicate direct production package is declared. All direct production packages have confirmed source reachability. Type packages, lint packages, PGlite, Playwright, Vite, PWA tooling and Netlify CLI are development or build-only.

On Windows, npm 11 installs `@emnapi/runtime` from Tailwind's optional bundled WASM branch but reports that one package as extraneous through `npm ls`. It is present in `package-lock.json`, is not an advisory, is not imported by application source and is omitted from the shipped production graph. No direct dependency was added merely to suppress this npm metadata result.

## Advisory remediation

Compatible current-major upgrades were applied for Supabase, Puppeteer, React Router, Resend, Vite and Netlify CLI. Narrow overrides select patched transitive versions for affected parsing, proxy, archive, WebSocket and build packages. No `--force` operation, unsafe downgrade or major dependency rewrite was used.

| Exception | Reachability | Owner | Review date | Required action |
| --- | --- | --- | --- | --- |
| Babel Low advisory with no patched 7.x release | Development compiler only, not shipped as runtime code | Repository owner | 2026-08-21 | Upgrade when a compatible patched 7.x version exists or validate the next supported major |
| Netlify CLI OpenTelemetry Moderate advisories | Local and CI build or deploy tooling only, not bundled into the web or function runtime | Repository owner | 2026-08-21 | Recheck the latest Netlify CLI and remove the exception when upstream resolves the chain |
| Five packages without standard license metadata | Transitive Netlify or legacy utility metadata only | Repository owner | 2026-08-21 | Recheck upstream metadata and replace a package if licensing cannot be verified |

No Critical or High exception is accepted.

## Required gate

The `Supply chain` check performs a clean install, lock and source validation, production and full-graph audits, high-confidence secret scan, lifecycle allowlist, license inventory and production SBOM generation. The pull request-only `Dependency review` check uses GitHub-native review when the Dependency graph is enabled. Until then, a mandatory repository fallback applies the same complete-graph advisory, package-source, lifecycle and licence gates.

The production build also emits an artifact manifest with the package-lock digest and SHA-256 digest for every built web file and Netlify function source file. Evidence is tied to the Git commit SHA by the workflow artifact name.
