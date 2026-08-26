import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  getCoachCalendarEventResourceIds,
  toggleCoachCalendarResourceId,
} from '../apps/mobile-core/src/coachCalendarCore.js'

const screenUrl = new URL('../apps/coach-mobile/src/CoachOperationalScreens.js', import.meta.url)
const dataUrl = new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url)

test('Coach Calendar resolves and toggles only the selected event Resource links', () => {
  const resources = [
    { id: 'resource-1', links: [{ linkedType: 'calendar_event', linkedId: 'event-1' }] },
    { id: 'resource-2', links: [{ linkedType: 'calendar_event', linkedId: 'event-2' }] },
    { id: 'resource-3', links: [{ linkedType: 'player', linkedId: 'event-1' }] },
  ]
  assert.deepEqual(getCoachCalendarEventResourceIds(resources, 'event-1'), ['resource-1'])
  assert.deepEqual(toggleCoachCalendarResourceId(['resource-1'], 'resource-2'), ['resource-1', 'resource-2'])
  assert.deepEqual(toggleCoachCalendarResourceId(['resource-1', 'resource-2'], 'resource-1'), ['resource-2'])
})

test('Coach phone Calendar can attach existing Team Resources and open saved attachments', async () => {
  const [screen, data] = await Promise.all([readFile(screenUrl, 'utf8'), readFile(dataUrl, 'utf8')])
  assert.match(screen, /Event attachments/)
  assert.match(screen, /getCoachCalendarEventResourceIds\(resources, event\.sourceId\)/)
  assert.match(screen, /syncCoachCalendarEventResources\(user, savedEvent, form\?\.resourceIds \|\| \[\]\)/)
  assert.match(screen, /label=\{`Open \$\{resource\.title\}`\}/)
  assert.match(data, /assertCoachOperationalMutation\(user, \{ minimumRank: 50, requiresTeam: true \}\)/)
  assert.match(data, /\.eq\('linked_type', 'calendar_event'\)/)
  assert.match(data, /\.eq\('linked_id', eventId\)/)
  assert.match(data, /resource_library_event_resources_synced/)
})
