# Footballplayer.online Proposed Paywall Feature Tier Matrix

Reference: FP-PAYWALL-MATRIX-02

Date: 2026-06-20

Status: Approved by Simon on 2026-06-22. Historical proposal retained for audit trail.

Approved decision record: `docs/decisions/paywall-tier-model-approved-2026-06-22.md`

Source audit: `docs/audits/paywall-feature-access-audit-2026-06-20.md`

Audit commit: `d31e84b0ca7bc75ddd3fd95e515d47261c6b064d`

Scope: Documentation and planning only. No gates were implemented, no code behavior was changed, no Stripe configuration was changed, no public pricing pages were changed, no Supabase schema was changed, no production data was touched, and no deploy was performed.

## 1. Executive summary

The completed paywall audit found that Footballplayer.online already has a working tier model, but it is not yet shaped around Steve's intended commercial gating model. The current code defines four plan keys in `src/lib/plans.js`: `individual`, `single_team`, `small_club`, and `large_club`. Steve's proposed model has five commercial tiers: Individual Coach Free, Single Team, Small Club, Development Club, and Large Club.

What currently aligns:

- The code already gates by scale for teams, staff logins, active players, and monthly evaluations. Evidence: `src/lib/plans.js`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql`.
- Parent email and PDF report access are already paid features with strong Netlify function enforcement. Evidence: `netlify/functions/send-parent-email.js`, `netlify/functions/manage-scheduled-emails.js`.
- Basic branding starts at Single Team and broader branding/theme controls start at Small Club in the current model. Evidence: `src/lib/plans.js`, `src/lib/domain/club-settings-actions.js`.
- Full activity log access is already treated as premium and backed by route, helper, and RLS checks. Evidence: `src/app/router.jsx`, `src/lib/domain/audit.js`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql`.
- Large Club is already treated as a contact/manual tier rather than a normal direct checkout tier. Evidence: `src/pages/PublicPricingPage.jsx`, `netlify/functions/create-checkout-session.js`.

What currently conflicts:

- Steve's proposal has a Development Club tier, but the current code and audit only found four plan keys. There is no confirmed `development_club` plan key.
- Current public pricing says Individual includes "Family portal", but parent portal is not represented as a plan feature and is not clearly tier-owned. Evidence: `src/lib/login-pricing.js`, `src/app/router.jsx`.
- Steve wants Single Team to feel like the complete one-team product, but the current Single Team plan uses lower code limits than the proposed commercial limits. The current audit found Single Team at 20 players and 3 staff, while Steve proposes 30 players and up to 5 staff.
- Checkout currently supports only Single Team and Small Club paid Stripe checkout paths. Evidence: `netlify/functions/create-checkout-session.js`.
- Calendar, polls, match day, parent portal, mobile access, reports/exports, and advanced analytics are not all represented in the current central plan feature map.
- Unknown plan keys currently fall back to Small Club in JavaScript. Evidence: `src/lib/plans.js`.

What needs Steve decision:

- Whether to add Development Club as a real plan key.
- Whether Large Club stays contact/negotiated only.
- Whether Individual is a real free tier, a demo tier, or a starter plan.
- Exactly what "Family portal preview" means on Free.
- Whether full parent portal, parent emails, PDF reports, attachments, calendar, and basic branding all start at Single Team.
- Whether full audit log, custom colors, shared templates, and club analytics start at Small Club.
- Whether advanced analytics, pathways, handovers, custom templates, club-wide exports, scheduled parent reports, and priority support start at Development Club.
- Whether unknown plan keys should fail closed.

What should be fixed first after decisions are made:

1. Decide the final tier names, prices, and plan keys.
2. Add fail-closed behavior for unknown tier keys if Steve approves.
3. Create a central tier and feature access map.
4. Align route, navigation, paywall, Netlify function, and Supabase enforcement to that map.
5. Align public pricing copy and Stripe checkout only after Steve signs off.

## 2. Current tier model found in code

| Existing plan key | Current code role | Current checkout support | Current public pricing status | Known enforced limits | Fit against Steve's proposed model | Notes |
|---|---|---|---|---|---|---|
| `individual` | Free starter plan with small scale and most feature flags off | No paid checkout. Public CTA routes toward sign-in/signup. | Public pricing lists Individual as Free and says "Family portal". | 1 team, 1 staff login, 5 active players, 10 monthly evaluations. | Partial fit. Matches Free tier concept, but Family portal needs to become preview only or the copy must change. | Audit found parent portal is active-link and role gated, not a central plan feature. Evidence: `src/lib/plans.js`, `src/lib/login-pricing.js`, `src/app/router.jsx`. |
| `single_team` | Paid one-team plan | Direct Stripe checkout supported for monthly/annual Single Team. | Public pricing currently shows GBP 9.99/month, not Steve's proposed GBP 12.99/month. | 1 team, 3 staff logins, 20 active players, unlimited monthly evaluations, parent email, PDF export, custom fields, basic branding. | Good conceptual fit, but limits and price need decision. Steve proposes up to 5 staff and 30 players. | This should become the complete one-team product under Steve's model. |
| `small_club` | Paid club plan for multiple teams and premium controls | Direct Stripe checkout supported for monthly/annual Small Club. | Public pricing currently shows GBP 24.99/month, not Steve's proposed GBP 34.99/month. | 10 teams, unlimited staff, unlimited players, parent email, PDF export, custom fields, basic/custom branding, themes, audit logs, approval workflow. | Good partial fit, but Steve proposes up to 5 teams, not 10, and positions it as club oversight. | Current Small Club is also the JS fallback for unknown plan keys, which is risky. |
| `large_club` | Contact/manual large club plan | No normal direct checkout found. Contact/demo flow. | Public pricing lists Contact us and "More than 10 teams". | Unlimited or negotiated limits in JS and DB plan functions. | Partial fit. Could remain Large Club, but Steve proposes adding Development Club before it. | Large Club should likely remain negotiated unless Steve wants direct checkout. |
| No confirmed key for Development Club | Not found as a central plan key in the audit | No checkout support found | No public pricing tier found | Not applicable | Missing against Steve's model. | Steve must decide whether to add a new code key such as `development_club`. |
| Trialing status | Billing status, not a commercial tier | Checkout creates trialing flows for paid plans | Not a tier on pricing table | Active access when status is trialing | Compatible if retained | Keep separate from tier ownership. |
| Comped plan | Manual/tester/bypass access | No normal checkout | Not public pricing | Can bypass billing status in selected paths | Compatible if controlled | Should be treated as platform/admin access, not customer tier positioning. |

## 3. Proposed new tier model

| Proposed commercial tier name | Monthly price | Target customer | Team limit | Staff limit | Player limit | Core included value | Main upgrade trigger | Notes |
|---|---:|---|---:|---:|---:|---|---|---|
| Individual Coach Free | Free | One coach testing Football Player with a small group | 1 | 1 | 5 | Basic records, goals, notes, limited history, and family portal preview only | More than 5 players, multiple staff, full history, parent communication, reports, attachments, or proper team calendar | Treat as starter/demo. Do not sell this as full parent communication unless Steve later decides otherwise. |
| Single Team | GBP 12.99/month | One real team that wants the complete Football Player product | 1 | 5 | 30 | Full one-team records, assessments, parent portal, parent email, PDF reports, attachments, calendar/events, basic logo branding, basic activity log | Second team, club administrator control, club-wide calendar, shared branding, shared templates, or cross-team oversight | This is the most important commercial promise: a single team should not feel crippled. |
| Small Club | GBP 34.99/month | Small multi-team club needing oversight and shared operations | 5 | Unclear | Unclear | Club administrator access, shared player oversight, staff roles, bulk invites/imports, club-wide calendar, shared report templates, custom colors/branding, full audit log, basic club analytics | More than 5 teams, development pathways, coach handovers, scheduled review cycles, custom report templates, advanced analytics, scheduled parent reports | Sells club-level organisation and multi-team oversight. |
| Development Club | GBP 59.99/month | Club that wants mature player development operations across teams | 10 | Unclear | Unclear | Advanced development analytics, player pathways, coach handovers, scheduled review cycles, custom templates, club-wide exports, scheduled parent reports, priority support | More than 10 teams, migration, integrations, bespoke onboarding, rollout support, dedicated contact, agreed service terms | Not currently confirmed as a code plan key. |
| Large Club | GBP 99.99+/month | Large club or organisation needing rollout confidence and custom support | Negotiated, more than 10 | Negotiated | Negotiated | Assisted setup, data migration, custom onboarding, bespoke branding, integrations where available, dedicated support contact, rollout planning, agreed service terms | Bespoke operational needs, integration needs, or negotiated rollout requirements | Best kept as contact/negotiated unless Steve wants direct checkout. |

## 4. Proposed feature/tier matrix

Legend for tier values: Include, Limit, Preview, Exclude, Upsell, Future, Hidden, Not applicable, Unclear.

| Category | Capability | Individual Coach Free | Single Team | Small Club | Development Club | Large Club | Current enforcement status | Current mismatch/risk | Recommendation confidence | Steve decision needed | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Player records | Player records | Limit | Include | Include | Include | Include | Limit enforced by JS helpers and Supabase functions | Free and Single Team limits differ from Steve proposal | High | Confirm player limits | Free 5, Single Team proposed 30. |
| Player records | Player development records | Limit | Include | Include | Include | Include | Monthly evaluation limits enforced | Free limit exists, paid tiers appear unlimited | High | Confirm Free history and monthly record limit | Keep basic development records in Free. |
| Player records | Goals | Include | Include | Include | Include | Include | Not separately tier-gated in audit | No confirmed mismatch | Medium | Confirm goals stay core | Core product value. |
| Player records | Notes | Include | Include | Include | Include | Include | Not separately tier-gated in audit | No confirmed mismatch | Medium | Confirm notes stay core | Core one-team value. |
| Player records | Player feedback | Limit | Include | Include | Include | Include | Platform/tester feedback is separate from player workflow | Tier ownership unclear | Medium | Define player feedback surface by tier | Do not confuse with platform feedback route. |
| Player records | Full history | Limit | Include | Include | Include | Include | Active workspace required, but history depth not clearly tier-gated | Free limited history is a proposed product rule, not current enforcement | Medium | Define limited history period for Free | Needed for fair Free to paid upgrade. |
| Assessments | Assessment sessions | Limit | Include | Include | Include | Include | Assessment/session routes are role and active-plan gated | Not clearly priced as a feature beyond active plan | High | Confirm Single Team includes full one-team assessments | Single Team should not feel crippled. |
| Assessments | Assessment templates | Include | Include | Include | Include | Include | Default fields exist, custom fields gated | Template ownership unclear | Medium | Decide default vs shared vs custom templates | Shared/custom templates can drive club tiers. |
| Assessments | Custom assessment fields | Exclude | Include | Include | Include | Include | `customFormFields` gated Single Team and above | Aligned for Single Team, but club template distinction unclear | High | Confirm custom fields start at Single Team | Evidence: `src/lib/domain/form-field-actions.js`. |
| Assessments | Monthly evaluations | Limit | Include | Include | Include | Include | Individual has monthly evaluation limit, paid tiers unlimited | Free limit needs Steve confirmation | High | Confirm Free monthly evaluation limit | Audit found 10 monthly evaluations for Individual. |
| Player records | Player notes | Include | Include | Include | Include | Include | Not separately tier-gated in audit | No confirmed mismatch | Medium | Confirm notes stay core | Should not be premium-only. |
| Media | Attachments | Exclude | Include | Include | Include | Include | PDF attachment path tied to `pdfExport`; general attachment tier is unclear | Steve wants attachments at Single Team, current audit did not prove full attachment gate | Medium | Confirm attachments start at Single Team | Distinguish PDF attachments from general file attachments. |
| Analytics | Progress charts | Limit | Include | Include | Include | Include | Not clearly tier-gated in audit | Tier ownership unclear | Medium | Define chart depth by tier | Basic progress belongs in complete one-team product. |
| Parent portal | Parent portal preview | Preview | Not applicable | Not applicable | Not applicable | Not applicable | Current public Individual copy says Family portal, but code does not model preview | High copy risk | High | Define exactly what preview means | Preview should not imply full communication. |
| Parent portal | Full parent portal | Exclude | Include | Include | Include | Include | Parent routes require active parent link, not central plan feature | Not clearly tier-owned | High | Should full Parent Portal start at Single Team? | Recommended yes under Steve model. |
| Parent communication | Parent email access | Exclude | Include | Include | Include | Include | `parentEmail` gated Single Team and above in UI and Netlify functions | Mostly aligned | High | Confirm starts at Single Team | Strong existing enforcement. |
| Parent communication | Parent PDF access | Exclude | Include | Include | Include | Include | `pdfExport` gated Single Team and above | Mostly aligned | High | Confirm starts at Single Team | Strong existing enforcement. |
| Parent portal | Parent visibility controls | Include where parent features exist | Include | Include | Include | Include | Parent RPCs and visibility checks are safety scoped | Must not become expensive safety gate | High | Confirm safety visibility is core wherever parent features exist | Visibility rights should follow the parent feature. |
| Parent communication | Parent communication | Preview | Include | Include | Include | Include | Parent email is gated, parent portal is not clearly tier-gated | Free copy risk | High | Define Free preview vs full communication | Separate viewing preview from actual communication. |
| Calendar | Team calendar | Exclude or Preview | Include | Include | Include | Include | Calendar is role and active-plan gated, not tier-gated | Steve says proper team calendar triggers Free to Single Team | High | Confirm team calendar starts at Single Team | Team calendar belongs in complete one-team product. |
| Calendar | Club calendar | Exclude | Exclude | Include | Include | Include | Club-wide events are club admin scoped, not tier-owned | Club-tier ownership unclear | High | Confirm Small Club unlocks club-wide calendar | Sells club oversight. |
| Calendar | Club-wide events | Exclude | Exclude | Include | Include | Include | RLS distinguishes club-wide events by `team_id is null` | Not commercially tiered | High | Confirm Small Club unlocks club-wide events | Evidence: `supabase/migrations/20260609104500_restrict_calendar_club_events.sql`. |
| Calendar | Recurring events | Exclude or Preview | Include | Include | Include | Include | Audit found recurring UI, no named tier feature | Tier ownership unclear | Medium | Decide if recurring is core team or club automation | Recommendation: Single Team for team recurring events, club-wide recurrence at Small Club. |
| Calendar | Fixtures | Exclude or Preview | Include | Include | Include | Include | Calendar/match day related, not named tier feature | Tier ownership unclear | Medium | Confirm fixtures start at Single Team | Fixtures support normal one-team use. |
| Calendar | Training events | Exclude or Preview | Include | Include | Include | Include | Sessions/calendar routes, not named tier feature | Tier ownership unclear | Medium | Confirm training events start at Single Team | Training events support normal one-team use. |
| Calendar | General events | Exclude or Preview | Include | Include | Include | Include | Calendar routes, not named tier feature | Tier ownership unclear | Medium | Confirm general events start at Single Team | Club-wide general events should be Small Club. |
| Match day | Match day features | Exclude or Preview | Include | Include | Include | Include | Role/RLS/RPC scoped, not tier-gated | Not clearly tier-owned | High | Confirm starts at Single Team | A real one-team product likely needs match day. |
| Engagement | Polls | Exclude or Preview | Include | Include | Include | Include | Role/RPC scoped, not tier-gated | Not clearly tier-owned | Medium | Confirm starts at Single Team | Parent polls should follow parent feature access. |
| Administration | Team management | Limit | Include | Include | Include | Include | Team limits enforced by JS and DB | Single Team team count aligns, staff/player limits need change | High | Confirm team limits | Free and Single Team remain 1 team. |
| Administration | Staff management | Limit | Include | Include | Include | Include | Staff invite/user access limits exist | Current Single Team limit is 3, Steve proposes 5 | High | Confirm staff limits | Evidence: `src/pages/UserAccessPage.jsx`, plan functions. |
| Administration | Club administrator access | Exclude | Exclude or Limit | Include | Include | Include | Role-gated by club admin, not fully tier-owned | Small Club ownership unclear | High | Should club admin be Small Club and above? | Recommended Small Club and above for multi-team oversight. |
| Administration | Staff roles | Limit | Include | Include | Include | Include | Role hierarchy exists | Commercial tier ownership unclear | Medium | Define role depth by tier | Essential permissions should not be premium-only. Advanced governance can be premium. |
| Club operations | Shared player oversight | Exclude | Exclude | Include | Include | Include | Club admin needs team context in many workflows | Commercial meaning not fully mapped | Medium | Confirm starts at Small Club | Sells multi-team oversight. |
| Setup | Club setup | Limit | Include | Include | Include | Include | Club settings route and paid field checks exist | Some identity editing behavior differs from feature flags | Medium | Define Free setup boundaries | Core setup must exist, premium branding can be gated. |
| Setup | Team setup | Limit | Include | Include | Include | Include | Team count enforced | Good conceptual fit | High | Confirm team limits | Single Team is 1 team. |
| Setup | Bulk invites/imports | Exclude | Upsell | Include | Include | Include | Not confirmed as current central plan feature | Proposed capability may be future/partial | Medium | Confirm whether implemented and tier-owned | If not implemented, mark Future in roadmap. |
| Branding | Branding | Football Player branding | Basic logo branding | Custom colors and branding | Custom templates and branding | Bespoke branding | Current basic/custom branding and themes exist | Proposed tier split needs detail | High | Confirm branding split by tier | Keep Football Player branding on Free. |
| Branding | Football Player branding | Include | Include | Include | Include | Include | Not a paid feature | No mismatch | High | Confirm Free remains FP-branded | Default branding across tiers unless custom allowed. |
| Branding | Basic logo branding | Exclude | Include | Include | Include | Include | `basicBranding` starts at Single Team | Mostly aligned | High | Confirm starts at Single Team | Evidence: `src/lib/domain/club-settings-actions.js`. |
| Branding | Custom colours | Exclude | Exclude | Include | Include | Include | `themes` starts at Small Club | Mostly aligned | High | Confirm starts at Small Club | Spelling in code/copy may use colors. |
| Branding | Bespoke branding | Exclude | Exclude | Exclude | Upsell | Include | Not proven as implemented beyond custom branding/themes | Large Club positioning feature | Medium | Define bespoke scope | May be mostly service-led. |
| Branding | Theme controls | Exclude | Exclude | Include | Include | Include | `themes` starts at Small Club | Mostly aligned | High | Confirm Small Club start | Evidence: `src/lib/plans.js`. |
| Audit | Basic activity log | Include for safety events | Include | Include | Include | Include | Current full activity log is premium | Need split basic safety auditability from full log | High | Define basic auditability surface | Basic security/safety events should not be expensive-only. |
| Audit | Full audit log | Exclude | Exclude or Limit | Include | Include | Include | `auditLogs` starts at Small Club | Mostly aligned | High | Should full audit log start at Small Club? | Recommended Small Club and above. |
| Governance | Approval workflows | Exclude | Exclude | Include | Include | Include | `approvalWorkflow` starts at Small Club | Mostly aligned | Medium | Confirm Small Club start | Fits club governance. |
| Analytics | Basic club analytics | Exclude | Exclude | Include | Include | Include | Not clearly represented in central plan features | May be partial via end of season stats | Medium | Define basic club analytics | Small Club value driver. |
| Analytics | Advanced development analytics | Exclude | Exclude | Exclude or Upsell | Include | Include | Not clearly represented in central plan features | Missing tier feature | Medium | Confirm Development Club start | Development Club value driver. |
| Development pathway | Player pathways across teams | Exclude | Exclude | Exclude or Upsell | Include | Include | Not clearly represented in audit | Missing feature or unpriced feature | Medium | Confirm Development Club start | Cross-team pathways require multi-team data model decisions. |
| Development pathway | Coach handovers | Exclude | Exclude | Exclude or Upsell | Include | Include | Not clearly represented in central plan features | Missing feature or unpriced feature | Medium | Confirm Development Club start | Supports development maturity. |
| Development pathway | Scheduled review cycles | Exclude | Exclude | Exclude or Upsell | Include | Include | Not clearly represented in central plan features | Missing feature or unpriced feature | Medium | Confirm Development Club start | Automation should sell higher tiers. |
| Reports | Shared report templates | Exclude | Exclude | Include | Include | Include | Custom fields exist, shared report templates unclear | Missing tier ownership | Medium | Confirm Small Club start | Good Small Club operational value. |
| Reports | Custom report templates | Exclude | Exclude | Exclude or Upsell | Include | Include | Not clearly represented in central plan features | Missing tier ownership | Medium | Confirm Development Club start | Higher-tier maturity feature. |
| Reports | Club-wide exports | Exclude | Exclude | Upsell | Include | Include | End-season stats exists, premium export model unclear | Need split legal export rights from premium exports | High | Confirm Development Club start | Premium operational export, not data rights. |
| Parent communication | Scheduled parent reports | Exclude | Exclude or Upsell | Upsell | Include | Include | Scheduled emails exist, scheduled reports not clearly tiered | Missing tier ownership | Medium | Confirm Development Club start | Automation should sell higher tiers. |
| Safety/data | Data export/deletion rights | Include | Include | Include | Include | Include | Not fully audited as a tier feature | Must not become premium-only | High | Confirm legal/data rights are all-tier | Separate from premium reports/export packs. |
| Reports | Reports | Limit | Include | Include | Include | Include | PDF report/email path gated Single Team and above; broader reports unclear | Needs report category split | Medium | Define one-team vs club reports | Single Team gets own-team reports, higher tiers get club-wide packs. |
| Reports | CSV/report packs | Exclude | Exclude or Limit | Upsell | Include | Include | Not clearly represented in central plan features | Missing tier ownership | Medium | Confirm Development Club start | Premium operational exports. |
| Mobile | Mobile/PWA/native app access | Unclear | Include | Include | Include | Include | Audit did not find web plan model gating mobile/native apps | Tier ownership unclear | Medium | Should mobile access be included in all paid plans? | Recommendation: paid tiers include access, Free may preview if supported. |
| Integrations | Google calendar sync, if referenced | Future | Future | Future or Upsell | Upsell | Include | Referenced as a decision question, not confirmed implemented | Future integration tier unclear | Medium | Should integrations be Large Club only? | Keep as Future unless implementation exists. |
| Notifications | Notifications/email/app preferences, if referenced | Include | Include | Include | Include | Include | Function-specific checks exist for email/push, no central notification tier | Safety/preference features should not be premium-only | Medium | Define notification channel limits | Preferences and opt-outs must be core. Automation can be premium. |
| Platform | Platform admin controls | Hidden | Hidden | Hidden | Hidden | Hidden | Super admin only, outside customer tier model | Should not be sold as club tier access | High | No customer tier decision unless admin override policy changes | Keep outside commercial plan matrix. |
| Support | Support levels | Community/self serve | Standard | Standard or faster | Priority | Dedicated | Not code-enforced feature in audit | Commercial/service decision | High | Define support promises | Higher tiers should sell support confidence. |
| Services | Assisted setup | Exclude | Upsell | Upsell | Upsell | Include | Service feature, not code-gated | Commercial decision | High | Confirm Large Club only or paid add-on | Fits Large Club. |
| Services | Data migration | Exclude | Upsell | Upsell | Upsell | Include | Service feature, not code-gated | Commercial decision | High | Confirm Large Club only or paid add-on | Fits Large Club. |
| Services | Custom onboarding | Exclude | Upsell | Upsell | Upsell | Include | Service feature, not code-gated | Commercial decision | High | Confirm Large Club only or paid add-on | Fits Large Club. |
| Integrations | Integrations | Future | Future | Future or Upsell | Upsell | Include | Not confirmed as implemented tier feature | Future pricing risk | Medium | Should integrations be Large Club only? | Keep where available and clearly scoped. |
| Services | Rollout planning | Exclude | Exclude | Upsell | Upsell | Include | Service feature, not code-gated | Commercial decision | High | Confirm Large Club inclusion | Fits negotiated tier. |
| Trial/demo | Demo/trial access | Include | Include | Include | Include | Include | Trialing/comped/test flows exist | Product model needs final definition | Medium | Define Free vs trial vs demo | Keep separate from paid feature ownership. |

## 5. Features that must stay safety/core across all relevant tiers

These should not be treated as premium upsells:

- Safeguarding controls.
- Secure access.
- Essential role permissions.
- Parental consent and visibility where parent features exist.
- Basic account protection.
- Data export and deletion rights required for user, account, or data protection.
- Basic safety and security auditability.
- Reliable backup and recovery expectations where operationally required.
- Notification preferences, opt-outs, and consent controls.

Current code areas to watch:

- `src/lib/plans.js` currently has a premium `auditLogs` flag. That may be fine for full operational audit logs, but safety/security auditability should be separated from premium activity history.
- `src/lib/login-pricing.js` says Individual includes "Family portal". If Free only has preview, copy and gating need a separate preview concept.
- `src/app/router.jsx` and parent RPC migrations already enforce parent scoping. These visibility and consent protections should follow the parent feature wherever it exists.
- `netlify/functions/send-parent-email.js` gates parent email and PDF reports. That is a premium communication/reporting feature, not a reason to hide basic legal visibility or data rights.
- Supabase RLS and RPC checks should protect data access for every tier, regardless of whether premium operational exports exist.

## 6. Recommended tier positioning

### Individual Coach Free

Who it is for: One coach trying Football Player with a small number of players.

What it should unlock: Basic player records, development notes, goals, limited history, account safety, secure access, and a family portal preview if Steve wants that in the funnel.

What it should not unlock: Full parent communication, parent email workflows, PDF reports, attachments, full history, proper team calendar, multi-staff operation, or club oversight.

What causes upgrade: More than 5 players, multiple staff, parent communication, PDF reports, attachments, full history, or proper calendar.

Why the tier is commercially fair: A coach can test the core idea without the operational value becoming free forever.

Risk if it includes too much: Free becomes a viable small-team product and weakens Single Team conversion.

Risk if it includes too little: Coaches cannot understand the product value before paying.

### Single Team

Who it is for: One real team that wants Football Player to run weekly development, parent communication, and team operations.

What it should unlock: The complete one-team product: 1 team, up to 5 staff, up to 30 players, full history, assessments, parent portal, parent emails, PDF reports, attachments, team calendar/events, basic logo branding, and basic activity log.

What it should not unlock: Multi-team club oversight, club-wide calendar, shared report templates, full audit log, advanced analytics, scheduled parent reports, integrations, migration, or dedicated support.

What causes upgrade: A second team, club admin control, shared branding, shared templates, club-wide calendar, or multi-team oversight.

Why the tier is commercially fair: It gives one team the product they thought they bought while reserving club organisation and automation for higher tiers.

Risk if it includes too much: Small Club loses its reason to exist.

Risk if it includes too little: The main paid plan feels crippled and harms trust.

### Small Club

Who it is for: A small club running multiple teams and needing shared setup, governance, and oversight.

What it should unlock: Up to 5 teams, club administrator access, shared player oversight, staff roles, bulk invites/imports if implemented, club-wide calendar, shared report templates, custom colors and branding, full audit log, and basic club analytics.

What it should not unlock: Advanced development pathways, coach handovers, scheduled review cycles, custom report templates, club-wide export packs, scheduled parent reports, integrations, migration, or dedicated support.

What causes upgrade: More than 5 teams, advanced development operations, scheduled review cycles, custom report templates, advanced analytics, scheduled parent reports, or priority support needs.

Why the tier is commercially fair: It sells club-level organisation rather than withholding basic team value.

Risk if it includes too much: Development Club has weak differentiation.

Risk if it includes too little: Multi-team clubs may feel forced into a high tier before they need advanced development maturity.

### Development Club

Who it is for: Clubs that want player development maturity across squads, not just admin scale.

What it should unlock: Up to 10 teams, advanced development analytics, player pathways across teams, coach handovers, scheduled review cycles, custom assessment/report templates, club-wide exports, scheduled parent reports, and priority support.

What it should not unlock: Unlimited/negotiated scale, data migration, custom onboarding, bespoke integrations, dedicated contact, or rollout planning unless Steve decides otherwise.

What causes upgrade: More than 10 teams, migration, integrations, bespoke onboarding, rollout support, dedicated contact, or agreed service terms.

Why the tier is commercially fair: It charges for automation, analytics, and development operations that create club-wide value.

Risk if it includes too much: Large Club becomes only a support label.

Risk if it includes too little: The new tier does not justify adding a fifth commercial plan.

### Large Club

Who it is for: Larger clubs or organisations that need operational confidence, rollout help, migration, integrations, or bespoke service terms.

What it should unlock: More than 10 teams, negotiated limits, assisted setup, data migration, custom onboarding, bespoke branding, integrations where available, dedicated support contact, rollout planning, and agreed service terms.

What it should not unlock: Safety basics that should exist in every relevant tier.

What causes upgrade: Organisational scale, implementation risk, integration needs, migration needs, or service-level expectations.

Why the tier is commercially fair: It sells support, migration, rollout, and operational confidence.

Risk if it includes too much: Lower tiers may look incomplete.

Risk if it includes too little: Large organisations may not see enough value to accept a negotiated plan.

## 7. Current audit mismatch list

- Public Individual pricing says "Family portal", but parent portal is not clearly tier-gated as a plan feature. Evidence: `src/lib/login-pricing.js`, `src/app/router.jsx`.
- Checkout currently supports only Single Team and Small Club. Evidence: `netlify/functions/create-checkout-session.js`.
- Current code has four plan keys, while Steve's proposal has five commercial tiers.
- Development Club does not currently appear as a plan key in the completed audit.
- Unknown plan keys currently fall back to Small Club in JavaScript. Evidence: `src/lib/plans.js`.
- Calendar is not clearly tier-owned. Evidence: `src/lib/domain/calendar-events.js`, `supabase/migrations/20260609104500_restrict_calendar_club_events.sql`.
- Match day is not clearly tier-owned. Evidence: `src/app/router.jsx`, `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql`.
- Parent portal is not clearly tier-owned. Evidence: `src/app/router.jsx`, parent RPC migrations.
- Mobile/PWA/native app access is not clearly tier-owned by the current web plan model.
- Activity logs need separation between basic safety/security auditability and the full operational audit log.
- Current Single Team price and limits do not match Steve's proposed price and limits.
- Current Small Club price and team limit do not match Steve's proposed price and limit.
- Reports and exports need separation between required data rights and premium operational reports.
- Upgrade prompts exist for central plan flags, but several role/readiness-gated modules do not produce clear commercial upgrade prompts.
- Public pricing can imply a richer tier map than the current central `PLAN_OPTIONS` feature set provides.

## 8. Product decisions Steve must make

- [ ] Should the code add a new Development Club plan key?
- [ ] Should Large Club remain a normal selectable checkout tier or become contact/negotiated?
- [ ] Should Individual be a real tier or a free starter/demo plan?
- [ ] What exactly does Family portal preview mean on Free?
- [ ] Should full Parent Portal start at Single Team?
- [ ] Should parent emails and PDF reports start at Single Team?
- [ ] Should attachments start at Single Team?
- [ ] Should basic logo branding start at Single Team?
- [ ] Should full audit log start at Small Club?
- [ ] Should advanced analytics start at Development Club?
- [ ] Should reports/exports start at Development Club?
- [ ] Should scheduled parent reports start at Development Club?
- [ ] Should integrations be Large Club only?
- [ ] Should unknown plan keys fail closed?
- [ ] Should checkout support every public paid plan before launch?
- [ ] Should Single Team limits change to 5 staff and 30 players?
- [ ] Should Small Club limits change to 5 teams?
- [ ] Should Development Club have up to 10 teams?
- [ ] Should Free have limited history, and what exact history limit should apply?
- [ ] Should basic activity log be a visible product feature or only a safety/security backend capability?

## 9. Later implementation implications

Do not implement these until Steve signs off.

Likely implementation work:

- Plan registry update to represent the final commercial tier set.
- Tier key normalization across JavaScript, Netlify functions, Stripe mapping, and Supabase plan checks.
- Fail-closed unknown plan handling if Steve approves.
- Central feature access map covering scale, oversight, automation, support, route visibility, server enforcement, and public copy.
- Route, navigation, UI gating, and paywall prompt alignment in `src/app/router.jsx`, `src/components/layout/Sidebar.jsx`, and page-level guards.
- Netlify function enforcement alignment for email, PDF, checkout, scheduled emails, team management, platform billing, and any future export/report functions.
- Supabase RLS/RPC alignment for plan features, limits, parent visibility, calendar, match day, polls, auditability, and data rights.
- Paywall prompt copy alignment so users see clear upgrade reasons for commercial gates.
- Public pricing copy alignment in `src/lib/login-pricing.js` and `src/pages/PublicPricingPage.jsx`.
- Stripe checkout product and price alignment only after tier names, prices, and checkout availability are approved.
- Tests for each tier, including positive and negative access tests.
- Hostile direct-route and direct-function access tests.
- A migration/backfill plan for existing clubs if plan keys, limits, or fallback behavior changes.

## 10. Recommended implementation sequence after Steve signs off

### Phase 1: plan naming and fail-closed safety

- Decide final plan keys.
- Decide whether `development_club` exists.
- Decide whether unknown keys fail closed.
- Define legacy plan migration behavior.

### Phase 2: central tier/feature access map

- Create one source of truth for capabilities, tier access, role access, and enforcement expectations.
- Include safety/core features separately from premium commercial features.
- Map JavaScript feature keys to Supabase feature keys in one place.

### Phase 3: UI/nav/route/paywall alignment

- Align route guards, sidebar visibility, disabled states, and page notices.
- Replace ambiguous role/plan blocks with clear copy where the block is commercial.
- Keep safety and permission failures separate from paid upgrade prompts.

### Phase 4: server/API/RLS alignment

- Align Netlify functions with the final feature map.
- Align Supabase RLS/RPC functions with the final tier model.
- Keep direct-route and direct-function access hostile-tested.

### Phase 5: public pricing and Stripe checkout alignment

- Update public copy only after Steve signs off.
- Add or remove checkout support according to final tier decisions.
- Keep Large Club contact/manual if it remains negotiated.

### Phase 6: tests and hostile access verification

- Add tier matrix tests for all plan keys.
- Add route/nav tests.
- Add Netlify function tests for feature access.
- Add Supabase/RLS verification where practical.
- Add negative tests for unknown plan keys if fail-closed behavior is approved.

### Phase 7: production deploy only after Steve approval

- Run the agreed validation suite.
- Verify exact build and commit.
- Deploy only after Steve approval.
- Perform post-deploy access checks against the live site.

## Evidence notes

- The source audit is `docs/audits/paywall-feature-access-audit-2026-06-20.md`.
- Central plan model evidence is in `src/lib/plans.js`.
- Public pricing copy evidence is in `src/lib/login-pricing.js` and `src/pages/PublicPricingPage.jsx`.
- Route and navigation evidence is in `src/app/router.jsx` and `src/components/layout/Sidebar.jsx`.
- Netlify plan/function evidence is in `netlify/functions/_plan-gate.js`, `netlify/functions/create-checkout-session.js`, `netlify/functions/send-parent-email.js`, `netlify/functions/manage-scheduled-emails.js`, and `netlify/functions/manage-team.js`.
- Supabase limit, feature, calendar, parent visibility, match day, and audit evidence is in the migrations referenced by the audit, including `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql`, `supabase/migrations/20260609104500_restrict_calendar_club_events.sql`, and `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql`.
- Where this proposal says Unclear, Future, or Upsell, it means the completed audit did not prove a final current tier owner or confirmed implementation state.

## Validation

Docs-only validation to run for this proposal:

- `git diff --check`
