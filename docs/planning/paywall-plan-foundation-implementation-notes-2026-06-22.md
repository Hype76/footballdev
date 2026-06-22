# Paywall Plan Foundation Implementation Notes

Reference: FP-PAYWALL-FOUNDATION-04

Date: 2026-06-22

Authoritative decision record: `docs/decisions/paywall-tier-model-approved-2026-06-22.md`

## Current findings before implementation

Existing canonical-like plan keys found:

- `individual`
- `single_team`
- `small_club`
- `large_club`

New approved first-class key added:

- `development_club`

Existing display labels and checkout labels found:

- `Individual`
- `Single Team`
- `Small Club`
- `Large Club`

Existing subscription and billing statuses found in code:

- `active`
- `trialing`
- `past_due`
- `cancelled`
- Stripe source statuses including `canceled`, `unpaid`, `incomplete`, and `incomplete_expired`, which normalize to local billing status values.

Existing broad-access fallback risks found:

- `src/lib/plans.js` returned Small Club for unknown plan keys.
- `netlify/functions/_plan-gate.js` used Small Club when club or profile plan values were missing.
- Platform billing and club creation functions accepted invalid plan values by keeping or assigning Small Club.
- Several browser-side profile normalizers displayed missing plan values as Small Club.
- Supabase historical functions use `coalesce(plan_key, 'small_club')`.

Compatibility aliases now handled by the canonical JavaScript model:

- Individual Coach - Free: `individual`, `individual coach free`, `individual coach`, `individual free`, `free`, `coach free`
- Single Team: `single_team`, `single team`, `single`, `team`
- Small Club: `small_club`, `small club`
- Development Club: `development_club`, `development club`, `development`, `dev club`
- Large Club: `large_club`, `large club`, `contact`, `contact sales`, `enterprise`, `negotiated`

## Migration considerations

`supabase/migrations/20260622043000_paywall_plan_key_foundation.sql` is included but was not applied to production.

Before applying it anywhere live:

- Run `scripts/report-unknown-plan-values.mjs` against the target database.
- Review any unknown rows before adding or tightening constraints.
- Confirm whether historical `club_owner_invites`, `tester_access_codes`, and `stripe_checkout_records` need cleanup or archive handling.
- Confirm that Development Club checkout exists before exposing it as a visible self-service public paid tier.

The migration preserves the current feature matrix shape while adding Development Club as a first-class plan and removing SQL-side Small Club fallback from rewritten helper functions.

Small Club and Development Club staff/player limits remain unlimited in the JavaScript plan registry because that is the currently enforced safe value. New commercial numeric limits were not invented.

## Compatibility risks

- Unknown plan values now fail closed in JavaScript instead of receiving Small Club features.
- Invalid platform billing updates now return a validation error instead of silently keeping or assigning Small Club.
- Development Club is a recognized plan key, but checkout still has no Stripe price ID in this phase.
- Public pricing was not changed.
- Production data was not read or modified.
- No deployment was performed.
