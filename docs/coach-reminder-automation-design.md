# Coach reminder automation draft

Requested in Simon's Slack thread `C0C5N2XEQHM/1790926427.123419`, narrowed to matches and training in `1790926851.154569`, with coach-selectable strictness in `1790927543.799169`.

## Implemented locally

The portable policy engine plans unanswered MATCH and occurrence-specific TRAINING follow-ups, the three deadline options, and MATCH squad reminders. All options default off. A controlled web editor exposes these options without saving or enabling anything. A transactional worker contract commits a separate automatic effect and an outbox entry together. Local PostgreSQL tests exercise actual transaction rollback and duplicate replay. Browser tests exercise the editor at phone and desktop widths.

This is a draft foundation, not a connected end-to-end feature. The editor is not mounted in a production screen. There is no production repository adapter, policy API, scheduler endpoint, attendance write, application migration, or live communication. The current Coach and Parent code paths are unchanged. The portable engine adds no native dependency or runtime version change.

## Existing semantics inspected

* `calendar_event_invites` stores event participation. Account-joining invitations are separate and outside this feature.
* MATCH uses shared `match_day_player_availability`, separate recipient `match_day_availability_requests`, response history, and auto-selection triggers.
* TRAINING uses occurrence-specific `training_availability_requests`, recipient request-player rows and shared per-player responses. Existing response-source constraints permit parent, adult-player and staff answers, not automatic decisions.
* Manual `_availability-follow-up.js` queues targeted messages and rechecks staff, event, invitation and recipient access. It does not check whether the player answered after queuing, so automatic reminders must use the stricter new notification validation.
* `match_day_player_squad_decisions` stores per-player decisions. A selected player alone is not evidence of a complete or confirmed squad. No unambiguous squad-complete field was established.
* Existing email workers already lease jobs and apply communication preferences and plan access. A new adapter must preserve these checks and never bypass them.

## Safety contracts

Policies require immutable revisions, club/team scope and an activation timestamp. Invitation automation accepts only newly created invitations whose first confirmed delivery occurred after activation. It never backfills old invitations, merely queued emails or existing squad events. Elapsed hours use absolute UTC durations. The clock is injected, not read globally.

Squad calendar days preserve an explicit event timezone and local kickoff time across DST. Ambiguous or nonexistent reminder times are rejected for an explicit scheduling decision. TBC kickoff is not assigned a fabricated time. Training requires an occurrence identifier; deleted or excluded occurrences must be resolved as inactive by the adapter.

Each job snapshots policy, event and invitation revisions. It rechecks current authority, team membership, invitation eligibility, recipient permissions/preferences, current response, cancellation, occurrence and event time under a transaction. Old jobs are skipped after edits or rescheduling. Logical recipient notification keys remain stable across rescheduling, so an accepted reminder is not sent twice. An adapter may refresh an unsent outbox entry for the new event revision, but must never reopen an accepted entry. Stale claims must be invalidated before refreshing.

Automatic unavailable is a separate `coach_deadline_automation` effect. It is never inserted into the parent's response table, never impersonates a parent, and never runs existing explicit-answer auto-selection or chat triggers. Planning reads must project the effect. A late explicit answer always wins; a changed response revision also invalidates any old planning exclusion. Maybe remains an explicit answer and is never automatically replaced. The deadline can exclude it from planning, as requested. Final attending/not-attending answers are never overridden.

Outbox validation repeats all scope and status checks immediately before delivery. Provider acceptance and durable idempotency are required. Uncertain delivery or interruption after acceptance is held for reconciliation, not blindly resent. The eventual adapter must hold/recheck leases and reconcile an accepted provider receipt before retrying.

## Decisions required before connecting shared behavior

1. **Policy ownership:** one shared team policy, per-event policy, or personal coach policy? Personal deadline policies can conflict over the same shared player availability. Who can edit an existing policy, and how are concurrent edits resolved?
2. **Squad completion:** at least one selected player, an explicit squad save/confirmation, or a minimum/complete squad rule? The engine requires an authoritative boolean and fails closed when unknown.
3. **Timing and communication:** confirm first successful delivery as the elapsed-clock anchor, one follow-up per invitation, and one squad reminder per match/policy. Confirm whether squad "days before" means the same local kickoff time or a specified daily send time. For TBC kickoff, an explicit time or skip rule is needed. Confirm Coach inbox, push and/or email audience/channel and plan/opt-out rules. The draft accepts eligible recipients from an adapter and does not choose a live channel.
4. **Planning enforcement and correction:** confirm which planning actions must prevent/exclude no-response/Maybe players, whether a staff override is allowed, and how that override is recorded. The draft projects planning eligibility but does not block existing squad/formation RPCs. Late explicit replies currently supersede the automatic effect while the event remains open; no squad selection is automatically changed by the draft.

## Migration and release requirements

After those decisions, add an additive migration with policy records/revisions, immutable first-delivery enrolment, event/invitation scheduling revisions, effects, a uniquely keyed outbox and guarded claim/commit/reconciliation RPCs. Enable RLS and revoke client writes to worker/effect/outbox tables. Test actual club/team/staff/parent/adult-player scopes and concurrent response/job transactions in PostgreSQL. No backfill or defaults that enrol existing records. No cron installation in the migration.

Build the authorised settings API and durable adapter using current active memberships and the existing event-recipient authority RPC. Resolve every recurring occurrence using existing London-calendar semantics and occurrence exclusions. Wire the planning projection and automatic provenance label into web, Coach and Parent read models, and enforce the selected planning rule on the server. Preserve explicit-answer RPCs and all existing queues, staff chat, Match Day, login-intent and dual-access behavior.

Keep the server release flag off independently of individual policy options. Apply the reviewed migration only in a separately authorised release, then deploy the API/read-model code, run smoke tests with non-sending fixtures, and verify migrations and rollback behavior before authorising any scheduler activation. Enable future invitations only with an explicit policy save. A release must not immediately change old attendance or send catch-up reminders. Mobile changes must be JavaScript-only OTA on installed runtimes; no native rebuild or app-store submission.

The separate draft workflow runs the new tests. Existing security/regression/build workflows remain intact, including the concurrent theme-save PR's workflow changes. All aggregate gates and unchanged-baseline comparisons remain required before merge. Live deployment and physical-device evidence are outside the current local/draft scope.
