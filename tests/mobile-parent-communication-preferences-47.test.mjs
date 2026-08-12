import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Parent app Settings exposes App, Email and Both choices', async () => {
  const [app, preference] = await Promise.all([
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/communicationPreferences.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /Communication choice/)
  assert.match(app, /App notifications/)
  assert.match(app, /Email/)
  assert.match(app, /Both/)
  assert.match(app, /saveParentCommunicationPreference/)
  assert.match(preference, /\.netlify\/functions\/parent-communication-preferences/)
  assert.match(preference, /Authorization: `Bearer \$\{accessToken\}`/)
  assert.match(preference, /\['app', 'email', 'both'\]/)
})
