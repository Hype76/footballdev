import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const coachChatScreenUrl = new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url)

test('Coach Chat messages show the same date and time format used by Parent Chat', async () => {
  const source = await readFile(coachChatScreenUrl, 'utf8')

  assert.match(source, /formatParentProductDateTime/)
  assert.match(source, /year: 'numeric'/)
  assert.match(source, /formatCoachChatDateTime\(message\.createdAt\)/)
  assert.match(source, /styles\.messageTime/)
})
