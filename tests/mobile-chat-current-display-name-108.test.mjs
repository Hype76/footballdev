import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { normalizeCoachChatMessage } from '../apps/mobile-core/src/coachPhase31ECore.js'

test('Coach Chat prefers the current profile display name over the message snapshot', () => {
  const message = normalizeCoachChatMessage({
    sender_id: 'parent-1',
    sender_name: 'juliet1',
    users: { display_name: 'Juliet Smith', name: 'juliet1' },
  })

  assert.equal(message.senderName, 'Juliet Smith')
})

test('Parent name updates use Parent auth metadata and refresh the Chat session', async () => {
  const [parentData, coachData] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
  ])

  assert.match(parentData, /auth\.updateUser\(\{[\s\S]*display_name: nextDisplayName/)
  assert.doesNotMatch(parentData, /rpc\('update_own_user_profile'/)
  assert.match(parentData, /auth\.refreshSession\(\)/)
  assert.match(parentData, /isCurrentUser \? user\.displayName \|\| user\.name/)
  assert.match(coachData, /select\('id, display_name, name, username'\)/)
  assert.match(coachData, /nameBySenderId/)
})
