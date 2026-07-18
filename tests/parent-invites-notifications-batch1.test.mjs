import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getParentInvitationView,
  isParentInvitationPending,
  normalizeParentInvitation,
  PARENT_INVITATION_VIEWS,
  splitParentInvitationsForViews,
} from '../src/lib/domain/parent-invitations.js'

const migrationUrl = new URL('../supabase/migrations/20260714130128_parent_invites_notifications_batch1.sql', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentPortalShellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

const [migration, parentPortalPage, parentPortalShell, matchDayPage] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(parentPortalPageUrl, 'utf8'),
  readFile(parentPortalShellUrl, 'utf8'),
  readFile(matchDayPageUrl, 'utf8'),
])

function invitation(overrides = {}) {
  return normalizeParentInvitation({
    invitation_id: overrides.invitation_id || 'invite-1',
    invitation_type: overrides.invitation_type || 'match_attendance',
    source_record_id: overrides.source_record_id || 'request-1',
    source_event_type: 'match_day',
    event_id: overrides.event_id || 'fixture-1',
    event_title: overrides.event_title || 'Team vs Opponent',
    event_start: overrides.event_start || '2030-07-20T10:00:00.000Z',
    event_end: overrides.event_end || '2030-07-20T12:00:00.000Z',
    invitation_state: overrides.invitation_state || 'active',
    response_state: overrides.response_state || 'awaiting_response',
    can_respond: overrides.can_respond ?? true,
    can_change_response: overrides.can_change_response ?? true,
    is_pending: overrides.is_pending ?? false,
    ...overrides,
  })
}

test('pending badge inputs count only server-authoritative actionable rows', () => {
  const rows = [
    invitation({ invitation_id: 'pending', is_pending: true }),
    invitation({ invitation_id: 'accepted', response_state: 'accepted' }),
    invitation({ invitation_id: 'declined', response_state: 'declined' }),
    invitation({ invitation_id: 'expired', invitation_state: 'expired' }),
    invitation({ invitation_id: 'cancelled', invitation_state: 'cancelled' }),
    invitation({ invitation_id: 'past', event_end: '2030-07-18T12:00:00.000Z' }),
    invitation({ invitation_id: 'duplicate', source_record_id: 'request-1', is_pending: false }),
  ]

  assert.deepEqual(rows.filter(isParentInvitationPending).map((row) => row.invitationId), ['pending'])
})

test('pending, responded or upcoming, and history partitions keep season records compact', () => {
  const rows = [
    invitation({ invitation_id: 'pending', is_pending: true }),
    invitation({ invitation_id: 'responded', response_state: 'accepted' }),
    invitation({ invitation_id: 'cancelled', invitation_state: 'cancelled' }),
    invitation({ invitation_id: 'past', event_end: '2030-07-18T12:00:00.000Z' }),
  ]
  const views = splitParentInvitationsForViews(rows, { now: '2030-07-19T12:00:00.000Z' })

  assert.deepEqual(views.pending.map((row) => row.invitationId), ['pending'])
  assert.deepEqual(views.upcoming.map((row) => row.invitationId), ['responded'])
  assert.deepEqual(views.history.map((row) => row.invitationId).sort(), ['cancelled', 'past'])
  assert.equal(getParentInvitationView(rows[2], { now: '2030-07-19T12:00:00.000Z' }), PARENT_INVITATION_VIEWS.history)
})

test('pending summary stays parent scoped, expiry aware, and duplicate safe', () => {
  assert.match(migration, /from public\.get_parent_portal_invitation_state\(parent_link_id_value\)/i)
  assert.match(migration, /partition by[\s\S]*invitation\.parent_link_id[\s\S]*invitation\.event_id[\s\S]*invitation\.child_id[\s\S]*invitation\.invitation_type/i)
  assert.match(migration, /ranked\.actionable_rank = 1/i)
  assert.match(migration, /ranked\.invitation_state in \('active', 'offered'\)/i)
  assert.match(migration, /ranked\.response_state in \('awaiting_response', 'no_response'\)/i)
  assert.match(migration, /ranked\.response_deadline is null or ranked\.response_deadline > now\(\)/i)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_invitation_summary\(uuid\) from anon/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_invitation_summary\(uuid\) to authenticated, service_role/i)
})

test('desktop, overview, and mobile badges share pending rows and hide zero', () => {
  assert.match(parentPortalPage, /parentInvitations\.filter\(isParentInvitationPending\)/)
  assert.match(parentPortalPage, /eventInvites=\{pendingParentInvitations\}/)
  assert.match(parentPortalPage, /invites: currentInvitationCount/)
  assert.match(parentPortalPage, /variant="mobile"/)
  assert.match(parentPortalShell, /typeof count === 'number' && count > 0/)
})

test('invites page defaults to Pending and bounds history rendering', () => {
  assert.match(parentPortalPage, /useState\(PARENT_INVITATION_VIEWS\.pending\)/)
  assert.match(parentPortalPage, /label: 'Responded or Upcoming'/)
  assert.match(parentPortalPage, /const parentInvitationHistoryPageSize = 8/)
  assert.match(parentPortalPage, /\.slice\(0, visibleHistoryCount\)/)
  assert.match(parentPortalPage, /Load more history/)
  assert.match(parentPortalPage, /You're all caught up\. There are no invitations waiting for your response\./)
  assert.match(parentPortalPage, /min-w-0 overflow-hidden/)
  assert.match(parentPortalPage, /break-words/)
  assert.match(parentPortalPage, /max-w-full gap-2 overflow-x-auto/)
})

test('volunteer acceptance notification is transition-only and team scoped', () => {
  assert.match(migration, /after update of volunteer_scorer_response, volunteer_linesman_response, volunteer_referee_response/i)
  assert.match(migration, /previous_response[\s\S]*= 'yes'[\s\S]*next_response[\s\S]*<> 'yes'/i)
  assert.match(migration, /from public\.team_staff assignment[\s\S]*assignment\.team_id = new\.team_id[\s\S]*assignment\.user_id = staff\.id/i)
  assert.match(migration, /staff\.role not in \('parent_portal', 'super_admin'\)/i)
  assert.match(migration, /coalesce\(staff\.status, 'active'\) = 'active'/i)
  assert.match(migration, /staff\.id = fixture\.created_by/i)
  assert.match(migration, /event_type[\s\S]*'volunteer_role_accepted_staff'/i)
  assert.match(migration, /Open Match Day/)
})

test('player email follows the saved selection transition and not temporary UI state', () => {
  assert.match(migration, /after insert or update of status[\s\S]*on public\.match_day_player_squad_decisions/i)
  assert.match(migration, /new\.status <> 'selected'[\s\S]*old\.status = 'selected'/i)
  assert.match(migration, /transition_key_value := concat\(new\.id, ':selected:', gen_random_uuid\(\)\)/i)
  assert.doesNotMatch(matchDayPage, /scheduled_email_queue|player_selected_guardian|notify_guardians_on_player_selection/i)
  assert.match(migration, /View match details and open Match Chat/)
  assert.match(migration, /https:\/\/parent\.footballplayer\.online\/parent-chat\?matchDayId=/)
})

test('selection recipients are current guardian links only and isolated per queue row', () => {
  assert.match(migration, /parent_link\.club_id = new\.club_id/i)
  assert.match(migration, /parent_link\.player_id = new\.player_id/i)
  assert.match(migration, /parent_link\.team_id = new\.team_id or parent_link\.team_id is null/i)
  assert.match(migration, /parent_link\.status = 'active'/i)
  assert.match(migration, /parent_link\.auth_user_id is not null/i)
  assert.match(migration, /distinct on \(lower\(btrim\(parent_link\.email\)\)\)/i)
  assert.match(migration, /'to', jsonb_build_array\(guardian\.email\)/i)
  assert.doesNotMatch(migration, /string_agg\([^)]*guardian\.email/i)
})

test('notification idempotency and failure ledger preserve core transitions', () => {
  assert.match(migration, /unique index if not exists match_day_notification_events_transition_recipient_key/i)
  assert.match(migration, /on conflict \(event_type, transition_key, lower\(recipient_email\)\) do nothing/i)
  assert.match(migration, /exception[\s\S]*when others then[\s\S]*status = 'failed'/i)
  assert.match(migration, /notificationError/i)
  assert.match(migration, /return new;[\s\S]*exception when others then[\s\S]*return new;/i)
  assert.match(migration, /revoke all privileges on table public\.match_day_notification_events from public, anon, authenticated/i)
})

test('selection email includes only the selected child fixture context', () => {
  for (const label of ['Team:', 'Opponent:', 'Date:', 'Kick off:', 'Meet time:', 'Venue:']) {
    assert.match(migration, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(migration, /child_display_name[\s\S]*has been selected/i)
  assert.doesNotMatch(migration, /other children|squad list|all players/i)
})
