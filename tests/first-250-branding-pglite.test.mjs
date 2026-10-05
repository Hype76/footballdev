import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const sql = await readFile(new URL('../supabase/migrations/20261003060000_first_250_branding_preparation.sql', import.meta.url), 'utf8')
const authoritySource = await readFile(new URL('../supabase/migrations/20260725174533_platform_club_access_management.sql', import.meta.url), 'utf8')
const authority = authoritySource.slice(authoritySource.indexOf('create or replace function public.platform_access_is_admin_v1'),
  authoritySource.indexOf('create or replace function public.platform_access_audit_v1'))
const club = '10000000-0000-4000-8000-000000000001'
const admin = '20000000-0000-4000-8000-000000000001'
const team = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function database() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
    create table public.teams(id uuid primary key, club_id uuid, name text);
    create table public.users(id uuid primary key, role text, status text);
    create table public.platform_admins(id uuid primary key, status text);
    insert into public.users values ('${admin}', 'super_admin', 'active');
    insert into public.platform_admins values ('${admin}', 'active');
    insert into public.teams select ('30000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '${club}', 'Synthetic team' from generate_series(1,260) n;`)
  await db.exec(authority); await db.exec(sql)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
  return db
}
async function mapExisting(db) {
  for (let n = 1; n <= 39; n++) await db.query('select public.prepare_existing_branding_team($1,$2)', [team(n), club])
}
async function enableSynthetic(db) {
  await db.exec("update app_private.first_250_branding_offer set terms_version='synthetic-v1',release_enabled=true")
}

test('dormant install has no application triggers/FKs, does not start clocks, and denies client/direct service writes', async () => {
  const db = await database()
  try {
    assert.deepEqual((await db.query('select public.read_branding_offer_counter() as value')).rows[0].value, { status: 'not_active' })
    await assert.rejects(db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(40), club, 'synthetic-v1']), /not_active/)
    assert.equal((await db.query('select count(*)::int n from app_private.first_250_branding_entries')).rows[0].n, 0)
    assert.equal((await db.query("select count(*)::int n from pg_trigger where not tgisinternal and tgrelid='public.teams'::regclass")).rows[0].n, 0)
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select public.prepare_existing_branding_team($1,$2)', [team(1), club]), /permission denied/)
    await db.exec('reset role; set role service_role')
    await assert.rejects(db.query('select * from app_private.first_250_branding_entries'), /permission denied/)
    await db.exec('reset role')
    await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
    await assert.rejects(db.query('select public.prepare_existing_branding_team($1,$2)', [team(1), club]), /service_only/)
  } finally { await db.close() }
})
test('39 mapped teams are permanent/exempt, scoped, capped and idempotent without clock fields', async () => {
  const db = await database()
  try {
    await mapExisting(db)
    assert.equal((await db.query('select public.prepare_existing_branding_team($1,$2) slot', [team(1), club])).rows[0].slot, 1)
    await assert.rejects(db.query('select public.prepare_existing_branding_team($1,$2)', [team(40), club]), /cohort_full/)
    await assert.rejects(db.query('select public.prepare_existing_branding_team($1,$2)', [team(1), admin]), /scope_invalid/)
    const counts = (await db.query("select count(*)::int n,count(started_at)::int clocks from app_private.first_250_branding_entries where state='grandfathered'")).rows[0]
    assert.deepEqual(counts, { n: 39, clocks: 0 })
    // No FK prevents an existing team deletion from becoming a new regression.
    await db.query('delete from public.teams where id=$1', [team(1)])
  } finally { await db.close() }
})
test('new claim is blocked until exact existing cohort is mapped and terms match', async () => {
  const db = await database()
  try {
    await enableSynthetic(db)
    await assert.rejects(db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(40), club, 'synthetic-v1']), /mapping_incomplete/)
    await db.exec('update app_private.first_250_branding_offer set release_enabled=false')
    await mapExisting(db); await enableSynthetic(db)
    await assert.rejects(db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(40), club, 'wrong']), /acceptance_invalid/)
    assert.equal((await db.query('select public.reserve_new_branding_team($1,$2,$3) slot', [team(40), club, 'synthetic-v1'])).rows[0].slot, 40)
    const original = (await db.query('select * from app_private.first_250_branding_entries where team_id=$1', [team(40)])).rows[0]
    await db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(40), club, 'synthetic-v1'])
    assert.deepEqual((await db.query('select * from app_private.first_250_branding_entries where team_id=$1', [team(40)])).rows[0], original)
  } finally { await db.close() }
})
test('211 new teams fill the capped ledger; exhaustion does not recycle or expose identities', async () => {
  const db = await database()
  try {
    await mapExisting(db); await enableSynthetic(db)
    for (let n = 40; n <= 250; n++) await db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(n), club, 'synthetic-v1'])
    assert.equal((await db.query('select public.reserve_new_branding_team($1,$2,$3) slot', [team(251), club, 'synthetic-v1'])).rows[0].slot, null)
    await db.exec("update app_private.first_250_branding_entries set state='failed' where slot=40")
    assert.deepEqual((await db.query('select public.read_branding_offer_counter() as value')).rows[0].value,
      { status: 'active', capacity: 250, reserved: 250, remaining: 0 })
  } finally { await db.close() }
})
test('UK calendar months clamp month-end and preserve local wall time across DST', async () => {
  const db = await database()
  try {
    const cases = [['2026-01-31T12:00:00Z',3,'2026-04-30T11:00:00.000Z'],
      ['2026-08-31T11:00:00Z',3,'2026-11-30T12:00:00.000Z'],
      ['2028-01-31T12:00:00Z',1,'2028-02-29T12:00:00.000Z']]
    for (const [start, months, expected] of cases) {
      const value = (await db.query('select app_private.branding_calendar_deadline($1,$2) value', [start, months])).rows[0].value
      assert.equal(new Date(value).toISOString(), expected)
    }
  } finally { await db.close() }
})
test('extension needs real active platform authority, is audited once and preserves stored team artwork', async () => {
  const db = await database()
  try {
    await mapExisting(db); await enableSynthetic(db)
    await db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(40),club,'synthetic-v1'])
    await db.query("insert into app_private.first_250_team_branding values ($1,$2,'https://example.test/logo.png','#047857','solid')",[team(40),club])
    const before = (await db.query('select * from app_private.first_250_team_branding')).rows
    await assert.rejects(db.query('select public.extend_branding_offer_team($1,$2,$3,$4)',[team(40),club,team(1),'Support']),/not_authorized/)
    const first = (await db.query('select public.extend_branding_offer_team($1,$2,$3,$4) value',[team(40),club,admin,'Support'])).rows[0].value
    const replay = (await db.query('select public.extend_branding_offer_team($1,$2,$3,$4) value',[team(40),club,admin,'Support retry'])).rows[0].value
    assert.equal(new Date(first).toISOString(),new Date(replay).toISOString())
    const audit = (await db.query('select extension_used,extended_by,extension_reason from app_private.first_250_branding_entries where slot=40')).rows[0]
    assert.deepEqual(audit,{extension_used:true,extended_by:admin,extension_reason:'Support'})
    await db.exec("update app_private.first_250_branding_entries set state='failed' where slot=40")
    assert.deepEqual((await db.query('select * from app_private.first_250_team_branding')).rows,before)
  } finally { await db.close() }
})
