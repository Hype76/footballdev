import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { hexToHsv, hsvToHex, mergeTeamKits, mobileTeamKitCacheKey, normalizeKitColour, normalizeTeamKits } from '../src/lib/team-kits.js'

test('team kit colours are normalized without inventing missing overrides', () => {
  assert.equal(normalizeKitColour(' #1D4ED8 '), '#1d4ed8')
  assert.equal(normalizeKitColour('#12345g'), null)
  assert.deepEqual(normalizeTeamKits({ home_kit_colour: '#DC2626', away_kit_colour: null }), {
    home: { colour: '#dc2626', imagePath: null, source: 'team' },
  })
})

test('continuous picker conversions preserve representative colours', () => {
  for (const colour of ['#ffffff', '#000000', '#dc2626', '#16a34a', '#2563eb']) {
    assert.equal(hsvToHex(hexToHsv(colour)), colour)
  }
})

test('Coach kit save clears blank sides to null without accepting malformed colours', async () => {
  const dataSource = readFileSync(new URL('../apps/mobile-core/src/coachTeamKitsData.js', import.meta.url), 'utf8')
  let savedValues
  const gates = []
  const query = {
    update(values) { savedValues = values; return this },
    eq() { return this },
    select() { return this },
    async single() { return { data: savedValues, error: null } },
  }
  const save = new Function('assertCoachOperationalMutation', 'assertCoachCapability', 'CAPABILITIES', 'normalizeKitColour', 'normalizeTeamKits', 'supabase', `${dataSource.slice(dataSource.indexOf('export async function saveCoachTeamKits')).replace('export async function', 'async function')}; return saveCoachTeamKits`)(
    (_user, options) => gates.push(options),
    (_user, capability) => gates.push(capability),
    { matchDay: 'matchDay' }, normalizeKitColour, normalizeTeamKits,
    { from: () => query },
  )
  const user = { clubId: 'club-a', activeTeamId: 'team-a' }
  assert.deepEqual(await save(user, { home: { colour: '#DC2626' }, away: { colour: '' } }), {
    home: { colour: '#dc2626', imagePath: null, source: 'team' },
  })
  assert.deepEqual(savedValues, { home_kit_colour: '#dc2626', away_kit_colour: null })
  assert.deepEqual(await save(user, { home: { colour: ' ' }, away: { colour: null } }), {})
  assert.deepEqual(savedValues, { home_kit_colour: null, away_kit_colour: null })
  assert.deepEqual(gates[0], { minimumRank: 50, requiresTeam: true })
  assert.equal(gates[1], 'matchDay')
  await assert.rejects(save(user, { home: { colour: '#bad' }, away: { colour: '' } }), /six-digit colours/)
  await assert.rejects(save(user, { home: { colour: '' }, away: { colour: 'not a colour' } }), /six-digit colours/)
})

test('team colours override only the matching side and preserve paid club artwork fallback', () => {
  const clubKits = {
    home: { colour: '#111111', imagePath: 'club/home.png' },
    away: { colour: '#eeeeee', imagePath: 'club/away.png' },
  }
  assert.deepEqual(mergeTeamKits(normalizeTeamKits({ home_kit_colour: '#2563eb' }), clubKits), {
    home: { colour: '#2563eb', imagePath: null, source: 'team' },
    away: clubKits.away,
  })
})

test('team cache identities include both club and exact team', () => {
  assert.notEqual(mobileTeamKitCacheKey('club-a', 'team-a'), mobileTeamKitCacheKey('club-a', 'team-b'))
  assert.notEqual(mobileTeamKitCacheKey('club-a', 'team-a'), mobileTeamKitCacheKey('club-b', 'team-a'))
})

test('coach and parent displays pass exact team context and settings avoid an eyedropper claim', () => {
  const coach = readFileSync(new URL('../apps/coach-mobile/src/CoachMatchDayScreen.js', import.meta.url), 'utf8')
  const parent = readFileSync(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8')
  const settings = readFileSync(new URL('../apps/coach-mobile/src/CoachTeamKitSettings.js', import.meta.url), 'utf8')
  const display = readFileSync(new URL('../apps/mobile-core/src/ClubKitDisplay.js', import.meta.url), 'utf8')
  assert.match(coach, /teamId=\{context\.teamId \|\| user\.activeTeamId\}/)
  assert.match(parent, /teamId=\{selectedMatch\.teamId/)
  assert.match(settings, /colour picker/)
  assert.doesNotMatch(settings, /eyedropper/i)
  assert.match(display, /kit\.source === 'team'/)
  assert.match(display, /name="tshirt-crew"/)
})
