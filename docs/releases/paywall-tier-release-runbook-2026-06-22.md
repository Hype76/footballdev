# Paywall Tier Release Runbook

Reference: FP-PAYWALL-RELEASE-10
Date: 2026-06-22
Release target: Footballplayer.online approved paywall implementation
Authoritative decision: `docs/decisions/paywall-tier-model-approved-2026-06-22.md`
Verification evidence: `docs/audits/paywall-implementation-verification-2026-06-22.md`

## 1. Release Status

Status: Amber.

This document is a release plan, not a deployment. It does not approve production deployment by itself.

Production deployment is not approved by this runbook alone. Steve must explicitly approve deployment after reviewing this runbook, the verification report, and the remaining Amber risks. Supabase migration execution requires explicit approval. Live Stripe configuration requires explicit approval. Netlify production environment variable changes require explicit approval.

No deploy, production Supabase migration, production data change, live Stripe object change, production environment variable edit, subscription migration, or customer announcement was performed while creating this runbook.

## 2. Release Scope

Included commits:

| Phase | Commit | Purpose |
|---|---|---|
| FP-PAYWALL-FOUNDATION-04 | `80c23d3fe736069cfb87b3b5c6b11c65cb75bcda` | Canonical plan definitions, plan normalization, fail-closed unknown plan handling, database foundation migration, unknown-plan reporting script. |
| FP-PAYWALL-ACCESS-05 | `abb5c735cc88e4eff24914917fd578a42664fca3` | Central capability registry, feature access evaluator, tier limits, upgrade targets, safety and data-right separation. |
| FP-PAYWALL-UI-06 | `5a73cb6` | UI, route, sidebar, navigation, and upgrade prompt alignment with central access model. |
| FP-PAYWALL-SERVER-07 | `ce68a64c9c57520052d15a695ea9f714dd410e4f` | Trusted server, API, domain, Netlify, Supabase RPC/RLS, and storage paywall enforcement alignment. |
| FP-PAYWALL-COMMERCE-08 | `453d986b9d2bf33afe144608bcd27527a282bad0` | Public pricing, checkout eligibility, Stripe Price ID mapping, webhook fail-closed behavior. |
| FP-PAYWALL-HARDEN-09 | `746fd660a307ab776295da16c36e720676f23daa` | Full regression, hostile access, Large Club limit hardening, final verification report. |

Exact release range from the pre-paywall implementation baseline:

- Baseline before FOUNDATION-04: `426af5a933de875e7bf6a41d991146dd03cf2ce9`
- Release candidate head before this runbook: `746fd660a307ab776295da16c36e720676f23daa`
- Diff summary: 83 files changed, 4506 insertions, 566 deletions.

Features included:

- Five approved public tiers.
- Fail-closed plan normalization.
- Central feature and tier access model.
- Route, navigation, upgrade prompt, and UI gating alignment.
- Trusted Netlify function feature checks.
- Source-level Supabase RPC, RLS, and storage paywall enforcement.
- Public pricing copy and checkout behavior aligned to the approved tier model.
- Stripe webhook Price ID as the trusted source for plan updates.
- Unknown plan and unknown Stripe Price ID failure.
- Large Club negotiated-limit and integration setup guardrails.

Approved tiers:

- Individual Coach - Free.
- Single Team.
- Small Club.
- Development Club.
- Large Club.

Exclusions:

- No production deployment.
- No production Supabase migration execution.
- No production data changes.
- No live Stripe products or prices created or edited.
- No production environment variables edited.
- No subscription migration.
- No customer announcement.
- No unrelated staging-retirement cleanup.

Systems affected by a later approved release:

- React app and public pricing UI.
- Netlify functions for checkout, webhooks, parent emails, PDF rendering, scheduled emails, invites, team creation, billing, and platform administration.
- Supabase schema functions, policies, constraints, and storage object policies.
- Netlify production environment variables.
- Stripe live Products, Prices, Checkout, and webhook endpoint configuration.

Unrelated staging-retirement files are out of scope and must not be staged or deployed accidentally.

## 3. Approved Production Behaviour

### Individual Coach - Free

- 1 team.
- 1 staff login.
- Up to 5 players.
- Basic records, goals, and notes.
- Limited history.
- Football Player branding.
- Family portal preview only.
- No full parent portal.
- No parent emails.
- No PDF reports.
- No assessments.
- No attachments.
- No calendar or events.
- No match day.
- No polls.
- No club administration.
- No full operational audit log.
- No analytics.
- No operational exports.
- No integrations.

### Single Team

- Complete one-team product.
- 1 team.
- Up to 5 staff.
- Up to 30 players.
- Assessments.
- Notes.
- Attachments.
- Parent portal.
- Parent emails.
- PDF reports.
- Team calendar and events.
- Match day.
- Polls.
- Basic branding and activity visibility.

### Small Club

- Up to 5 teams.
- Club administrator access.
- Shared oversight.
- Bulk invites and imports.
- Club-wide calendar and events.
- Recurring events.
- Calendar export/feed.
- Shared templates.
- Custom colours and branding.
- Full operational audit log.
- Basic club analytics.

### Development Club

- Up to 10 teams.
- Advanced analytics.
- Pathways.
- Coach handovers.
- Scheduled reviews.
- Approval workflows.
- Custom templates.
- Operational exports.
- Scheduled parent reports.
- Priority support.

### Large Club

- Contact sales.
- Explicit negotiated limits only.
- No accidental unlimited access.
- Integrations only when configured.
- Rollout, migration, support, and service terms handled manually.

## 4. Pre-release Prerequisites

All of these must be true before production deployment approval:

- Critical and High issues in the verification report are closed. The current report lists no Critical or High open issue, but this must be rechecked before approval.
- Amber items are reviewed and either accepted or resolved.
- `npm.cmd run build` passes on the exact release commit.
- Relevant paywall tests pass on the exact release commit.
- Relevant platform tests pass on the exact release commit.
- Relevant V1 stabilisation tests pass on the exact release commit.
- Supabase migrations are reviewed and explicitly approved.
- Production database backup is confirmed.
- Rollback strategy is approved.
- Live Stripe Product and Price IDs are prepared.
- Development Club live Price ID is confirmed, or Development Club production purchase is deliberately disabled and the public CTA behavior is accepted.
- Stripe webhook endpoint and signing secret are confirmed.
- Production environment variables are prepared but not guessed.
- Public pricing copy is approved.
- Large Club contact route is confirmed.
- Legacy customer mapping and manual review process are approved.
- Unrelated dirty files are understood and not accidentally included in the release artifact.
- Netlify deployment mode and manual deployment control are confirmed.
- Full repo lint failure is either fixed or explicitly accepted as unrelated existing debt.
- Steve gives explicit production deployment approval after reviewing this runbook.

## 5. Required Live Configuration

Do not guess any value. Do not copy live secret values into documentation.

| Config item | Status | Required before production? | Notes |
|---|---|---:|---|
| `STRIPE_SECRET_KEY` | Unknown in this runbook | Yes | Must be live-mode and scoped to Jeluma Labs Stripe account. |
| `STRIPE_WEBHOOK_SECRET` | Unknown in this runbook | Yes | Must match the live webhook endpoint used by `netlify/functions/stripe-webhook.js`. |
| `VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID` | Unknown in this runbook | Yes | Must map to Single Team GBP 12.99 monthly. |
| `VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID` | Unknown in this runbook | Yes | Must map to Small Club GBP 34.99 monthly. |
| `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` | Unknown in this runbook | Required only if Development Club checkout is live | If absent, Development Club checkout fails closed with "This plan is not available for checkout yet". |
| `VITE_STRIPE_SINGLE_TEAM_ANNUAL_PRICE_ID` | Optional compatibility | No unless annual checkout is enabled | Annual pricing is not publicly advertised by this release. |
| `VITE_STRIPE_SMALL_CLUB_ANNUAL_PRICE_ID` | Optional compatibility | No unless annual checkout is enabled | Annual pricing is not publicly advertised by this release. |
| `VITE_STRIPE_DEVELOPMENT_CLUB_ANNUAL_PRICE_ID` | Optional compatibility | No unless annual checkout is enabled | Must not be guessed. |
| `VITE_PAYMENTS_DISABLED` | Known config key | Yes | Production context in `netlify.toml` sets `false`; non-production contexts are retired and disabled. |
| `VITE_APP_URL` | Unknown in this runbook | Recommended | Checkout falls back to `URL` or `https://footballplayer.online`. Confirm intended production app URL. |
| `URL` | Netlify-provided | Optional fallback | Used only when `VITE_APP_URL` is not set. |
| `VITE_SUPABASE_URL` | Existing public config | Yes | Must target production Supabase project `hvapkizujvsahvgspser`. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY` | Existing public config | Yes | Public client key only. |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing secret config | Yes for server functions | Must never be exposed to browser code or copied into docs. |
| `CONTACT_REQUEST_RECIPIENT` or demo/contact request destination | Unknown in this runbook | Yes for Large Club enquiries | Required if contact/demo request function depends on it. |
| Supabase migration `20260622043000_paywall_plan_key_foundation.sql` | Not applied by this runbook | Yes before complete DB enforcement | Approval and backup required. |
| Supabase migration `20260622050850_paywall_server_enforcement.sql` | Not applied by this runbook | Yes before complete DB enforcement | Approval and backup required. |
| Large Club integration setup flags | Unknown, manual | Optional by customer | Integrations remain disabled unless explicitly configured. |

## 6. Stripe Live Configuration Checklist

Before enabling production checkout:

- Confirm live Products exist for Single Team, Small Club, and Development Club if Development Club is enabled.
- Confirm monthly Prices match approved values: GBP 12.99, GBP 34.99, and GBP 59.99.
- Confirm billing cycle is recurring monthly.
- Confirm currency is GBP.
- Confirm VAT and tax behavior with Steve or Simon before launch.
- Confirm Checkout Session mode is `subscription`.
- Confirm checkout uses Stripe Billing and Prices, not deprecated Plan objects.
- Confirm live webhook endpoint points to the production `stripe-webhook` function.
- Confirm webhook signing secret belongs to that endpoint.
- Confirm webhook events include `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
- Confirm live-mode and test-mode IDs are not mixed.
- Confirm unknown Price IDs fail closed in webhook handling.
- Confirm checkout metadata plan tampering is blocked by Price ID validation.
- Confirm Development Club remains disabled unless a real live Price ID exists.
- Confirm Large Club has no ordinary checkout path.
- Confirm Free has no ordinary checkout path.
- Confirm a safe test procedure exists before any real customer transaction.

## 7. Legacy Customer and Plan Handling

Known current plan aliases:

- Individual Coach - Free: `individual`, `individual_coach`, `individual_coach_free`, `individual_free`, `free`, `coach_free`, `individualcoachfree`.
- Single Team: `single_team`, `single`, `team`, `singleteam`.
- Small Club: `small_club`, `smallclub`, `club`.
- Development Club: `development_club`, `developmentclub`, `development`, `dev_club`, `devclub`.
- Large Club: `large_club`, `largeclub`, `contact`, `contact_sales`, `enterprise`, `negotiated`.

Compatibility mapping:

- JavaScript uses `src/lib/plans.js`.
- Stripe helpers use `netlify/functions/_stripe-billing.js`.
- SQL migration adds `public.normalize_subscription_plan_key(raw_plan_key text)`.

Existing subscriptions:

- Do not silently reprice.
- Do not automatically migrate customers unless explicitly approved.
- Do not automatically change legacy subscribers from Single Team or Small Club to another commercial tier.
- Existing Single Team and Small Club subscribers should keep their current Stripe customer, subscription, price, plan status, and club linkage until Stripe sends a trusted event or an authorized platform admin makes a reviewed billing change.

Manual review process:

- Run `scripts/report-unknown-plan-values.mjs` against the approved target database before applying stricter constraints.
- Review unknown rows from `clubs`, `club_owner_invites`, `tester_access_codes`, and `stripe_checkout_records`.
- Prepare a manual mapping for each unknown or legacy value.
- Record any approved customer migration separately in the Activity Log.

Rollback mapping:

- Preserve the previous Stripe Price IDs and plan labels.
- Keep a manual list of customers changed during rollout.
- If rollback is required, restore the previous app build and manually verify affected clubs retain or recover their prior plan state.

## 8. Database Migration Plan

Do not apply migrations from this runbook.

### `supabase/migrations/20260622043000_paywall_plan_key_foundation.sql`

Purpose:

- Add `development_club` as a first-class SQL plan key.
- Replace older Small Club fallback behavior.
- Normalize stored plan values.
- Tighten plan key constraints.
- Recreate plan helper functions for features, teams, players, and staff.
- Cap Large Club team creation at 10 unless comped or later explicitly negotiated through an approved mechanism.

Affected objects:

- `public.clubs` plan key constraint.
- `public.tester_access_codes` plan key constraint.
- `public.club_owner_invites` plan key constraint.
- `public.normalize_subscription_plan_key(text)`.
- `public.can_use_plan_feature(uuid, text)`.
- `public.can_insert_team_for_plan(uuid)`.
- `public.can_insert_player_for_plan(uuid)`.
- `public.can_insert_staff_for_plan(uuid)`.
- Function grants to `authenticated`.

Backward compatibility:

- Existing known aliases normalize to approved canonical keys.
- Unknown values fail closed and must be reviewed before constraint tightening.
- Existing app can mostly run before this migration because app-level and Netlify checks are present, but SQL enforcement will be incomplete.
- Running this migration before the app deploy is possible only with approval, because it changes SQL helper behavior and constraints.

Validation queries:

```sql
select public.normalize_subscription_plan_key('Development Club') as development_key;
select public.normalize_subscription_plan_key('../large_club') as hostile_key;
select plan_key, count(*) from public.clubs group by plan_key order by plan_key;
select public.can_insert_team_for_plan(id) from public.clubs where plan_key = 'large_club' limit 5;
select routine_name from information_schema.routines where routine_schema = 'public' and routine_name in ('normalize_subscription_plan_key', 'can_use_plan_feature', 'can_insert_team_for_plan', 'can_insert_player_for_plan', 'can_insert_staff_for_plan');
```

Backup requirement:

- Confirm a production database backup before applying.
- Export affected plan-key rows before applying if any unknown values are reported.

Rollback or forward-fix strategy:

- Prefer forward-fix migration for constraint or helper errors.
- Rolling back constraints and functions requires a reviewed migration that restores previous helper bodies and accepted plan keys.
- Do not use ad hoc destructive rollback.

Order:

- Recommended before app deployment only if Steve approves migration-first order and a maintenance window.
- Recommended release order is backup, unknown-plan report, apply migration, validate, then deploy app.

### `supabase/migrations/20260622050850_paywall_server_enforcement.sql`

Purpose:

- Replace `public.can_use_plan_feature` with the approved full capability matrix.
- Add plan-gated SQL helpers for evaluations, players, and staff invites.
- Add or replace RLS policies for calendar events, parent links, staff invites, parent email templates, audit logs, and form fields.
- Add plan-aware storage object policies for club and team logos.
- Add trigger enforcement for club branding and approval workflow changes.

Affected objects:

- `public.can_use_plan_feature(uuid, text)`.
- `public.can_insert_evaluation_for_plan(uuid)`.
- `public.can_insert_player_for_plan(uuid, text, text)`.
- `public.can_insert_staff_invite_for_plan(uuid, text)`.
- `public.calendar_events` insert, update, and delete policies.
- `public.parent_player_links` insert policy.
- `public.club_user_invites` insert policy.
- `public.parent_email_templates` select, insert, and update policies.
- `public.audit_logs` select policy.
- `public.form_fields` insert, update, and delete policies.
- `public.enforce_club_plan_update_features()`.
- `storage.objects` logo insert and update policies.
- Function grants to `authenticated`.

Backward compatibility:

- Source-level tests show intended fail-closed behavior.
- Existing app can run before this migration, but DB-level enforcement will be incomplete.
- Migration can be run before app deploy only if stricter denials are accepted and old app flows are not expected to keep operating during the gap.

Validation queries:

```sql
select public.can_use_plan_feature(id, 'parentEmails') from public.clubs where plan_key = 'single_team' limit 5;
select public.can_use_plan_feature(id, 'fullOperationalAuditLog') from public.clubs where plan_key = 'single_team' limit 5;
select public.can_use_plan_feature(id, 'approvalWorkflows') from public.clubs where plan_key = 'development_club' limit 5;
select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('calendar_events', 'parent_player_links', 'club_user_invites', 'parent_email_templates', 'audit_logs', 'form_fields') order by tablename, policyname;
select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like '%logo%' order by policyname;
```

Backup requirement:

- Confirm a production database backup before applying.
- Capture current policy definitions for the affected tables and storage policies.

Rollback or forward-fix strategy:

- Prefer forward-fix migration for policy errors.
- RLS rollback is high-risk because policy state can diverge from app expectations.
- If an urgent rollback is required, restore the previous app build and apply a reviewed policy restoration migration.

Order:

- Recommended after foundation migration and before production app deploy, with immediate post-migration validation.
- The app can run before this migration only as partial enforcement.
- The migration can run before the app deploy only with explicit approval and rollback owner assigned.

## 9. Deployment Order

Recommended order:

1. Confirm repo state and target commit.
2. Confirm production database backups.
3. Confirm live Stripe config exists.
4. Confirm production environment variables are prepared.
5. Apply backward-compatible Supabase migrations if approved.
6. Run post-migration validation queries.
7. Deploy application to production manually.
8. Verify Netlify function environment.
9. Verify checkout and webhook behaviour using a safe test procedure.
10. Verify public pricing.
11. Run production smoke tests.
12. Monitor logs and support channels.
13. Mark release complete only after first post-release checks pass.

Manual deployment control:

- Use an explicit production deployment command or approved Netlify UI action only after approval.
- Do not use branch deploy or deploy-preview paths for V1, because `netlify.toml` intentionally blocks those contexts.
- Keep unrelated dirty files out of the artifact.

## 10. Smoke-test Plan

Public and checkout checks:

- Public pricing page shows all five tiers.
- Free plan CTA routes to sign-in/setup, not Stripe checkout.
- Single Team checkout creates a subscription Checkout Session.
- Small Club checkout creates a subscription Checkout Session.
- Development Club checkout creates a subscription Checkout Session only when the live Price ID exists.
- Development Club returns a clear fail-closed message if its Price ID is absent.
- Large Club opens contact/demo flow and does not create checkout.
- Unknown checkout plan is denied.
- Unknown billing cycle is denied.
- Unknown Stripe Price ID is denied by webhook logic.
- Stripe metadata plan tampering is blocked by configured Price ID mapping.

Tier checks:

- Free parent preview is isolated from live parent data and communication.
- Single Team parent portal loads for an eligible club.
- Single Team parent email can be prepared and sent through approved safe procedure.
- Single Team PDF report can be generated.
- Single Team calendar and normal events work.
- Single Team is denied club-wide controls.
- Small Club club-wide controls work.
- Small Club recurring events work.
- Small Club is denied Development Club exports and advanced analytics.
- Development Club advanced features work.
- Large Club team limits use explicit negotiated limits and do not become unlimited accidentally.

Role and access checks:

- Parent access works only for valid parent links.
- Coach access works for staff context.
- Club admin access works for club admin context.
- Platform admin access comes from role and not plan fallback.
- Cross-club access is denied.
- Direct API access is denied when feature, role, or ownership context is missing.
- Storage denial applies where branding/logo capability is missing.
- Unknown plan fails closed.
- Mobile and responsive web route checks pass.
- No protected-content flash is visible where practical.

## 11. Monitoring Plan

Monitor:

- Checkout failures.
- Webhook failures.
- Unknown Price IDs.
- Unknown plan values.
- Access-denied spikes.
- RLS errors.
- Failed parent emails.
- Failed PDF generation.
- Subscription mapping errors.
- Unexpected upgrades.
- Unexpected downgrades.
- Team, player, and staff limit failures.
- Parent portal access failures.
- Support contacts.
- Large Club enquiries.
- Rollback indicators.

Suggested evidence sources:

- Netlify function logs for checkout, webhook, parent email, PDF, invite, and scheduled email functions.
- Supabase logs for RLS and policy denials.
- Stripe event delivery logs.
- Support inbox and contact/demo request destination.
- Activity Log entries for release, rollback, blockers, or customer-impacting findings.

## 12. Rollback Plan

Application rollback:

- Re-deploy the previous known-good production deploy or commit.
- Verify live bundle references the production Supabase project and not retired staging.
- Re-run route and checkout smoke tests after rollback.

Database rollback or forward-fix:

- Prefer forward-fix migrations.
- Migration rollback is limited because RLS policy and function replacements can affect live authorization immediately.
- Capture affected policies and helper function definitions before applying migration.
- If rollback is needed, apply a reviewed restoration migration rather than manual console edits.

Stripe rollback:

- Disable or remove newly prepared Price IDs from checkout mapping by removing the corresponding Netlify env vars under approval.
- Keep Products and Prices archived rather than deleted where Stripe supports that workflow.
- Confirm webhook endpoint remains pointed at the intended production function.

Public pricing rollback:

- Roll back the app bundle to the previous pricing page.
- If app rollback is delayed, temporarily disable payments with an approved environment variable change.

Checkout disable switch:

- `VITE_PAYMENTS_DISABLED=true` disables checkout behavior, but changing it in production requires explicit approval and will affect public purchase flow.
- Development Club can be disabled by leaving `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` unset.

Legacy plan restoration:

- Keep a before-and-after list of changed customer records.
- Restore individual club plan fields only through approved admin or SQL process.
- Do not bulk migrate without reviewed mapping.

Communication:

- Communication owner must be assigned before deployment.
- Rollback approval owner must be Steve unless delegated.
- Record rollback and evidence in the Activity Log.

Decision thresholds:

- Repeated checkout failures for valid plans.
- Webhook failures that prevent plan updates.
- RLS errors blocking normal paid-tier workflows.
- Unexpected paid feature exposure.
- Unknown Price ID or unknown plan rows appearing after release.
- Parent portal, parent email, or PDF failures affecting new paid customers.

## 13. Customer Communication Notes

Do not send announcements from this runbook.

Internal support summary:

- Football Player is moving to five approved tiers with clearer feature gates and fail-closed billing behavior.
- Safety, secure access, consent, account protection, required data rights, and safety-critical auditability are not being sold as premium extras.
- Paid tiers add scale, oversight, automation, analytics, operational exports, onboarding, integrations where configured, and support.

What changed for new customers:

- Public pricing aligns to Individual Coach - Free, Single Team, Small Club, Development Club, and Large Club.
- Single Team is the complete one-team product.
- Development Club is now a first-class tier if checkout is enabled.
- Large Club is contact sales.

What does not change for existing customers unless separately migrated:

- Existing customer Stripe subscriptions are not silently repriced.
- Existing Single Team and Small Club subscribers are not automatically moved to new tiers.
- Manual migration requires separate approval and evidence.

Customer-facing notes:

- Free: "The free plan is for one coach using basic records with a small squad. It includes a family portal preview but not full parent access or communication."
- Single Team: "Single Team is the complete Football Player product for one team."
- Small Club: "Small Club adds club oversight, multiple teams, recurring events, shared templates, audit log, and basic club analytics."
- Development Club: "Development Club adds advanced development operations such as pathways, handovers, approval workflows, custom templates, exports, scheduled parent reports, and priority support."
- Development Club checkout not live yet: "Development Club is planned for self-service, but checkout is not active until the live billing configuration is confirmed. We can help manually in the meantime."
- Large Club: "Large Club is a negotiated contact-sales tier for larger organisations needing rollout, migration, integrations where available, and agreed service terms."

## 14. Final Manual Approval Checklist

| Approval area | Owner | Sign-off | Date | Notes |
|---|---|---|---|---|
| Steve commercial approval | Steve | Pending | Pending | Required before production deployment. |
| Simon commercial acknowledgement, if needed | Simon | Pending | Pending | Needed if pricing or customer messaging changes require business acknowledgement. |
| Technical reviewer approval | Technical reviewer | Pending | Pending | Confirm code, tests, and known lint debt acceptance. |
| Database migration approval | Steve or delegated technical owner | Pending | Pending | Required before running Supabase migrations. |
| Stripe/live billing approval | Steve or billing owner | Pending | Pending | Required before live Product, Price, webhook, or env configuration. |
| Production environment variable approval | Steve or delegated technical owner | Pending | Pending | Required before Netlify env edits. |
| Production deployment approval | Steve | Pending | Pending | Required after this runbook is reviewed. |
| Post-release monitoring owner | Named owner | Pending | Pending | Must be assigned before release. |

## 15. Post-release Verification

First 15 minutes:

- Confirm site loads.
- Confirm public pricing loads.
- Confirm no immediate Netlify function error spike.
- Confirm no Supabase RLS error spike.
- Confirm no Stripe webhook delivery failures.

First hour:

- Confirm checkout start for enabled self-service plans.
- Confirm Large Club contact flow.
- Confirm parent portal route guards.
- Confirm paid-tier feature gates with safe accounts.
- Confirm support inbox/contact destination.

First business day:

- Review checkout failures.
- Review webhook failures.
- Review unknown plan reports.
- Review support messages.
- Review access-denied logs for false positives.

First-event checks:

- First checkout.
- First webhook.
- First upgrade or downgrade.
- First parent email.
- First PDF report.
- First tier-limit rejection.
- First Development Club purchase attempt if enabled.
- First Large Club enquiry.
- First unknown-plan denial.
- First support issue.

## 16. Final Recommendation

Recommendation: Amber.

Deployment is possible only after the listed blockers are accepted or resolved. This runbook should not be treated as production approval.

Remaining blockers:

- Supabase migrations are not applied or verified in production.
- Live Stripe Products, Prices, webhook endpoint, and signing secret were not verified by this runbook.
- Production Netlify environment variables for Stripe Price IDs are unknown and must not be guessed.
- Development Club checkout must either have a real live Price ID or remain deliberately disabled.
- Full repo lint still fails on unrelated existing debt.
- Unrelated staging-retirement dirty files remain in the worktree and must not enter the release artifact.
- Steve has not yet explicitly approved production deployment from this runbook.

Files changed by this release-prep task:

- `docs/releases/paywall-tier-release-runbook-2026-06-22.md`

Validation performed while creating this runbook:

- `npm.cmd run build`: passed, including postbuild verification of the live Supabase project in the web build.
- `node --test tests/paywall-hardening-matrix.test.mjs tests/paywall-plan-normalization.test.mjs tests/paywall-access-model.test.mjs tests/paywall-ui-alignment.test.mjs tests/paywall-server-enforcement.test.mjs tests/paywall-commerce-alignment.test.mjs`: 36 tests passed.
- `npm.cmd run test:platform`: 102 tests passed.
- `npm.cmd run test:v1-stabilise`: 47 tests passed.
- `npx.cmd eslint --no-error-on-unmatched-pattern docs/releases/paywall-tier-release-runbook-2026-06-22.md`: exited 0 with one warning because Markdown files are ignored by the current ESLint config.
- `git diff --check`: passed.
- Runbook secret/style scan: no em dashes, smilies, or obvious Stripe/JWT secret patterns found.
- `git diff --cached --check`: to be run after staging and before commit.
