import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@babel/parser'
import { PGlite } from '@electric-sql/pglite'
import { getMatchDayDisplayName } from '../src/lib/matchday-display.js'
import { normalizeMatchDay } from '../src/lib/domain/match-day.js'

const fixture = { id: 'fixture', clubName: 'Cambourne Town FC', opponent: 'Holbeach United U14', homeAway: 'home' }
const source = await readFile('src/pages/SessionsPage.jsx', 'utf8')
const declaration = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'getFormFromCalendarEvent')
const dependencies = {
  getDefaultCalendarForm: () => ({}), getFormInviteFields: () => ({}),
  formatTimeInput: value => value, formatDateInput: value => value,
  addMinutesToTime: value => value, formatExpiryDurationFromHours: value => value,
  getMatchDayDisplayName,
}
const reopen = new Function(...Object.keys(dependencies), `${source.slice(declaration.start, declaration.end)}; return getFormFromCalendarEvent`)(...Object.values(dependencies))

test('fixture editor reopens with its saved custom title and readable legacy fallback', () => {
  for (const title of ['', 'Match', 'Match vs Holbeach United U14', 'Cambourne cup semi-final']) {
    const saved = normalizeMatchDay({ ...fixture, title })
    const form = reopen({ sourceType: 'match-day', data: saved })
    assert.equal(form.title, title === 'Cambourne cup semi-final' ? title : 'Cambourne Town FC v Holbeach United U14')
  }
  assert.equal(getMatchDayDisplayName({ ...fixture, homeAway: 'away' }), 'Holbeach United U14 v Cambourne Town FC')
})

test('custom title survives database save, reload and an unrelated edit', async t => {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec("create table match_days(id integer primary key, notes text); insert into match_days values(1,'');")
  await db.exec(await readFile('supabase/migrations/20260917112619_fixture_custom_title.sql', 'utf8'))
  await db.query('update match_days set title=$1 where id=1', ['Cambourne cup semi-final'])
  await db.query('update match_days set notes=$1 where id=1', ['Bring home kit'])
  const saved = (await db.query('select * from match_days where id=1')).rows[0]
  assert.equal(reopen({ sourceType: 'match-day', data: normalizeMatchDay({ ...fixture, ...saved }) }).title, 'Cambourne cup semi-final')
  const domain = await readFile('src/lib/domain/match-day.js', 'utf8')
  assert.match(domain, /if \(updates.title !== undefined\) payload.title = normalizeText\(updates.title\)/)
  assert.match(source, /const payload = \{\s+arrivalTime: calendarForm.arrivalTime,\s+title: trimmedTitle,/)
})
