# Paywall Feature Access Model

Reference: FP-PAYWALL-ACCESS-05

Date: 2026-06-22

Status: Implementation foundation.

Authoritative decision source: `docs/decisions/paywall-tier-model-approved-2026-06-22.md`

Foundation dependency: FP-PAYWALL-FOUNDATION-04, commit `80c23d3fe736069cfb87b3b5c6b11c65cb75bcda`.

## Purpose

Football Player now has a central feature access foundation for commercial tier checks. The model keeps plan entitlement separate from user permission, payment state, setup state, and club or team context.

Primary code:

- `src/lib/paywall-capabilities.js`
- `src/lib/paywall-access.js`
- `src/lib/plans.js`
- `src/lib/domain/plan-gates.js`

The central helpers are:

- `canUseFeature(context, capability)`
- `getFeatureAccess(context, capability)`
- `getPlanLimit(context, limit)`
- `getLimitAccess(context, limit)`
- `getRequiredUpgrade(context, capability)`
- `normalizePlanKey(value)`

## Access Decision Order

The central evaluator checks:

1. Capability key is known.
2. Capability readiness is `active`.
3. Current canonical plan includes the capability.
4. Required payment state is valid.
5. Required role authority is present.
6. Required club, team, player, ownership, or live-data context exists.
7. Required setup flags are complete.

Unknown plan keys fail closed. Unknown capability keys fail closed.

## Capability Ownership

| Capability group | Owning tier | Readiness | Upgrade target | Security notes |
|---|---|---|---|---|
| Secure authentication, account protection, safeguarding, essential role permissions | Core across relevant tiers | Active | None | These are safety and account controls, not premium features. |
| Required data access, correction, export, and deletion rights | Core across relevant tiers | Active | None | These are separate from premium reporting and operational export features. |
| Safety-critical auditability | Core across relevant tiers | Active | None | This is separate from full operational audit logs. |
| Basic development records, goals and notes, limited history, responsive web/PWA | Individual Coach - Free | Active | Single Team when limits are exceeded | Free remains limited by teams, staff, players, and monthly evaluations. |
| Family portal preview | Individual Coach - Free | Active | Single Team for real Parent Portal | Preview only. No live parent/player data, parent invitations, emails, PDFs, messaging, consent changes, or communication history. |
| Real Parent Portal, parent invitations, parent emails, PDF reports, attachments | Single Team | Active | Single Team | Real parent access begins at Single Team. |
| Full one-team records, full history, assessments, calendar, training, fixtures, match day, polls | Single Team | Active | Single Team | Role and team context still apply. |
| Basic logo branding and basic activity visibility | Single Team | Active | Single Team | Full operational audit logs remain Small Club and above. |
| Club administration, club staff roles, shared oversight, bulk invites/imports | Small Club | Active | Small Club | Club admin authority is still role-checked separately. |
| Club-wide calendar/events, recurring events, calendar export/feed | Small Club | Active | Small Club | Recurring events and calendar export/feed begin at Small Club. |
| Custom colours and club branding, shared report templates, full operational audit log, basic club analytics | Small Club | Active | Small Club | Full operational audit log is premium. Safety auditability is core. |
| Advanced development analytics, player pathways, coach handovers, scheduled review cycles | Development Club | Active | Development Club | These are maturity and automation capabilities. |
| Approval workflows, custom assessment templates, custom report templates | Development Club | Active | Development Club | `approvalWorkflow` legacy checks now map to Development Club. |
| Club-wide operational exports, scheduled parent reports, priority support | Development Club | Active | Development Club | Operational exports are premium and distinct from required data rights exports. |
| Negotiated limits, bespoke branding, assisted setup, data migration, custom onboarding, rollout planning | Large Club | Active | Large Club | Large Club remains negotiated/contact-led. |
| Integrations and external calendar integrations | Large Club | Active, setup required | Large Club | Large Club eligibility does not activate an integration unless explicit setup flags are true. |
| Platform admin access | Platform role only | Active | None | Platform Admin access comes from verified `super_admin` role, not plan fallback. |
| Native app entitlement | Future/hidden | Hidden | None | This stays inactive and hidden until separately approved. |

## Numeric Limits

All commercial limits are exposed through `PLAN_OPTIONS.limits` and read through `getPlanLimit` or `getLimitAccess`.

| Limit | Individual Coach - Free | Single Team | Small Club | Development Club | Large Club | Source |
|---|---:|---:|---:|---:|---:|---|
| Teams | 1 | 1 | 5 | 10 | Negotiated | `PLAN_OPTIONS.limits.teams` |
| Staff logins | 1 | 5 | Unlimited currently enforced | Unlimited currently enforced | Negotiated | `PLAN_OPTIONS.limits.staffLogins` |
| Players | 5 | 30 | Unlimited currently enforced | Unlimited currently enforced | Negotiated | `PLAN_OPTIONS.limits.players` |
| Monthly evaluations | 10 | Unlimited | Unlimited | Unlimited | Unlimited | `PLAN_OPTIONS.limits.monthlyEvaluations` |

Small Club and Development Club staff/player limits remain commercially reviewable because the approved tier model did not set final numeric values beyond team limits.

## Legacy Feature Keys

Existing V1 code still uses legacy feature keys. They now resolve through the central registry:

| Legacy key | Central capability |
|---|---|
| `parentEmail` | `parentEmails` |
| `pdfExport` | `pdfReports` |
| `customFormFields` | `customDevelopmentFields` |
| `basicBranding` | `basicLogoBranding` |
| `customBranding` | `customColoursBranding` |
| `themes` | `customColoursBranding` |
| `auditLogs` | `fullOperationalAuditLog` |
| `approvalWorkflow` | `approvalWorkflows` |

This preserves existing helper imports while moving commercial decisions to the central capability registry.

## Payment States

Paid commercial features require:

- `active`
- `trialing`
- comped access, when the tester access has not expired

These states fail closed for paid features:

- `past_due`
- `incomplete`
- `canceled`
- `cancelled`
- `expired`
- unknown or missing paid subscription state

Free/core capabilities do not require a paid subscription.

## Compatibility Notes

- Public pricing copy was not changed.
- Stripe products and live price IDs were not changed.
- Production data was not changed.
- No deploy was performed.
- Existing UI call sites still import `hasPlanFeature`, `getPlanLimit`, and upgrade-message helpers, but those helpers now read central capability definitions.
- Approval workflow entitlement now follows the approved Development Club placement in the central model. Existing database enforcement may need a reviewed migration path before any live rollout.
- Small Club and Development Club staff/player limits remain unlimited in code until explicit numeric limits are approved.
