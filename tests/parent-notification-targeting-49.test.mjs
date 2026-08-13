import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('Parent native pushes identify the exact authorised child and item', async () => {
  const [matchPush, parentPush] = await Promise.all([
    readSource('netlify/functions/send-match-day-push.js'),
    readSource('netlify/functions/send-parent-mobile-push.js'),
  ])

  assert.match(parentPush, /communicationLogId: log\.id/)
  assert.match(parentPush, /invitationId: `match:\$\{request\.id\}`/)
  assert.match(parentPush, /route: 'invites'/)
  assert.match(parentPush, /categoryId: 'parent-response'/)
  assert.match(parentPush, /parentLinkId: payload\.data\.parentLinkId \|\| device\.parent_link_id/)
  assert.match(matchPush, /parentLinkId: device\.parent_link_id/)
})
