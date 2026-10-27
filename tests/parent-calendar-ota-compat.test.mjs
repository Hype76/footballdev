import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const config = require('../apps/parent-mobile/app.config.js').expo
const packageJson = require('../apps/parent-mobile/package.json')
const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')
const data = await readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8')

test('new native release connects the revocable accepted-event feed to Apple Calendar', () => {
  assert.equal(config.version, '1.1.0')
  assert.equal(packageJson.version, '1.1.0')
  assert.equal(packageJson.dependencies['expo-calendar'], undefined)
  assert.doesNotMatch(JSON.stringify(config), /expo-calendar|READ_CALENDAR|WRITE_CALENDAR/)
  assert.doesNotMatch(app, /parentDeviceCalendar|Sync accepted events to this phone/)
  assert.match(app, /changeParentCalendarFeed/)
  assert.doesNotMatch(app, /webcal:/)
  assert.match(app, /Show secure calendar link/)
  assert.match(app, /Connect Apple Calendar/)
  assert.match(app, /Linking\.openURL\(getAppleCalendarSubscriptionUrl\(url\)\)/)
  assert.match(data, /parent-calendar-feed\?parentLinkId=\$\{encodeURIComponent\(link\.id\)\}/)
  assert.match(app, /Press and hold the link below to copy it/)
  assert.doesNotMatch(app, /expo-clipboard|Clipboard\.setStringAsync/)
  assert.equal(packageJson.dependencies['expo-clipboard'], undefined)
})
