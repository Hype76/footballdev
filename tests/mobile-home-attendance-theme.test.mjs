import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildParentCalendarEvents, getParentCalendarAttendanceInvitation } from '../apps/mobile-core/src/parentCalendarCore.js'
import { createCoachThemePreference } from '../apps/coach-mobile/src/coachThemePreferenceCore.js'
import { createCoachTheme, createMatchInvitesTheme } from '../apps/coach-mobile/src/coachThemeCore.js'
import { getParentAnnouncementMessages, prepareParentChatRooms } from '../apps/parent-mobile/src/parentPresentationCore.js'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'

const invite = (date, extra = {}) => ({ invitationId: `training:${date}`, invitationType: 'training_attendance', eventId: 'training', eventStart: `${date}T18:00:00Z`, ...extra })

test('event details select this occurrence, including an already answered invitation', () => {
  const invitations = [invite('2099-09-17'), invite('2099-09-10', { responseState: 'available', canChangeResponse: true })]
  const event = { id: 'training', startsAt: '2099-09-10T18:00:00Z', title: 'JPL Training' }
  const [calendar] = buildParentCalendarEvents({ calendarEvents: [event], invitations })
  assert.equal(calendar.invitationId, 'training:2099-09-10')
  assert.equal(getParentCalendarAttendanceInvitation(calendar, invitations), invitations[1])
  assert.equal(getParentCalendarAttendanceInvitation(calendar, [invitations[0]]), null)
  assert.equal(getParentCalendarAttendanceInvitation(calendar, []), null)
})

test('attendance uses attendance invitation rather than volunteer offer and rejects stale occurrence ids', () => {
  const event = { sourceId: 'training', startsAt: '2099-09-10T18:00:00Z', invitationId: 'training:2099-09-17' }
  const attendance = invite('2099-09-10')
  assert.equal(getParentCalendarAttendanceInvitation(event, [invite('2099-09-10', { invitationType: 'match_role' }), invite('2099-09-17'), attendance]), attendance)
})

test('late preference reads cannot replace a newer light-mode choice', async () => {
  let resolveRead
  const saved = []
  const preference = createCoachThemePreference({ read: () => new Promise(resolve => { resolveRead = resolve }), write: async mode => { saved.push(mode) } })
  const loading = preference.read()
  await preference.write('light')
  resolveRead('dark')
  assert.equal(await loading, 'light')
  assert.equal(preference.peek(), 'light')
  assert.equal(await preference.read(), 'light')
  assert.deepEqual(saved, ['light'])
})

test('rapid theme choices persist in order and route palettes preserve the chosen mode', async () => {
  const writes = []
  const preference = createCoachThemePreference({ read: async () => 'dark', write: async mode => { writes.push(mode) } })
  await Promise.all([preference.write('light'), preference.write('dark'), preference.write('light')])
  assert.deepEqual(writes, ['light', 'dark', 'light'])
  for (const mode of ['light', 'dark']) {
    const home = createCoachTheme({ mode })
    const invites = createMatchInvitesTheme(null, mode)
    assert.equal(invites.mode, home.mode)
    if (mode === 'light') assert.equal(invites.tokens.background, home.tokens.background)
  }
  assert.equal(preference.peek(), 'light')
})

test('saved coach follow-ups retain their event context and appear separately from club announcements', () => {
  const source = readFileSync(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8')
  const node = parse(source, { sourceType: 'module' }).program.body.find(node => node.id?.name === 'normalizeMessage')
  const normalizeMessage = new Function('normalizeText', `${source.slice(node.start, node.end)}; return normalizeMessage`)(value => String(value ?? '').trim())
  const reminder = normalizeMessage({ id: 'reminder', created_at: '2026-09-10T09:57:00Z', sender_name: 'Simon Bailey', metadata: {
    source: 'club_announcement', authorType: 'club_staff', type: 'availability_follow_up', body: 'Please confirm attendance.',
    calendarEventId: 'training', occurrenceDate: '2099-09-10', eventTitle: 'JPL Training 3G Pitch', eventStartsAt: '2099-09-10T18:00:00Z',
  } })
  const announcement = { ...reminder, id: 'club', messageType: '', body: 'Club news' }
  const rooms = prepareParentChatRooms([], [reminder, announcement])
  assert.equal(rooms.find(room => room.id === 'coach-reminders').title, 'Coach reminders')
  assert.match(rooms.find(room => room.id === 'coach-reminders').latestMessage, /JPL Training 3G Pitch/)
  assert.equal(getParentAnnouncementMessages([reminder, announcement])[0].legacyMessageId, 'club')
  const [message] = getParentAnnouncementMessages([reminder, announcement], 'coach-reminders')
  assert.equal(message.senderName, 'Simon Bailey')
  assert.equal(message.calendarEventId, 'training')
  assert.equal(message.occurrenceDate, '2099-09-10')
  assert.equal(getParentCalendarAttendanceInvitation({ sourceId: message.calendarEventId, startsAt: message.eventStartsAt }, [invite('2099-09-17'), invite('2099-09-10')]).invitationId, 'training:2099-09-10')
})

test('Home only loads displayed primary sources and tolerates one unavailable source', async () => {
  const source = readFileSync(new URL('../apps/mobile-core/src/coachPhase31GData.js', import.meta.url), 'utf8')
  const nodes = parse(source, { sourceType: 'module' }).program.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
  const body = ['sourceError', 'getCoachPhase31GPrimaryHomeSnapshot'].map(name => { const node = nodes.find(node => node?.id?.name === name); return source.slice(node.start, node.end) }).join('\n')
  const load = new Function('getCoachMatchDays', 'getCoachSessions', 'getCoachCalendarResources', 'withMobileAsyncTimeout', 'buildCoachHomeOperationalSnapshot', `${body}; return getCoachPhase31GPrimaryHomeSnapshot`)(
    async () => { throw new Error('Unavailable') }, async () => [], async () => [{ id: 'training' }], loader => loader(), input => input,
  )
  const result = await load({})
  assert.equal(result.calendar[0].id, 'training')
  assert.deepEqual(result.errors, ['matches:Unavailable'])
  assert.equal('summary' in result, false)
})
