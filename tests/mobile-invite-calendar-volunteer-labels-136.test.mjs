import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  getCoachVolunteerAssignmentLabel,
  getCoachVolunteerPersonLabel,
} from '../apps/mobile-core/src/coachMatchDayCore.js'
import {
  enrichParentMatchInvitations,
  getParentGoogleCalendarUrl,
} from '../apps/parent-mobile/src/parentExperience.js'
import { enrichVolunteerEligibilityRecipients } from '../netlify/functions/lib/_volunteer-recipient-labels.js'

test('Invites merge the authoritative match fields used by the working Calendar action', () => {
  const [invitation] = enrichParentMatchInvitations([
    {
      eventId: 'match-1',
      eventTitle: 'Match Day vs Future Football Elite U14',
      invitationType: 'match_attendance',
    },
  ], [
    {
      id: 'match-1',
      kickoffTime: '11:45',
      matchDate: '2026-09-26',
      matchDurationMinutes: 80,
      opponent: 'Future Football Elite U14',
      teamName: 'U14 JPL 26/27',
      venueAddress: 'Bawburgh Road, Easton, Norwich, NR9 5DX',
    },
  ])

  assert.equal(invitation.eventDate, '2026-09-26')
  assert.equal(invitation.eventStart, '2026-09-26T11:45:00')
  assert.equal(invitation.eventLocation, 'Bawburgh Road, Easton, Norwich, NR9 5DX')
  const url = new URL(getParentGoogleCalendarUrl(invitation))
  assert.equal(url.searchParams.get('dates'), '20260926T114500/20260926T130500')
  assert.equal(url.searchParams.get('location'), 'Bawburgh Road, Easton, Norwich, NR9 5DX')
})

test('Coach volunteer labels prefer the Parent display name and retain an email fallback', () => {
  const requests = [{ parentLinkId: 'parent-1', recipientEmail: 'parent@example.com', recipientName: 'Jamie Parent' }]
  assert.equal(getCoachVolunteerPersonLabel(requests[0]), 'Jamie Parent')
  assert.equal(getCoachVolunteerAssignmentLabel({ id: 'assignment-1', parentLinkId: 'parent-1', playerName: 'Child Player' }, requests), 'Jamie Parent')
  assert.equal(getCoachVolunteerPersonLabel({ recipientEmail: 'parent@example.com' }), 'parent@example.com')
})

test('Volunteer eligibility enrichment stays within the fixture and club scope', async () => {
  const calls = []
  const adminSupabase = {
    from(table) {
      const state = { table }
      const query = {
        select() { return query },
        eq(column, value) { calls.push([table, column, value]); return query },
        in(column, values) {
          calls.push([table, column, values])
          if (table === 'match_day_availability_requests') return Promise.resolve({ data: [{ id: 'request-1', player_id: 'player-1', parent_link_id: 'link-1', recipient_email: 'old@example.com', recipient_name: 'old username' }], error: null })
          if (table === 'parent_player_links') return Promise.resolve({ data: [{ id: 'link-1', player_id: 'player-1', club_id: 'club-1', auth_user_id: 'auth-1', email: 'parent@example.com', status: 'active' }], error: null })
          if (table === 'users') return Promise.resolve({ data: [{ id: 'auth-1', display_name: 'Jamie Parent', name: '', email: 'parent@example.com' }], error: null })
          return Promise.resolve({ data: [], error: null })
        },
      }
      return query
    },
  }

  const result = await enrichVolunteerEligibilityRecipients(adminSupabase, {
    eligibility: [{ auth_user_id: null, parent_link_id: null, eligible: false, reason: 'Scorer not offered', request_id: 'request-1' }],
    match: { club_id: 'club-1', id: 'match-1' },
  })

  assert.equal(result[0].recipient_name, 'Jamie Parent')
  assert.equal(result[0].eligible, false)
  assert.equal(result[0].auth_user_id, null)
  assert.equal(result[0].parent_link_id, null)
  assert.equal(result[0].confirmed_parent_link_id, 'link-1')
  assert.equal(result[0].confirmed_auth_user_id, 'auth-1')
  assert.ok(calls.some((call) => call[0] === 'match_day_availability_requests' && call[1] === 'match_day_id' && call[2] === 'match-1'))
  assert.ok(calls.some((call) => call[0] === 'parent_player_links' && call[1] === 'club_id' && call[2] === 'club-1'))
  assert.equal(calls.some((call) => call[0] === 'users' && call[1] === 'club_id'), false)
})

test('Volunteer names never resolve through a different player, club, or ambiguous legacy link', async () => {
  for (const badLinks of [
    [{ id: 'link-1', player_id: 'other-player', club_id: 'club-1', status: 'active', auth_user_id: 'foreign', email: 'parent@example.com' }],
    [{ id: 'link-1', player_id: 'player-1', club_id: 'other-club', status: 'active', auth_user_id: 'foreign', email: 'parent@example.com' }],
    [{ id: 'link-1', player_id: 'player-1', club_id: 'club-1', status: 'revoked', auth_user_id: 'foreign', email: 'parent@example.com' }],
    [1, 2].map((n) => ({ id: `link-${n}`, player_id: 'player-1', club_id: 'club-1', status: 'active', auth_user_id: `foreign-${n}`, email: 'parent@example.com' })),
  ]) {
    const tables = []
    const admin = { from(table) {
      tables.push(table)
      const query = { select: () => query, eq: () => query, in: async () => ({ data: table === 'match_day_availability_requests'
        ? [{ id: 'request-1', player_id: 'player-1', player_name: 'Child One', recipient_email: 'parent@example.com', recipient_name: '' }]
        : badLinks, error: null }) }
      return query
    } }
    const [row] = await enrichVolunteerEligibilityRecipients(admin, { eligibility: [{ request_id: 'request-1', eligible: false }], match: { id: 'match-1', club_id: 'club-1' } })
    assert.equal(row.recipient_name, 'parent@example.com')
    assert.equal(tables.includes('users'), false)
  }
})
