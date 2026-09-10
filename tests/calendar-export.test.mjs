import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { buildParentCalendarIcs } from '../apps/parent-mobile/src/parentExperience.js'

test('Apple calendar exports preserve London times, actual end time, and recurrence occurrence identity', () => {
  const item = { id: 'training', title: 'Training', startsAt: '2026-09-10T17:45:00Z', endsAt: '2026-09-10T19:00:00Z' }
  const ics = buildParentCalendarIcs(item)
  assert.match(ics, /DTSTART;TZID=Europe\/London:20260910T184500/)
  assert.match(ics, /DTEND;TZID=Europe\/London:20260910T200000/)
  assert.match(ics, /BEGIN:VTIMEZONE/)
  assert.match(buildParentCalendarIcs({ ...item, startsAt: '2026-12-10T17:45:00Z', endsAt: '2026-12-10T19:00:00Z' }), /DTSTART;TZID=Europe\/London:20261210T174500/)
  const next = buildParentCalendarIcs({ ...item, startsAt: '2026-09-17T17:45:00Z', endsAt: '2026-09-17T19:00:00Z' })
  assert.notEqual(ics.match(/UID:.*/)[0], next.match(/UID:.*/)[0])
  assert.equal(buildParentCalendarIcs({ matchDate: '2026-02-31' }), '')
  assert.match(buildParentCalendarIcs({ matchDate: '2026-09-10', kickoffTimeTbc: true }), /DTSTART;VALUE=DATE:20260910/)
})

test('calendar text is escaped and folded by UTF-8 octets', () => {
  const title = 'Training é'.repeat(30)
  const ics = buildParentCalendarIcs({ eventDate: '2026-09-10', title, notes: 'Hello\rATTENDEE:bad\r\nNext; test, value' })
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75)
  const unfolded = ics.replaceAll('\r\n ', '')
  assert.ok(unfolded.includes('SUMMARY:' + title))
  assert.ok(unfolded.includes('DESCRIPTION:Hello\\nATTENDEE:bad\\nNext\\; test\\, value'))
  assert.ok(!ics.includes('\rATTENDEE:'))
})

test('directions chooser opens Waze for the selected venue and handles cancellation and failure', async () => {
  const result = await build({ entryPoints: ['apps/mobile-core/src/venueDirections.js'], bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'maps-test', setup(api) {
    api.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'maps-test' }))
    api.onLoad({ filter: /.*/, namespace: 'maps-test' }, () => ({ contents: 'export const Platform={OS:"android"};export const Alert={alert:(...args)=>globalThis.mapsTest.alert(...args)};export const Linking={openURL:async url=>{globalThis.mapsTest.url=url;if(globalThis.mapsTest.fail)throw new Error("Cannot open maps")}}' }))
  } }] })
  const module = { exports: {} }
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports)
  const state = { choice: 'Waze', alert(title, message, buttons) {
    assert.equal(title, 'Open directions')
    assert.deepEqual(buttons.map(button => button.text), ['Google Maps', 'Waze', 'Cancel'])
    buttons.find(button => button.text === this.choice).onPress()
  } }
  globalThis.mapsTest = state
  try {
    await module.exports.openVenueDirections('Back Lane, Cambourne')
    assert.equal(new URL(state.url).searchParams.get('q'), 'Back Lane, Cambourne')
    assert.equal(new URL(state.url).hostname, 'waze.com')
    state.choice = 'Cancel'; state.url = ''
    await module.exports.openVenueDirections('Back Lane')
    assert.equal(state.url, '')
    state.choice = 'Google Maps'; state.fail = true
    await assert.rejects(module.exports.openVenueDirections('Back Lane'), /Cannot open maps/)
  } finally { delete globalThis.mapsTest }
})
