import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  getParentAnnouncementMessages,
  isParentStaffAnnouncement,
  prepareParentChatRooms,
} from '../apps/parent-mobile/src/parentPresentationCore.js'

const validAnnouncement = {
  authorType: 'club_staff',
  body: 'Training is cancelled tonight.',
  createdAt: '2026-08-27T09:00:00Z',
  id: 'staff-announcement',
  readAt: '',
  senderName: 'Demo FC',
  source: 'club_announcement',
}

test('Club Announcements fail closed to explicit staff-authored publications', () => {
  const randomEmailRows = [
    { ...validAnnouncement, authorType: '', id: 'source-less-email', source: '' },
    { ...validAnnouncement, authorType: '', id: 'calendar-update', source: 'calendar_event_notification' },
    { ...validAnnouncement, authorType: '', id: 'calendar-invite', source: 'calendar_event_invite' },
    { ...validAnnouncement, authorType: '', id: 'development-email', source: '', templateName: 'Send Development Record' },
    { ...validAnnouncement, authorType: 'parent', id: 'parent-message' },
  ]

  assert.equal(isParentStaffAnnouncement(validAnnouncement), true)
  assert.deepEqual(getParentAnnouncementMessages(randomEmailRows), [])
  assert.deepEqual(getParentAnnouncementMessages([...randomEmailRows, validAnnouncement]).map((item) => item.legacyMessageId), ['staff-announcement'])
  assert.equal(prepareParentChatRooms([], randomEmailRows).some((room) => room.id === 'club-announcements'), false)

  const announcementRoom = prepareParentChatRooms([], [...randomEmailRows, validAnnouncement])
    .find((room) => room.id === 'club-announcements')
  assert.equal(announcementRoom.canPost, false)
  assert.equal(announcementRoom.unreadCount, 1)
})

test('Parent data, cache, push and database boundaries all enforce staff-only announcement provenance', async () => {
  const [data, app, push, migration] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-parent-mobile-push.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260827095500_parent_club_announcements_staff_only.sql', import.meta.url), 'utf8'),
  ])

  assert.match(data, /authorType: normalizeText\(metadata\.authorType\)\.toLowerCase\(\)/)
  assert.match(data, /source: normalizeText\(metadata\.source\)\.toLowerCase\(\)/)
  assert.match(app, /presentParentMessages\(normalizedItems\)\.filter\(isParentStaffAnnouncement\)/)
  assert.match(push, /isClubStaffAnnouncement/)
  assert.match(push, /source\)\.toLowerCase\(\) === 'club_announcement'/)
  assert.match(push, /authorType\)\.toLowerCase\(\) === 'club_staff'/)
  assert.match(push, /\.gte\('role_rank', 20\)/)
  assert.match(push, /calendarEventId[\s\S]*route: 'calendar'/)
  assert.match(push, /reportId[\s\S]*route: 'development'/)
  assert.match(migration, /join public\.users author[\s\S]*author\.status = 'active'[\s\S]*author\.role_rank >= 20/i)
  assert.match(migration, /metadata ->> 'source'[\s\S]*club_announcement/i)
  assert.match(migration, /metadata ->> 'authorType'[\s\S]*club_staff/i)
  assert.doesNotMatch(migration, /\b(?:insert into|update|delete from) public\.communication_logs\b/i)
})
