# First 250 team branding phone setup preparation

Local-only preparation on 04:10:2026, based on promotion candidate
7d7a8cce3995238416b0663afc1fcf8de8d83e14. Separate branch:
codex/first-250-phone-onboarding-preparation-04-10-2026. The original candidate
and C:/fp-simon-feedback are preserved. This is not a released feature.

## Resulting flow

After confirmed sign-in and team provisioning, Coach reads the existing promotion
management service for the selected online team authority. When the offer is OFF,
the prompt is hidden. An eligible unclaimed team, or participant without artwork,
gets a compact Home prompt; Do this later stores only an account/team-scoped
dismissal marker. Settings retains Add or edit badge and colour.

Existing native Linking opens /team-branding on the configured approved API origin.
Only production and the existing mobile test origin are allowed. No native module,
dependency, lockfile, app version/runtime or native configuration is changed.
The existing mobile test host still needs confirmation that the new frontend route
is hosted there before testing that environment; it never falls back to production.

The browser page uses its own normal account sign-in at the same fixed route.
Credentials are never passed between app and browser. Arbitrary return destinations,
tokens and other query fields are not reflected. Only a validated team UUID and
from=coach are used. Each management read and mutation uses the current browser
Bearer header; account changes prevent mutation with the earlier actor expectation.
Current server authority and team scope remain the enforcement boundary.

This dedicated route deliberately does not use the Teams route's teamStaffRoles
gate, which would block free Matchday participants. That gate and all Club settings
permissions remain unchanged. The new page grants no Teams/staff or Club controls.

Before claim/save, fresh management and authenticated display reads confirm scope
and capability state. Claim requires current terms consent, and uses the existing
idempotent capped allocator. Exhaustion returns its server error without reserving
another place. Grandfathered/permanent teams skip claim. Existing provisional
deadline/progress and failed-access retention rules are shown; offer terms are
unchanged. Badge-only saves do not change the stored colour.

PNG/JPG/WebP file selection runs in the phone browser, up to 5 MB. Existing server
validation, sanitisation and team content-addressed storage remain in use. Upload
errors retain the selected file and existing saved artwork. No Club logo/theme field
is written. Paid Club display takes priority and suppresses team editor/claim,
including when it becomes applicable before a pending save.

The fixed return link is footballplayercoach://branding-return, with no query or
credentials. It is a refresh signal, not authority or proof of a successful save.
Coach refreshes through the existing authenticated profile loader on exact return
or resume after opening setup. Other notification/deep-link routes are preserved.
Manual app switching is supported if the scheme does not open. Cold-return handling
is checked once to avoid a refresh loop. Reads discard stale scope/account results.

## Local validation and limits

- Selected existing promotion, Parent, signup, pricing, packaging and report
  regressions plus new URL/scope/auth helper tests: 92/92 passed.
- Existing mobile auth, secure session, OTA settings/environment boundaries and
  theme regressions: 101/101 passed.
- Existing logo validation, privileged authority and invitation-location/cache
  preservation regressions: 21/21 passed. Total selected Node tests: 214/214.
- Production web/PWA build and compiled environment verification passed. Build
  uses the existing approved production configuration; no client was opened against
  production. Vite native config loading and workspace TEMP/TMP avoid the previously
  established Windows sandbox ancestor/temp limitations.
- Rendered phone-browser tests use actual page source and compiled production CSS,
  with synthetic auth, management and display adapters. Every request is intercepted
  or aborted. Claims/uploads in these tests are fixture-only. They cover sign-in,
  current terms, exhaustion, separate logo/colour grants, grandfathered/permanent,
  error retention, revocation, paid Club precedence and malformed scopes.
  Final rendered phone rehearsal: 26 assertions passed with no page errors.
- Rendered Coach component tests use actual component source with mocked native
  Linking, AppState, storage and profile loader. They prove skip/later editing,
  return/resume refresh, fixed-URL rejection, cold-return loop prevention, OFF,
  offline/suspended boundaries and paid Club controls. They do not prove handset
  receipt or the installed Android/iOS binary.
  Final rendered Coach rehearsal: 12 checks passed with no page errors.
- Web phone screenshot visually reviewed: compact rows, thin separators, UK date,
  readable text and accessible actions. Coach adapter screenshot is synthetic and
  is not handset visual QA.
- Full lint, migration441, secret2471 and whitespace checks passed.
  Logs/screenshots are under ignored output/.
- The unchanged supply-chain gate still fails four propagated high development
  findings for the baseline root GHSA-VFJ7-8CJW-P6XM in braces 3.0.3. Package,
  lockfiles and policy are unchanged. No exception, install or audit fix attempted.
- Real PostgreSQL concurrency/full authority-RLS remains blocked by the previously
  recorded restricted-token initdb failure. No retry or alternate route attempted.
- Remaining release evidence: full installed JWT/RLS and concurrency rehearsal,
  actual phone picker/upload/return/refresh receipt, correct test frontend hosting,
  and independent review. Browser account recovery through /sign-in requires
  reopening setup from Coach; no arbitrary redirect persistence is added.

Hold through 04:10:2026; 05:10:2026 is review only. No production rows/uploads,
emails, migration application, offer activation, transfer, push, merge, deployment,
OTA, native build or store submission occurred.
