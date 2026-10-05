# First 250 branding local readiness correction

Local correction on 05:10:2026, parent candidate
46456b63c168eba2833a8197a3ceee5574a5dc0c. Branch
codex/first-250-phone-onboarding-preparation-04-10-2026. This document supersedes
the earlier defect/readiness snapshot, not the agreed offer terms. No production
database change, activation, notification, push, deployment or OTA occurred.

## Corrected behaviour

- Fresh places require the installed canonical Matchday plan helper and active
  team/Club scope. Shared team/Club locks hold that state through allocation.
  Existing reservations remain idempotent after an upgrade or stale terms retry;
  grandfathered places remain exempt and clocks do not restart.
- Management requires current confirmed, unbanned active authority and matching
  membership. Club Admin rank 90 or actual Platform Admin remains supported.
  Team management requires a current staff profile at rank 20 or above and the
  head-manager assignment at rank 70 or above. Parent profiles cannot gain
  management through a retained assignment. Existing Coach rank 30 promotion is
  preserved: its team assignment changes without raising the global profile rank.
- The authority helper uses fresh snapshots. Claim, save and management read
  revalidate after allocation/entry observation lock waits. Revocation inside a
  synthetic allocation trigger rejects and rolls back the new place.
- Management supplies claimAllowed. Phone, Home prompt and Teams controls deny
  new paid-plan claims. Phone refreshes eligibility before sending a claim;
  independent paid branding editing remains available.
- Coach opening attempts carry a generation. Account/team changes clear opening;
  an earlier promise cannot clear the new attempt or its pending return. Deferred
  tests include account, team and away-and-back changes and old-promise rejection.

## Recovered decisions

Simon explicitly confirmed existing 39 teams are exempt and branding applies only
to each team, even if several belong to one Club:
https://jelumalabs.slack.com/archives/C0C5N2XEQHM/p1791003712336799

The same thread confirms new clocks start when claiming, retained artwork restores
on an eligible paid package, and linked teams may later adopt paid Club branding:
https://app.slack.com/client/T0C65BQ9VLZ/C0C5N2XEQHM/thread/C0C5N2XEQHM-1790953327.827119

Permanent qualification terms remain seven active players with valid accepted
Parent links and ten completed matches within three UK calendar months. Failed
places remain allocated, artwork retained, free revival unsupported and expired
extensions rejected. No retry/reset policy or whole-Club grant was introduced.
The existing 39 is an approved allocation, not a verified live database count.
No exact team/Club ID mapping was found in the relevant Slack results or local
candidate documentation. Mapping is not needed to integrate these corrections.

## Validation

- Actual promotion SQL, actual canonical plan and Platform Admin helpers, synthetic
  authority fixture, adapters, onboarding and existing Matchday entitlement suite:
  43/43 passed. Includes direct allocator bypass attempts for modern/legacy paid
  plans, Parent retained assignments, legitimate promoted Coach access, upgrade
  retries, cap, clocks, qualification, controlled transfer and rollback.
- Rendered phone page with production CSS and synthetic auth/API adapters: 30
  assertions passed, no page errors or external requests.
- Actual Coach component with mocked native adapters: 25 checks passed, no page
  errors or external requests. Browser runs required the previously permitted
  local Chromium spawn capability; no PostgreSQL escalation was attempted.
- Additional preservation suite: 67/70 passed. Three failures reproduced unchanged
  on an isolated archive of 46456b63: old canonical registry list, old Club alias
  expectation, obsolete Pilot UI source-expression assertion. The affected source
  and tests are unchanged by this correction. They remain integration gate failures,
  not waived checks. Logs: output/first-250-corrective-preservation.log and
  output/first-250-baseline-plan-failures.log.
  Directly affected Parent themes, reports/PDF, signup, logo validation and colour
  preservation checks also passed as a focused 56/56 run. These overlap the 70-test
  suite and are not additional unique coverage.
- Independent reviewer branding_independent_review ran 17/17 focused tests and
  reviewed the final corrections, authority rank compatibility and lock ordering.
  No further blocking defect found. Reviewer did not execute browser rehearsals.
- Full lint, ordered migration441, secret2472, whitespace, production web/PWA build,
  compiled environment identity, Parent access screen and artifact manifest passed.
  Artifacts and raw receipts are under ignored output/.
- Official npm registry audit with valid vulnerability metadata still reports
  four propagated high development findings for GHSA-VFJ7-8CJW-P6XM; the unchanged
  supply-chain gate fails all four. Package files/policy were not changed and no
  waiver was introduced. The first sandbox attempt returned a JSON endpoint error,
  which the existing gate incorrectly treated as zero findings. That apparent pass
  is rejected. The official registry receipt and gate failure replace it:
  output/first-250-corrective-audit.json and output/first-250-corrective-supply-chain.log.
  Integration owner should also make the shared gate reject audit error objects or
  missing vulnerability metadata. No dependency install or security-gate edit here.

## Remaining evidence and integration

Real multi-connection PostgreSQL remains blocked in the restricted Windows account:
initdb cannot create/re-execute its restricted token (errors 87 and 3), then reports
the existing C:/Users/pulse directory. Prior receipt:
../promotion-draft/output/first-250-postgres-review.log. No database process started.
No escalation, WSL/container substitute, remote database or other access route was
attempted. The prepared local-only harness now loads the actual canonical plan
helper, but its 52-session rehearsal has not executed. PGlite serialises work and
does not establish simultaneous allocation/revocation/expiry/extension/transfer.

The fixture documents synthetic Staff/Parent/Fan/adult display helpers. Full installed
authority/RLS/JWT/PostgREST, actual handset picker/upload/return/refresh, approved test
frontend hosting and combined Parent PDF badge preparation remain separate checks.
Do not treat mocked native adapters as handset evidence or a preview as production.

For main V1 integration task 01a102d2-2f16-7427-8bbc-fada37d6e0c8, this correction is
the child of 46456b63. If that phone candidate is already integrated, take only this
correction. Otherwise preserve the existing local chain from verified base7ccbc415:
c6e8780b foundation, 163aaa51 integration, 7d7a8cce review, 46456b63 phone preparation,
then this correction. PR168 still contains only earlier foundation ed5fd844, whose
tree matches local c6e8780b. Avoid installing duplicate promotion migrations.

The only mapping question for activation is: which exact 39 team IDs, paired with
their Club IDs and approved cohort source, occupy the permanent reserved places?
Activation remains OFF until the mapping and remaining verification are complete.
