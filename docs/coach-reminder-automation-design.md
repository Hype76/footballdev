# Shared Coach reminder options

Simon requested MATCH/TRAINING availability reminders, squad reminders and configurable deadline strictness in Slack C0C5N2XEQHM/1790926427.123419. Clarifications: 1790926851.154569, 1790927543.799169, shared team ownership 1790930398.560359 and stopping rules 1790931365.547819.

## Behaviour

One policy belongs to the team and is shared by its authorised Coaches. Every automation starts off and every timing starts blank. A Coach must configure hours/days and explicitly opt in. Save commands have durable identities, repeated clicks coalesce, retries reuse their identity, and conflicting edits require reload.

Only newly created, successfully delivered MATCH/TRAINING availability invitations after both the policy and release activation cutoffs are enrolled. Account-joining invitations, existing invitations and existing attendance are untouched. First confirmed delivery is immutable; resends never reset the elapsed clock. Changing a policy starts a new future-only cutoff and invalidates its previous jobs.

Individual reminders stop as soon as the shared status leaves awaiting, including Maybe. Deadline options are reminders only, exclusion of awaiting/Maybe from planning, or automatic Not attending for awaiting plus notification. Maybe remains an explicit answer and can be excluded under strict policy; it is never automatically replaced. Automatic status is a separate effect with coach_deadline_automation provenance, projected into reads rather than written into a parent's answer. Late Attending or Not attending supersedes the automatic effect. Late Attending restores eligibility without rewriting a saved squad. Existing response APIs remain open until their existing event-based closing rules.

A persisted selected squad decision stops the squad reminder. Current active authorised assigned team Coaches receive it through their existing Coach inbox/push invitation preference. Parent/player availability notifications reuse existing eligible contacts, app/email/both preferences, active links, installation opt-outs and the existing plan gate. No new Coach email fallback is invented.

## Local implementation

The web Coach home links to shared team settings through a separately gated route; Coach mobile has a compact settings section. Web Coach/Parent/Adult Player and Coach/Parent mobile reads carry separate automatic provenance and correction labels. Existing invitation delivery states and explicit response records are preserved. New match selection, linked formation versions and formation publication are guarded in PostgreSQL. Existing selected squads and saved plans are not rewritten. Training read models expose planning exclusion without changing historical attendance.

One additive migration defines scoped policy RLS, optimistic revisions, idempotent save commands, disabled release control, future-only source delivery triggers, immutable enrolments, bounded candidate scanning, durable jobs/effects/outbox, authoritative context checks and minimal authorised projections. No backfill or cron is installed. The two unreleased draft stages are consolidated into one migration to meet the existing single-migration scope gate; no applied migration is changed. The endpoint process-team-coach-reminders is separately disabled and requires the existing scheduler secret when enabled.

Jobs are replanned from current canonical events and recurrence metadata. Cancelled/deleted/past/TBC events, removed memberships, revoked/cancelled request sources and excluded training occurrences fail closed. London calendar-day squad timing preserves wall time across DST. Ambiguous or nonexistent starts are skipped. A canonical training reschedule cannot rely on an obsolete request occurrence timestamp. SQL selection guards use the same current occurrence rules.

Context is checked at commit and again before delivery. Logical recipient keys survive rescheduling. Accepted or held sends cannot be reopened. Resend providers receive durable hashed idempotency keys, and inbox writes deduplicate. An interrupted or uncertain send, lost lease, or expired claim is held for reconciliation instead of blindly retried. Expo has no provider idempotency contract, so a send interrupted after provider acceptance must remain held until reconciled. Candidate scans are bounded and cycle through durable cursors; future jobs do not occupy the due-job batch.

## Validation and limits

Local PostgreSQL fixtures exercise actual source triggers, context/commit/claim RPCs, repository, processor, mocked channels, projections and squad/formation guards. Tests cover defaults, shared authority, conflicts/retries, opt-out, late answers, scope removal, replay, stale jobs, cancellation, recurrence/rescheduling and DST. Browser fixtures exercise web and actual React Native settings at compact widths, with external requests blocked. Both mobile web exports use existing Expo 54 dependencies. No dependencies, native configuration, runtime versions or app-store submissions change.

The dedicated reminder workflow runs policy/database/integration tests, lint, web settings browsers, native settings browser and both mobile web exports. Existing security gates are preserved. Detailed local pass counts and baseline failures are in PR #159; security failures are not waived.

## Separately authorised release requirements

1. Review and apply 20261002100424_team_coach_reminder_integration.sql. Confirm existing production schema/source-delivery contracts in a non-sending release smoke test. Release control remains disabled after migration.
2. Deploy dormant web/API/worker code. Settings use ENABLE_COACH_REMINDER_POLICY_SETTINGS, VITE_ENABLE_COACH_REMINDER_POLICY_SETTINGS and EXPO_PUBLIC_ENABLE_COACH_REMINDER_POLICY_SETTINGS. Automation uses ENABLE_COACH_REMINDER_AUTOMATION, VITE_ENABLE_COACH_REMINDER_AUTOMATION and EXPO_PUBLIC_ENABLE_COACH_REMINDER_AUTOMATION. All are unset/off in this PR.
3. Release only JavaScript OTA updates compatible with installed Coach/Parent runtimes. Verify the installed-device correction and notification navigation flows. No native rebuild or app-store submission is required or authorised.
4. Provision the existing scheduler secret and install a bounded schedule for the processor. Choose an operational polling interval and monitor scan latency/outbox holds; no schedule is installed by this draft.
5. Enable client provenance reads before server automation. Only with separate owner approval, enable the server flag and release row with a fresh activated_at cutoff. A Coach opt-in saved earlier cannot backfill old invitations.
6. Disabling the server flag/release row stops processing and removes projected automation. Preserve the ledgers for audit/reconciliation and leave explicit responses untouched. Do not replay held sends without checking provider/inbox acceptance.

No product clarification remains for shared ownership, strictness or stopping rules. Release approval, scheduling cadence, installed-device smoke evidence and baseline security failures remain release requirements. No live migration, communications, attendance changes, flags, cron, deployment or OTA publication was performed. Theme-save PR #158 files, unrelated worktrees and archives are preserved.
