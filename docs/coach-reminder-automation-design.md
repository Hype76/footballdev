# Coach reminder automation draft

Simon requested unanswered MATCH/TRAINING availability reminders and configurable deadline strictness in Slack thread C0C5N2XEQHM/1790926427.123419. Clarifications: 1790926851.154569, 1790927543.799169, shared team ownership 1790930398.560359, and reminder stopping rules 1790931365.547819.

## Resolved behaviour

One policy is shared by the authorised coaches of each team. Timings start blank and every option starts off. Coaches explicitly configure hours/days and save an opt-in. Concurrent edits conflict rather than overwriting another Coach's settings; request IDs make repeat clicks and retries safe.

Individual reminders apply only while availability is awaiting a response. Attending, Not attending or Maybe stops those reminders. The selected deadline rule can exclude awaiting/Maybe from planning; automatic Not attending only applies to awaiting. It never replaces Maybe or another explicit answer. A saved selected squad decision stops the team reminder. All current authorised assigned coaches for that team are eligible targets, subject to their existing invitation preference.

The elapsed clock uses immutable first confirmed availability delivery. Squad days preserve the local kickoff wall time in Europe/London across DST. TBC, ambiguous/nonexistent local times, past, postponed, cancelled or deleted events fail closed. Recurring training requires an occurrence and current occurrence membership.

## Implemented locally

* Portable policy planner/evaluator, three deadline modes, read-time provenance projection and delivery validation.
* Responsive shared settings editor, scoped settings store and authenticated Netlify policy API. The web route is separately gated by VITE_ENABLE_COACH_REMINDER_POLICY_SETTINGS; the API is gated by ENABLE_COACH_REMINDER_POLICY_SETTINGS. Neither flag defaults on. The route avoids UserSettingsPage and the concurrent theme-save PR.
* Additive migration 20261002084522_team_coach_reminder_policy.sql: scoped policy RLS, optimistic revisions, idempotent save ledger, immutable invitation enrolments, jobs, separate automatic effects, unique outbox, release control, current-context reads, atomic compare-and-commit and claimed delivery leases. Release control is inserted disabled. No cron, triggers on existing records, backfill or attendance mutation.
* Supabase repository adapter for the worker contract. Its database commit compares authoritative current context under a job lock. A response, policy, membership or event change before commit aborts that stale decision. Delivery revalidates again. Existing contact eligibility and parent communication preferences are reused.
* Local PostgreSQL and browser fixtures. No live database was migrated and no real communication was queued or sent.

This remains an incomplete feature draft. No scheduler/delivery-source enrolment pipeline or live transport is connected. The settings API always reports delivery unavailable. The automatic effect projection is tested but is not connected to existing web/Coach/Parent read models or server planning enforcement. No mobile screen has been changed. Do not merge or describe this as an end-to-end reminder implementation.

## Existing semantics and safety

Account-joining invites are separate from calendar_event_invites and outside scope. MATCH explicit answers live in shared match_day_player_availability; per-recipient delivery uses match_day_availability_requests. TRAINING uses occurrence requests, per-recipient request-player rows and shared responses. Current response-source constraints intentionally remain unchanged.

Automatic outcomes use separate coach_deadline_automation provenance, never a parent response row. They do not invoke explicit-answer auto-selection/chat triggers. Late available/unavailable answers supersede the automatic effect. Late Maybe remains the explicit answer and stops reminders, while strict deadline planning exclusion continues because the place remains uncertain. A reset to pending with a changed response revision invalidates the old effect. Old jobs are invalidated by policy/event/invitation revisions, cancelled requests, revoked tokens, removed active player/team membership and excluded training occurrences.

Enrolment must only record newly created availability invitations with confirmed delivery after both policy activation and server release activation. An unchanged resend cannot reset the immutable clock. Existing invites, existing attendance and existing squad events must not be enrolled or changed on release. Each policy edit starts a fresh cutoff and invalidates its prior jobs.

Logical recipient notification keys survive event rescheduling. An accepted or held delivery cannot be reopened; an unsent/unleased outbox entry can be refreshed. Expired delivery leases are held for provider reconciliation rather than blindly retried. Provider acceptance must be durable and attributable to the idempotency key. The delivery adapter must preserve the existing plan, communication-channel, installation and invitation-preference rules.

## Remaining implementation before release

1. Connect confirmed-delivery source enrolment and bounded discovery/replanning to the repository. Cover both MATCH recipient delivery and TRAINING occurrence delivery, including app-only delivery. Do not infer successful delivery from queue creation or mutable resend timestamps.
2. Connect a separately gated processor and existing communication infrastructure. Revalidate current response and scope immediately before each actual channel delivery; use durable provider idempotency and reconciliation. Preserve email plan gates, app/email/both preferences, Coach invitation preferences and push installation opt-out. The current manual follow-up validator does not suppress a late response, so it cannot serve as automatic delivery validation unchanged.
3. Connect the separate effect projection and clear automatic provenance labels to web, Coach and Parent read models. Enforce planning exclusion on the server for new enrolled records. A late available answer restores eligibility without automatically rewriting a previously saved squad. Preserve existing explicit-answer APIs and staff chat semantics.
4. Add Coach settings/navigation and any read-model changes as JavaScript-only OTA compatible with installed runtimes. No native dependency, native build, runtime-version change or app-store submission is authorised.
5. Complete end-to-end fixtures across discovery, source races, recurring rescheduling/cancellation, all channels, plan and opt-out gates, UI provenance and server planning guards. Run applicable configured regression/build/security aggregates on that final integrated change and compare failures with unchanged main.

Shared ownership and squad stopping are resolved; these are engineering tasks, not additional questions for Simon. No staff override mode has been implemented or implied by this draft.

## Migration and release boundary

Local/draft scope does not authorise applying this migration, publishing mobile updates, changing production flags/release control, enrolling live invitations or activating a scheduler. Once the remaining implementation and review are complete, a separately authorised release must apply the additive migration, deploy dormant API/read-model/worker code, exercise non-sending smoke fixtures, verify rollback/reconciliation and only then activate future-only automation. Preserve the independent server release cutoff even when a Coach saved opt-in earlier. Disabling release must stop claims and effects immediately. Do not roll back by rewriting explicit responses.

PR #158 theme-save files and security workflow are preserved. No archives/worktrees were removed. Draft validation evidence and unchanged baseline failures are recorded in the PR description; gates are not weakened.
