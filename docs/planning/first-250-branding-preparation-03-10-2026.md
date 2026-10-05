# First 250 team branding preparation

Baseline: main 7ccbc41591569a7b7723a4fba7b28fbfa44cf50b, verified through GitHub.
Authorisation: Simon Slack 1791003441.883379, preparation only. Weekend hold through
04:10:2026; 05:10:2026 is review only, not automatic release approval.

## Confirmed rules

- 250 total team places. The individually mapped existing 39 are permanently
  grandfathered, have no qualification clock and cannot fail the offer.
- 211 new places, one entry per team. Multiple teams in one club may each claim.
- New-team claim time is server-owned. Deadline is three calendar months in
  Europe/London, including DST and month-end clamping.
- Seven distinct active players each need an accepted, currently valid Parent
  account link. Siblings can share one Parent; extra links do not inflate counts.
- Ten distinct completed/concluded matches within the window; valid 0-0 counts.
- New teams have provisional branding immediately, permanent once qualified.
  Failure removes promotional display entitlement only.
- Retain uploaded team logo and chosen colours. A later eligible paid package
  restores display without re-upload or recolouring.
- Authorised paid Club branding takes precedence after controlled team linking.
  A promotional team does not unlock branding for the rest of its club.
- One audited Platform Admin calendar-month extension per new team.

## What this candidate implements

One isolated dormant migration creates private config, a capped eligibility ledger,
saved per-team branding storage and service-only mapping/claim/counter/extension,
management and reconciliation functions. Config is OFF with no terms version.
Explicit ACLs deny direct client and service table access. Authenticated display
uses existing staff, Parent, Fan and adult-player resource authority. Management
requires confirmed, unbanned Auth identity and current active role/resource scope;
extension additionally checks the actual active Platform Admin helper.

The ledger locks the config row before allocation. Unique team and bounded slot
constraints protect retries and slot exhaustion. Slots 1-39 are reserved for the
verified existing cohort; new claims use 40-250. Incomplete mapping blocks claims
and public counts. Sold-out claims return null without affecting ordinary signup.
Failed places are retained and never silently recycled. Existing application tables
receive no new FK, function replacement or policy change. OFF-guarded observation
triggers cover accepted links, concluded matches, active players and account state.
An approved completed-transfer trigger reconciles private metadata atomically.

The local integration adds manage-team-branding, strict request fields, derived
actor/club scope, validated content-addressed logo uploads, repeated SQL write
authority, aggregate progress, compact web claim/save/extension controls and shared
scoped web/Coach/Parent branding. Client payloads carry provisional expiry and
separate base grants. Report exports reject mismatched scope and clear cached badge
aliases. Parent mobile exports receive the selected-link access context. No signup
auto-claim or activation endpoint exists. No live binding has been installed.

## Integration work required before deployment or activation

1. Prepare the explicit 39-team metadata mapping with team/club IDs and an approved
   cohort source. Do not infer membership from a numerical count or signup dates.
2. Rehearse the new adapters and SQL against the full installed authority/RLS/JWT
   schema with synthetic records. Test Fan/adult consumers against their real helper
   definitions. The focused fixture uses explicitly documented synthetic display
   helpers and the actual Platform Admin helper, so it cannot prove all authority.
3. Prove simultaneous claim/qualification/expiry/extension/transfer races in an
   independent PostgreSQL process. Current state after expiry cannot manufacture a
   timely observation. Reconciliation exists but no scheduled processor is wired;
   displays deny expired provisional grants and management reads reconcile state.
4. Coordinate the separate Parent PDF worker so mobile badges use its safe JPEG
   preparation with this scoped payload. This candidate supplies scope, colour and
   safe initials fallback, but does not implement native badge image preparation.
   Preserve the independent Team custom-colour client/SQL mismatch as a separate
   issue; no global capability opening is used here.
5. Connect the separate public Site only to the aggregate counter after reviewed
   activation. No Site publishing is performed by this local integration.
6. Rehearse installed schema/ACLs and authenticated flows with synthetic records,
   review exact migration bytes and combined CI, then seek the separately required
   release decision after the hold. No blanket db push or migration-history repair.

## Paid Club transfer and report interfaces

Current controlled transfer exists in manage-workspace-team-transfer.js and
20260807125343_fp_v1_workspace_scope_onboarding_master_03.sql. Completion requires
Platform Admin authority, both approvals, source team/destination club scopes,
destination capacity and source billing/user/invitation checks. Preservation
snapshots compare direct/indirect record counts. It is not an automatic consequence
of purchasing Club. The new trigger runs only on the existing ready-to-completed
request transition, verifies approvals, active Platform Admin, destination team
scope and matching private source scope, then updates private ownership metadata
in the same transaction. Synthetic rollback/commit checks preserve artwork and
clock fields. Full original transfer workflow rehearsal still remains required.

Proposed consumer contract: authorised teamId/clubId, resolved branding source
(platform/team/paid_club), entitled logo URL, accent and button style, plus aggregate
promotion state/deadline where needed. Never expose player IDs, Parent IDs/emails or
raw eligibility rows. Parent PDF work must retain capability context and filtering,
consume this resolved payload, and pass its existing safe image/JPEG preparation.
No other feature branch is incorporated. No cross-workspace transfer is performed.

## Remaining implementation boundaries

Commercial scope and clock decisions are settled. Existing-39 mapping and terms
review remain administrative inputs. Whether an extension may revive already
expired provisional access is not specified: this candidate records an extension
only before expiry; its compact Platform Admin control also excludes failed teams.
Post-expiry revival remains explicitly unsupported pending that edge-case decision.
Do not ask again about the settled offer.

PGlite tests use synthetic schema/claims and the real Platform Admin helper body.
They do not establish full installed RLS, JWT/PostgREST, providers, actual concurrency,
handset receipt or production schema drift. Existing tests must pass alongside them.
No production records, migration, deployment, offer activation, OTA, native build,
store submission or email is authorised by this preparation.

## Local verification receipt

Follow-up source review on 03:10:2026 examined local integration commit
163aaa5108732fc4706640f3261fec0264ddc88d. This was a fresh source review in the
same execution session, not a second independent reviewer. Two corrections follow:
observation time is assigned after obtaining the entry lock, so a queued read
cannot use an earlier timestamp with later committed eligibility; Parent PDF
preparation validates selected team/club, removes cached badge aliases, and carries
the selected capability context with independent logo/colour flags. No Parent PDF
worker candidate was imported. Its supplied commit object is unavailable here;
native image/JPEG preparation and handset receipt remain unverified.

The real PostgreSQL retry failed in initdb before server startup: restricted-token
creation error87, restricted-token re-execution error3, and inability to create the
ancestor directory C:/Users/pulse. Evidence: output/first-250-postgres-review.log.
The synthetic PGlite fixture uses some helper stubs and does not prove full
installed authority/RLS or concurrent sessions. Before advancing, run the existing
local-only PostgreSQL harness on an authorised isolated host, then rehearse:
same-team and distinct-team simultaneous claims; final-slot exhaustion; queued
qualification/deadline/extension races; denied anonymous, wrong-club, stale-role,
suspended, banned, demo and mismatched Parent requests; permitted scoped Staff,
Parent, Fan and adult-player reads; private table grants/RLS and PostgREST/JWT
boundaries; approved transfer commit and failed-transfer rollback. Use synthetic
identities and records only. Do not use an existing production database.

Supply-chain retry with the actual npm CLI failed solely on missing installed
metadata for @opentelemetry/api. Evidence:
output/first-250-supply-chain-review.log. Package and lock files are unchanged.
No dependency install, allowlist change or gate bypass was attempted. PR168 stays
at foundation head ed5fd844291354dfdaf85f6f5e940a6029cd6640 until required gates pass.
The weekend hold remains in force through 04:10:2026; 05:10:2026 is review only.
Follow-up verification passed 86/86 selected regression tests and 27/27 focused
checks, full ESLint, migration441, secret2464 and git diff whitespace checks.
Evidence: output/first-250-review-validation.log and
output/first-250-review-focused.log. These checks do not replace the blocked gates.

Local integration on 03:10:2026, after the foundation receipt below:

- Expanded promotion, SQL, adapter, Parent branding, signup, pricing, packaging and
  report tests: 85/85 passed. Output: output/first-250-integration-validation.log.
- The final null-team Parent-link observation adjustment passed 14/14 focused
  SQL/adapter tests. Full lint and diff checks passed; migration441 and the secret
  scan covering all 2464 staged/tracked files passed. Build-environment verification
  confirmed the live Supabase project in compiled output. The artifact manifest
  covers 185 web files and 166 function source files.
- Parent save fixture initially could not bundle its entry because esbuild walks
  inaccessible Windows ancestor directories. Its loader now reads the exact trusted
  entry through Node into a virtual namespace; assertions and production code are
  unchanged by that fixture adjustment. The focused PDF/adapter run passed 18/18.
- Full web/PWA build completed with Vite native config loading and TEMP/TMP scoped
  to output/workbox-temp in the permitted workspace. Default npm launcher was broken;
  default config bundling and system temporary directory writes hit permission
  errors. No permission expansion, dependency install or release action occurred.
- Execution server briefly disconnected and subsequently recovered; edits survived.
- This remains a locally integrated review candidate, not release-ready proof:
  independent concurrency, full installed authority/RLS, handset and native Parent
  PDF badge-worker integration are still outstanding. Draft PR168 remains at the
  previously tested foundation head ed5fd844, with no duplicate PR created.
- Activity Log row1989 was read back successfully. Its historical rejection text
  predates the permitted retry; PR168 now exists. No existing log row was rewritten.

- 55/55 promotion and selected existing preservation tests passed: first-250 unit
  and PGlite, Parent green defaults/branding, existing entitlement SQL, signup,
  workspace owner invites and subscription pricing.
- Full lint passed. The final migration gate passed for 441 ordered files after
  aligning this isolated checkout's origin/main ref with verified GitHub main.
  An earlier pass used the cloned stale main ref and failed its reconciliation
  check; no allowlist or security rule was weakened. Secret scan passed 2459 files.
- Real local PostgreSQL rehearsal is prepared but blocked before startup:
  Windows initdb cannot create/re-execute its restricted token. No listener started.
  Do not describe allocation races as independently exercised until this runs.
- Reused read-only existing dependencies; no clean install or dependency changes.
  Local Node 22.21.0/npm 10.9.4 differs from configured CI npm 11.7.0.
