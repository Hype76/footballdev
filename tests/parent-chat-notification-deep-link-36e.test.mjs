import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  parentNotificationIntentTypes,
  resolveParentNotificationLinkId,
  resolveParentNotificationOpen,
} from '../apps/mobile-core/src/parentNotificationsCore.js'

const parentAppSource = readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')

test('Parent Chat notification targets only an authoritative Parent link and exact room', () => {
  const links = [{ id: 'link-first' }, { id: 'link-second' }]

  assert.equal(resolveParentNotificationLinkId({ parentLinkId: 'link-second' }, links), 'link-second')
  assert.equal(resolveParentNotificationLinkId({ parentLinkId: 'link-removed' }, links), null)
  assert.equal(resolveParentNotificationLinkId({}, links), '')
  assert.deepEqual(resolveParentNotificationOpen({
    app: 'parent',
    route: 'chat',
    roomId: 'room-second',
  }, {
    chat: ['room-second'],
  }), {
    tab: 'chat',
    targetId: 'room-second',
  })
  assert.deepEqual(resolveParentNotificationOpen({
    app: 'parent',
    route: 'chat',
    roomId: 'room-removed',
  }, {
    chat: ['room-second'],
  }), {
    tab: 'chat',
    targetId: '',
  })
  assert.ok(parentNotificationIntentTypes.includes('parent_chat'))
})

test('Parent app switches child context before consuming and verifies current resources before opening', () => {
  assert.match(parentAppSource, /if \(requestedLinkId && requestedLinkId !== selectedLink\?\.id\) \{\s*setSelectedLinkId\(requestedLinkId\)\s*return undefined\s*\}/)
  assert.match(parentAppSource, /notificationResponseProcessingRef\.current = responseId[\s\S]*void loadParentData\(\)[\s\S]*resolveParentNotificationOpen/)
  assert.match(parentAppSource, /requestedTargetId && !destination\.targetId/)
  assert.match(parentAppSource, /setSelectedRoomId\(destination\.tab === 'chat' \? destination\.targetId : ''\)/)
})
