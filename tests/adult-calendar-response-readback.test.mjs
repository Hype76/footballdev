import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

process.env.VITE_SUPABASE_URL = 'https://adult-calendar-readback.example.test'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key'
const { normalizeCalendarEventInvite } = await import('../src/lib/domain/calendar-event-invites.js')
const { buildEventResponseReadModel } = await import('../src/lib/domain/event-response-read-model.js')
const source = readFileSync('src/components/sessions/AdultCalendarResponses.jsx', 'utf8').replace('export function', 'function')
const compiled = transformSync(source, { loader: 'jsx', jsxFactory: 'React.createElement' }).code
const AdultCalendarResponses = new Function('React', compiled + ';return AdultCalendarResponses')(React)

test('organizer readback renders saved adult choices and keeps separate Parent fields', () => {
  const invites = ['available', 'maybe', 'unavailable'].map((status, index) => normalizeCalendarEventInvite({
    id: String(index), club_id: 'club', team_id: 'team', player_id: 'player-' + index,
    calendar_event_id: 'event', recipient_type: 'parent_and_player', player_contact_email: 'adult@example.test',
    invite_status: 'active', responded_at: 'parent-response-time', adult_response_status: status,
    adult_responded_at: 'adult-response-time', players: { id: 'player-' + index, player_name: 'Player ' + index },
  }))
  assert.equal(invites[0].adultResponseState, 'available')
  assert.equal(invites[0].adultRespondedAt, 'adult-response-time')
  assert.equal(invites[0].respondedAt, 'parent-response-time')
  assert.equal(invites[0].inviteStatus, 'active')
  const html = renderToStaticMarkup(React.createElement(AdultCalendarResponses, { invites }))
  for (const label of ['Player 0', 'Player 1', 'Player 2', 'Attending', 'Maybe', 'Not attending']) assert.ok(html.includes(label))
  assert.ok(html.includes('aria-label="Adult Player responses"'))
  const model = buildEventResponseReadModel({ event: { sourceType: 'calendar', sourceId: 'event', eventType: 'general' }, calendarInvites: invites })
  assert.deepEqual(model.participants.map(row => row.responseState), ['available', 'maybe', 'unavailable'])
  assert.ok(model.participants.every(row => row.responseSource === 'adult_player'))
  const rendered = renderToStaticMarkup(React.createElement(AdultCalendarResponses, { invites: model.participants }))
  for (const label of ['Attending', 'Maybe', 'Not attending']) assert.ok(rendered.includes(label))
})

test('ordinary Parent invitations do not become adult responses and invited adults show pending', () => {
  const parent = normalizeCalendarEventInvite({ id: 'parent-only', calendar_event_id: 'event', player_id: 'parent-child', recipient_type: 'parent_guardian', notify_requested: true, adult_response_status: 'available' })
  assert.equal(renderToStaticMarkup(React.createElement(AdultCalendarResponses, { invites: [parent] })), '')
  const model = buildEventResponseReadModel({ event: { sourceType: 'calendar', sourceId: 'event', eventType: 'general' }, calendarInvites: [parent] })
  assert.equal(model.participants[0].responseState, 'not_requested')
  const html = renderToStaticMarkup(React.createElement(AdultCalendarResponses, { invites: [normalizeCalendarEventInvite({ id: 'adult', calendar_event_id: 'event', recipient_type: 'player' })] }))
  assert.ok(html.includes('Awaiting response'))
})
