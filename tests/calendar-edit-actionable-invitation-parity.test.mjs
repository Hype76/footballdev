import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { buildMatchDayActionableInvitationEmail } from '../netlify/functions/lib/_match-day-actionable-invitation.js'

const sendFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)
const calendarDomainUrl = new URL('../src/lib/domain/calendar-events.js', import.meta.url)
const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const responseFunctionUrl = new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url)
const processorUrl = new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260718055023_calendar_edit_actionable_invitation_parity.sql', import.meta.url)

const fixture = {
  id: 'match-1',
  opponent: 'Rovers',
  match_date: '2026-07-25',
  kickoff_time: '14:00:00',
  arrival_time: '13:15:00',
  venue_name: 'Town Ground',
  venue_address: '1 Football Road',
  request_scorer: true,
  request_linesman: true,
  request_referee: false,
  teams: { name: 'U15 Green' },
  clubs: { name: 'Example FC', logo_url: '' },
}

test('creation and edit use one actionable HTML and plain-text invitation builder', () => {
  const creation = buildMatchDayActionableInvitationEmail({
    appOrigin: 'https://footballplayer.online',
    match: fixture,
    player: { player_name: 'Alex Player' },
    recipient: { email: 'parent@example.com', name: 'Pat Parent', type: 'parent' },
    responseUrl: 'https://footballplayer.online/.netlify/functions/match-day-availability-confirm?token=abc',
  })
  const update = buildMatchDayActionableInvitationEmail({
    appOrigin: 'https://footballplayer.online',
    match: fixture,
    player: { player_name: 'Alex Player' },
    recipient: { email: 'parent@example.com', name: 'Pat Parent', type: 'parent' },
    responseUrl: 'https://footballplayer.online/.netlify/functions/match-day-availability-confirm?token=def',
    updated: true,
  })

  for (const email of [creation, update]) {
    assert.match(email.html, />Available<\/a>/)
    assert.match(email.html, />Maybe<\/a>/)
    assert.match(email.html, />Unavailable<\/a>/)
    assert.match(email.html, /Volunteer as Scorer/)
    assert.match(email.html, /Volunteer as Linesman/)
    assert.doesNotMatch(email.html, /Volunteer as Referee/)
    assert.match(email.text, /Available: https:\/\/footballplayer\.online/)
    assert.match(email.text, /Maybe: https:\/\/footballplayer\.online/)
    assert.match(email.text, /Unavailable: https:\/\/footballplayer\.online/)
    assert.match(email.text, /Volunteer as Scorer:/)
    assert.doesNotMatch(email.html, /parent\.footballplayer\.online\/parent-portal/)
  }
  assert.match(update.html, /existing response is preserved/i)
})

test('Calendar Match Day edits use the shared server service and no browser recipient scope', async () => {
  const [sendFunction, calendarDomain, processor] = await Promise.all([
    readFile(sendFunctionUrl, 'utf8'),
    readFile(calendarDomainUrl, 'utf8'),
    readFile(processorUrl, 'utf8'),
  ])

  assert.match(calendarDomain, /source: 'calendar_edit'/)
  assert.match(calendarDomain, /notificationRequestToken: normalizedRequestToken/)
  assert.doesNotMatch(calendarDomain, /source: 'calendar_edit'[\s\S]{0,300}(?:playerIds|recipientEmail|parentLinkId)/)
  assert.match(sendFunction, /notify_calendar_event_parents/)
  assert.match(sendFunction, /calendar_event_notification_commands/)
  assert.match(sendFunction, /calendar_event_notification_events/)
  assert.match(sendFunction, /buildMatchDayActionableInvitationEmail/)
  assert.match(sendFunction, /matchDayActionableInvitation:[\s\S]*prepared: true/)
  assert.match(sendFunction, /queue\?\.payload\?\.matchDayActionableInvitation\?\.prepared === true/)
  assert.match(sendFunction, /recipientUnits[\s\S]*parentLink\.player_id[\s\S]*recipientEmail/)
  assert.match(sendFunction, /`\$\{parentLink\.player_id\}:\$\{recipientEmail\}`/)
  assert.match(sendFunction, /match_day_role_assignments/)
  assert.match(sendFunction, /!filledRoles\.has\('scorer'\)/)
  assert.match(sendFunction, /calendarActionableInvitationBlocked: true/)
  assert.match(sendFunction, /resendPayload:[\s\S]*to: \[\]/)
  assert.match(sendFunction, /No email was released/)
  assert.match(processor, /contains\('payload', \{ communicationLog: \{ metadata: \{ notificationCommandId: command\.id \} \} \}\)/)
})

test('edit token rotation preserves responses while removed scope and closed fixtures fail closed', async () => {
  const [sendFunction, migration, responseFunction] = await Promise.all([
    readFile(sendFunctionUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
    readFile(responseFunctionUrl, 'utf8'),
  ])

  const editUpdateStart = sendFunction.indexOf('const { error: requestUpdateError }')
  assert.notEqual(editUpdateStart, -1)
  const editUpdate = sendFunction.slice(
    editUpdateStart,
    sendFunction.indexOf('const responseUrl =', editUpdateStart),
  )
  assert.match(editUpdate, /token_hash: tokenHash/)
  assert.match(editUpdate, /expires_at: expiry/)
  assert.doesNotMatch(editUpdate, /status:/)
  assert.doesNotMatch(editUpdate, /volunteer_scorer_response:/)
  assert.match(sendFunction, /staleRequests[\s\S]*expires_at: new Date\(0\)\.toISOString\(\)/)
  assert.match(migration, /match_day\.deleted_at is null/)
  assert.match(migration, /not in \('cancelled', 'full_time', 'postponed'\)/)
  assert.match(migration, /parent_link\.status = 'active'/)
  assert.match(migration, /player\.club_id = request\.club_id/)
  assert.match(migration, /player\.team_id = request\.team_id/)
  assert.match(migration, /request\.expires_at >= timezone\('utc', now\(\)\)/)
  assert.match(migration, /calendar_event_invites_invalidate_match_day_tokens/)
  assert.match(migration, /request\.status <> 'expired'/)
  assert.match(responseFunction, /id="volunteer-\$\{escapeHtml\(normalizeText\(label\)\.toLowerCase\(\)\)\}"/)
})

test('edit remains opt-in and the UI promises updated actionable links', async () => {
  const sessionsPage = await readFile(sessionsPageUrl, 'utf8')

  assert.match(sessionsPage, /if \(notifyRequested\) \{[\s\S]*notifyCalendarEventParents/)
  assert.match(sessionsPage, /Send updated invitations to parents/)
  assert.match(sessionsPage, /secure availability and configured volunteer response links/)
  assert.match(sessionsPage, /const notifyRequested = calendarForm\.notifyInvitedFamilies/)
})
