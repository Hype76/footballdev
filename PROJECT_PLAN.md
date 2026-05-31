# Football Player Staged Recovery and Rebuild Plan

Reference: FOOTBALL-PLAN-01

This document is the single source of truth for the staged recovery and rebuild of Football Player. It is a planning and verification document only. It must not be treated as approval to change live data, deploy live code, or expose unfinished modules to normal users.

## 1. Product Summary

Football Player is a football-only club operating system for youth and grassroots clubs. It helps clubs manage their weekly football work in one place: club setup, teams, staff, players, training sessions, assessments, parent communication, availability, match day, and billing.

The primary customer is a football club or academy that needs a trusted digital workspace for coaches, managers, parents, and club administrators.

Primary user roles:

- Platform Admin: manages clubs, billing options, tester access, platform staff, and platform-level operations.
- Club Admin: owns the club workspace, club settings, branding, staff access, team creation, billing, and club-wide setup.
- Team Admin or Manager: operates one or more assigned teams, adds staff and players, runs sessions, prepares match day, and manages team workflows.
- Coach: performs football work for assigned teams, including sessions, attendance, notes, and assessments.
- Parent or Guardian: views parent portal information, messages, polls, availability requests, match updates, and player feedback for linked children.
- Adult Player: may receive direct communication or availability requests where the player is old enough to manage their own access.

Core value proposition:

Football Player should give a club a trusted football workspace that is easier to operate than scattered spreadsheets, WhatsApp groups, paper assessments, and disconnected payment or parent tools. The platform must feel role-specific, safe, and obvious: each user should see only the work they can actually do.

## 2. Environment Map

Production and staging are separate boundaries. Recovery work must stay on staging Netlify and test Supabase until the user explicitly approves promotion.

| Boundary | Current evidence | Rule |
| --- | --- | --- |
| Production Netlify | `netlify.toml` has `[context.production]` using `npm run build:live && npm run verify:build-env`. Existing production URL is documented in `docs/live-backup-baseline-2026-05-25.md`. | Do not deploy to production during recovery unless explicitly approved. |
| Staging Netlify | `netlify.toml` branch and deploy preview contexts use `npm run build:staging && npm run verify:build-env`. Staging URLs and deploy evidence are documented in `docs/staging-verification-2026-05-27.md`. | All recovery builds and user review deployments belong here. |
| Live Supabase | `.env.production` points at the live Supabase project. Live project baseline is documented in `docs/live-backup-baseline-2026-05-25.md`. | Do not write to live Supabase during recovery. Do not copy staging data into live. |
| Test Supabase | `.env.staging` and the baseline doc identify the test Supabase project used by staging. | Use this database for recovery testing, seed data, route audits, and role verification. |

Existing docs supporting the boundary:

- `docs/live-backup-baseline-2026-05-25.md`
- `docs/staging-verification-2026-05-27.md`
- `netlify.toml`
- `.env.production`
- `.env.staging`
- `scripts/verify-web-build-env.mjs`

Hard recovery rule:

No production deploys, no live database writes, no live migration runs, and no staging-to-live data copies until the staged plan is verified and the user explicitly approves promotion.

Netlify deploy safety rule:

Before any Netlify deploy command, run `npm run check:netlify-deploy-safety` and print the deployment target evidence. The output must include the current git branch, target branch, Netlify site id when available, deploy context, intended URL or context, whether the command can trigger production, whether `main` is involved, and whether the live Supabase ref could be used.

The safety check must stop the work when any of these are true:

- Target branch is `main`.
- Deploy context is `production`, unless the user explicitly approved a production deploy in that exact prompt.
- The live Supabase ref `hvapkizujvsahvgspser` appears in the staging build or staging deploy target.
- The staging Supabase ref `llpufwzvgxyczxcjwupu` is not proven for staging.
- Netlify CLI cannot prove the target context.
- A staging deploy targets anything other than `football-os-staging`, unless the user explicitly approves another staging branch in that exact prompt.
- The command uses `--prod` during staging work.

Known deploy ambiguity:

An earlier `netlify deploy --trigger` attempt with a branch context republished the existing `main` commit in production context. It did not deploy staging setup-guide work to live and did not touch live Supabase, but it proved the CLI trigger path is unsafe for staging work unless the target context is independently proven. Future staging work must use the safety check first and must not use `netlify deploy --trigger` when the intended result is a staging branch deploy.

## 3. Current App Inventory

### Web App Areas

The web app is a React and Vite app under `src`. The route tree in `src/app/router.jsx` includes:

- Public landing and public marketing pages: `/`, `/login`, `/features`, `/parents`, `/pricing`, `/gdpr`, `/terms`
- Authentication and recovery: `/sign-in`, `/reset-password`
- Invite flows: `/staff-invite/:token`, `/club-invite/:token`, `/parent-invite/:token`, legacy `/invite/:token`
- Club workspace home: `/coach`
- Club and user setup: `/club-settings`, `/user-access`, `/teams`, `/billing`
- Player workflows: `/add-player`, `/players`, `/players/current`, `/archived-players`, `/player/:id`
- Session workflows: `/sessions`, `/sessions/start`, `/sessions/previous`
- Development and assessment workflows: `/form-builder`, `/create-evaluation`, `/assess-player`, `/assess-player/new`, `/assess-player/completed`, `/create`
- Parent workflows: `/parent-login`, `/parent-portal`, `/parent-messages`, `/parent-polls`, `/friends-family`, `/parent-linking`, `/parent-email-templates`
- Availability and match workflows: `/polls`, `/match-day`, `/end-season-stats`
- Operations: `/email-queue`, `/activity-log`, `/information`, `/platform-feedback`
- Platform admin: `/platform-admin`, `/platform-clubs`, `/platform-billing-options`

### Mobile App Areas

Mobile code exists under `apps`:

- `apps/coach-mobile`: Expo app for coach and staff workflows.
- `apps/parent-mobile`: Expo app for parent portal workflows.
- `apps/mobile-core`: shared mobile auth, routes, Supabase, notifications, UI, data, profile, parent links, biometrics, assessments, and actions.
- `apps/scripts`: mobile preflight, release, EAS, reviewer, screenshot, store, and evidence scripts.

Mobile documentation includes:

- `apps/MOBILE_RELEASE_PHASES.md`
- `apps/MOBILE_RELEASE_STATUS.md`
- `apps/MOBILE_PRE_STORE_QA.md`
- `apps/MOBILE_NOTIFICATION_RUNBOOK.md`
- `apps/MOBILE_ENVIRONMENT_RUNBOOK.md`
- `apps/MOBILE_DEVICE_TESTING.md`
- `apps/MOBILE_REVIEWER_HANDOFF.md`
- `apps/coach-mobile/README.md`
- `apps/parent-mobile/README.md`

### Netlify Functions

Serverless functions exist under `netlify/functions`. Current function areas include:

- Supabase, billing, plan gates, and Stripe helpers.
- Platform admin access, club creation, club management, club deletion support, tester access codes, platform admin staff.
- Staff invite, club owner invite, staff account creation, parent account creation, password reset.
- Parent portal invite, parent email, parent push subscription, parent mobile push.
- Match day availability requests and confirmations, coach and match day push.
- Scheduled email processing, retry failed emails, email log storage.
- PDF rendering, demo reset, contact and demo requests.

This is a broad operational surface and must be verified module by module before normal users are asked to rely on it.

### Supabase Migration Footprint

The repository currently contains 126 Supabase migration files under `supabase/migrations`. The migration footprint covers:

- Multi-tenant auth and role setup.
- User profiles, club memberships, platform admin identity, and role policies.
- Form fields, assessments, assessment sessions, player records, archived players, staff notes, and voice notes.
- Club settings, logos, team records, team staff, team plan limits, and billing gates.
- Parent contacts, parent portal links, parent invites, parent messages, parent polls, friends and family links.
- Email logs, templates, scheduled email queue, duplicate-send protection, and recipient event tracking.
- Polls, availability, match day, player of the match, end of season stats, and push devices.
- Workspace onboarding state, club owner invites, first-run team creation, and large-club team creation fixes.

There is one Supabase Edge Function visible at `supabase/functions/create-staff-user/index.ts`.

### Existing Docs, Runbooks, and Checklists

Existing documentation:

- `README.md`: still mostly default Vite template content and not a product runbook.
- `docs/live-backup-baseline-2026-05-25.md`
- `docs/staging-verification-2026-05-27.md`
- Multiple mobile release and store-readiness docs under `apps`.

### Existing Scripts and Gates

Important scripts in `package.json` and `scripts`:

- `npm run build`
- `npm run build:live`
- `npm run build:staging`
- `npm run verify:build-env`
- `npm run audit:staging-clicks`
- `npm run lint`
- `npm run preview`
- Mobile gates such as `mobile:doctor`, `mobile:preflight`, `mobile:release-check`, `mobile:build:preflight`, `mobile:reviewer:preflight`, `mobile:store:preflight`, and store build or submit commands.

The `postbuild` hook runs `scripts/verify-web-build-env.mjs`, which is an important guard against building the wrong Supabase target.

## 4. Trust Status

| Area | Current confidence | Why | Required verification |
| --- | --- | --- | --- |
| Environment separation | partial | Netlify contexts and env files show live versus staging separation, and docs record the boundary. Recent work has included both staging and live deployment, so future work needs discipline. | Run build-env verification for every deploy target. Capture asset checks proving staging bundles use test Supabase and live bundles use live Supabase. |
| Public web pages | partial | Routes exist and have previously smoke-tested, but product copy and conversion paths are not the recovery priority. | Browser route check for public pages, console errors, auth redirects, and mobile layout. |
| Auth and workspace shell | risky | Recent user feedback reported flashing routes and login confusion. Route guards are complex and role-specific. | Test every role on staging with clean browser state, direct route access, refresh, sign out, and wrong-host scenarios. |
| Club setup | partial | Onboarding and modal work exists, but user feedback showed broken team creation, billing limit confusion, and incomplete action focus. | Full club admin setup from empty club: details, branding, admins, team admins, teams, assignments, skip states, and completion tracking. |
| Teams and staff | partial | Team management and staff allocation exist, including pending invite allocation work. Past feedback showed create team and assignment blockers. | Test create, edit, delete, assign existing staff, assign pending staff, remove staff, and role visibility. |
| Players | partial | Player pages, add player, archive, contacts, and parent links exist. Needs end-to-end proof. | Create players, edit players, archive, restore, add contacts, check role access, and check parent link eligibility. |
| Form builder | unknown | Route and migrations exist, but no current end-to-end evidence in this plan. | Configure assessment fields as club or team role, save, reload, and confirm fields appear in assessment flow. |
| Assessments | partial | Assessment pages and migrations exist, but readiness depends on form builder, players, teams, and coach permissions. | Coach completes assessment for assigned player, saves result, views previous record, and parent can view intended feedback. |
| Parent invites | partial | Previous staging docs include invite endpoint checks. Recent user feedback reported parent invite pages stuck on loading. | Generate parent invite, open on parent staging host, accept, create login, sign in, and verify linked child only. |
| Parent portal | partial | Routes and mobile parent app exist. Recent parent invite issue means trust is incomplete. | Parent login, portal dashboard, messages, polls, availability, family links, and direct route guards. |
| Email and messages | partial | Netlify functions, Resend integration, templates, queues, and logs exist. Staging email delivery may be intentionally limited. | Confirm staging-safe email behavior, manual invite URL fallback, template rendering, queue events, and failure handling. |
| Polls and availability | partial | Poll and match availability migrations and pages exist. | Create poll, vote as parent, enforce vote rules, create availability request, confirm via link. |
| Match day | partial | Match day page and availability functions exist. User requested fixture modal, arrival time, squad selection, and email/app confirmations. | Create fixture with arrival options, select squad, send availability requests, confirm response, run match board. |
| Billing and plan gates | risky | User feedback showed Large Club being treated as zero or wrong tier in modals. | Test tier matrix on staging for Single Team, Large Club, unpaid, paid, past due, tester, and suspended states. |
| Platform admin | partial | Platform admin routes and functions exist, but delete and search behavior recently needed fixes. | Test platform admins, create club, unpaid or paid invite, search, delete club, manage testers, and role gates. |
| Mobile coach app | unknown | App and docs exist, but current web recovery has not verified mobile alignment. | Mobile preflight, auth, assigned-team access, session, assessment, push, and store-test build evidence. |
| Mobile parent app | unknown | App and docs exist, but parent web invite and portal must stabilize first. | Mobile preflight, parent auth, linked child access, messages, polls, push, and store-test build evidence. |

## 5. Proposed Module Map

| Module | Status | Intended users | Readiness state | Required tests | Visible to normal users during recovery |
| --- | --- | --- | --- | --- | --- |
| Shell/auth/workspace | partial | All roles | Required foundation, still risky due route flashing and role guard complexity. | Login, logout, refresh, direct route, wrong role, wrong host, missing profile, suspended, expired tester, parent host. | Yes, but only for active recovery test accounts. |
| Club setup | partial | Club Admin | Existing pages and onboarding exist, but action focus and completion need proof. | Empty club setup, branding, admin invite, team admin invite, team create, assignment, skip states. | Yes for club admin test accounts only. |
| Teams/staff | partial | Club Admin, Team Admin, Manager | Team CRUD and staff allocation exist, but previous blockers make it untrusted until retested. | Create, edit, delete, assign accepted staff, assign pending staff, remove staff, role limits. | Yes for club admin and team admin test accounts only. |
| Players | partial | Club Admin, Team Admin, Manager, Coach where allowed | Core pages exist, needs current proof. | Add, edit, archive, restore, contacts, age handling, team scope, permissions. | Yes for assigned team staff in active tests. |
| Form builder | unknown | Club Admin, Team Admin where allowed | Route exists, no current recovery proof. | Create fields, edit fields, disable fields, reload, assessment integration. | Hide from normal users until Phase 1 proves it. |
| Assessments | partial | Team Admin, Manager, Coach | Existing development routes and mobile shared assessment code exist. | Create assessment session, select squad, complete player assessment, save, view history, parent feedback. | Yes only in active core workflow tests. |
| Parent invites | partial | Club Admin, Team Admin, Parent | Functions and routes exist, recent stuck invite behavior makes it risky. | Generate invite, open link, accept, create account, sign in, link child, expired token, duplicate accept. | No for normal users until Phase 3 passes. |
| Parent portal | partial | Parent, Guardian, Adult Player where applicable | Portal routes exist, parent login and messages/polls exist, needs full proof. | Parent login, child scope, messages, polls, availability, feedback view, direct route guards. | No for normal users until Phase 3 passes. |
| Email/messages | partial | Club Admin, Team Admin, Parents, Staff | Functions and queue exist, staging delivery may be restricted. | Template preview, send function, queue logs, manual URL fallback, retry, Resend live boundary. | Only staging-safe sends to test accounts. |
| Polls/availability | partial | Team staff, Parents | Poll and availability routes exist, match availability functions exist. | Create poll, parent vote, lock rules, availability request, confirmation link. | No for normal users until Phase 4 passes. |
| Match day | partial | Team Admin, Manager, Coach, Parent | Match day route exists, fixture modal and availability changes need proof. | Create fixture, arrival time, squad selection, notify selected players or parents, score, minutes, player of match. | No for normal users until Phase 4 passes. |
| Billing | partial | Club Admin, Platform Admin | Stripe and plan gates exist, recent tier confusion makes this risky. | Paid, unpaid, tester, past due, plan feature visibility, checkout, webhook, billing summary. | Club admin can see only if in active test plan. |
| Platform admin | partial | Platform Admin | Platform routes and functions exist, needs route and action proof. | Admin auth, create club, paid or unpaid invite, search, delete, tester codes, staff admin. | Platform admins only. |
| Mobile coach app | unknown | Coach, Team Admin, Manager | Code and release docs exist, not aligned to current staged recovery. | Mobile preflight, sign in, assigned team, session, assessment, push. | No until Phase 5. |
| Mobile parent app | unknown | Parent, Guardian | Code and release docs exist, depends on stable parent portal. | Mobile preflight, parent sign in, child view, messages, polls, push. | No until Phase 5. |

## 6. Recovery Phases

### Phase 0: Documentation, Environment Safety, Route and Module Audit

Scope:

- Keep this plan current.
- Confirm live and staging boundaries.
- Inventory routes, modules, functions, migrations, scripts, and docs.
- Run read-only route/module audit on staging and test Supabase only.
- Produce evidence for what is enabled, broken, hidden, or leaking.

Out of scope:

- App behavior changes.
- Database migrations.
- Production deploys.
- Live database writes.
- UI rebuild work.

Acceptance tests:

- `PROJECT_PLAN.md` exists and covers the staged recovery plan.
- Every app route is mapped to a module, role, and phase.
- Every normal-user navigation item is mapped to enabled or hidden status.
- Staging/test boundary is verified before any deploy.

Evidence to capture:

- Route list.
- Screenshot set for role home pages.
- Console logs for route flashing or runtime errors.
- Current staging bundle environment check.
- Gap list by module.

Stop conditions:

- Any command would write to live Supabase.
- Any deploy target is production.
- Route audit cannot identify which Supabase project is active.

### Phase 1: Core Web Workflow Only

Scope:

- Prove the first web workflow: club owner creates workspace, creates team, adds players, configures assessment fields, coach completes assessment, parent receives or views feedback.
- Keep modules outside the core workflow hidden from normal users.
- Fix only what is required for the core workflow to be trusted.

Out of scope:

- Full match day.
- Payments beyond safe gates needed to access test workspace.
- Full messaging system.
- Mobile app changes.

Acceptance tests:

- Club admin can complete setup without dead-end pages.
- Team creation works for the correct tier and does not show false billing limits.
- Team admin or coach can be invited and assigned before accepting invite where intended.
- Players can be created and scoped to the correct team.
- Assessment fields can be configured and used.
- Coach can complete and save a development record.
- Parent can view the intended feedback through the safe parent path.

Evidence to capture:

- Test account list.
- Step-by-step manual QA table.
- Screenshots of each completed workflow step.
- Database records proving completion state.
- Console and function logs.

Stop conditions:

- Any role sees modules outside the phase that normal users should not see.
- Core workflow requires direct database edits.
- Parent or coach can see another team or child incorrectly.

### Phase 2: Coach Dumb Mode

Scope:

- Make coach access simple and role-limited.
- Coach sees assigned team, first useful action, session tools, and assessment tools only.
- Coach does not see club setup, billing, platform admin, or unrelated teams.

Out of scope:

- Coach-wide admin features.
- Club-level staff management.
- Mobile coach release.

Acceptance tests:

- Coach with assigned team lands on a clear team workspace.
- Coach with no assigned team sees a waiting state.
- Coach can run session if allowed.
- Coach can perform assessment if allowed.
- Coach cannot access club admin or platform admin routes directly.

Evidence to capture:

- Coach role screenshots.
- Direct route bypass test results.
- Session and assessment record IDs.
- Permission failure logs where expected.

Stop conditions:

- Coach can access club-wide setup.
- Coach gets stuck on setup that only an admin can complete.
- Coach can see unrelated team data.

### Phase 3: Parent Portal

Scope:

- Stabilize parent invite, login, portal, child scope, messages, polls, availability, and feedback viewing.
- Ensure parent host routing is stable.

Out of scope:

- Mobile parent release.
- Full push notification rollout.
- Broad marketing page changes.

Acceptance tests:

- Parent invite link opens without flashing or infinite loading.
- Parent can create or access portal login.
- Parent sees only linked child or children.
- Parent can view approved feedback.
- Parent can receive or view messages and polls included in test plan.
- Direct route bypass is blocked.

Evidence to capture:

- Parent invite URL.
- Parent test account.
- Browser console logs.
- Screenshots of invite accept, login, portal, child data, and blocked routes.
- Parent link records.

Stop conditions:

- Parent route flashes or stalls.
- Parent can see another child.
- Parent cannot recover from expired or already accepted invite.

### Phase 4: Payments, Messages, Polls, and Match Day

Scope:

- Prove payment gates, paid or unpaid club setup, messaging, availability polls, fixture setup, squad selection, arrival time, and match day workflow.

Out of scope:

- Live Stripe promotion.
- Mobile app release.
- Non-football sports.

Acceptance tests:

- Platform admin can create paid and unpaid club invites on staging.
- Club plan state is clear and does not block allowed actions incorrectly.
- Staging email behavior is safe and predictable.
- Match fixture can be created with arrival time.
- Squad can be selected.
- Availability request reaches selected parents or adult players through staging-safe path.
- Match day board works for the selected team only.

Evidence to capture:

- Plan and billing screenshots.
- Function logs for email and availability requests.
- Fixture and availability record IDs.
- Parent confirmation screenshots.
- Stripe test mode evidence if used.

Stop conditions:

- Live Stripe or live email would be triggered accidentally.
- Plan gate blocks an allowed tier or unlocks a disallowed tier.
- Match day reaches unselected players or parents.

### Phase 5: Mobile App Alignment

Scope:

- Align coach and parent mobile apps with the verified web workflows.
- Run mobile preflight and store-test checks.
- Confirm mobile uses correct staging environment before any store-test build.

Out of scope:

- Production app store release.
- Live push notification rollout.
- Mobile features not backed by verified web modules.

Acceptance tests:

- `npm run mobile:preflight` passes.
- Coach mobile can sign in to staging and access assigned team workflows.
- Parent mobile can sign in to staging and access linked child workflows.
- Push registration is tested against staging-safe setup.
- Store-test build evidence is recorded if builds are run.

Evidence to capture:

- Mobile preflight output.
- Screenshots or videos from devices or emulators.
- EAS environment evidence.
- Push registration logs.
- Store-test build IDs where applicable.

Stop conditions:

- Mobile app points at live unexpectedly.
- Parent or coach mobile exposes unverified modules.
- Push sends to live users.

### Phase 6: Release Readiness

Scope:

- Final staging verification.
- Live backup plan.
- Rollback plan.
- Production promotion checklist.
- User approval gate.

Out of scope:

- Any live deploy before approval.
- Any live data migration without backup and explicit plan.

Acceptance tests:

- All phase evidence is complete.
- No high or critical defects remain open.
- Live backup plan is current.
- Build environment verification passes for intended production build.
- User explicitly approves live promotion.

Evidence to capture:

- Final QA report.
- Staging deploy ID.
- Production backup evidence.
- Live deploy command and result only after approval.
- Post-live smoke test.

Stop conditions:

- Missing evidence for any core workflow.
- Open critical or high severity defect.
- Environment verification fails.
- User has not approved live promotion.

## 7. Core Workflow Acceptance Test

The first workflow to prove is:

Club owner creates or sets up workspace, creates team, adds players, configures assessment fields, coach completes assessment, parent receives or views feedback.

Required test path:

1. Platform admin creates or identifies a staging club using test Supabase only.
2. Club owner signs in through staging.
3. Club owner completes club details and branding only where the current plan allows.
4. Club owner creates a team.
5. Club owner invites or confirms a team admin.
6. Club owner assigns the team admin to the team, including pending invite users where intended.
7. Team admin signs in and sees only assigned team setup.
8. Team admin adds manager or coach where needed.
9. Team admin or coach adds players.
10. Team admin or club admin configures assessment fields.
11. Coach creates or opens an assessment context.
12. Coach completes assessment for a player.
13. Parent invite is generated or parent access is linked.
14. Parent opens portal and views approved feedback for their linked child only.

Pass criteria:

- No role sees irrelevant setup.
- No user lands halfway down a large page when the intended task is a contained modal.
- No direct route bypass exposes another role or team.
- Completion states are based on real database records where possible.
- The workflow is repeatable from a clean test account.

## 8. Navigation and Route Gating Rules

Normal users must only see modules that are all of the following:

- Enabled for the current recovery phase.
- Appropriate to their role.
- Ready enough for the active test plan.
- Included in the current QA evidence model.

Rules:

- No coming soon pages for normal users.
- No hidden module leakage through sidebar, topbar, search, command menus, direct links, or browser history.
- No direct route bypass for role-restricted modules.
- Platform admin routes are for platform admins only.
- Club admin routes are for club admins only unless explicitly shared by permission.
- Team admin and coach routes must be team-scoped.
- Parent routes must be child-scoped.
- Billing gates must explain access without pretending that setup failed.
- Route changes must load at the top of the page unless intentionally navigating to a specific section.
- If a button starts a contained task, it should open the exact modal or focused task. It should not drop the user onto a broad page and make them hunt.
- Full pages should be reserved for broad workspace views such as reviewing all players, reviewing all teams, reports, live sessions, assessments, full match day boards, and audit history.

## 9. QA Evidence Model

Manual and automated test results should be recorded against this plan using the following model.

| Field | Required content |
| --- | --- |
| Module | Name from the module map. |
| Route | Exact route or function endpoint tested. |
| Role | Platform Admin, Club Admin, Team Admin, Manager, Coach, Parent, Adult Player, or signed-out user. |
| Test account | Email or identifier for the staging test account. |
| Steps | Numbered actions taken by the tester. |
| Expected result | What should happen. |
| Actual result | What happened. |
| Pass or fail | Pass, fail, blocked, or not applicable. |
| Severity | Critical, high, medium, low, or observation. |
| Screenshots or log notes | Screenshot path, browser console notes, function log note, network error, or database evidence. |
| Resolution status | Open, fixed, retest needed, accepted risk, or deferred. |

Recommended evidence table template:

| Module | Route | Role | Test account | Steps | Expected result | Actual result | Pass or fail | Severity | Screenshots or log notes | Resolution status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Example | `/coach` | Coach | `coach@example.test` | 1. Sign in. 2. Open `/coach`. | Assigned team workspace opens. | To be tested. | Not applicable | Observation | None yet. | Open |

Evidence rules:

- A module is not trusted until evidence exists for the role that will use it.
- A successful build does not prove a workflow.
- A successful route load does not prove permissions.
- A single happy path does not prove role safety.
- Screenshots should include route and visible role context where possible.
- Console errors, network failures, and database policy errors must be recorded even if the UI appears usable.

## 10. Immediate Next Actions

### Next Codex Task

Run a read-only route and module audit against this `PROJECT_PLAN.md` on staging only.

Recommended prompt:

```text
Using PROJECT_PLAN.md as the source of truth, run a read-only route and module audit on staging only. Do not change app behavior, routes, UI, database migrations, data, deploys, or live services. Map every route, sidebar item, topbar action, onboarding action, and direct module entry point to the module map and recovery phase. Report anything normal users can see that is not enabled, role-appropriate, ready for the current phase, or included in the active test plan. Include console errors, redirect loops, route flashing, dead buttons, and buttons that should open focused modals instead of broad pages.
```

## 11. Staging Reset and Tester Feedback Evidence

Reference: FOOTBALL-STAGING-RESET-FEEDBACK-01

Status on 31 May 2026:

- Staging Supabase target verified as `llpufwzvgxyczxcjwupu`, project name `FootballDev Test`.
- Live Supabase target remains `hvapkizujvsahvgspser`, project name `FootballDev`.
- All reset work in this section was run against staging only.
- Public workspace data was cleared from staging: clubs, teams, users except platform admins, memberships, invites, players, assessments, sessions, match day, polls, parent links, parent messages, email logs, scheduled email queue, Stripe checkout records, Stripe webhook records, audit logs, backups, and old platform feedback.
- Preserved staging platform admin access: `2` platform admin records and `2` public user profiles.
- Preserved schema and migrations.
- Preserved the new tester feedback table.
- Supabase Auth users were not deleted. Public workspace profiles were cleared except platform admins, but Auth identities were left in place to avoid direct auth-store deletion during this reset.
- Storage bucket objects were not deleted in this reset.

Current after-reset counts:

| Table group | Remaining rows |
| --- | --- |
| Clubs | 0 |
| Teams | 0 |
| Players | 0 |
| User club memberships | 0 |
| Club and owner invites | 0 |
| Assessment sessions and players | 0 |
| Evaluations | 0 |
| Match day records | 0 |
| Polls and votes | 0 |
| Parent links and parent portal reads | 0 |
| Communication logs, email logs, and email queue | 0 |
| Stripe checkout and webhook records | 0 |
| Audit logs and record backups | 0 |
| Old platform feedback records | 0 |
| Platform admin records | 2 |
| Public platform admin user profiles | 2 |
| Tester feedback reports | 0 |

Tester feedback model added:

- New table: `public.tester_feedback_reports`.
- New app route: `/feedback/new`.
- Sidebar entry: `Report issue`, available to signed-in testers and parent portal users.
- Captures: submitter, email, name, role, club, team, module, phase, route, page title, feedback type, severity, status, summary, reproduction steps, expected result, actual result, browser/device, screenshot URL, log reference, and admin notes.
- RLS model: signed-in users can submit own reports, users can view own reports, club admins can view own club reports, platform admins can view and manage all reports.

Staging payment suspension:

- Staging builds set `VITE_PAYMENTS_DISABLED=true`.
- Production builds set `VITE_PAYMENTS_DISABLED=false`.
- Public pricing on staging sends all plans to sign-up instead of Stripe checkout.
- The sign-up form exposes a staging-only `Test tier` selector.
- New staging signups can choose Individual, Single Team, Small Club, or Large Club without payment.
- The selected tier is stored as the club `plan_key` with `plan_status='active'` and `is_plan_comped=true`.
- The Netlify checkout function still rejects checkout attempts while payments are disabled.

Open evidence gap:

- Exact before-reset row counts were not captured before the delete migration was applied. The after-reset counts above were verified after the reset completed.
