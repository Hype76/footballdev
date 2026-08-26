import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const coachApp = fs.readFileSync(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
const coachNotifications = fs.readFileSync(new URL('../apps/coach-mobile/src/notifications.js', import.meta.url), 'utf8')
const parentApp = fs.readFileSync(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8')

test('Parent and Coach notification settings use one Off, Minimal, or Detailed choice', () => {
  for (const source of [parentApp, coachApp]) {
    assert.match(source, /key: 'off', label: 'Off'/)
    assert.match(source, /key: 'minimal', label: 'Minimal'/)
    assert.match(source, /key: 'detailed', label: 'Detailed'/)
    assert.match(source, /accessibilityRole="radio"/)
  }

  const coachSettings = coachApp.slice(coachApp.indexOf('function SettingsScreen'), coachApp.indexOf('function CoachHeader'))
  assert.doesNotMatch(coachSettings, /label="Enable notifications"|label="Disable notifications"/)
  assert.match(coachSettings, /onNotificationModeChange\(choice\.key\)/)
})

test('selecting a Coach notification detail mode before registration preserves that choice', () => {
  assert.match(coachApp, /enableNotifications\(\{ detailLevel: mode \}\)/)
  assert.match(coachApp, /detailLevel: options\?\.detailLevel/)
  assert.match(coachNotifications, /detailLevel: requestedDetailLevel = ''/)
  assert.match(coachNotifications, /setDetailLevel\(requestedDetailLevel, apiBaseUrl\)/)
})
