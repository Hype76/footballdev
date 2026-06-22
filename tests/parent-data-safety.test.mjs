import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentProfileSourceUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const scheduledEmailsDomainUrl = new URL('../src/lib/domain/scheduled-emails.js', import.meta.url)
const manageScheduledEmailsFunctionUrl = new URL('../netlify/functions/manage-scheduled-emails.js', import.meta.url)
const parentCalendarMigrationUrl = new URL('../supabase/migrations/20260614030531_20260613120000_parent_calendar_visibility_controls.sql', import.meta.url)
const playerPickerMigrationUrl = new URL('../supabase/archived-migrations/not-applied-production/20260617085000_parent_data_safety_match_day_players.sql', import.meta.url)
const staffNotesMigrationUrl = new URL('../supabase/migrations/20260501100000_player_activity_and_staff_notes.sql', import.meta.url)

const fixtures = {
  authUserId: 'parent-user-1',
  unrelatedAuthUserId: 'parent-user-2',
  clubId: 'club-1',
  teamId: 'team-1',
  otherTeamId: 'team-2',
  links: [
    {
      id: 'link-child-1',
      authUserId: 'parent-user-1',
      clubId: 'club-1',
      teamId: 'team-1',
      playerId: 'player-linked-1',
      status: 'active',
    },
    {
      id: 'link-child-2',
      authUserId: 'parent-user-1',
      clubId: 'club-1',
      teamId: 'team-2',
      playerId: 'player-linked-2',
      status: 'active',
    },
    {
      id: 'link-revoked',
      authUserId: 'parent-user-1',
      clubId: 'club-1',
      teamId: 'team-1',
      playerId: 'player-revoked',
      status: 'revoked',
    },
    {
      id: 'link-unrelated-parent',
      authUserId: 'parent-user-2',
      clubId: 'club-1',
      teamId: 'team-1',
      playerId: 'player-unrelated',
      status: 'active',
    },
  ],
  players: [
    {
      id: 'player-linked-1',
      clubId: 'club-1',
      teamId: 'team-1',
      playerName: 'Linked Child One',
      section: 'Squad',
      status: 'active',
    },
    {
      id: 'player-linked-2',
      clubId: 'club-1',
      teamId: 'team-2',
      playerName: 'Linked Child Two',
      section: 'Squad',
      status: 'active',
    },
    {
      id: 'player-unrelated',
      clubId: 'club-1',
      teamId: 'team-1',
      playerName: 'Unrelated Same Team Child',
      section: 'Squad',
      status: 'active',
    },
    {
      id: 'player-archived-linked',
      clubId: 'club-1',
      teamId: 'team-1',
      playerName: 'Archived Linked Child',
      section: 'Squad',
      status: 'archived',
    },
  ],
  calendarEvents: [
    {
      id: 'event-team-visible',
      clubId: 'club-1',
      teamId: 'team-1',
      parentVisible: true,
      parentAudience: 'all_team_parents',
      title: 'Visible linked team training',
    },
    {
      id: 'event-club-visible',
      clubId: 'club-1',
      teamId: null,
      parentVisible: true,
      parentAudience: 'all_club_parents',
      title: 'Visible club day',
    },
    {
      id: 'event-private',
      clubId: 'club-1',
      teamId: 'team-1',
      parentVisible: false,
      parentAudience: 'all_team_parents',
      title: 'Private staff planning',
    },
    {
      id: 'event-other-team',
      clubId: 'club-1',
      teamId: 'team-2',
      parentVisible: true,
      parentAudience: 'all_team_parents',
      title: 'Other team activity',
    },
  ],
  matchDays: [
    {
      id: 'match-involved',
      clubId: 'club-1',
      teamId: 'team-1',
      parentVisible: true,
      parentAudience: 'involved_players',
      availabilityPlayerIds: ['player-linked-1'],
      title: 'Linked child fixture',
    },
    {
      id: 'match-other-child',
      clubId: 'club-1',
      teamId: 'team-1',
      parentVisible: true,
      parentAudience: 'involved_players',
      availabilityPlayerIds: ['player-unrelated'],
      title: 'Unrelated child fixture',
    },
    {
      id: 'match-private',
      clubId: 'club-1',
      teamId: 'team-1',
      parentVisible: false,
      parentAudience: 'all_team_parents',
      availabilityPlayerIds: ['player-linked-1'],
      title: 'Private match card',
    },
  ],
  feedback: [
    {
      id: 'feedback-visible',
      playerId: 'player-linked-1',
      parentVisible: true,
      title: 'Parent visible development feedback',
    },
    {
      id: 'feedback-staff-only',
      playerId: 'player-linked-1',
      parentVisible: false,
      title: 'Staff only feedback',
    },
    {
      id: 'feedback-unrelated',
      playerId: 'player-unrelated',
      parentVisible: true,
      title: 'Unrelated player feedback',
    },
  ],
}

function activeLinksForParent({ authUserId }) {
  return fixtures.links.filter((link) => link.authUserId === authUserId && link.status === 'active')
}

function findActiveLink({ authUserId, parentLinkId }) {
  return activeLinksForParent({ authUserId }).find((link) => link.id === parentLinkId)
}

function linkedPlayersForParent({ authUserId }) {
  const playerIds = new Set(activeLinksForParent({ authUserId }).map((link) => link.playerId))
  return fixtures.players.filter((player) => playerIds.has(player.id) && player.status !== 'archived')
}

function parentMatchDayPlayersForLink({ authUserId, parentLinkId }) {
  const link = findActiveLink({ authUserId, parentLinkId })

  if (!link) {
    return []
  }

  return fixtures.players.filter((player) =>
    player.id === link.playerId
    && player.clubId === link.clubId
    && (!link.teamId || player.teamId === link.teamId)
    && player.status !== 'archived'
    && player.section === 'Squad')
}

function visibleCalendarEventsForLink({ authUserId, parentLinkId }) {
  const link = findActiveLink({ authUserId, parentLinkId })

  if (!link) {
    return []
  }

  return fixtures.calendarEvents.filter((event) =>
    event.clubId === link.clubId
    && event.parentVisible === true
    && (
      (
        event.parentAudience === 'all_team_parents'
        && event.teamId
        && event.teamId === link.teamId
      )
      || (
        event.parentAudience === 'all_club_parents'
        && event.clubId === link.clubId
      )
    ))
}

function visibleMatchDaysForLink({ authUserId, parentLinkId }) {
  const link = findActiveLink({ authUserId, parentLinkId })

  if (!link) {
    return []
  }

  return fixtures.matchDays.filter((match) =>
    match.clubId === link.clubId
    && match.parentVisible === true
    && match.parentAudience !== 'none'
    && (
      (
        match.parentAudience === 'involved_players'
        && match.availabilityPlayerIds.includes(link.playerId)
      )
      || (
        match.parentAudience === 'all_team_parents'
        && match.teamId
        && match.teamId === link.teamId
      )
      || (
        match.parentAudience === 'all_club_parents'
        && match.clubId === link.clubId
      )
    ))
}

function visibleFeedbackForParent({ authUserId }) {
  const linkedPlayerIds = new Set(linkedPlayersForParent({ authUserId }).map((player) => player.id))
  return fixtures.feedback.filter((item) => item.parentVisible === true && linkedPlayerIds.has(item.playerId))
}

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const nextFunction = source.indexOf('\ncreate or replace function public.', start + 1)
  const nextRevoke = source.indexOf('\nrevoke ', start + 1)
  const endCandidates = [nextFunction, nextRevoke].filter((value) => value !== -1)
  const end = endCandidates.length > 0 ? Math.min(...endCandidates) : source.length
  return source.slice(start, end)
}

test('safe fixtures model linked children and unrelated controls', () => {
  const linkedPlayers = linkedPlayersForParent({ authUserId: fixtures.authUserId })

  assert.deepEqual(linkedPlayers.map((player) => player.id).sort(), ['player-linked-1', 'player-linked-2'])
  assert.equal(linkedPlayers.some((player) => player.id === 'player-unrelated'), false)
  assert.equal(linkedPlayers.some((player) => player.id === 'player-revoked'), false)
})

test('parent match day player picker fixture returns only the selected linked child', () => {
  const players = parentMatchDayPlayersForLink({
    authUserId: fixtures.authUserId,
    parentLinkId: 'link-child-1',
  })

  assert.deepEqual(players.map((player) => player.id), ['player-linked-1'])
  assert.equal(players.some((player) => player.id === 'player-unrelated'), false)
})

test('parent with no active link has no player data in fixtures and page has an empty state', async () => {
  assert.deepEqual(linkedPlayersForParent({ authUserId: 'parent-with-no-links' }), [])

  const source = await readFile(parentPortalPageUrl, 'utf8')
  assert.match(source, /No child is linked to this parent account yet/)
  assert.match(source, /Ask your club or team contact to send a parent invite/)
  assert.match(source, /setMatches\(\[\]\)/)
  assert.match(source, /setEventInvites\(\[\]\)/)
  assert.match(source, /setPlayers\(\[\]\)/)
  assert.match(source, /setSharedCalendarEvents\(\[\]\)/)
})

test('parent calendar fixture includes only parent visible relevant events', () => {
  const events = visibleCalendarEventsForLink({
    authUserId: fixtures.authUserId,
    parentLinkId: 'link-child-1',
  })

  assert.deepEqual(events.map((event) => event.id).sort(), ['event-club-visible', 'event-team-visible'])
  assert.equal(events.some((event) => event.id === 'event-private'), false)
  assert.equal(events.some((event) => event.id === 'event-other-team'), false)
})

test('parent match day fixture excludes unrelated child and private match cards', () => {
  const matches = visibleMatchDaysForLink({
    authUserId: fixtures.authUserId,
    parentLinkId: 'link-child-1',
  })

  assert.deepEqual(matches.map((match) => match.id), ['match-involved'])
  assert.equal(matches.some((match) => match.id === 'match-other-child'), false)
  assert.equal(matches.some((match) => match.id === 'match-private'), false)
})

test('parent feedback fixture only allows explicitly parent visible linked child content', () => {
  const feedback = visibleFeedbackForParent({ authUserId: fixtures.authUserId })

  assert.deepEqual(feedback.map((item) => item.id), ['feedback-visible'])
  assert.equal(feedback.some((item) => item.id === 'feedback-staff-only'), false)
  assert.equal(feedback.some((item) => item.id === 'feedback-unrelated'), false)
})

test('parent profile source loads active links for the signed-in auth user only', async () => {
  const source = await readFile(parentProfileSourceUrl, 'utf8')
  const start = source.indexOf('async function getParentPortalMemberships')
  const end = source.indexOf('function normalizeParentPortalProfile', start)
  const section = source.slice(start, end)

  assert.match(section, /\.from\('parent_player_links'\)/)
  assert.match(section, /\.eq\('auth_user_id', authUser\.id\)/)
  assert.match(section, /\.eq\('status', 'active'\)/)
  assert.match(section, /players:player_id/)
  assert.match(section, /teams:team_id/)
  assert.match(section, /clubs:club_id/)
})

test('parent portal dashboard only loads current parent data sources', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.match(source, /getParentPortalMatchDays\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /getParentPortalMatchDayPlayers\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /getParentPortalEventInvites\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /getParentPortalSharedCalendarEvents\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.doesNotMatch(source, /getParentPortalMessages|getParentPortalPolls|getParent.*Assessment|getParent.*Feedback/)
  assert.doesNotMatch(source, /player_staff_notes|getStaff|staffNotes|StaffNotes/)
})

test('parent event invite query is scoped to the active parent link and visible event audience', async () => {
  const source = await readFile(new URL('../src/lib/domain/calendar-event-invites.js', import.meta.url), 'utf8')

  assert.match(source, /\.eq\('parent_link_id', normalizedParentLinkId\)/)
  assert.match(source, /calendar_events:calendar_event_id \(id, title, event_type, starts_at, ends_at, location, notes, parent_visible, parent_audience\)/)
  assert.match(source, /calendarEvent\.parent_visible === true && calendarEvent\.parent_audience === 'involved_players'/)
})

test('event invited family notification uses the scheduled email holding queue', async () => {
  const sessionsSource = await readFile(sessionsPageUrl, 'utf8')
  const scheduledEmailsSource = await readFile(scheduledEmailsDomainUrl, 'utf8')
  const manageQueueSource = await readFile(manageScheduledEmailsFunctionUrl, 'utf8')

  assert.match(sessionsSource, /import \{ createScheduledEmail \} from '..\/lib\/domain\/scheduled-emails\.js'/)
  assert.match(sessionsSource, /calendarForm\.notifyInvitedFamilies[\s\S]*canUseUiFeature\(user, CAPABILITIES\.parentEmails\)/)
  assert.match(sessionsSource, /\.filter\(\(invite\) => invite\.notifyRequested\)/)
  assert.match(sessionsSource, /\.filter\(\(invite\) => String\(invite\.parentContactEmail \?\? ''\)\.trim\(\)\)/)
  assert.match(sessionsSource, /source: 'calendar_event_invite'/)
  assert.match(sessionsSource, /Parent portal invites were still saved\./)
  assert.match(sessionsSource, /adds a parent email to the holding queue for review before send time/)

  assert.match(scheduledEmailsSource, /action: 'create'/)
  assert.match(manageQueueSource, /async function createQueueItem/)
  assert.match(manageQueueSource, /\.from\('scheduled_email_queue'\)[\s\S]*\.insert\(/)
  assert.match(manageQueueSource, /status: 'scheduled'/)
  assert.match(manageQueueSource, /resendPayload/)
  assert.match(manageQueueSource, /if \(action === 'create'\)/)
})

test('parent portal dashboard does not call staff-only match day actions', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')

  assert.doesNotMatch(source, /\bgetMatchDays\(\{ user/)
  assert.doesNotMatch(source, /\bcreateMatchDay\(/)
  assert.doesNotMatch(source, /\bupdateMatchDay\(\{ user/)
  assert.doesNotMatch(source, /\bselectMatchDayScorer\(/)
  assert.doesNotMatch(source, /\baddStaffMatchDayGoal\(/)
  assert.doesNotMatch(source, /send-match-day-availability-requests/)
  assert.match(source, /getParentPortalMatchDays\(\{ parentLinkId: selectedLink\.id \}\)/)
  assert.match(source, /getParentPortalMatchDayPlayers\(\{ parentLinkId: selectedLink\.id \}\)/)
})

test('hardened player picker RPC is selected link and auth user scoped', async () => {
  const migration = await readFile(playerPickerMigrationUrl, 'utf8')
  const rpc = getFunctionSection(migration, 'get_parent_portal_match_day_players')

  assert.match(rpc, /where link\.id = parent_link_id_value/)
  assert.match(rpc, /and link\.auth_user_id = auth\.uid\(\)/)
  assert.match(rpc, /and link\.status = 'active'/)
  assert.match(rpc, /on player\.id = link\.player_id/)
  assert.match(rpc, /and player\.club_id = link\.club_id/)
  assert.match(rpc, /coalesce\(player\.status, 'active'\) <> 'archived'/)
  assert.match(rpc, /player\.section = 'Squad'/)
  assert.doesNotMatch(rpc, /on link\.club_id = player\.club_id\s+and \(\s+link\.team_id is null\s+or player\.team_id = link\.team_id\s+\)/)
  assert.match(migration, /revoke execute on function public\.get_parent_portal_match_day_players\(uuid\) from anon;/i)
  assert.match(migration, /grant execute on function public\.get_parent_portal_match_day_players\(uuid\) to authenticated;/i)
})

test('parent calendar and match day RPCs require parent visibility and active signed-in link', async () => {
  const migration = await readFile(parentCalendarMigrationUrl, 'utf8')
  const calendarRpc = getFunctionSection(migration, 'get_parent_portal_shared_calendar_events')
  const matchRpc = getFunctionSection(migration, 'get_parent_portal_match_days')

  for (const rpc of [calendarRpc, matchRpc]) {
    assert.match(rpc, /where id = parent_link_id_value/)
    assert.match(rpc, /and auth_user_id = auth\.uid\(\)/)
    assert.match(rpc, /and status = 'active'/)
    assert.match(rpc, /auth\.uid\(\) is not null/)
    assert.match(rpc, /parent_visible is true/)
  }

  assert.match(calendarRpc, /event\.parent_audience in \('all_team_parents', 'all_club_parents'\)/)
  assert.match(matchRpc, /match_day\.parent_audience <> 'none'/)
  assert.match(matchRpc, /request\.player_id = link\.player_id/)
})

test('staff note storage remains staff scoped and absent from parent portal output', async () => {
  const [staffNotesMigration, parentPageSource, playerPickerMigration] = await Promise.all([
    readFile(staffNotesMigrationUrl, 'utf8'),
    readFile(parentPortalPageUrl, 'utf8'),
    readFile(playerPickerMigrationUrl, 'utf8'),
  ])

  assert.match(staffNotesMigration, /create table if not exists public\.player_staff_notes/)
  assert.match(staffNotesMigration, /public\.current_user_role_rank\(\) >= 20/)
  assert.match(parentPageSource, /You only see updates the club has shared for this child/)
  assert.doesNotMatch(parentPageSource, /staff notes|team admin tools/i)
  assert.doesNotMatch(parentPageSource, /player_staff_notes|staffNotes|StaffNotes/)
  assert.doesNotMatch(playerPickerMigration, /player_staff_notes/i)
})
