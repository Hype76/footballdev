import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const config = require('../apps/parent-mobile/app.config.js').expo
const packageJson = require('../apps/parent-mobile/package.json')
const app = await readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')

test('accepted calendar subscription can update the installed Parent 1.0.22 app', () => {
  assert.equal(config.version, '1.0.22')
  assert.equal(packageJson.version, '1.0.22')
  assert.equal(packageJson.dependencies['expo-calendar'], undefined)
  assert.doesNotMatch(JSON.stringify(config), /expo-calendar|READ_CALENDAR|WRITE_CALENDAR/)
  assert.doesNotMatch(app, /parentDeviceCalendar|Sync accepted events to this phone/)
  assert.match(app, /changeParentCalendarFeed/)
  assert.match(app, /webcal:/)
})
