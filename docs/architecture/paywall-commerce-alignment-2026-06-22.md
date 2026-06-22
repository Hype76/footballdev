# Paywall Commerce Alignment

Date: 2026-06-22
Goal: FP-PAYWALL-COMMERCE-08

Builds on:
- FOUNDATION-04: `80c23d3fe736069cfb87b3b5c6b11c65cb75bcda`
- ACCESS-05: `abb5c735cc88e4eff24914917fd578a42664fca3`
- UI-06: `5a73cb6`
- SERVER-07: `ce68a64c9c57520052d15a695ea9f714dd410e4f`

## Scope

This phase aligns public pricing, product messaging, upgrade copy, checkout availability, and Stripe price mapping with the approved five-tier model. It does not create or edit Stripe products or prices, production environment variables, production subscriptions, Supabase production data, live migrations, deploy state, or unrelated staging-retirement files.

## Public Tier Model

| Tier | Public price | Checkout mode | Commercial position |
|---|---:|---|---|
| Individual Coach - Free | GBP 0 | No checkout | Basic records for one coach, with family portal preview only. |
| Single Team | GBP 12.99/month | Self-service | The complete Football Player product for one team. |
| Small Club | GBP 34.99/month | Self-service | Club scale and oversight for up to 5 teams. |
| Development Club | GBP 59.99/month | Self-service | Development analytics, pathways, approvals, templates, exports, scheduled reports, and priority support. |
| Large Club | GBP 99.99+/month | Contact sales | Negotiated rollout, limits, onboarding, migration, support, and service terms. |

Safety controls, secure access, consent controls, essential permissions, account protection, and responsive web/PWA access remain outside premium positioning. Higher tiers sell scale, oversight, automation, analytics, onboarding, integration eligibility where configured, and support.

## Stripe Price Environment Variables

Checkout and webhook mapping use environment variables only. No price IDs or secrets are hardcoded.

| Plan | Monthly env var | Annual env var |
|---|---|---|
| Single Team | `VITE_STRIPE_SINGLE_TEAM_MONTHLY_PRICE_ID` | `VITE_STRIPE_SINGLE_TEAM_ANNUAL_PRICE_ID` |
| Small Club | `VITE_STRIPE_SMALL_CLUB_MONTHLY_PRICE_ID` | `VITE_STRIPE_SMALL_CLUB_ANNUAL_PRICE_ID` |
| Development Club | `VITE_STRIPE_DEVELOPMENT_CLUB_MONTHLY_PRICE_ID` | `VITE_STRIPE_DEVELOPMENT_CLUB_ANNUAL_PRICE_ID` |

The public pricing UI now shows monthly prices only because VAT presentation, annual billing, discounts, and promotional pricing are separate commercial decisions. The server keeps annual env var support for existing compatibility, but no annual price is advertised by this phase.

If a Development Club live Stripe Price ID is missing, the code supports the plan key and validates it, but checkout returns `This plan is not available for checkout yet`. Production purchase remains disabled until a real live Price ID is configured in the target environment.

## Checkout Rules

- Self-service checkout accepts only `single_team`, `small_club`, and `development_club`.
- Individual Coach - Free and Large Club are rejected by the checkout endpoint.
- Unknown or malformed plan keys are rejected before Stripe is called.
- Unknown or unsupported billing cycles are rejected before Stripe is called.
- Checkout metadata includes the canonical plan key, but Stripe Price ID remains the trusted plan source for webhook processing.
- Large Club routes to contact/demo copy and does not create checkout.

## Webhook Rules

- Webhook price mapping is centralized in `netlify/functions/_stripe-billing.js`.
- Unknown Stripe Price IDs fail closed and are not mapped to Small Club.
- Checkout metadata cannot override or contradict the configured Stripe Price ID.
- Subscription updates reject unknown configured prices instead of silently changing plan state.
- Existing idempotency handling through `stripe_webhook_events` remains in place.
- Existing status normalization keeps `canceled`, `cancelled`, `unpaid`, `incomplete`, and `incomplete_expired` inactive.

## Legacy Compatibility

Existing plan aliases are preserved through the canonical compatibility map in `src/lib/plans.js` and `netlify/functions/_stripe-billing.js`. Legacy subscriptions are not repriced, moved, or migrated by this phase. Current subscription rows keep their stored Stripe customer, subscription, price, and status values until Stripe sends a trusted event or an authorized platform admin changes billing.

## Non-Changes

- No live Stripe product or price changes.
- No production environment variable edits.
- No production subscription changes.
- No Supabase production migration or data update.
- No deploy.
- No customer announcements.
- Existing unrelated staging-retirement worktree changes were preserved.
