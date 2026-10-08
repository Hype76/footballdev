import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261008135335_parent_invite_team_branding.sql', import.meta.url), 'utf8')
const club = '10000000-0000-4000-8000-000000000001'
const team = '20000000-0000-4000-8000-000000000001'
async function database() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema app_private;
    create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
    create table public.clubs(id uuid primary key,status text,archived_at timestamptz,plan_key text,
      logo_url text,theme_accent text,theme_button_style text);
    create table public.teams(id uuid primary key,club_id uuid,status text,archived_at timestamptz);
    create table app_private.first_250_branding_offer(release_enabled boolean);
    create table app_private.first_250_branding_entries(team_id uuid,club_id uuid,cohort text,state text,started_at timestamptz,deadline_at timestamptz);
    create table app_private.first_250_team_branding(team_id uuid,club_id uuid,logo_url text,theme_accent text,theme_button_style text);
    create function public.can_use_plan_feature(c uuid,f text) returns boolean language sql as $$
      select exists(select 1 from public.clubs where id=c and plan_key in ('club','team')) $$;
    create function public.workspace_scope_for_plan_key(p text) returns text language sql as $$ select case when p='club' then 'club' else 'team' end $$;
    insert into public.clubs values('${club}','active',null,'matchday','https://cdn.example.com/club.png','#facc15','solid');
    insert into public.teams values('${team}','${club}','active',null);
    insert into app_private.first_250_branding_offer values(true);
    insert into app_private.first_250_branding_entries(cohort,state) select 'existing_39','grandfathered' from generate_series(1,39);
    insert into app_private.first_250_branding_entries values('${team}','${club}','new_211','provisional',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day');
    insert into app_private.first_250_team_branding values('${team}','${club}','https://cdn.example.com/team.png','#15803d','solid');`)
  await db.exec(migration)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
  return db
}
const read = async db => (await db.query('select public.read_parent_invite_branding($1,$2) value', [team, club])).rows[0].value

test('SQL reader applies eligible team, paid Club, expired promotion and base entitlement rules without writes', async () => {
  const db = await database()
  try {
    const before = (await db.query('select * from app_private.first_250_branding_entries')).rows
    let display = await read(db)
    assert.equal(display.source, 'team'); assert.match(display.logoUrl, /team.png/); assert.equal(display.accent, '#15803d')
    assert.deepEqual((await db.query('select * from app_private.first_250_branding_entries')).rows, before)
    await db.exec("update public.clubs set plan_key='club'")
    display = await read(db)
    assert.equal(display.source, 'paid_club'); assert.match(display.logoUrl, /club.png/); assert.equal(display.accent, '#facc15')
    await db.exec("update public.clubs set plan_key='matchday'; update app_private.first_250_branding_entries set deadline_at=clock_timestamp()-interval '1 second' where team_id is not null")
    display = await read(db)
    assert.equal(display.logoAllowed, false); assert.equal(display.coloursAllowed, false)
    assert.equal(display.logoUrl, ''); assert.equal(display.accent, '')
    await db.exec("update public.clubs set plan_key='team'")
    display = await read(db)
    assert.equal(display.baseLogoAllowed, true); assert.match(display.logoUrl, /team.png/)
    await db.exec('update app_private.first_250_branding_offer set release_enabled=false')
    assert.equal(await read(db), null)
  } finally { await db.close() }
})

test('SQL reader denies client roles, wrong scope and inactive teams, leaving private tables closed', async () => {
  const db = await database()
  try {
    await db.exec('set role service_role')
    assert.equal((await read(db)).source, 'team')
    await assert.rejects(db.query('select * from app_private.first_250_team_branding'), /permission denied/)
    await db.exec('reset role')
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(read(db), /permission denied/)
      await db.exec('reset role')
      await db.exec(`select set_config('request.jwt.claim.role','${role}',false)`)
      await assert.rejects(read(db), /service_only/)
    }
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
    await assert.rejects(db.query('select public.read_parent_invite_branding($1,$2)', [team, team]), /scope_denied/)
    await db.exec("update public.teams set status='suspended'")
    await assert.rejects(read(db), /scope_denied/)
    await db.exec('set role service_role')
    await assert.rejects(db.query('select * from app_private.first_250_team_branding'), /permission denied/)
    await db.exec('reset role')
  } finally { await db.close() }
})
