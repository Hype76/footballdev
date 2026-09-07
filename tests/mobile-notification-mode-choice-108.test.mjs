import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const coachApp = fs.readFileSync(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const coachNotifications = fs.readFileSync(new URL('../apps/coach-mobile/src/notifications.js', import.meta.url), 'utf8')
const parentApp = fs.readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')

test('Parent and Coach settings share the category controls and retain device permission setup', () => {
  const choices = fs.readFileSync(new URL('../apps/mobile-core/src/notificationCategories.js', import.meta.url), 'utf8')
  for (const source of [parentApp, coachApp]) {
    assert.match(source, /<NotificationCategorySettings/)
    assert.match(source, /Enable push alerts on this device/)
    assert.doesNotMatch(source, /label: 'Minimal'|label: 'Detailed'/)
  }
  for (const key of ['off', 'scores_cards', 'full']) assert.ok(choices.includes(`key: '${key}'`))
})

test('selecting a Coach notification detail mode before registration preserves that choice', () => {
  assert.match(coachApp, /enableNotifications\(\{ detailLevel: mode \}\)/)
  assert.match(coachApp, /detailLevel: options\?\.detailLevel/)
  assert.match(coachNotifications, /detailLevel: requestedDetailLevel = ''/)
  assert.match(coachNotifications, /setDetailLevel\(requestedDetailLevel, apiBaseUrl\)/)
})
