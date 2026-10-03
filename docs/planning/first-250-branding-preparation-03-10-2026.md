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
saved per-team branding storage and service-only mapping/claim/counter/extension
functions. Explicit ACLs deny direct client and service table access; functions use
an empty search path and check the service role. Extension additionally checks the
actual existing active Platform Admin helper. Config is OFF with no terms version.

The ledger locks the config row before allocation. Unique team and bounded slot
constraints protect retries and slot exhaustion. Slots 1-39 are reserved for the
verified existing cohort; new claims use 40-250. Incomplete mapping blocks claims
and public counts. Sold-out claims return null without affecting ordinary signup.
Failed places are retained and never silently recycled. Existing application tables
receive no new FK, trigger, function replacement or policy change.

The unused backend library implements scoped progress calculation, entitlement OR,
paid Club display precedence and a whitelist-only aggregate counter. No HTTP route,
signup hook, worker, UI, renderer or app binding is introduced by this candidate.
It is a tested backend foundation, not the fully integrated launch implementation.

## Integration work required before deployment or activation

1. Prepare the explicit 39-team metadata mapping with team/club IDs and an approved
   cohort source. Do not infer membership from a numerical count or signup dates.
2. Add authenticated claim, per-team branding read/write and extension adapters.
   Validate confirmed Auth identity, active profile/membership, team resource scope,
   suspension and authority before invoking service RPCs. Never accept actor IDs,
   claim timestamps, eligibility counts or paid-plan booleans from request bodies.
   Use existing upload validation/storage constraints. Offer claiming needs consent
   and a reviewed terms version. There is deliberately no activation adapter here.
3. Fetch qualification rows under authorised server team/club scope, emit aggregate
   progress only, and commit permanent/failed transitions with row locks and durable
   timely observations. Current rows read after expiry cannot prove historical
   eligibility. Bind evaluation to accepted Parent and concluded-match changes with
   a recovery process, then prove lost-update/expiry/extension races independently.
4. Introduce a common trusted per-team branding payload in web/mobile/report contexts.
   SQL and client gates must agree on promotional overrides. Paid plan, suspension,
   role/resource authority, upload and Parent/Fan scope remain authoritative.
   Keep the existing Team custom-colour client/SQL mismatch separately documented;
   do not globally open that capability as a promotion shortcut.
5. Add the claim/progress UI using compact rows and accessible actions. Connect the
   public Site only to the aggregate counter after reviewed activation. Draft copy
   may describe the offer; it must not pretend that claims/counts are live.
6. Rehearse installed schema/ACLs and authenticated flows with synthetic records,
   review exact migration bytes and combined CI, then seek the separately required
   release decision after the hold. No blanket db push or migration-history repair.

## Paid Club transfer and report interfaces

Current controlled transfer exists in manage-workspace-team-transfer.js and
20260807125343_fp_v1_workspace_scope_onboarding_master_03.sql. Completion requires
Platform Admin authority, both approvals, source team/destination club scopes,
destination capacity and source billing/user/invitation checks. Preservation
snapshots compare direct/indirect record counts. It is not an automatic consequence
of purchasing Club. The transfer enumerates public tables; this new app_private
ledger/artwork is outside its traversal. A separate bounded, authorised integration
must preserve the team ID and update/reconcile private ownership metadata atomically.
Until that exists, paid destination Club branding can take precedence without
inventing a migrated promotional entitlement or deleting original saved artwork.

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
only before expiry and does not expose an extension UI. Review that
edge case before binding the adapter; do not ask again about the settled offer.

PGlite tests use synthetic schema/claims and the real Platform Admin helper body.
They do not establish full installed RLS, JWT/PostgREST, providers, actual concurrency,
handset receipt or production schema drift. Existing tests must pass alongside them.
No production records, migration, deployment, offer activation, OTA, native build,
store submission or email is authorised by this preparation.

## Local verification receipt

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
