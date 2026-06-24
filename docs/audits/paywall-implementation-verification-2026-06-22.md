# Paywall Implementation Verification

Date: 2026-06-22
Scope: FP-PAYWALL-HARDEN-09
Repository: Football Player

## 1. Executive Summary

Result: Amber.

The approved Football Player paywall implementation was regression-tested across plan normalization, tier access, hostile plan values, role checks, UI route gates, trusted Netlify function gates, source-level RPC/RLS/storage enforcement, public pricing, and Stripe checkout mapping.

The scoped hardening matrix passed after two in-scope defects were fixed:

- Large Club could bypass team limits in `manage-team`, browser team creation, and the foundation SQL helper when no negotiated limit was configured.
- Unsafe plan token shapes such as `../large_club` could normalize into a real paid plan key.

The implementation is ready for controlled pre-production review. It is not ready for production rollout until the Supabase migrations are applied and verified in the target database, live Stripe price configuration is checked under approval, and full lint blockers outside this paywall patch are resolved or accepted.

## 2. Commits Reviewed

- FOUNDATION-04: `80c23d3fe736069cfb87b3b5c6b11c65cb75bcda`
- ACCESS-05: `abb5c735cc88e4eff24914917fd578a42664fca3`
- UI-06: `5a73cb6`
- SERVER-07: `ce68a64c9c57520052d15a695ea9f714dd410e4f`
- COMMERCE-08: `453d986b9d2bf33afe144608bcd27527a282bad0`
- HARDEN-09: pending at report write time

## 3. Scope and Exclusions

Included:

- Local code and source-level SQL verification.
- Paywall plan and tier regression.
- Hostile and malformed plan values.
- Billing state fail-closed checks.
- Role and route checks.
- Public pricing and checkout mapping checks.
- Netlify function source checks.
- Build and local test regression.

Excluded:

- No live Stripe configuration changes.
- No production environment variable changes.
- No production data changes.
- No production migration execution.
- No deploy.
- No customer announcement.

## 4. Full Tier Matrix Results

Passed in `tests/paywall-hardening-matrix.test.mjs` and existing paywall tests.

- Individual Coach - Free: basic records, goals and notes, limited history, responsive web/PWA, Football Player branding, and family portal preview remain available. Real parent portal, assessments, attachments, parent emails, PDF reports, calendars, match day, polls, audit logs, analytics, exports, and integrations remain denied.
- Single Team: assessments, player notes, attachments, parent portal, parent emails, PDF reports, team calendar, training events, fixtures, general events, match day, polls, basic logo branding, and basic activity visibility are allowed.
- Small Club: club administration, club staff roles, shared player oversight, bulk invites/imports, club-wide calendar, recurring events, calendar export feed, custom colours branding, full operational audit log, and basic club analytics are allowed.
- Development Club: advanced development analytics, player pathways, coach handovers, scheduled review cycles, approval workflows, custom assessment templates, custom report templates, club-wide operational exports, and scheduled parent reports are allowed.
- Large Club: Large-only integrations remain blocked unless `integrationsConfigured` is explicitly true.

## 5. Full Role Matrix Results

Passed.

- Coach and assistant coach can use Single Team parent email capability where plan, club, and role context are valid.
- Parent portal and player roles cannot use staff-only parent email capability.
- Empty or unauthenticated role context fails closed.
- Platform admin access is role-based and does not come from paid plan fallback.
- Missing club, team, player, or ownership context fails closed for capabilities that require that context.

## 6. Public Pricing and Checkout Verification

Passed.

- Public pricing exposes the approved five tiers: Individual Coach - Free, Single Team, Small Club, Development Club, and Large Club.
- Free is preview-only for family portal.
- Single Team copy remains the complete Football Player product for one team.
- Self-service checkout is allowed only for Single Team, Small Club, and Development Club.
- Free, Large Club, unknown plans, unknown billing cycles, and unknown Stripe prices fail closed.
- Stripe webhook source rejects mismatched checkout metadata and price tampering.

## 7. Route and Navigation Verification

Passed by source and unit coverage.

- `/assess-player` maps to assessments and denies Free users.
- `/calendar` maps to team calendar and denies Free users.
- `/activity-log` maps to paid audit capability and denies Single Team users.
- Single Team users can access team workflow and parent communication routes.
- Upgrade copy remains plan-aware for billing roles and contact-only for non-billing roles.

## 8. API and Function Verification

Passed by source-level checks.

- `_plan-gate.js` verifies profile auth user ID and email binding before feature checks.
- `manage-team.js` uses `getPlanLimit(profile, 'teams')` and no longer treats Large Club as unlimited.
- `send-parent-email.js` gates parent emails and PDF reports.
- `render-pdf.js` gates PDF reports.
- `manage-scheduled-emails.js` gates parent emails and stores the required feature in queued payloads.
- `send-parent-portal-invite.js` gates parent invitations.
- `send-staff-invite.js` gates team staff roles or club staff roles according to invite context.
- `create-checkout-session.js` accepts only self-service plan keys and approved billing cycles.
- `stripe-webhook.js` rejects unknown prices and metadata mismatches.

## 9. RPC, RLS, and Storage Verification

Source-level checks passed.

- `20260622050850_paywall_server_enforcement.sql` contains fail-closed `else false` behavior.
- Recurring calendar events, parent invitations, branding, and storage object policies reference server-side plan feature checks.
- Storage object checks include club scoping through `current_user_club_id()::text`.
- `20260622043000_paywall_plan_key_foundation.sql` now caps Large Club team creation at 10 unless a future approved negotiated limit mechanism is applied elsewhere.

Live database behavior was not verified because production migration execution was explicitly out of scope.

## 10. Stripe Test and Configuration Verification

Local source and test verification passed.

- `SELF_SERVICE_CHECKOUT_PLAN_KEYS` allows Single Team, Small Club, and Development Club only.
- `getPlanFromPriceId('price_unknown')` returns an empty plan and billing cycle.
- Webhook source rejects a configured price mismatch and preserves duplicate handling for unique conflicts.

Live Stripe dashboard configuration was not changed or verified.

## 11. Legacy Plan and Alias Verification

Passed.

- Approved aliases normalize explicitly: Free, Individual Coach - Free, club, Development Club, dev club, Contact sales, enterprise.
- Missing plan values map to Individual Coach - Free where the approved free default is intended.
- Unknown paid plan values do not receive paid entitlements.

## 12. Unknown Plan and Malformed Plan Verification

Passed after fix.

- Unknown values such as `future_plus` fail closed.
- Hostile shapes such as `../large_club` and `<script>large_club</script>` now fail closed and no longer normalize into Large Club.
- Inactive statuses including `past_due`, `incomplete`, `canceled`, `cancelled`, `expired`, `unpaid`, `incomplete_expired`, `unknown`, and empty status deny paid capabilities.

## 13. Core Safety and Data-Right Verification

Passed.

- Secure authentication, account protection, safeguarding controls, essential role permissions, parental consent visibility controls, safety auditability, data rights access, data rights export, and data rights deletion are non-commercial and non-payment-gated across all plans.
- Premium operational logs and club-wide operational exports remain separate from required data rights exports.

## 14. Hostile Access Attempts

Passed.

- Unknown plan keys fail closed.
- Path-like and HTML-like plan tokens fail closed.
- Missing role, missing club, missing team, missing player, missing ownership, and wrong role contexts fail closed.
- Inactive paid subscription statuses fail closed.
- Unknown capability names fail closed.
- Unknown checkout price IDs fail closed.
- Checkout price and metadata mismatch paths are rejected by source-level webhook checks.

## 15. Defects Found and Fixed

Fixed:

- Large Club team-limit bypass. Removed the Large Club unlimited bypass from `netlify/functions/manage-team.js`, removed the browser-side Large Club `null` team limit branch from `src/lib/domain/team-actions.js`, and changed `public.can_insert_team_for_plan` in `supabase/migrations/20260622043000_paywall_plan_key_foundation.sql` so only comped plans bypass the team cap.
- Unsafe plan token normalization. Added a central unsafe token shape guard in `src/lib/plans.js` so path-like or HTML-like strings cannot normalize into a paid plan alias.

Added:

- `tests/paywall-hardening-matrix.test.mjs`, covering tier, role, route, billing, hostile access, checkout, source-level function, RPC, RLS, storage, and upgrade-target checks.
- Additional Large Club negotiated team-limit assertions in existing access and normalization tests.

## 16. Remaining Risks by Severity

Medium:

- Supabase migration behavior is verified at source level only. The target database still needs approved migration application and live verification.
- Live Stripe price and webhook configuration were not verified in Stripe, by request scope. Development Club checkout remains fail-closed unless real Price IDs are configured.
- Full repository lint currently fails on unrelated existing issues in untouched files.

Low:

- Staff and player numeric limits for Small Club, Development Club, and Large Club preserve the currently approved unlimited behavior until explicit numeric limits are approved.
- Large Club negotiated limits now support local object overrides for team caps, but no production admin workflow for setting negotiated numeric limits was added in this phase.

## 17. Production Readiness Recommendation

Amber.

The implementation is suitable for controlled pre-production review and code-level sign-off. Do not roll this to production as a paywall enforcement milestone until:

- Supabase migrations are applied and tested in the approved target database.
- Live Stripe price IDs, checkout paths, and webhook behavior are verified under approval.
- Known full-lint blockers are fixed or explicitly accepted.
- A final production smoke test confirms protected routes, plan-gated APIs, and billing redirects against the deployed bundle.

## 18. Exact Evidence and Test Commands

Passed:

- `node --test tests/paywall-hardening-matrix.test.mjs`: 8 tests passed.
- `node --test tests/paywall-plan-normalization.test.mjs tests/paywall-access-model.test.mjs tests/paywall-ui-alignment.test.mjs tests/paywall-server-enforcement.test.mjs tests/paywall-commerce-alignment.test.mjs`: 28 tests passed.
- `node --check src/lib/plans.js`
- `node --check netlify/functions/manage-team.js`
- `node --check src/lib/domain/team-actions.js`
- `node --check tests/paywall-hardening-matrix.test.mjs`
- `npm.cmd run test:platform`: 102 tests passed.
- `npm.cmd run test:v1-stabilise`: 47 tests passed.
- `npm.cmd run build`: passed, including postbuild verification of the live Supabase project in the web build.
- `npx.cmd eslint src/lib/plans.js src/lib/domain/team-actions.js netlify/functions/manage-team.js tests/paywall-hardening-matrix.test.mjs tests/paywall-access-model.test.mjs tests/paywall-plan-normalization.test.mjs`: passed.
- `git diff --check`: passed.

Failed, unrelated to this patch:

- `npm.cmd run lint`: failed with 25 errors and 2 warnings in existing untouched or unrelated dirty files, including `_supabase.js`, `prepare-staging-test-signup.js`, `Layout.jsx`, `ParentPortalShell.jsx`, `auth-access-browser-fixtures.js`, `auth.js`, `player-progression.js`, `ParentPortalPage.jsx`, and `vite.config.js`.

Supabase documentation check:

- Fetched `https://supabase.com/changelog.md` and reviewed current breaking-change entries relevant to source-level SQL/RLS/storage work. No additional change was required for this local source-only verification phase.

## 19. No Live Change Confirmation

Confirmed:

- No live Stripe changes were made.
- No production environment variables were changed.
- No production data was changed.
- No production migrations were executed.
- No production deploy was performed.
- No customer announcement was made.
