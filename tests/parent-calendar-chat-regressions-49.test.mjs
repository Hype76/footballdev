import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const calendarUrl = new URL('../src/components/sessions/FootballCalendar.jsx', import.meta.url)
const chatUrl = new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url)
const chatOrderUrl = new URL('../src/components/chat/parent-chat-order.js', import.meta.url)
const parentPortalUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const stylesUrl = new URL('../src/index.css', import.meta.url)

test('Parent dark Calendar uses semantic event states with readable dark surfaces', async () => {
  const [calendar, styles] = await Promise.all([
    readFile(calendarUrl, 'utf8'),
    readFile(stylesUrl, 'utf8'),
  ])

  assert.match(calendar, /data-calendar-visual-state=\{getCalendarVisualState\(event\) \|\| undefined\}/)
  assert.match(calendar, /data-calendar-event-type=\{event\.type \|\| 'training'\}/)
  for (const state of ['accepted', 'declined', 'action_required', 'informational', 'past', 'cancelled_or_postponed']) {
    assert.match(styles, new RegExp(`data-calendar-visual-state='${state}'`))
  }
  assert.match(styles, /\.theme-dark \.parent-portal-theme-scope/)
  assert.match(styles, /data-calendar-event-type='training'\]:not\(\[data-calendar-visual-state\]\)/)
})

test('Calendar event modal does not duplicate Add to calendar', async () => {
  const source = await readFile(parentPortalUrl, 'utf8')
  const modalStart = source.indexOf('function ParentCalendarEventModal')
  const modalEnd = source.indexOf('function ParentUpcomingEvents', modalStart)
  const modal = source.slice(modalStart, modalEnd)

  assert.notEqual(modalStart, -1)
  assert.notEqual(modalEnd, -1)
  assert.doesNotMatch(modal, /Add to calendar/)
  assert.doesNotMatch(modal, /calendarUrl/)
})

test('Parent Chat orders current room messages newest first', async () => {
  const [source, ordering] = await Promise.all([
    readFile(chatUrl, 'utf8'),
    readFile(chatOrderUrl, 'utf8'),
  ])

  assert.match(source, /orderParentPortalChatMessagesNewestFirst/)
  assert.match(ordering, /rightTime - leftTime/)
  assert.match(source, /variant === 'parent'/)
  assert.match(source, /displayedMessages\.map/)
})
