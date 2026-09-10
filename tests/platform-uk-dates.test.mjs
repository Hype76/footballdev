import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatUkDate, formatUkDateTime, normalizeDateOnly } from '../src/lib/date-format.js'
import { getResourceDisplayTitle, getResourceTitleDate, sortResourcesNewestFirst } from '../src/lib/resource-date-presentation.js'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

test('numeric dates are day first, with four digit years and explicit UK separators', () => {
  for (const value of ['2026-09-05', '05/09/2026', '5/9/26', '05:09:2026', '5 Sep 2026']) {
    assert.equal(formatUkDate(value), '05:09:2026')
    assert.equal(normalizeDateOnly(value), '2026-09-05')
  }
  assert.equal(normalizeDateOnly('31/02/2026'), '')
  assert.equal(normalizeDateOnly('2026-02-29'), '')
  assert.equal(formatUkDate('2028-02-29'), '29:02:2028')
  assert.equal(formatUkDate('', 'Unknown'), 'Unknown')
})

test('UK date and time agree across midnight, British summer time and year boundaries', () => {
  assert.equal(formatUkDateTime('2026-09-09T23:30:00Z'), '10:09:2026 00:30')
  assert.equal(formatUkDateTime('2026-12-31T23:30:00Z'), '31:12:2026 23:30')
  assert.equal(formatUkDateTime('2027-01-01T00:30:00Z'), '01:01:2027 00:30')
  assert.equal(formatUkDate(new Date('2026-09-09T23:30:00Z')), '10:09:2026')
})

test('legacy report titles display UK dates without changing the stored titles', () => {
  const resource = { title: '2026 08 29 u14 v Haverhill gold completed report' }
  assert.equal(getResourceDisplayTitle(resource), '29:08:2026 u14 v Haverhill gold completed report')
  assert.equal(resource.title, '2026 08 29 u14 v Haverhill gold completed report')
  assert.equal(getResourceDisplayTitle({ title: 'Veo 5/9/26 CTFCJPLU14 v St Neots' }), 'Veo 05:09:2026 CTFCJPLU14 v St Neots')
  assert.equal(getResourceTitleDate('U14 JPL 26/27'), '')
  assert.equal(getResourceTitleDate('2026 02 30 report'), '')
})

test('resource history sorts actual dates newest first across months and years, without mutating data', () => {
  const resources = [
    { id: 'august', title: '2026 08 29 report', createdAt: '2026-09-10' },
    { id: 'september', title: '2026 09 05 report', createdAt: '2026-09-06' },
    { id: 'january', title: '01/01/27 report' },
    { id: 'dated', title: 'Shared training', eventDate: '2026-12-31' },
    { id: 'undated', title: 'Club handbook' },
  ]
  assert.deepEqual(sortResourcesNewestFirst(resources).map(item => item.id), ['january', 'dated', 'september', 'august', 'undated'])
  assert.equal(resources[0].id, 'august')
})

test('platform date displays cannot silently fall back to a device US locale', () => {
  const roots = ['src', 'netlify/functions', 'apps/mobile-core/src', 'apps/coach-mobile/src', 'apps/parent-mobile/src']
  const files = ['apps/coach-mobile/App.js', 'apps/parent-mobile/App.js']
  function scan(folder) {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name)
      if (item.isDirectory()) scan(file)
      else if (/\.[jt]sx?$/.test(file)) files.push(file)
    }
  }
  roots.forEach(scan)
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /(?:toLocaleDateString|DateTimeFormat)\(\s*(?:\)|\[\]|['"]en-US['"])/, file)
    assert.doesNotMatch(source, /toLocaleString\(\s*(?:\[\]|['"]en-US['"])/, file)
  }
})
