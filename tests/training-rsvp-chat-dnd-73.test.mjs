import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Coach mobile does not let generic Calendar notification downgrade Training RSVP state', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachCalendarData.js', import.meta.url), 'utf8')

  assert.match(source, /save_training_availability_setting_v3/)
  assert.match(source, /config\.isProduction && notifyParents && !requestTrainingAvailability/)
  assert.match(source, /notify_calendar_event_parents/)
})

test('Parent Chat exposes and persists a separate DND switch for every room', async () => {
  const [app, data, screens, migration] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260819112343_training_rsvp_delivery_and_parent_chat_dnd_73.sql', import.meta.url), 'utf8'),
  ])

  assert.match(app, /handleToggleChatRoomNotifications/)
  assert.match(data, /get_parent_portal_chat_notification_preferences/)
  assert.match(data, /set_parent_portal_chat_room_notifications/)
  assert.match(screens, /Do not disturb/)
  assert.match(screens, /Notifications muted for this room/)
  assert.match(screens, /<Switch/)
  assert.match(migration, /notifications_muted boolean not null default false/)
  assert.match(migration, /parent_chat_parent_link_can_receive_notification[\s\S]*membership\.notifications_muted/)
})

test('Parent Needs response keeps canonical pending Training RSVP invitations actionable', async () => {
  const source = await readFile(new URL('../apps/parent-mobile/src/parentPresentationCore.js', import.meta.url), 'utf8')

  assert.match(source, /needsResponse = future\.filter\(\(item\) => item\.isPending && isInvitationActionable\(item, now\)\)/)
  assert.match(source, /response_required|requiresResponse|canRespond/)
})
