import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationPath = new URL('../supabase/migrations/20260725174533_platform_club_access_management.sql', import.meta.url)
const repairPath = new URL('../supabase/repairs/FP-V1-PLATFORM-CLUB-ACCESS-AUDIT-RECOVERY-25.sql', import.meta.url)
const functionPath = new URL('../netlify/functions/platform-club-access.js', import.meta.url)
const componentPath = new URL('../src/components/platform/ClubAccessManagement.jsx', import.meta.url)
const staffAcceptancePath = new URL('../netlify/functions/create-staff-account.js', import.meta.url)

const [migration, repair, handler, component, staffAcceptance] = await Promise.all([
  readFile(migrationPath, 'utf8'),
  readFile(repairPath, 'utf8'),
  readFile(functionPath, 'utf8'),
  readFile(componentPath, 'utf8'),
  readFile(staffAcceptancePath, 'utf8'),
])

test('Platform Admin authority is enforced on every server action', () => {
  assert.match(handler, /loadActiveAuthorityProfile/)
  assert.match(handler, /profile\.role !== 'super_admin'/)
  assert.match(migration, /platform_access_is_admin_v1\(p_actor_id\)/)
  assert.match(migration, /join public\.platform_admins pa/)
  assert.match(migration, /revoke all on function public\.platform_create_access_invite_v1[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.platform_create_access_invite_v1[\s\S]*to service_role/)
})

test('owner invitation replacement uses a fresh digest and atomically supersedes the source', () => {
  assert.match(handler, /generateInvitationValue\(\)/)
  assert.match(handler, /digestInvitationValue\(ownerToken\)/)
  assert.doesNotMatch(handler, /return json\([\s\S]{0,300}\btoken:/)
  assert.match(migration, /pg_advisory_xact_lock/)
  assert.match(migration, /set status = 'replaced'[\s\S]*replaced_at = timezone\('utc', now\(\)\)/)
  assert.match(migration, /set replaced_by_invite_id = inserted_owner\.id/)
  assert.match(migration, /club_owner_invites_one_active_identity_key/)
})

test('accepted and replaced invitations cannot be reissued', () => {
  assert.match(migration, /owner_source\.accepted_at is not null/)
  assert.match(migration, /owner_source\.replaced_at is not null/)
  assert.match(migration, /staff_source\.accepted_at is not null/)
  assert.match(migration, /staff_source\.replaced_at is not null/)
  assert.match(migration, /source_not_replaceable/)
})

test('duplicate membership and invitation states fail closed with structured audits', () => {
  assert.match(migration, /active_membership_exists/)
  assert.match(migration, /pending_invitation_exists/)
  assert.match(migration, /platform_access_duplicate_invitation_denied/)
  assert.match(migration, /platform_access_audit_v1/)
  assert.match(migration, /correlation_id/)
  assert.match(migration, /denialCode/)
})

test('provider acceptance and message ID are recorded without exposing invitation secrets', () => {
  assert.match(handler, /getProviderMessageId/)
  assert.match(handler, /platform_record_access_invite_delivery_v1/)
  assert.match(migration, /provider_message_id/)
  assert.match(migration, /invite_sent_at = case when normalized_delivery = 'provider_accepted'/)
  assert.match(migration, /delivery_state_conflict/)
  assert.doesNotMatch(component, /providerMessageId/)
  assert.doesNotMatch(component, /inviteToken|token_digest|auth_user_id/)
})

test('existing Auth users use explicit assignment and new recipients use invitations', () => {
  assert.match(handler, /findAuthUserByEmail/)
  assert.match(handler, /platform_assign_existing_access_v1/)
  assert.match(handler, /existing_user_assigned/)
  assert.match(migration, /target_identity_mismatch/)
  assert.match(migration, /on conflict \(auth_user_id, club_id\) do update/)
  assert.match(handler, /createInvite/)
})

test('Team Admin scope requires explicit same-club teams and prevents duplicates', () => {
  assert.match(migration, /cardinality\(team_ids\) = 0/)
  assert.match(migration, /t\.club_id = p_club_id/)
  assert.match(migration, /cross_club_team/)
  assert.match(migration, /insert into public\.team_staff/)
  assert.match(migration, /on conflict \(team_id, user_id\) do nothing/)
  assert.match(component, /selectedTeamIds/)
  assert.match(component, /No club-wide access is inferred/)
})

test('multi-team staff invitations are accepted only for active teams in the invited club', () => {
  assert.match(migration, /create table if not exists public\.club_user_invite_teams/)
  assert.match(staffAcceptance, /club_user_invite_teams/)
  assert.match(staffAcceptance, /\.eq\('teams\.club_id', invite\.club_id\)/)
  assert.match(staffAcceptance, /inviteTeamIds\.map/)
  assert.match(staffAcceptance, /Team Admin invitation has no active team assignment/)
})

test('remove and restore preserve the Auth account and historical business records', () => {
  assert.match(migration, /platform_access_assignment_history/)
  assert.match(migration, /state in \('removed', 'restored'\)/)
  assert.match(migration, /platform_access_assignment_removed/)
  assert.match(migration, /platform_access_assignment_restored/)
  assert.doesNotMatch(migration, /delete from auth\.users/)
  assert.doesNotMatch(migration, /delete from public\.(evaluations|assessment_sessions|fixtures|calendar_events|platform_feedback)/)
  assert.match(component, /without deleting the account or historical records/)
})

test('final administrator removal is blocked and ownership transfer is deliberate', () => {
  assert.match(migration, /active_admin_count <= 1/)
  assert.match(migration, /platform_access_critical_removal_denied/)
  assert.match(migration, /final_administrator/)
  assert.match(handler, /transfer_owner/)
  assert.match(handler, /ownership_transfer_requires_dedicated_workflow/)
  assert.match(component, /final active administrator is protected/)
})

test('audit writes are part of mutation transactions and contain safe structured context', () => {
  assert.match(migration, /event_category,[\s\S]*severity,[\s\S]*outcome,[\s\S]*correlation_id/)
  assert.match(migration, /'feature', 'platform_club_access'/)
  assert.match(migration, /'operation', p_action/)
  assert.match(migration, /'netlify_function'/)
  assert.doesNotMatch(migration, /source[\s\S]{0,800}'platform_club_access'\s*\)/)
  assert.match(migration, /recipient.*regexp_replace/)
  assert.match(migration, /previousState/)
  assert.match(migration, /newState/)
  assert.doesNotMatch(migration, /p_token_(?:digest|value).*jsonb_build_object/)
  assert.doesNotMatch(migration, /password/)
})

test('reviewed production repair replaces only the audit helper contract and keeps the source constraint untouched', () => {
  assert.match(repair, /create or replace function public\.platform_access_audit_v1/)
  assert.match(repair, /'feature', 'platform_club_access'/)
  assert.match(repair, /'operation', p_action/)
  assert.match(repair, /'netlify_function'/)
  assert.match(repair, /revoke all on function public\.platform_access_audit_v1/)
  assert.match(repair, /grant execute on function public\.platform_access_audit_v1[\s\S]*to service_role/)
  assert.doesNotMatch(repair, /alter table public\.audit_logs/)
  assert.doesNotMatch(repair, /audit_logs_source_check/)
})

test('mutation errors are caught and known database failures return structured 4xx responses', () => {
  for (const action of [
    'handleInviteAction',
    'handleCancel',
    'handleAssignmentChange',
    'handleOwnershipTransferAttempt',
  ]) {
    assert.match(handler, new RegExp(`return await ${action}`))
  }

  assert.match(handler, /'23514': 409/)
  assert.match(handler, /'42501': 403/)
  assert.match(handler, /getErrorStatusCode\(error\)/)
  assert.match(handler, /getSafeErrorMessage\(error, statusCode\)/)
})

test('no email is sent on reads, existing-user assignment, cancellation, remove, or restore', () => {
  const sendCallCount = (handler.match(/await sendAccessInvite\(/g) || []).length
  assert.equal(sendCallCount, 1)
  assert.match(handler, /communicationSent: false/)
  assert.match(handler, /event\.httpMethod === 'GET'/)
  assert.match(handler, /action === 'cancel_invitation'/)
  assert.match(handler, /action === 'remove' \|\| action === 'restore'/)
})

test('reserved non-delivery smoke mode is restricted to FP TEST and example.invalid', () => {
  assert.match(handler, /deliveryMode === 'reserved_test'/)
  assert.match(handler, /isSyntheticClubName/)
  assert.match(handler, /isReservedNonDeliveryRecipient/)
  assert.match(handler, /example\.invalid/)
  assert.match(handler, /communicationSent: false/)
})

test('desktop and mobile UI exposes all required access sections and confirmations', () => {
  for (const label of [
    'Club access',
    'Owner',
    'Club Admins',
    'Team Administrators',
    'Pending invitations',
    'Removed access',
    'Invite Club Admin',
    'Assign Team Admin',
    'Replace invitation',
    'Cancel invitation',
    'Remove access',
    'Restore access',
  ]) {
    assert.match(component, new RegExp(label))
  }

  assert.match(component, /window\.confirm/)
  assert.match(component, /sm:grid-cols|xl:grid-cols/)
})
