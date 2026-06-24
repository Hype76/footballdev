# Paywall Server Enforcement

Date: 2026-06-22
Goal: FP-PAYWALL-SERVER-07
Builds on:
- FOUNDATION-04: `80c23d3fe736069cfb87b3b5c6b11c65cb75bcda`
- ACCESS-05: `abb5c735cc88e4eff24914917fd578a42664fca3`
- UI-06: `5a73cb6`

## Scope

This change enforces the approved subscription model at trusted and near-trusted boundaries without changing public pricing, Stripe products, Stripe price IDs, production env vars, production data, deploy state, or live migrations.

## Enforced Surfaces

- Netlify user-token functions now resolve an authenticated plan profile for the requested club before feature checks:
  - `send-parent-email`
  - `render-pdf`
  - `manage-scheduled-emails`
  - `send-parent-portal-invite`
  - `send-staff-invite`
  - `manage-team`
- Netlify background workers still use service role, but re-check the club plan in a system context before sending queued or retried email.
- Browser domain actions now route feature checks through `src/lib/domain/plan-gates.js`, which reloads club plan details instead of trusting caller-supplied plan fields.
- High-risk domain actions now gate:
  - Assessments
  - Calendar writes, including club-wide, recurring, and parent-visible event rules
  - Parent email templates
  - Parent portal invite creation
  - Staff invite and staff user creation
  - Staff assignment
  - Audit log reads
  - Form field customization
  - Club branding and approval workflow settings

## Migration Coverage

The migration `supabase/migrations/20260622050850_paywall_server_enforcement.sql` is generated but not applied. It:

- Replaces `public.can_use_plan_feature` with canonical and legacy feature-key normalization.
- Returns false for unknown plans, unknown features, integrations without setup, and native app entitlement.
- Moves approval workflows to Development Club and above.
- Keeps Parent Portal, parent invites, parent emails, PDF reports, assessments, team calendar, and team staff roles at Single Team and above.
- Keeps recurring and club-wide calendar events, full operational audit log, and custom colours at Small Club and above.
- Adds future RLS enforcement for calendar events, parent player links, staff invites, parent email templates, audit logs, form fields, and logo storage.
- Preserves service-role bypass for server workers where existing trusted background processing requires it.

## Intentional Non-Changes

- No public pricing copy changed.
- No Stripe product or price ID changed.
- No production migration was applied.
- No production data was changed.
- No deploy was run.
- Existing unrelated staging-retirement worktree changes were left untouched.

## Validation Target

Focused validation should include:

- `node --test tests/paywall-access-model.test.mjs tests/paywall-server-enforcement.test.mjs`
- `node --check` for touched Netlify and domain modules
- `npm.cmd run test:platform`
- `npm.cmd run test:v1-stabilise`
- `npm.cmd run build`

Full lint is still expected to report unrelated historical debt unless separately cleaned.
