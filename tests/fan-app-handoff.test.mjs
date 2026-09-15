import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fanAppHandoffLinks, PARENT_APP_STORE_URL, PARENT_PLAY_STORE_URL } from '../src/lib/fan-app-handoff.js'

const token = '20000000-0000-4000-8000-000000000099'
test('Fan app handoff uses the installed Parent scheme, preserves only the invitation, and has public store links', async () => {
  const config = await readFile(new URL('../apps/parent-mobile/app.config.js', import.meta.url), 'utf8')
  assert.match(config, /scheme: 'footballplayerparents'/)
  assert.match(config, /packageName: 'com\.footballplayer\.parents'/)
  const links = fanAppHandoffLinks(token)
  assert.equal(links.app, `footballplayerparents://fan-invite/${token}`)
  assert.equal(links.invitation, `https://parent.footballplayer.online/fan-invite/${token}`)
  assert.equal(fanAppHandoffLinks(token, { accepted: true }).app, 'footballplayerparents://fans')
  assert.equal(new URL(PARENT_PLAY_STORE_URL).searchParams.get('id'), 'com.footballplayer.parents')
  assert.equal(new URL(PARENT_APP_STORE_URL).hostname, 'apps.apple.com')
  assert.match(PARENT_APP_STORE_URL, /id6772061464$/)
  assert.equal(PARENT_APP_STORE_URL.includes('testflight'), false)
  for (const unsafe of ['', 'https://attacker.test', `${token}?access_token=secret`, `${token}#fan_confirmation=secret`, 'javascript:alert(1)']) assert.equal(fanAppHandoffLinks(unsafe), null)
})
