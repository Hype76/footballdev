# Footballplayer.online Approved Paywall Tier Model

Reference: FP-PAYWALL-APPROVAL-03

Date: 2026-06-22

Status: Approved authoritative implementation decision.

Approved by: Simon, after Steve and Simon reviewed the full proposal.

Source audit: `docs/audits/paywall-feature-access-audit-2026-06-20.md`

Audit commit: `d31e84b0ca7bc75ddd3fd95e515d47261c6b064d`

Source proposal: `docs/planning/paywall-feature-tier-matrix-proposal-2026-06-20.md`

Proposal commit: `c8dde413c96436df4f19b06e4db897f7ef11ccbb`

Scope: Documentation and planning decision only. No gates were implemented, no code behavior was changed, no plan helpers were changed, no feature gates were changed, no Stripe configuration was changed, no public pricing pages were changed, no Supabase schema or data was changed, and no deploy was performed.

## Decision summary

Simon approved the proposed commercial direction in full on 22 June 2026. Later implementation phases must use this decision record as the source of truth for Footballplayer.online subscription tiers, feature ownership, and feature-gating principles.

The approved model gates paid value by:

- Scale.
- Oversight.
- Automation.
- Support.

The approved model does not gate basic:

- Safeguarding.
- Secure access.
- Essential permissions.
- Parental consent and visibility controls.
- Account protection.
- Required data access, correction, export, and deletion rights.
- Safety-critical auditability.

Single Team must be the complete Football Player product for one team.

## Approved tiers

| Tier | Headline monthly price | Approved scope |
|---|---:|---|
| Individual Coach - Free | GBP 0 | 1 team, 1 staff login, up to 5 players, basic development records, goals and notes, limited history, Football Player branding, and non-operational family portal preview. |
| Single Team | GBP 12.99/month | 1 team, up to 5 staff, up to 30 players, full record history, assessments, player notes, attachments, full parent portal, parent emails, PDF reports, team calendar and normal events, match day features, team polls, basic logo branding, and basic activity visibility. |
| Small Club | GBP 34.99/month | Up to 5 teams, club administrator access, club-level staff roles, shared player oversight, bulk invites/imports, club-wide calendar and events, recurring event automation, calendar export/feed, shared report templates, custom colours and club branding, full operational audit log, and basic club analytics. |
| Development Club | GBP 59.99/month | Up to 10 teams, advanced development analytics, player pathways across teams, coach handovers, scheduled review cycles, approval workflows, custom assessment/report templates, club-wide operational exports, scheduled parent reports, and priority support. |
| Large Club | GBP 99.99+/month | More than 10 teams, contact/negotiated sale, negotiated limits, assisted setup, data migration, custom onboarding, bespoke branding, integrations where available, rollout planning, dedicated support contact, and agreed service terms. |

Individual, Single Team, Small Club, Development Club, and Large Club are the approved public tier names.

## Approved feature ownership

- Development Club is a first-class plan.
- Large Club is contact/negotiated rather than standard self-service checkout.
- Individual is a genuine free starter tier.
- Family portal preview must not provide full parent access or communication.
- Full Parent Portal begins at Single Team.
- Parent emails, PDF reports, and attachments begin at Single Team.
- Team calendar and normal events begin at Single Team.
- Match day features and team polls begin at Single Team.
- Recurring events and calendar export/feed begin at Small Club.
- Club-wide calendar and oversight begin at Small Club.
- Full operational audit history begins at Small Club.
- Advanced analytics, pathways, handovers, scheduled reviews, approval workflows, custom templates, exports, and scheduled parent reports begin at Development Club.
- Integrations begin at Large Club by default.
- Responsive web/PWA access follows the account tier and is not separately paywalled.
- Native application access remains a future decision and must not be exposed as an active entitlement.
- Unknown or invalid plan keys must fail closed.
- Every visible self-service paid tier must have working checkout support before public launch.

## Temporary implementation rule for limits

The approved report did not establish final numeric player or staff limits for Small Club and Development Club beyond the approved team limits.

Until explicit numeric limits are approved:

- Preserve currently enforced safe limits.
- Centralise those limits so they can later be changed in one place.
- Do not invent new commercial limits during implementation.

Approved team limits:

- Individual Coach - Free: 1 team.
- Single Team: 1 team.
- Small Club: up to 5 teams.
- Development Club: up to 10 teams.
- Large Club: more than 10 teams with negotiated limits.

Approved Single Team limits:

- Up to 5 staff.
- Up to 30 players.

## Pricing and launch constraints

- The monthly prices in this record are approved headline prices.
- VAT presentation, annual billing, discounts, and promotional pricing are separate commercial decisions.
- No production deployment is authorised by this decision record alone.
- Public pricing and Stripe checkout must not be changed until an implementation phase explicitly authorises that work.
- Every visible self-service paid tier must have working checkout support before public launch.

## Implementation implications

Later implementation phases should align central plan definitions, feature access mapping, route and navigation behaviour, Netlify function checks, Supabase enforcement, public pricing, Stripe checkout, and tests to this decision record.

Implementation must preserve the separation between commercial feature gates and safety, security, legal, account protection, consent, parental visibility, and required data rights.

## Validation expectation

Documentation-only changes that reference this decision should run:

- `git diff --check`

Implementation phases that change application behavior must define and run their own broader validation suite before deployment.
