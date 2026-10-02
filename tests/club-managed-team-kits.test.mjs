import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isClubManagedTeamKit, mergeTeamKits, mobileTeamKitCacheKey, normalizeTeamKits } from '../src/lib/team-kits.js'

const clubPlans = ['club', 'small_club', 'development_club', 'large_club', 'pilot', 'development', 'enterprise']
const standalonePlans = ['matchday', 'team', 'single_team', 'individual', 'free', '', 'legacy_unknown']
const clubKits = {home: {colour: '#111111', imagePath: 'club/home.png'}, away: {colour: '#eeeeee', imagePath: 'club/away.png'}}
const overrides = normalizeTeamKits({home_kit_colour: '#ff0000', away_kit_colour: '#00ff00'})

test('authoritative club and legacy plan scopes inherit artwork without changing overrides; standalone retains editor colours', () => {
  for (const planKey of clubPlans) {
    assert.equal(isClubManagedTeamKit({planKey, type: 'team'}), true)
    assert.deepEqual(mergeTeamKits(overrides, clubKits, {planKey}), clubKits)
    assert.deepEqual(mergeTeamKits(overrides, {}, {planKey}), {})
  }
  for (const planKey of standalonePlans) {
    assert.equal(isClubManagedTeamKit({planKey, clubId: 'present', type: 'club'}), false)
    assert.deepEqual(mergeTeamKits(overrides, clubKits, {planKey}), overrides)
  }
  assert.equal(overrides.home.colour, '#ff0000')
  assert.notEqual(mobileTeamKitCacheKey('c','t','team'), mobileTeamKitCacheKey('c','t','club'))
})

function cacheHarness({offline = false, persisted = new Map()} = {}) {
  let now = 1000000000, teamReads = 0, clubReads = 0
  const source = readFileSync(new URL('../apps/mobile-core/src/mobileKitCache.js', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '').replace(/export /g, '')
  const cache = new Function('AsyncStorage','Image','kitImageUrl','readClubKits','isClubManagedTeamKit','mergeTeamKits','mobileTeamKitCacheKey','readTeamKits','supabase','getMobileRuntimeConfig','Date', `${source}; return {loadMobileTeamKits, peekMobileTeamKits, setMobileTeamKits}`)(
    {getItem: async key => persisted.get(key), setItem: async (key, value) => persisted.set(key, value)},
    {prefetch: async () => {}}, () => null,
    async () => {clubReads++; if(offline) throw Error('offline'); return clubKits},
    isClubManagedTeamKit, mergeTeamKits, mobileTeamKitCacheKey,
    async () => {teamReads++; if(offline) throw Error('offline'); return overrides},
    {}, () => ({supabaseUrl: 'test'}), {now: () => now},
  )
  return {cache, persisted, reads: () => ({teamReads, clubReads}), advance: ms => {now += ms}}
}

test('same-team plan upgrades, downgrades and club transfers isolate fresh in-memory cache and never read team overrides for clubs', async () => {
  const h = cacheHarness()
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',undefined,undefined,'team'), overrides)
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',undefined,undefined,'club'), clubKits)
  assert.deepEqual(h.reads(), {teamReads: 1, clubReads: 1})
  assert.deepEqual(h.cache.peekMobileTeamKits('a','t','club'), clubKits)
  assert.deepEqual(h.cache.setMobileTeamKits('a','t',overrides,'club'), clubKits)
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',undefined,undefined,'team'), overrides)
  assert.deepEqual(await h.cache.loadMobileTeamKits('b','t',undefined,undefined,'club'), clubKits)
  assert.deepEqual(h.reads(), {teamReads: 1, clubReads: 2})
  h.advance(5*60*1000+1)
  await h.cache.loadMobileTeamKits('a','t',undefined,undefined,'club')
  assert.equal(h.reads().clubReads, 3)
})

test('offline seven-day club cache ignores legacy merged overrides; standalone cache survives format upgrade', async () => {
  const persisted = new Map([
    ['fp.kits.v1:test:a', JSON.stringify({clubId:'a',kits:clubKits,checkedAt:1000000000-600000})],
    ['fp.team-kits.v1:test:a:t', JSON.stringify({clubId:'a',teamId:'t',kits:overrides,checkedAt:1000000000-600000})],
  ])
  const h = cacheHarness({offline:true,persisted})
  const published=[]
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',k=>published.push(k),undefined,'club'), clubKits)
  assert.deepEqual(published, [clubKits])
  assert.equal(h.reads().teamReads, 0)
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',undefined,undefined,'team'), overrides)
  assert.ok(persisted.has('fp.team-kits.v1:test:a:t'))
  const expired = cacheHarness({offline:true,persisted:new Map(persisted)})
  expired.advance(7*24*60*60*1000+1)
  await assert.rejects(expired.cache.loadMobileTeamKits('a','t',undefined,undefined,'club'), /offline/)
})

test('offline absent club kits never reintroduce stored team colours; supplied club artwork is retained', async () => {
  const h=cacheHarness({offline:true})
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',undefined,{},'club'), {})
  assert.deepEqual(await h.cache.loadMobileTeamKits('a','t',undefined,clubKits,'club'), clubKits)
  assert.equal(h.reads().teamReads,0)
})
