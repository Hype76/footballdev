# Footballplayer.online V1 Match Hub Refinement Plan

Reference: FP-V1-MATCH-HUB-PLAN

## Purpose

Capture the agreed V1 refinement direction for Match Day / Match Hub work so it can be implemented in staged batches rather than one huge risky Codex prompt.

## Core Principle

Do not put all Match Hub ideas into one giant implementation prompt.

Split the work into category batches with clear outcomes. Each batch should be meaningful enough to deliver value, but scoped enough to avoid overbuilding, regressions, or tangled changes.

## Planning Status

This document is a source/planning note.

It is not an instruction to implement all items immediately.

Each batch requires its own scoped Codex prompt before implementation.

## Batch 1: Match Day Event Log Core

Priority: First implementation batch.

Outcome: Turn Match Day from a basic score/add-goal form into a practical event log and match timeline.

Scope:

- Rework the score/add-goal section into event logging.
- Support shirt-number lookup for our team players.
- Auto-resolve player name when a shirt number matches one known player.
- Handle duplicate shirt numbers with a picker or warning.
- Allow unknown shirt numbers with manual name entry.
- Allow opposition shirt number plus optional manual name.
- Support goals.
- Support assists where relevant.
- Support yellow cards.
- Support red cards.
- Support substitutions.
- Support refreshment breaks / water breaks.
- Show a clear match event timeline.
- Timeline should show minute, event type, team side, shirt number, and player name where known.
- Preserve home-team-first match display.
- Preserve scorer, linesman, and referee volunteer selection behaviour.
- Preserve existing Match Day stale-state fixes.

Product note: Parents and helpers often know shirt numbers before they know every player name. The event log should work naturally from shirt numbers.

## Batch 2: Parent Match Request + Carpool

Outcome: Managers should know not only who can play, but who can actually get to the game.

Scope:

- Extend parent match availability request thinking to include transport.
- Add transport states such as:
  - Sorted.
  - Needs lift.
  - Can offer lift.
- Include seats available where a parent can offer a lift.
- Include notes, such as pickup/drop-off limitations.
- Give managers a match readiness summary:
  - confirmed available.
  - no response.
  - needs lift.
  - lift seats offered.
  - transport risk.
- Connect transport responses into the Match Hub / fixture context.
- Avoid relying on messy WhatsApp threads for lift coordination.

Product note: Many players do not know how they are getting to games. This is a real grassroots matchday problem and should be treated as a strong priority idea, not just a nice-to-have.

## Batch 3: Light Mode Consistency Audit

Outcome: Light mode should feel intentionally designed, not like dark-mode components dropped onto a light page.

Scope:

- Audit and fix hardcoded dark styling in light mode.
- Include scoring guide modal.
- Include info/help buttons.
- Include popovers.
- Include overlays.
- Include modal panels.
- Include dark square info buttons.
- Include hover and focus states.
- Include mobile versions.
- Preserve dark mode styling.
- Prefer shared theme tokens or existing design variables over one-off colour patches.

Known issue: The feedback/development form scoring guide modal and info buttons still appear dark while the page is in light mode.

## Batch 4: Feedback Previous Performance Values

Outcome: Performance fields should behave like tracked values rather than blank one-off fields.

Scope:

- For fields such as:
  - Bleep Test Score.
  - 10k.
  - 5k.
  - 2k.
- Prefill from the player's most recent previous saved value where one exists.
- Leave blank where no previous value exists.
- Allow the coach to keep, edit, or clear the value.
- Do not overwrite coach edits with late refetches.
- Treat 0 as a valid previous value.
- Scope values to the correct player and existing product rules.
- Do not turn this into a charting or analytics rebuild.

## Batch 5: Match Hub Communication

Outcome: Replace WhatsApp chaos with organised fixture-specific communication.

Scope:

- Explore fixture-specific Match Day group chats.
- Suggested group name format: `DD-MM-YYYY Home Team vs Away Team`.
- Auto-create or offer to create a group chat for a fixture.
- Add relevant coaches/managers.
- Add participating parents where appropriate.
- Consider adding parents when they approve availability or volunteer.
- Use colour-coded names or badges for volunteers:
  - Scorer.
  - Linesman.
  - Referee.
  - Lift Offered.
  - Lift Needed.
- Consider parent-to-staff direct messaging through a staff dropdown.
- Messages should remain inside the platform rather than exposing personal phone numbers.
- Include lifecycle/archive thinking:
  - created.
  - active.
  - match finished.
  - archived/read-only after a sensible period.
- Treat permissions, safeguarding, visibility, retention, and audit as important design concerns.

Product note: This idea came from Simon showing Steve his phone full of separate, disorganised WhatsApp chats for different match days. Footballplayer.online can improve this by attaching communication to the actual fixture.

Important channel rule: Do not use email for live matchday updates.

Reason: Resend email allowance would be consumed quickly across clubs, teams, parents, and match events.

Preferred communication channels:

- Parent portal.
- In-app notifications.
- Push notifications later where supported.
- Match Hub timeline.
- Optional post-match summary later if needed.

Email should remain for lower-frequency important communications such as:

- invitations.
- fixture changes.
- cancellations.
- important club/admin messages.
- possible digests, if explicitly approved later.

Later visual idea:

- Consider kit/shirt visuals in a later phase:
  - manager configures or uploads a kit design.
  - app renders numbered shirt cards/icons.
  - use in parent portal timeline, in-app event feed, and possibly push notifications.
  - do not make V1 depend on complex image editing or per-player shirt photos.

## Recommended Implementation Order

1. Match Day Event Log Core.
2. Parent Match Request + Carpool.
3. Light Mode Consistency Audit.
4. Feedback Previous Performance Values.
5. Match Hub Communication.

Reason for order:

- Event Log Core is the visible Match Day foundation.
- Carpool is highly practical and tied to parent requests.
- Light Mode cleanup improves polish without changing data model.
- Previous Performance Values is useful but separate from Match Day.
- Match Hub Communication has the biggest permissions and safeguarding surface, so do not start with it and do not mix it into the first event-log prompt.

## V1 Boundary

Keep this as V1 finish/refinement planning.

Do not:

- turn this into a V2 rebuild.
- introduce a new architecture plan.
- implement all batches in one prompt.
- change auth, payments, Stripe, email sending, tiers, or production environment behaviour from this document alone.
- apply migrations from this document alone.
- mutate production data from this document alone.
- deploy from this document alone.

## Future Prompt Usage

Future Codex prompts may reference:

- FP-V1-MATCH-HUB-PLAN, Batch 1: Match Day Event Log Core.
- FP-V1-MATCH-HUB-PLAN, Batch 2: Parent Match Request + Carpool.
- FP-V1-MATCH-HUB-PLAN, Batch 3: Light Mode Consistency Audit.
- FP-V1-MATCH-HUB-PLAN, Batch 4: Feedback Previous Performance Values.
- FP-V1-MATCH-HUB-PLAN, Batch 5: Match Hub Communication.

Each implementation prompt must include its own:

- goal.
- scope.
- boundaries.
- validation.
- zero-regression gate.
- final report requirements.

## Zero-Regression Gate

This documentation task must not change application runtime behaviour.

Confirm:

- no product code changed unless only needed to link docs, which should be avoided.
- no tests changed unless documentation tooling requires it.
- no routes changed.
- no styling changed.
- no Supabase changes.
- no migrations.
- no production data mutation.
- no emails sent.
- no Stripe/payment/auth/tier changes.
- no deploy performed.
