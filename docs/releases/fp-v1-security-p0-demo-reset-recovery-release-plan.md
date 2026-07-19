# FP V1 P0 demo reset recovery release plan

Reference: `FP-V1-SECURITY-P0-AUTHORITY-CONTAINMENT-RECOVERY-RELEASE-01`

This plan is prepared but has not been executed. It must not be used until the implementation commit is approved as the intended production source.

## Candidate contract

- Migration: `supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql`
- Netlify entry point: `netlify/functions/reset-demo-account.js`
- Server manifest: `netlify/functions/lib/_demo-reset-manifest.js`
- Database operation: `public.reset_demo_account_atomic(uuid, uuid)`
- Lock key: `footballplayer:demo-reset:v1`
- Required caller: `service_role` through the authenticated Netlify function
- Approved browser payload: one operation UUID only
- Auth handling: authenticate the existing approved demo identity first, then invoke the reset with its bearer token
- Auth mutation: forbidden
- Communication dispatch: forbidden

## Expected approved demo state

Persistent records that must retain their current identifiers:

- One existing club
- One existing application user
- One existing Auth identity
- One existing membership
- Three existing named teams where already present
- Existing audit logs and record backups
- Existing communication history and chat state

Reconciled records:

- Five roles
- Three team staff assignments
- Eight form fields
- Ten players
- Six evaluations
- Four assessment sessions
- Fourteen assessment session player links
- Seven parent links
- Three staff notes
- Two polls
- Seven poll votes
- Two match locations
- Two Match Days
- Two Match Day events
- One scorer interest record
- Three availability requests
- Zero Calendar fixtures

Records that the recovery must not create, delete, or update:

- Any record outside the approved demo club
- Any additional application or Auth identity
- Any password, credential, session, or provider token
- Any real club, team, user, membership, Match Day, invitation, or communication record
- Any scheduled email, email event, email log, notification command, push command, or SMS command
- Any parent chat message or staff chat message
- Any immutable audit log, backup, or Match Day history record

## Exact release sequence

1. Confirm the intended release commit.
   - Fetch `origin/main`.
   - Set `RECOVERY_COMMIT` to the approved implementation commit from this batch.
   - Verify the commit is a descendant of production commit `193e3b3e2c56c27de5e4d1821157d3423fbfdd66` or reconcile any newer approved production changes first.
   - Verify the commit contains the exact migration, manifest, function, client, tests, and this release plan.

2. Verify production before any write.
   - Confirm Netlify site ID `264c7a36-8b0d-4a35-bedd-9d18482aaf69` and production URL `https://footballplayer.online`.
   - Confirm production Supabase ref `hvapkizujvsahvgspser`.
   - Confirm retired ref `llpufwzvgxyczxcjwupu` remains absent.
   - Confirm FP-SPR-001 migration `20260719071505_p0_shared_authority_profile_containment` is still latest or is present beneath only approved newer migrations.
   - Confirm the existing demo Auth identity, application profile, membership, club, and three teams still match the server-owned allowlist.
   - Stop if the demo actor has another membership, another user belongs to the demo club, another staff identity is assigned within the demo club, or an unexpected team, Match Day, location, or resettable owner is present.

3. Capture privacy-safe pre-release evidence.
   - Record production deploy ID and commit.
   - Capture the FP-SPR-001 authority fingerprint.
   - Capture a privacy-safe demo state fingerprint containing only hashes and counts.
   - Capture demo-scoped counts for invitations, scheduled email, notification events and commands, parent chat, staff chat, and communication history.
   - Capture global email and communication counters without exposing addresses or message content.

4. Apply only the approved forward migration.
   - Apply `20260719092052_p0_demo_reset_atomic_recovery.sql` to production.
   - Do not invoke `public.reset_demo_account_atomic` during migration.
   - Verify the audit table exists with RLS enabled.
   - Verify PUBLIC, `anon`, and `authenticated` have no function execution.
   - Verify only `service_role` can execute the reset function.
   - Verify all helper functions use a fixed empty search path.
   - Verify FP-SPR-001 triggers, policies, and grants are unchanged.

5. Deploy the exact matching application commit.
   - Deploy only `RECOVERY_COMMIT` to the production site.
   - Verify the ready deploy reports the exact commit.
   - Verify the top-level Netlify function count remains expected after the replacement.
   - Do not run the old unauthenticated reset path.

6. Perform one controlled recovery invocation.
   - Use the already approved existing demo credentials through the normal demo login UI.
   - Do not create, reset, delete, or update an Auth account or password.
   - Generate one operation UUID and retain it for retry.
   - Confirm the client signs in first and sends one authenticated reset request.
   - Confirm the operation acquires the transaction-scoped advisory lock.
   - If HTTP 409 reports an operation already running, do not start another operation. Monitor the first operation, then retry only with the same operation UUID if the response was lost.
   - Confirm the audit record reports an acquired lock and a completed outcome.

7. Verify the recovered state before calling the release Green.
   - Confirm the exact reconciled counts listed above.
   - Confirm the original club, application user, Auth identity, membership, and existing team identifiers are unchanged.
   - Confirm no duplicate team, team staff assignment, Match Day, poll, parent link, session player, or availability record exists.
   - Confirm the final privacy-safe demo fingerprint matches the manifest result.
   - Run the approved bounded role validation against disposable demo fixtures only.
   - Run one healthy-state reset with a new operation UUID and confirm the initial and final fingerprints are equal.
   - Retry that successful operation UUID and confirm it returns the cached completed result without executing another reset.

8. Recheck security and communication evidence.
   - Recompute the FP-SPR-001 authority fingerprint and require an exact match.
   - Rerun direct insert, update, upsert, membership, mixed-write, server-derived authority, disabled authority, and stale authority checks.
   - Require exact equality for every demo-scoped communication fingerprint captured before recovery.
   - Require no increase attributable to the recovery in scheduled email, email event, email log, notification command, parent chat message, staff chat message, push, invitation, or SMS counters.

9. Monitor.
   - Review the privacy-safe reset audit record, Netlify invocation outcome, PostgreSQL errors, deadlocks, unique violations, and timeouts.
   - Monitor for at least one complete release verification window.
   - Do not expose raw database errors, tokens, credentials, user identifiers, or personal data in release reporting.

10. Containment and rollback rules.
    - Never roll back FP-SPR-001.
    - If migration application fails, stop before deploying code.
    - If code deployment fails after migration, leave the dormant service-role-only database operation in place and stop. Do not invoke it directly as a workaround.
    - If lock acquisition conflicts, wait or retry the same operation UUID. Do not bypass the lock.
    - If reset verification fails, the database transaction must already have rolled back. Keep the release Red, do not run manual partial repairs, and preserve audit evidence.
    - If any communication counter changes, keep the release Red and contain the demo entry point while preserving the authority release.
    - If real-data isolation or authority fingerprints differ, stop immediately and escalate. Do not attempt cleanup.

## Required release result

The recovery release remains Red or Amber until the production migration, exact matching deployment, one controlled recovery, healthy retry, bounded role validation, authority regression, communication counter comparison, and monitoring all pass. The FP-SPR-001 authority containment remains live throughout.
