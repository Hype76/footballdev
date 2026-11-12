import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { clubTvSlugStatus, clubTvViewerUrl } from '../src/lib/club-matchday-tv.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key'
const { createClubMatchdayTvHandler } = await import('../netlify/functions/club-matchday-tv.js')

const cedarfield = '11111111-1111-4111-8111-111111111111'
const oakfield = '22222222-2222-4222-8222-222222222222'
const v2Shape = 'abcdefghijklmnopqrstuq'
const artwork = 'data:image/webp;base64,YXJ0'
const preferences = {
  appearance: 'dark', bigGoal: false, showMap: true, weatherPostcode: 'CB23 6FY', map: artwork,
  sponsorAds: [{ image: artwork, name: 'Fictional Sponsor', enabled: true, startDate: '2026-11-12', endDate: '2026-11-12' }],
  sponsorSeconds: 15, showPitchsideOrdering: true,
}

test('private Matchday TV settings and aliases are saved atomically by authorized Club Admins', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.clubs (id uuid primary key);
    grant select, update on public.clubs to service_role;
    insert into public.clubs values ('${cedarfield}'), ('${oakfield}');
  `)
  await db.exec(await readFile(new URL('../supabase/migrations/20261112090042_v1_club_matchday_tv_settings.sql', import.meta.url), 'utf8'))

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.exec('select * from public.club_matchday_tv_links'), { code: '42501' })
    await assert.rejects(db.exec('select * from public.club_matchday_tv_settings'), { code: '42501' })
    await assert.rejects(db.query('select public.save_club_matchday_tv_settings($1, null, $2, 0)', [cedarfield, {}]), { code: '42501' })
  }
  await db.exec('set role service_role')

  const client = {
    from(table) {
      const filters = []
      let columns
      return {
        select(value) { columns = value; return this },
        eq(column, value) { filters.push({ column, value }); return this },
        async maybeSingle() {
          const where = filters.map(({ column }, index) => `${column} = $${index + 1}`).join(' and ')
          const result = await db.query(`select ${columns} from public.${table} where ${where}`, filters.map(({ value }) => value))
          return { data: result.rows[0] ?? null, error: null }
        },
      }
    },
    async rpc(name, args) {
      assert.equal(name, 'save_club_matchday_tv_settings')
      try {
        const result = await db.query('select public.save_club_matchday_tv_settings($1, $2, $3, $4) as revision',
          [args.p_club_id, args.p_slug, args.p_preferences, args.p_revision])
        return { data: result.rows[0].revision, error: null }
      } catch (error) { return { data: null, error } }
    },
  }
  const endpoint = createClubMatchdayTvHandler({
    authenticate: async ({ headers }) => {
      if (!headers.actor) throw Object.assign(new Error('Login required'), { statusCode: 401 })
      return { role: headers.role || 'admin', clubId: headers.actor, planKey: 'club', accountStatus: 'active', clubStatus: 'active', planStatus: 'active' }
    },
    assertFeature: async () => {},
    client,
    logger: { error() {} },
  })
  async function request(actor, body, role) {
    const response = await endpoint({ httpMethod: 'POST', headers: { actor, role }, body: JSON.stringify(body) })
    assert.equal(response.headers['Cache-Control'], 'private, no-store, max-age=0')
    return { status: response.statusCode, ...JSON.parse(response.body) }
  }
  const save = (clubId, slug, revision = 0, next = preferences) => request(clubId, { action: 'save', clubId, slug, preferences: next, revision })
  const availability = (clubId, slug) => request(clubId, { action: 'availability', clubId, slug })
  const view = (actor, slug, role) => request(actor, { action: 'view', slug }, role)
  const settings = (clubId) => request(clubId, { action: 'settings', clubId }).then(result => result.settings)

  assert.deepEqual(await settings(cedarfield), { slug: null, preferences: null, revision: 0 })
  assert.equal((await availability(cedarfield, 'SeTTings')).availability, 'reserved')
  assert.equal((await availability(cedarfield, v2Shape.toUpperCase())).availability, 'reserved')
  assert.equal((await availability(cedarfield, 'AB12C')).availability, 'invalid')
  assert.equal((await save(cedarfield, 'Assets')).status, 400)
  assert.equal((await save(cedarfield, v2Shape)).status, 400)
  assert.equal((await availability(cedarfield, 'CEDAR-FC')).availability, 'available')
  assert.equal((await availability(oakfield, 'cedar-fc')).availability, 'available')
  assert.equal((await save(cedarfield, 'CEDAR-FC')).status, 200)
  const duplicate = await save(oakfield, 'cedar-fc')
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.availability, 'taken')
  assert.equal((await settings(oakfield)).revision, 0)
  assert.equal((await availability(oakfield, 'CEDAR-FC')).availability, 'taken')
  assert.equal((await view(undefined, 'cedar-fc')).status, 401)
  assert.equal((await view(oakfield, 'cedar-fc')).status, 403)
  assert.equal((await view(cedarfield, 'cedar-fc', 'coach')).status, 403)
  const ownView = await view(cedarfield, 'CeDaR-FC')
  assert.equal(ownView.status, 200)
  assert.equal(ownView.club.id, cedarfield)
  assert.deepEqual(ownView.settings, { slug: 'cedar-fc', preferences, revision: 1 })
  assert.equal((await request(oakfield, { clubId: cedarfield, action: 'settings' })).status, 403)
  assert.equal((await save(cedarfield, 'other-ending', 0)).status, 409)
  assert.equal((await availability(oakfield, 'other-ending')).availability, 'available')
  assert.equal((await save(cedarfield, 'cedarfield', 1, { ...preferences, appearance: 'light' })).status, 200)
  assert.equal((await view(cedarfield, 'cedar-fc')).settings.preferences.appearance, 'light')
  assert.equal((await view(cedarfield, 'cedarfield')).settings.revision, 2)
  assert.equal((await availability(oakfield, 'cedar-fc')).availability, 'taken')

  await assert.rejects(db.query('select public.save_club_matchday_tv_settings($1, $2, $3, 0)', [oakfield, 'broken-prefs', []]), { code: '23514' })
  assert.equal((await availability(oakfield, 'broken-prefs')).availability, 'available')
  for (const invalidSlug of ['UPPER', 'admin', v2Shape]) {
    await assert.rejects(db.query('select public.save_club_matchday_tv_settings($1, $2, $3, 0)', [oakfield, invalidSlug, preferences]), { code: '23514' })
  }
  await db.exec('reset role')
  await db.query('delete from public.clubs where id = $1', [cedarfield])
  assert.equal((await availability(oakfield, 'cedar-fc')).availability, 'taken')
  assert.equal((await save(oakfield, 'cedar-fc')).availability, 'taken')
  assert.deepEqual((await db.query('select count(*)::int as count from public.club_matchday_tv_settings')).rows, [{ count: 0 }])
})

test('viewer URL generation keeps the V2 token space and supports only the V1 app and approved domain options', () => {
  assert.equal(clubTvSlugStatus(v2Shape), 'reserved')
  const current = 'https://footballplayer.online'
  assert.equal(clubTvViewerUrl('cedar-fc', current, 'https://fpmd.online'), 'https://fpmd.online/cedar-fc')
  assert.equal(clubTvViewerUrl('cedar-fc', current, 'https://v1.fpmd.online'), 'https://v1.fpmd.online/cedar-fc')
  assert.equal(clubTvViewerUrl('cedar-fc', current, 'https://example.com'), 'https://footballplayer.online/club-matchday-tv/view/cedar-fc')
})
