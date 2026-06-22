# Footballplayer.online Paywall, Feature Access, and Tier Audit

Reference: FP-PAYWALL-AUDIT-01

Date: 2026-06-20

Scope: Codebase audit only. No production behavior was changed, no deploy was performed, no Stripe configuration was changed, and no production data was queried or modified.

## 1. Executive summary

The current product has a real tier model, but it is not yet a complete capability registry. The central JavaScript plan model lives in `src/lib/plans.js` and defines four plans, numeric limits, and eight named feature flags. The database also has plan keys, plan status, active access checks, plan limit functions, and RLS or trigger enforcement for selected capabilities. Evidence: `src/lib/plans.js:3`, `src/lib/plans.js:10`, `supabase/migrations/20260506110000_plans_and_onboarding.sql:1`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:1`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:65`.

Gating is scattered. Route access is controlled by React route guard components, navigation visibility is separately filtered in the sidebar, plan features are checked by helper functions in both browser and Netlify functions, and several Supabase migrations enforce limits or feature access at the database layer. Evidence: `src/app/router.jsx:551`, `src/components/layout/Sidebar.jsx:271`, `netlify/functions/_plan-gate.js:209`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:202`.

Biggest commercial risks:

- Public pricing advertises "Family portal" on Individual, but the central plan feature matrix does not contain a parent portal capability and parent portal access is link based rather than plan based. Evidence: `src/lib/login-pricing.js:3`, `src/lib/login-pricing.js:8`, `src/app/router.jsx:842`, `src/app/router.jsx:854`.
- Calendar, polls, match day, parent visibility, mobile push, native apps, and platform feedback are product capabilities but are not priced as plan features in `PLAN_OPTIONS`. Evidence: `src/lib/plans.js:21`, `src/lib/recovery-phase.js:5`, `src/app/router.jsx:909`, `src/app/router.jsx:927`.
- Checkout only supports Single Team and Small Club Stripe price IDs, while the code also names Individual and Large Club plans. Evidence: `netlify/functions/create-checkout-session.js:5`, `netlify/functions/create-checkout-session.js:105`, `src/pages/PublicPricingPage.jsx:121`, `src/pages/PublicPricingPage.jsx:126`.

Biggest security and access risks:

- Most protected SPA routes are client-rendered and must rely on Supabase RLS and Netlify functions for true backend enforcement. Some capabilities have strong backend checks, such as parent email, PDF export, form fields, audit logs, player limits, team limits, and calendar RLS. Other capabilities are more role-gated than tier-gated. Evidence: `src/app/router.jsx:802`, `netlify/functions/send-parent-email.js:253`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:304`, `supabase/migrations/20260609104500_restrict_calendar_club_events.sql:1`.
- Platform admin functions use service role patterns and explicit super admin checks. They are powerful and intentionally outside the club tier model. Evidence: `src/app/router.jsx:1146`, `src/app/router.jsx:1156`, `netlify/functions/manage-platform-admin-staff.js:41`, `netlify/functions/manage-stripe-coupons.js:65`.

Biggest pricing confusion risks:

- The public pricing copy and the actual `PLAN_OPTIONS` mostly align on team, staff, player, email, PDF, branding, themes, and audit logs, but pricing copy mentions Family portal while code does not price or tier-gate the parent portal capability. Evidence: `src/lib/login-pricing.js:1`, `src/lib/plans.js:10`.
- Upgrade messages exist for only the central feature flags and limits. Features outside that list generally redirect, hide, or show recovery/role messages rather than a commercial upgrade prompt. Evidence: `src/lib/plans.js:304`, `src/app/router.jsx:378`, `src/app/router.jsx:902`.

## 2. Current tier model found in code

| Tier or plan name | Price if found | Source file/location | Intended audience if inferable | Notes/confidence |
|---|---:|---|---|---|
| Individual | Free | `src/lib/plans.js:12`, `src/lib/plans.js:14`; `src/lib/login-pricing.js:3` | One coach testing player records with small squad | High. Key is `individual`. Limits: 1 team, 1 staff login, 5 players, 10 monthly evaluations. Most feature flags false. |
| Single Team | GBP 9.99/month | `src/lib/plans.js:33`, `src/lib/plans.js:35`; `src/lib/login-pricing.js:11` | One football group | High. Key is `single_team`. Stripe checkout maps monthly and annual price IDs only by plan name. |
| Small Club | GBP 24.99/month | `src/lib/plans.js:54`, `src/lib/plans.js:56`; `src/lib/login-pricing.js:17` | Several teams with staff access and oversight | High. Key is `small_club`. Default fallback when an unknown plan key is encountered. |
| Large Club | Contact us | `src/lib/plans.js:75`, `src/lib/plans.js:77`; `src/lib/login-pricing.js:23` | Larger clubs, rollout help, custom support | High. Key is `large_club`. Checkout does not create Stripe checkout for this plan, public pricing opens contact/demo flow. |
| Trialing status | No price | `src/lib/plans.js:154`, `netlify/functions/_stripe-billing.js:48`, `netlify/functions/create-checkout-session.js:60` | Trial period for paid checkout | High. Plan access is active when status is `active` or `trialing`; checkout sets 14 trial days. |
| Comped plan | No price | `src/lib/plans.js:164`, `netlify/functions/_plan-gate.js:41`, `src/pages/InformationPage.jsx:131` | Manual or tester access | High. `is_plan_comped` bypasses active billing status unless tester access expired. |
| Payments disabled test flow | No price | `netlify/functions/_stripe-billing.js:79`, `src/pages/PublicPricingPage.jsx:116`, `src/lib/auth.js:818` | Test signup or local/test environment | Medium. Environment flag changes checkout behavior and signup path. |

## 3. Current feature and capability inventory

| Category | Feature/capability | Route/UI location | API/server action if any | Current tier restriction | Current role restriction | Enforcement layer | Paywall/upgrade prompt | Status/confidence | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Billing | Plan active access | Workspace routes | `is_club_plan_access_active` | Active, trialing, or comped required for club workspace | Non-parent club users | Route gate and DB functions | Plan access message | High | `RequireClubWorkspace` requires active plan. Evidence: `src/app/router.jsx:802`, `src/app/router.jsx:623`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:1`. |
| Billing | Checkout | `/pricing`, sign-in return | `create-checkout-session`, `stripe-webhook`, `claim-stripe-checkout` | Single Team and Small Club Stripe checkout only | Public starts checkout; claim requires authenticated user | Netlify and Stripe webhook | Public pricing CTA | High | Individual routes to sign-in; Large Club contact/demo. Evidence: `src/pages/PublicPricingPage.jsx:121`, `src/pages/PublicPricingPage.jsx:126`, `netlify/functions/create-checkout-session.js:5`. |
| Players | Add active player | `/add-player`, `/players/current` | Supabase `players` insert | Individual 5, Single Team 20, Small/Large unlimited, comped unlimited | Team workflow staff; club admin needs team context except calendar | UI limit, domain helper, RLS function | Limit upgrade message | High | Evidence: `src/lib/plans.js:15`, `src/pages/AddPlayerPage.jsx:242`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:102`. |
| Players | Archive and restore | `/archived-players`, player profile | Supabase `players` update, restore trigger | Restore enforces active player plan limit | Staff role rank 20 plus club/team RLS | UI, domain action, DB trigger | Limit upgrade message for add/restore where surfaced | Medium | Evidence: `supabase/migrations/20260507171000_enforce_player_restore_plan_limits.sql:1`, `src/app/router.jsx:1586`. |
| Assessments | Create development record | `/create-evaluation`, `/assess-player/new`, `/create` | `createEvaluation` and Supabase evaluations insert | Individual limited to 10 per month; paid tiers unlimited | Club staff with active plan and team context; parent blocked | Route, helper, RLS | Limit upgrade message | High | Evidence: `src/app/router.jsx:1645`, `src/lib/domain/evaluation-actions.js:33`, `src/lib/domain/evaluation-actions.js:52`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:158`. |
| Assessments | View/edit development records | `/player/:id`, `/assess-player/completed` | Supabase evaluations select/update | Active plan required by workspace route; no specific tier feature | Parent blocked; managers and owners have wider access | Route, permission helper, RLS | No tier prompt | Medium | Evidence: `src/lib/auth-permissions.js:224`, `src/lib/auth-permissions.js:265`, `src/app/router.jsx:1678`, `src/app/router.jsx:1705`. |
| Assessments | Assessment templates/default fields | Form builder and default fields | `form_fields` | Default fields can exist; custom fields gated | Staff role rank varies by route and RLS | UI, helper, RLS | Custom fields upgrade prompt | High | Evidence: `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:245`, `src/components/form-builder/AddFieldSection.jsx:23`. |
| Form builder | Custom development fields | `/form-builder` | `form_fields` insert/update/delete | `customFormFields`: Single Team and above; Large/comped allowed | Team-level staff, not club admin, not parent, not platform admin | Route, sidebar, page, helper, RLS | Yes | High | Evidence: `src/app/router.jsx:968`, `src/app/router.jsx:983`, `src/lib/auth-permissions.js:128`, `src/lib/domain/form-field-actions.js:135`. |
| Calendar | Calendar, training, fixtures, general events | `/calendar`, `/sessions/start`, `/sessions/previous` | `calendar_events`, `assessment_sessions` | No named tier feature beyond active workspace plan | Staff rank 20; club admin can manage club-wide events; parent read via explicit RPC visibility | Route, domain action, RLS | No tier prompt | High | Evidence: `src/app/router.jsx:1520`, `src/lib/domain/calendar-events.js:79`, `supabase/migrations/20260609104500_restrict_calendar_club_events.sql:1`. |
| Calendar | Club-wide events | `/calendar` | `calendar_events` with `team_id is null` | No named tier feature | Club admin only for null team events | Domain and RLS | No tier prompt | High | Evidence: `supabase/migrations/20260609104500_restrict_calendar_club_events.sql:11`, `src/lib/domain/calendar-events.js:196`. |
| Calendar | Recurring events | `/calendar` form | `calendar_events` rows | No named tier feature | Same as calendar events | UI/domain, RLS | No tier prompt | Medium | Evidence: `src/pages/SessionsPage.jsx:230`. |
| Parent communication | Parent email send | Create evaluation, player profile, email queue | `send-parent-email`, scheduled queue | `parentEmail`: Single Team and above; demo account blocked | Staff role rank 20 for queue, sender email must match login | UI, Netlify function, plan gate | Yes | High | Evidence: `src/pages/CreateEvaluationPage.jsx:1608`, `netlify/functions/send-parent-email.js:253`, `netlify/functions/send-parent-email.js:277`. |
| Parent communication | PDF export/attachments | Development record email/PDF | `send-parent-email` PDF path | `pdfExport`: Single Team and above | Same as email/share | Netlify plan gate | Yes via feature copy | High | Evidence: `netlify/functions/send-parent-email.js:316`, `netlify/functions/send-parent-email.js:318`, `src/lib/plans.js:21`. |
| Parent portal | Parent login and family portal | `/parent-login`, `/parent-portal`, `/parent-messages`, `/parent-polls`, `/friends-family` | Parent RPCs for calendar, polls, messages, match day | No central tier feature; requires active parent link | `parent_portal` account with active link | Route, parent intent, Supabase RPCs | No tier prompt | High | Evidence: `src/app/router.jsx:842`, `src/app/router.jsx:854`, `src/app/router.jsx:1443`, `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql:95`. |
| Parent portal | Parent invites/linking | `/parent-linking`, `/parent-invite/:token` | `parent_player_links`, invite functions | Not a named tier feature; parent email sending is tier-gated when emailing invites | Staff access for linking; parent invite token for acceptance | Route, RLS/RPC, Netlify send gate | Indirect parentEmail prompt for emailing | Medium | Evidence: `src/app/router.jsx:865`, `src/app/router.jsx:1600`, `netlify/functions/send-parent-portal-invite.js:127`. |
| Polls | Availability and parent polls | `/polls`, `/parent-polls` | `polls`, `poll_votes`, parent poll RPC | No named tier feature | Staff can manage, parent can vote through RPC | Route, domain action, RLS/RPC | No tier prompt | High | Evidence: `src/app/router.jsx:909`, `src/lib/domain/polls.js:140`, `src/lib/domain/polls.js:410`. |
| Match day | Fixtures, live score, MOTM, availability | `/match-day`, parent portal | `match_days`, availability and scorer RPCs, push functions | No named tier feature | Staff rank 20 with team context, not club admin without team, not parent for staff view | Route, domain, RLS/RPC | No tier prompt | High | Evidence: `src/app/router.jsx:927`, `src/app/router.jsx:1720`, `src/lib/auth-permissions.js:214`, `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql:157`. |
| Team setup | Team creation and team settings | `/teams` | `manage-team`, Supabase `teams` | Individual and Single Team 1 team, Small Club 10, Large/comped unlimited | Club admin or super admin | Route, Netlify function, DB function | Limit upgrade message | High | Evidence: `src/app/router.jsx:1060`, `netlify/functions/manage-team.js:60`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:24`. |
| Staff management | User access, staff invites | `/user-access`, `/teams` staff sections | `club_user_invites`, staff account functions | Individual 1 login, Single Team 3, Small/Large unlimited | Super admin or rank 50 plus role hierarchy | Route, UI limit, helper, RLS | Limit upgrade message | High | Evidence: `src/lib/auth-permissions.js:81`, `src/pages/UserAccessPage.jsx:180`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:230`. |
| Club setup | Club profile | `/club-settings` | `clubs` update, storage logo | Basic branding Single Team and above; approval workflow Small Club and above | Club admin only | Route, helper, trigger/RLS | Yes for branded fields | High | Evidence: `src/app/router.jsx:1012`, `src/lib/domain/club-settings-actions.js:41`, `src/lib/domain/club-settings-actions.js:58`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:324`. |
| Branding/theme | Club logo and user/team theme | `/club-settings`, `/user-settings`, team settings | `clubs.logo_url`, `users.theme_*`, `teams.theme_*` | `basicBranding` Single Team and above; `themes` Small Club and above | Club admin for club logo; role/rank for theme areas | UI/helper/DB trigger | Yes | Medium | Evidence: `src/lib/plans.js:42`, `src/lib/plans.js:63`, `src/pages/UserSettingsPage.jsx:382`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:355`. |
| Reports/exports | End of season stats | `/end-season-stats` | `get_end_season_stats` RPC | No named tier feature; active plan required | Rank 50, not parent, not super admin | Route and RPC | No tier prompt | Medium | Evidence: `src/app/router.jsx:1074`, `src/lib/domain/season-stats.js:8`, `src/app/router.jsx:1755`. |
| Audit | Activity log | `/activity-log` | `audit_logs`, `record_backups` | `auditLogs`: Small Club and above; super admin override | Rank 50 or super admin | Route, domain helper, RLS | Sidebar disabled message | High | Evidence: `src/app/router.jsx:1092`, `src/app/router.jsx:1109`, `src/lib/domain/audit.js:129`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:304`. |
| Platform admin | Platform tools | `/platform-admin`, `/platform-clubs`, `/platform-billing-options` | Platform Netlify functions | Outside club plan tier | `super_admin` only | Route and Netlify checks | No | High | Evidence: `src/app/router.jsx:1146`, `src/app/router.jsx:1335`. |
| Platform feedback | Tester/platform feedback | `/platform-feedback`, `/feedback/new` | `tester_feedback_reports` | Recovery hidden from non-super admins for platform feedback; tester feedback not plan gated | Not demo for platform feedback; tester feedback route uses workspace gate with expired tester allowed | Recovery route | No | Medium | Evidence: `src/app/router.jsx:1116`, `src/app/router.jsx:1133`, `src/lib/recovery-phase.js:18`. |
| Notifications/mobile | Parent email queue, mobile push, native apps | Web routes, Netlify push functions, `apps/*` | Push device and notification functions | No named tier feature for mobile or push; parent email feature gates some email paths | Staff or parent context by function | Function-specific checks and app store docs | No | Medium | Evidence: `netlify/functions/send-parent-mobile-push.js:140`, `netlify/functions/send-parent-mobile-push.js:165`, `apps/coach-mobile/STORE_METADATA.md:47`, `apps/parent-mobile/STORE_METADATA.md:47`. |

## 4. Role access matrix

Legend: Allowed = intended route/use allowed by current code; Hidden = navigation hidden or route redirects; Server-enforced = backend/RLS also checks; UI-only = client guard seen but backend tier check unclear; Paywalled = plan feature required; Unclear = scattered or not fully proven in this audit.

| Feature/capability | Platform Admin | Club Admin | Team Admin | Manager | Coach | Assistant Coach | Parent | Public |
|---|---|---|---|---|---|---|---|---|
| Public pricing/features/parents pages | Allowed | Allowed when signed out only | Allowed when signed out only | Allowed when signed out only | Allowed when signed out only | Allowed when signed out only | Allowed when signed out only | Allowed |
| Platform admin dashboard | Allowed, server-enforced | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Blocked |
| Platform billing options/coupons | Allowed, server-enforced | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Blocked |
| Billing page | Allowed | Allowed | Hidden | Hidden | Hidden | Hidden | Hidden | Blocked |
| Coach/workspace home | Redirects to platform admin | Allowed | Allowed | Allowed | Allowed | Allowed | Hidden | Blocked |
| Team management | Hidden | Allowed, server-enforced | Hidden | Hidden | Hidden | Hidden | Hidden | Blocked |
| User/staff access | Allowed | Allowed | Allowed by rank where rank >= 50 | Allowed by rank | Hidden | Hidden | Hidden | Blocked |
| Calendar staff view | Hidden | Allowed for club-wide events | Allowed | Allowed | Allowed | Allowed if rank >= 20 | Hidden | Blocked |
| Sessions/training | Hidden | Needs selected team except calendar | Allowed | Allowed | Allowed | Allowed if rank >= 20 | Hidden | Blocked |
| Player records | Hidden | Needs selected team | Allowed | Allowed | Allowed | Allowed if rank >= 20 | Hidden | Blocked |
| Create development record | Hidden | Needs selected team | Allowed | Allowed | Allowed | Allowed if rank >= 20 | Blocked | Blocked |
| Custom development fields | Hidden | Blocked by current role helper | Paywalled, server-enforced | Paywalled, server-enforced | Paywalled, server-enforced | Paywalled, server-enforced if rank/team | Hidden | Blocked |
| Parent email queue | Hidden | Needs team workflow context | Paywalled, server-enforced | Paywalled, server-enforced | Paywalled, server-enforced | Paywalled, server-enforced if rank/team | Hidden | Blocked |
| Parent email templates | Hidden | Allowed by rank and plan | Paywalled | Paywalled | Hidden | Hidden | Hidden | Blocked |
| Parent linking | Hidden | Allowed when team context resolved | Allowed | Allowed | Allowed | Allowed | Hidden | Invite route public/token-based |
| Parent portal | Hidden | Hidden | Hidden | Hidden | Hidden | Hidden | Allowed with active parent link, server-enforced RPCs | Parent login and invite pages public |
| Polls/availability | Hidden | Allowed if can manage polls | Allowed | Allowed | Allowed | Allowed if rank >= 20 | Parent poll RPC only | Blocked |
| Match day | Hidden | Hidden unless team context path changes | Allowed | Allowed | Allowed | Allowed if rank >= 20 | Parent match day RPC only | Blocked |
| End of season stats | Hidden | Hidden | Allowed by rank | Allowed by rank | Hidden | Hidden | Hidden | Blocked |
| Activity log | Allowed | Paywalled | Paywalled by rank and plan | Paywalled by rank and plan | Hidden | Hidden | Hidden | Blocked |
| Club settings | Hidden | Paywalled for some fields | Hidden | Hidden | Hidden | Hidden | Hidden | Blocked |
| User theme settings | Hidden for club fields | Paywalled for themes | Paywalled for themes | Paywalled for themes | Paywalled for themes | Paywalled for themes | Account settings only unclear | Blocked |

Role evidence: role labels and ranks are normalized in `src/lib/auth-permissions.js:10`, `src/lib/auth-permissions.js:61`, `src/lib/auth-permissions.js:73`, `src/lib/auth-permissions.js:77`, and permission helpers span `src/lib/auth-permissions.js:81` through `src/lib/auth-permissions.js:220`.

## 5. Subscription and tier access matrix

Actual tier names found: Individual, Single Team, Small Club, Large Club. Legacy or unknown tier values fall back to Small Club in JavaScript. Evidence: `src/lib/plans.js:139`.

| Feature/capability | Individual | Single Team | Small Club | Large Club | Unknown/legacy tier |
|---|---|---|---|---|---|
| Active workspace access | Active/trialing/comped required | Active/trialing/comped required | Active/trialing/comped required | Active/trialing/comped required | JS fallback to Small Club if key unknown |
| Teams | 1 | 1 | 10 | Unlimited | Small Club fallback in JS |
| Staff logins | 1 | 3 | Unlimited | Unlimited | Small Club fallback in JS |
| Active players | 5 | 20 | Unlimited | Unlimited | Small Club fallback in JS |
| Monthly development records | 10 | Unlimited | Unlimited | Unlimited | Small Club fallback in JS |
| PDF export | Blocked | Allowed | Allowed | Allowed | Allowed via Small Club fallback |
| Parent email | Blocked, and demo users blocked | Allowed | Allowed | Allowed | Allowed via Small Club fallback |
| Custom development fields | Blocked | Allowed | Allowed | Allowed | Allowed via Small Club fallback |
| Basic branding | Blocked in feature matrix, but `canEditClubIdentity` allows Individual identity editing in one helper | Allowed | Allowed | Allowed | Allowed via Small Club fallback |
| Custom branding | Blocked | Blocked | Allowed | Allowed | Allowed via Small Club fallback |
| Themes | Blocked | Blocked | Allowed | Allowed | Allowed via Small Club fallback |
| Audit logs | Blocked | Blocked | Allowed | Allowed | Allowed via Small Club fallback |
| Approval workflow | Blocked | Blocked | Allowed | Allowed | Allowed via Small Club fallback |
| Calendar/events | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan |
| Polls | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan |
| Match day | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan | Not tier-gated beyond active plan |
| Parent portal | Link-gated, not tier-gated | Link-gated, not tier-gated | Link-gated, not tier-gated | Link-gated, not tier-gated | Link-gated, not tier-gated |
| Mobile/native apps | Not tier-gated in web plan model | Not tier-gated in web plan model | Not tier-gated in web plan model | Not tier-gated in web plan model | Not tier-gated in web plan model |

Tier evidence: central plan options are `src/lib/plans.js:10` through `src/lib/plans.js:96`; database feature mapping is `supabase/migrations/20260508133000_enforce_active_plan_access.sql:88` through `supabase/migrations/20260508133000_enforce_active_plan_access.sql:98`.

## 6. Route protection audit

| Route | Feature | Who should access it based on current code | Direct URL behaviour | Navigation behaviour | Server/API protection | Risk level | Evidence file references |
|---|---|---|---|---|---|---|---|
| `/`, `/login`, `/sign-in` | Public or workspace redirect | Public when signed out; signed-in users redirected to workspace | Client redirect based on auth/session | Public header/pricing | Auth handled by Supabase | Low | `src/app/router.jsx:755`, `src/app/router.jsx:949`, `src/app/router.jsx:1193`. |
| `/features`, `/parents`, `/pricing` | Public marketing/pricing | Public only, signed-in users redirect | PublicOnly guard redirects signed-in users | Public nav | Checkout function for paid CTA | Low | `src/app/router.jsx:1235`, `src/app/router.jsx:1249`, `src/app/router.jsx:1271`. |
| `/staff-invite/:token`, `/club-invite/:token`, `/parent-invite/:token` | Invite acceptance | Token based public pages | Direct route renders invite page | Not generally in app nav | Netlify/Supabase checks in invite flows | Medium | `src/app/router.jsx:1173`, `src/app/router.jsx:1181`, `src/app/router.jsx:1301`. |
| `/parent-login` | Parent auth | Public | Direct route renders parent login | Public parent surfaces | Supabase auth, parent link checks after login | Low | `src/app/router.jsx:1309`. |
| `/parent-portal`, `/parent-messages`, `/parent-polls`, `/friends-family` | Parent portal | Parent account with active link | Parent intent route state if wrong account or no link | Parent sidebar only | Parent RPCs verify active link and auth user | Medium | `src/app/router.jsx:842`, `src/app/router.jsx:1443`, `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql:113`. |
| `/platform-admin`, `/platform-clubs`, `/platform-billing-options` | Platform admin | Super admin only | Non-super admin redirected to workspace | Platform sidebar for super admin | Netlify platform functions also check super admin | Low | `src/app/router.jsx:1146`, `src/app/router.jsx:1335`. |
| `/platform-feedback` | Platform feedback | During recovery, super admin only due module config | Recovery block for others | Hidden for non-visible module | Server table/RLS not fully audited | Medium | `src/app/router.jsx:1116`, `src/lib/recovery-phase.js:18`. |
| `/feedback/new` | Tester feedback | Authenticated users, expired tester not blocked | Direct route allowed after workspace auth | Not central nav | Insert path not tier-gated | Low | `src/app/router.jsx:1133`, `src/app/router.jsx:1388`. |
| `/activity-log` | Audit log | Super admin or rank 50 plus auditLogs plan feature | Redirects if not allowed or not on feature plan | Sidebar hidden or disabled | RLS `audit_logs_select_scoped` | Low | `src/app/router.jsx:1092`, `src/components/layout/Sidebar.jsx:344`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:304`. |
| `/coach` | Workspace home | Active club workspace users, not parent, not super admin | Plan/suspended/test gates before route | Default workspace route | Backend actions separately protected | Medium | `src/app/router.jsx:802`, `src/app/router.jsx:1495`. |
| `/calendar` | Calendar | Active club workspace users with team workflow, club admin exception | Team context gate, recovery gate | Sidebar by team workflow | Calendar RLS | Medium | `src/app/router.jsx:815`, `src/app/router.jsx:827`, `src/app/router.jsx:1520`. |
| `/sessions`, `/sessions/start`, `/sessions/previous` | Sessions and assessment sessions | Team workflow users | Team context gate | Sidebar team workflow | Supabase RLS and domain checks | Medium | `src/app/router.jsx:1531`, `src/app/router.jsx:1542`, `src/app/router.jsx:1553`. |
| `/players`, `/players/current`, `/archived-players`, `/player/:id` | Player records | Team workflow users who can create evaluation | Team context gate | Sidebar team workflow | RLS and plan insert/restore limits | Medium | `src/app/router.jsx:1564`, `src/app/router.jsx:1575`, `src/app/router.jsx:1586`, `src/app/router.jsx:1705`. |
| `/create-evaluation`, `/assess-player`, `/assess-player/new`, `/assess-player/completed`, `/create` | Development records | Team workflow users with active plan | Team context and active plan gate | Sidebar team workflow | RLS, monthly evaluation limit, player limit | Medium | `src/app/router.jsx:1645`, `src/app/router.jsx:1656`, `src/app/router.jsx:1667`, `src/app/router.jsx:1678`, `src/app/router.jsx:1694`. |
| `/parent-linking` | Parent invites/linking | Club staff with active plan and parent link permissions | Redirects if cannot manage parent links | Sidebar by `canManageParentLinks` | Parent link RLS/functions | Medium | `src/app/router.jsx:865`, `src/app/router.jsx:1600`. |
| `/email-queue` | Parent email queue | Club staff rank 20 with `parentEmail` feature | Redirects home if no plan feature | Hidden if no feature | Netlify `send-parent-email` and queue checks | Low | `src/app/router.jsx:887`, `src/app/router.jsx:902`, `src/app/router.jsx:1616`. |
| `/polls` | Availability and polls | Club staff with active plan, rank 20 | Redirects if cannot manage polls | Sidebar by `canManagePolls` | RLS/RPC, no tier feature | Medium | `src/app/router.jsx:909`, `src/app/router.jsx:1632`. |
| `/match-day` | Match day | Team workflow staff rank 20, not club admin without team | Redirects if cannot manage match day | Sidebar by match day permission | RLS/RPC, no tier feature | Medium | `src/app/router.jsx:927`, `src/app/router.jsx:1723`. |
| `/teams` | Team setup | Club admin with active plan | Redirects if not club admin | Sidebar by `canManageTeamSettings` | Netlify and DB plan limit | Low | `src/app/router.jsx:1060`, `src/app/router.jsx:1739`, `netlify/functions/manage-team.js:60`. |
| `/end-season-stats` | Reports | Rank 50, active plan, not parent/super admin | Redirects if cannot view; recovery gate | Sidebar by `canViewEndSeasonStats` | RPC | Medium | `src/app/router.jsx:1074`, `src/app/router.jsx:1755`, `src/lib/domain/season-stats.js:8`. |
| `/user-access` | Staff access | Super admin or rank 50, active plan, Individual un-comped restricted | Redirects if cannot manage users | Sidebar by `canManageUsers` | RLS/helper/staff invite limits | Medium | `src/app/router.jsx:1046`, `src/app/router.jsx:1771`, `src/lib/auth-permissions.js:81`. |
| `/form-builder` | Custom fields | Team-level staff with `customFormFields` | Role unavailable state or redirect | Hidden or disabled with feature message | RLS `can_use_plan_feature` | Low | `src/app/router.jsx:968`, `src/app/router.jsx:1787`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:245`. |
| `/parent-email-templates` | Email templates | Rank 50 with `parentEmail` | Unavailable state if role, recovery, or plan fails | Hidden or disabled | Domain helper checks feature | Low | `src/app/router.jsx:990`, `src/app/router.jsx:1803`, `src/lib/domain/parent-email-templates.js:211`. |
| `/club-settings` | Club settings | Club admin with active plan | Redirects if not club admin | Sidebar by `canManageClubSettings` | Helper and DB trigger for paid fields | Low | `src/app/router.jsx:1012`, `src/app/router.jsx:1819`, `src/lib/domain/club-settings-actions.js:41`. |
| `/billing` | Billing | Super admin or club admin | Recovery hidden for non-super during recovery unless module visible; route blocks non-billing roles | Sidebar by `canViewBilling` | `get-billing-summary` checks caller role/rank | Low | `src/app/router.jsx:1026`, `src/app/router.jsx:1835`, `src/pages/BillingPage.jsx:91`. |

## 7. API/function/server enforcement audit

| Function/action/RPC/service | Feature | Current enforcement | Missing enforcement risk | UI/backend mismatch | Evidence file references |
|---|---|---|---|---|---|
| `create-checkout-session` | Checkout | POST only, payments disabled check, Stripe secret check, plan name to price ID map | Only Single Team and Small Club can checkout; Individual and Large Club are handled outside checkout | Public pricing aligns by redirect/contact, but plan model has four plans | `netlify/functions/create-checkout-session.js:84`, `netlify/functions/create-checkout-session.js:89`, `netlify/functions/create-checkout-session.js:103`. |
| `stripe-webhook` | Billing status updates | Stripe signature, price ID to plan mapping, subscription status normalization | Relies on configured env price IDs | Supports only mapped paid prices | `netlify/functions/stripe-webhook.js:168`, `netlify/functions/_stripe-billing.js:8`. |
| `claim-stripe-checkout` | Signup billing claim | Reads checkout records by session and applies club plan fields | Claim path must match authenticated club profile | Public checkout return depends on this path | `netlify/functions/claim-stripe-checkout.js:49`, `netlify/functions/claim-stripe-checkout.js:93`. |
| `update-platform-club-billing` | Manual platform billing | Super admin check in source search, updates club plan/status/comped fields | Powerful admin function | Outside normal club tier model | `netlify/functions/update-platform-club-billing.js:29`, `netlify/functions/update-platform-club-billing.js:117`. |
| `_plan-gate` | Server plan profile | Validates bearer token, profile membership, suspended account/club, active plan, feature access | Shared helper only where imported | Functions not importing it may rely on custom checks | `netlify/functions/_plan-gate.js:50`, `netlify/functions/_plan-gate.js:127`, `netlify/functions/_plan-gate.js:209`. |
| `send-parent-email` | Parent email and PDF | Requires club plan feature `parentEmail`; PDF attachment requires `pdfExport`; sender email must match request user; demo blocked | Strong feature enforcement | UI checks match server feature checks | `netlify/functions/send-parent-email.js:253`, `netlify/functions/send-parent-email.js:277`, `netlify/functions/send-parent-email.js:316`. |
| `manage-scheduled-emails` and processing | Email queue | Authenticated plan profile and rank check for queue; send step rechecks `parentEmail` | Queue UI and backend align for parent email | No separate tier for scheduling itself | `netlify/functions/manage-scheduled-emails.js:55`, `netlify/functions/manage-scheduled-emails.js:367`. |
| `retry-failed-emails` | Email retry | Source search shows `_plan-gate` import and required feature from payload | Depends on stored payload feature | Likely aligned | `netlify/functions/retry-failed-emails.js:15`, `netlify/functions/retry-failed-emails.js:72`. |
| `manage-team` | Team create/update/delete | Authenticated plan profile, club admin/super admin role check, team limit check | Strong server enforcement for team count | UI and backend both check limits | `netlify/functions/manage-team.js:37`, `netlify/functions/manage-team.js:60`. |
| `createEvaluation` browser domain action | Development record | Demo block, monthly evaluation limit, player limit | Browser action is not the only backend line; RLS also enforces evaluation insert limit | Good alignment | `src/lib/domain/evaluation-actions.js:33`, `src/lib/domain/evaluation-actions.js:52`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:213`. |
| `form_fields` mutations | Custom fields | Browser helper `assertClubFeature` and RLS `can_use_plan_feature` | Strong tier enforcement | UI role helper says rank 20/team, older RLS migration used rank 50 then later migration changed updates to rank 20 | `src/lib/domain/form-field-actions.js:135`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:245`, `supabase/archived-migrations/not-applied-production/20260618103000_player_form_defaults_fitness_numeric.sql:49`. |
| `calendar_events` mutations | Calendar | Domain blocks parent/super admin and rank under 20; RLS restricts team/club-wide event scope | No tier feature for calendar | Pricing may imply calendar broadly, but no commercial gate | `src/lib/domain/calendar-events.js:79`, `src/lib/domain/calendar-events.js:227`, `supabase/migrations/20260609104500_restrict_calendar_club_events.sql:1`. |
| Parent calendar RPC | Parent visibility | Auth user must match active parent link; event must be parent visible and audience allowed | Strong parent scoping | Not tier-gated | `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql:95`. |
| Parent match day RPC | Parent match day | Auth user active parent link; visibility/audience/status checks | Strong parent scoping | Not tier-gated | `supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql:157`. |
| Poll staff actions | Polls | Domain blocks parent and super admin, requires club staff; RLS/RPC handles parent vote | No tier feature | UI route uses role only, no commercial gate | `src/lib/domain/polls.js:140`, `src/lib/domain/polls.js:209`, `src/lib/domain/polls.js:422`. |
| Audit log reads | Activity log | Helper blocks under rank 50 and checks `auditLogs`; RLS checks `can_use_plan_feature` and role rank | Strong tier and role enforcement | UI disabled message aligns | `src/lib/domain/audit.js:129`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:304`. |
| Club settings | Branding and approval | Helper checks `basicBranding` and `approvalWorkflow`; DB trigger enforces same features | Strong for specific fields | UI may show broader Club Settings route to club admin while paid fields fail inline | `src/lib/domain/club-settings-actions.js:58`, `src/lib/domain/club-settings-actions.js:65`, `supabase/migrations/20260507162000_enforce_plan_feature_limits.sql:324`. |
| Supabase plan functions | Limits and features | `can_insert_team_for_plan`, `can_insert_player_for_plan`, `can_insert_evaluation_for_plan`, `can_insert_staff_invite_for_plan`, `can_use_plan_feature` | Coverage limited to named features and limits | Capabilities outside feature names remain unpriced | `supabase/migrations/20260508133000_enforce_active_plan_access.sql:24`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:65`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:102`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:158`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:192`. |

## 8. Paywall prompt audit

| Prompt/location | Message/copy | Tier suggested | Does it match code? | Notes |
|---|---|---|---|---|
| Generic feature upgrade helper | "`<Feature>` is not available in your current billing tier. Upgrade to `<plan>` to `<action>`." | First plan where feature is true | Mostly yes | Applies only to `approvalWorkflow`, `auditLogs`, `basicBranding`, `customBranding`, `customFormFields`, `parentEmail`, `pdfExport`, `themes`. Evidence: `src/lib/plans.js:304`. |
| Generic inactive billing helper | Feature included in current plan, but billing status needs update | Current plan | Yes | Triggered when feature exists but plan status inactive. Evidence: `src/lib/plans.js:310`. |
| Generic limit upgrade helper | Limit reached for current billing tier; upgrade to higher plan | First plan where limit is unlimited | Mostly yes | Used for players, monthly evaluations, teams, staff logins. Evidence: `src/lib/plans.js:317`. |
| Route plan access state | "Plan access needs attention" | Support contact, no plan named | Yes | Active plan gate blocks workspace tools. Evidence: `src/app/router.jsx:356`. |
| Expired tester state | "Workspace access needs review" | Support contact, no plan named | Yes | Tester expiry is a special billing state. Evidence: `src/app/router.jsx:334`. |
| Recovery phase block | "This area is hidden during Phase 1" | No paid tier suggested | Not commercial gating | This is readiness/recovery gating, not pricing. Evidence: `src/app/router.jsx:378`. |
| Form builder unavailable | Team-level role message | No paid tier suggested | Partial | Role failure message appears before custom fields plan check. Evidence: `src/app/router.jsx:397`, `src/app/router.jsx:979`. |
| Email templates unavailable | "not available for your current role or plan" | No plan named | Partial | Blends role and plan. Evidence: `src/app/router.jsx:412`. |
| Sidebar disabled items | Uses `createFeatureUpgradeMessage` for activity log, form builder, parent email templates, email queue | First matching upgrade plan | Yes where item remains visible | Some routes are filtered out entirely before disabled mapping, so users may see no upgrade message. Evidence: `src/components/layout/Sidebar.jsx:344`. |
| Activity Log page notice | Uses audit log upgrade message | Small Club | Yes | Evidence: `src/pages/ActivityLogPage.jsx:174`. |
| Form Builder page notice | Uses custom fields upgrade message | Single Team | Yes | Evidence: `src/pages/FormBuilderPage.jsx:501`. |
| Email Queue page notice | Uses parent email upgrade message | Single Team | Yes | Evidence: `src/pages/EmailQueuePage.jsx:367`. |
| Parent Email Templates page notice | Uses parent email upgrade message | Single Team | Yes | Evidence: `src/pages/ParentEmailTemplatesPage.jsx:302`. |
| Evaluation history card | "Parent and player email is not included in this plan." | No plan named | Accurate but less actionable | Evidence: `src/components/players/EvaluationHistoryCard.jsx:70`. |
| Billing managed setup | Contact support / View pricing | No specific plan | Yes | Evidence: `src/pages/BillingPage.jsx:229`. |

## 9. Public pricing mismatch audit

| Public claim | Source location | Actual code behaviour | Mismatch/risk | Suggested follow-up decision for Steve |
|---|---|---|---|---|
| Individual includes "Family portal" | `src/lib/login-pricing.js:8` | Parent portal is active-link and role gated, not `individual` plan feature gated. Parent link and visibility are controlled by parent RPCs and routes. | High. Could imply free tier includes parent portal capability. | Decide whether parent portal is included in every tier or starts at Single Team/Club. |
| Single Team includes parent email sending and PDF reports/attachments | `src/lib/login-pricing.js:14` | `parentEmail` and `pdfExport` true for Single Team in `PLAN_OPTIONS` and server email checks enforce both. | Low. Mostly aligned. | Keep as is or clarify any sending limits. |
| Single Team includes basic logo branding | `src/lib/login-pricing.js:14` | `basicBranding` true for Single Team; DB trigger blocks logo changes without feature. | Low. Aligned. | Confirm whether team logo/theme is part of basic branding or separate. |
| Small Club includes custom branding and themes | `src/lib/login-pricing.js:20` | `customBranding` and `themes` true only for Small Club and Large Club/comped. | Low. Aligned in plan matrix. | Decide if "custom branding" has enough implemented surface beyond logo/theme. |
| Small Club includes audit logs | `src/lib/login-pricing.js:20` | `auditLogs` true only Small Club/Large/comped; route and RLS enforce. | Low. Aligned. | Keep as premium unless Steve wants all clubs to have audit trail. |
| Large Club includes "More than 10 teams" and custom limits | `src/lib/login-pricing.js:26` | Large Club has null limits in JS; DB functions return true for large club. Checkout does not support direct purchase. | Low. Aligned but manual. | Confirm Large Club remains contact/manual only. |
| Public pricing describes adding more teams, staff, players, parent updates | `src/pages/PublicPricingPage.jsx:199` | Those limits/features exist, but parent portal and match day/polls/calendar are not tiered. | Medium. Broad copy can imply more tier structure than exists. | Decide whether calendar, polls, match day, and parent portal are core or premium. |
| Features page advertises training, fixtures, availability, parent updates, player records, development history | `src/pages/PublicFeaturesPage.jsx:111` | Implemented but not all priced or tier-gated. | Medium. Marketing broadness is okay, but tier mapping is unclear. | Decide which marketed modules belong in each paid tier. |
| Parents page says club controls parent updates | `src/pages/PublicParentsPage.jsx:76` | Parent portal visibility is explicit and scoped by link/RPC. | Low. Accurate access model, but not tied to tiers. | Decide if parent portal is bundled or add-on. |
| "Early club pricing may change" | `src/pages/PublicPricingPage.jsx:202` | Accurate risk language. | Low. Good caveat for current state. | Keep until tier decisions are final. |

## 10. Findings grouped by severity

### Critical

None confirmed in this static audit. I did not find an obvious route that intentionally exposes platform admin or parent portal staff tools to the wrong role in the current router and helper layer.

### High

- No central capability registry exists for the intended SaaS capability model. Current plan flags cover only eight features and four limits. Evidence: `src/lib/plans.js:21`, `src/lib/plans.js:42`, `src/lib/plans.js:63`, `src/lib/plans.js:84`.
- Public Individual pricing claims Family portal, but parent portal is not represented in the plan feature matrix. Evidence: `src/lib/login-pricing.js:8`, `src/lib/plans.js:21`, `src/app/router.jsx:842`.
- Several commercially important modules are role/readiness gated but not tier-gated: calendar, recurring events, polls, match day, parent portal, reports, native/mobile, and platform feedback. Evidence: `src/lib/recovery-phase.js:5`, `src/app/router.jsx:909`, `src/app/router.jsx:927`, `src/app/router.jsx:1074`.
- Direct checkout is configured only for Single Team and Small Club. Evidence: `netlify/functions/create-checkout-session.js:5`, `netlify/functions/create-checkout-session.js:105`.

### Medium

- Upgrade prompts are inconsistent. Some features show explicit upgrade copy, while route-level blocks often redirect or show role/recovery messages. Evidence: `src/components/layout/Sidebar.jsx:344`, `src/app/router.jsx:902`, `src/app/router.jsx:1005`.
- Some feature names differ between JavaScript camelCase and database snake_case, which raises maintenance risk. Evidence: `src/lib/plans.js:21`, `supabase/migrations/20260508133000_enforce_active_plan_access.sql:88`.
- `getPlanKey` falls back to Small Club for unknown keys, which is helpful for continuity but risky if legacy/unknown values should fail closed. Evidence: `src/lib/plans.js:139`.
- Basic branding has a potential conceptual mismatch: `features.basicBranding` is false for Individual, but `canEditClubIdentity` returns true for Individual in one helper path. Evidence: `src/lib/plans.js:21`, `src/lib/plans.js:205`, `src/lib/plans.js:220`.
- Club admin access is intentionally restricted from some team workflow paths unless a team context exists, while calendar club-wide events have a special exception. This is reasonable but can confuse commercial role wording. Evidence: `src/app/router.jsx:827`, `src/lib/auth-permissions.js:243`.

### Low

- Recovery-phase gating is separate from commercial gating and currently hides later modules like billing and activity log for non-platform users during Phase 1. Evidence: `src/lib/recovery-phase.js:3`, `src/lib/recovery-phase.js:5`.
- Public pricing and plan matrices mostly align for teams, staff, players, parent email, PDF, branding, themes, and audit logs. Evidence: `src/lib/login-pricing.js:1`, `src/lib/plans.js:10`.
- Billing page clearly treats unmanaged/comped setups as contact-support flows. Evidence: `src/pages/BillingPage.jsx:229`.

### Product decision needed

- Decide parent portal tier access, especially whether parents are included in all paid tiers, the free tier, or only paid team/club tiers.
- Decide whether calendar, recurring events, fixtures, polls, match day, availability, reports, exports, branding/theme, and integrations are core or premium capabilities.
- Decide whether platform admins can override club feature access beyond current super admin and service role behavior.
- Decide whether demo/free access should remain and what it can do.

### Clean-up only

- Align public plan copy with exact capability terms once Steve decides the tier matrix.
- Consider naming feature keys consistently across JS and SQL or introducing a single registry that emits both.
- Consider replacing route redirects for tier failures with explicit upgrade states where commercially useful.

## 11. Recommended next steps

### Immediate safety fixes

1. Decide whether unknown or legacy plan keys should continue falling back to Small Club or fail closed.
2. Add explicit tests or a small audit script that enumerates route guards, sidebar visibility, and plan feature keys.
3. Review the Individual "Family portal" pricing claim before any sales push.

### Pricing/tier decision work

1. Build a Steve-owned tier decision matrix for every capability in this audit.
2. Decide the parent portal rule first, because it affects pricing, onboarding, parent invites, email, match day, and mobile.
3. Decide whether calendar, match day, polls, reports/exports, and integrations are core, premium, or club-only.

### Central gating cleanup

1. Create a central capability registry with category, group, capability key, readiness, tier access, role access, route visibility, API enforcement, audit requirement, setup requirement, and payment requirement.
2. Make route guards and sidebar visibility consume the same registry where practical.
3. Map JavaScript feature keys to SQL feature keys in one place.

### Public pricing copy cleanup

1. Replace broad feature bullets with exact tier promises after Steve approves tier ownership.
2. Add "included in all paid plans" or "Club tier" language for parent portal, calendar, match day, and reports once decided.
3. Keep Large Club as contact/manual unless Stripe price IDs are added.

### Future V2 feature registry work

1. Add database-backed club feature overrides for pilot customers.
2. Add platform admin override views with audit logging.
3. Add automated mismatch tests for pricing copy, central feature matrix, route guards, and backend enforcement.

## 12. Open questions for Steve

1. Which tier gets parent portal access?
2. Are parents included in all paid tiers, included in Individual, or only available from Single Team upward?
3. Are calendar, fixtures, training events, recurring events, and club-wide events core or premium?
4. Are player notes and player records core or premium?
5. Are assessments and monthly development record limits correct for Individual?
6. Are custom assessment templates and custom form fields part of Single Team or Club?
7. Should parent email, scheduled email, PDF attachments, and reports/exports all be in the same paid tier?
8. Should end of season stats be premium?
9. Should club-wide features require Club tier rather than Single Team?
10. Should branding/theme controls remain split between basic branding and themes?
11. Are integrations such as Google calendar sync planned, and should integrations be premium?
12. Should mobile/native app access be included in all paid plans or gated separately?
13. Can platform admin override club feature access, and should that be audited as a separate event?
14. Should demo/free access exist after launch, and what should it be allowed to do?
15. Should unknown/legacy tier values fail closed instead of defaulting to Small Club?

## Validation run

Safe validation completed for this audit:

- `npm.cmd run build` passed, including `postbuild` and `scripts/verify-web-build-env.mjs`.
- `node --test tests\live-qa-hardening.test.mjs tests\hidden-recovery-gates.test.mjs tests\hidden-feature-batch1-resurface.test.mjs tests\hidden-feature-batch2-resurface.test.mjs tests\hidden-feature-batch3-resurface.test.mjs tests\hidden-feature-batch4-resurface.test.mjs tests\system-support-email-gating.test.mjs tests\matchday-navigation-access.test.mjs tests\parent-data-safety.test.mjs tests\parent-portal-ux.test.mjs tests\parent-portal-branding.test.mjs` passed with 83 tests, 0 failures.
- `rg` searches were run for plan, tier, subscription, billing, stripe, price, paywall, upgrade, locked, feature, role, permission, module, gate, trial, demo, parent, club admin, platform admin, coach, manager, RLS, and policy terms.

No production deploy was performed.
