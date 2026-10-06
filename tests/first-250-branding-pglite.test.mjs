import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const sql = await readFile(new URL('../supabase/migrations/20261003060000_first_250_branding_preparation.sql', import.meta.url), 'utf8')
const authoritySource = await readFile(new URL('../supabase/migrations/20260725174533_platform_club_access_management.sql', import.meta.url), 'utf8')
const authority = authoritySource.slice(authoritySource.indexOf('create or replace function public.platform_access_is_admin_v1'),
  authoritySource.indexOf('create or replace function public.platform_access_audit_v1'))
const planSource = await readFile(new URL('../supabase/migrations/20260918104253_matchday_tier_entitlement_security.sql', import.meta.url), 'utf8')
const canonicalPlan = planSource.slice(planSource.indexOf('create or replace function public.normalize_subscription_plan_key'),
  planSource.indexOf('alter table if exists public.clubs drop constraint'))
const club = '10000000-0000-4000-8000-000000000001'
const admin = '20000000-0000-4000-8000-000000000001'
const team = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
async function database() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,email text);
    create table public.clubs(id uuid primary key,status text default 'active',archived_at timestamptz,
      plan_key text default 'matchday',logo_url text,theme_accent text,theme_button_style text);
    create table public.teams(id uuid primary key, club_id uuid, name text,status text default 'active',archived_at timestamptz);
    create table public.users(id uuid primary key, role text, status text,club_id uuid,role_rank integer);
    create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table public.team_staff(user_id uuid,team_id uuid,role_key text,role_rank integer);
    create table public.players(id uuid primary key,team_id uuid,club_id uuid,status text default 'active',archived_at timestamptz,created_at timestamptz default clock_timestamp());
    create table public.parent_player_links(id uuid primary key,player_id uuid,team_id uuid,club_id uuid,auth_user_id uuid,link_type text,status text,accepted_at timestamptz);
    create table public.match_days(id uuid primary key,team_id uuid,club_id uuid,status text,deleted_at timestamptz,concluded_at timestamptz,match_date date);
    create table public.workspace_team_transfer_requests(id uuid primary key,team_id uuid,source_club_id uuid,destination_club_id uuid,
      status text,source_approved_by uuid,destination_approved_by uuid,completed_by uuid);
    -- Fixture authority helpers deliberately model only a known synthetic staff actor.
    -- Installed production helper/RLS/JWT behaviour remains a separate rehearsal.
    create function public.current_user_can_access_team(c uuid,t uuid) returns boolean language sql as $$ select auth.uid()='${admin}'::uuid and c='${club}'::uuid $$;
    create function public.current_user_can_access_parent_team(t uuid) returns boolean language sql as $$ select false $$;
    create function public.list_fan_connections() returns jsonb language sql as $$ select '[]'::jsonb $$;
    create function public.get_own_adult_player_account_state() returns table(team_id uuid,club_id uuid,access_granted boolean) language sql as $$ select null::uuid,null::uuid,false where false $$;
    create function public.can_use_plan_feature(c uuid,f text) returns boolean language sql as $$ select exists(select 1 from public.clubs where id=c and plan_key='club') $$;
    create function public.workspace_scope_for_plan_key(p text) returns text language sql as $$ select case when p='club' then 'club' else 'team' end $$;
    create table public.platform_admins(id uuid primary key, status text);
    insert into public.users(id,role,status) values ('${admin}', 'super_admin', 'active');
    insert into auth.users values ('${admin}',clock_timestamp(),null,'synthetic@example.test');
    insert into public.clubs(id) values ('${club}');
    insert into public.platform_admins values ('${admin}', 'active');
    insert into public.teams(id,club_id,name) select ('30000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid, '${club}', 'Synthetic team' from generate_series(1,260) n;`)
  await db.exec(authority); await db.exec(canonicalPlan); await db.exec(sql)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
  return db
}
async function mapExisting(db) {
  for (let n = 1; n <= 39; n++) await db.query('select public.prepare_existing_branding_team($1,$2)', [team(n), club])
}
async function enableSynthetic(db) {
  await db.exec("update app_private.first_250_branding_offer set terms_version='synthetic-v1',release_enabled=true")
}

test('dormant install does not start clocks, binds OFF-guarded observations, and denies client/direct service writes', async () => {
  const db = await database()
  try {
    assert.deepEqual((await db.query('select public.read_branding_offer_counter() as value')).rows[0].value, { status: 'not_active' })
    await assert.rejects(db.query('select public.reserve_new_branding_team($1,$2,$3)', [team(40), club, 'synthetic-v1']), /not_active/)
    assert.equal((await db.query('select count(*)::int n from app_private.first_250_branding_entries')).rows[0].n, 0)
    assert.equal((await db.query("select count(*)::int n from pg_trigger where not tgisinternal and tgrelid='public.teams'::regclass")).rows[0].n, 0)
    await db.query('insert into public.players(id,team_id,club_id) values($1,$2,$3)',[team(260),team(40),club])
    assert.equal((await db.query('select public.reconcile_first_250_branding_offer() n')).rows[0].n,0)
    assert.equal((await db.query('select count(*)::int n from app_private.first_250_branding_observations')).rows[0].n,0)
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
test('fresh places require canonical Matchday; upgrades preserve retries and grandfathered places', async () => {
  const db = await database()
  try {
    await mapExisting(db); await enableSynthetic(db)
    for (const plan of ['team','club','single_team','small_club','development_club','large_club','pilot','unknown']) {
      await db.query('update public.clubs set plan_key=$1 where id=$2',[plan,club])
      await assert.rejects(db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[admin,team(40),club,'synthetic-v1']),/matchday_required/)
      await assert.rejects(db.query('select public.reserve_new_branding_team($1,$2,$3)',[team(40),club,'synthetic-v1']),/matchday_required/)
      assert.equal((await db.query('select public.read_first_250_team_branding_management($1,$2,$3) v',[admin,team(40),club])).rows[0].v.claimAllowed,false)
    }
    assert.equal((await db.query("select count(*)::int n from app_private.first_250_branding_entries where cohort='new_211'")).rows[0].n,0)
    await db.query("update public.clubs set plan_key='matchday' where id=$1",[club])
    assert.equal((await db.query('select public.read_first_250_team_branding_management($1,$2,$3) v',[admin,team(40),club])).rows[0].v.claimAllowed,true)
    await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[admin,team(40),club,'synthetic-v1'])
    const original=(await db.query('select * from app_private.first_250_branding_entries where team_id=$1',[team(40)])).rows[0]
    await db.query("update public.clubs set plan_key='club' where id=$1",[club])
    assert.equal((await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4) slot',[admin,team(40),club,'stale-terms'])).rows[0].slot,40)
    assert.deepEqual((await db.query('select * from app_private.first_250_branding_entries where team_id=$1',[team(40)])).rows[0],original)
    assert.equal((await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4) slot',[admin,team(1),club,'stale-terms'])).rows[0].slot,1)
    // Existing free aliases use the actual installed canonical plan helper.
    await db.query("update public.clubs set plan_key='individual' where id=$1",[club])
    assert.equal((await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4) slot',[admin,team(41),club,'synthetic-v1'])).rows[0].slot,41)
  } finally { await db.close() }
})

test('current staff profile authority is required despite a retained head-manager assignment', async () => {
  const db=await database(), actor=team(261)
  try {
    await mapExisting(db); await enableSynthetic(db)
    await db.query("insert into auth.users values($1,clock_timestamp(),null,'staff@example.test')",[actor])
    await db.query("insert into public.users values($1,'coach','active',$2,70)",[actor,club])
    await db.query("insert into public.user_club_memberships values($1,$2,'coach',70)",[actor,club])
    await db.query("insert into public.team_staff values($1,$2,'head_manager',70)",[actor,team(40)])
    for (const [role,rank] of [['parent_portal',10],['parent_portal',70],['coach',19],['super_admin',100],['admin',20],['admin',70]]) {
      await db.query('update public.users set role=$1,role_rank=$2 where id=$3',[role,rank,actor])
      await db.query('update public.user_club_memberships set role=$1,role_rank=$2 where auth_user_id=$3',[role,rank,actor])
      await assert.rejects(db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[actor,team(40),club,'synthetic-v1']),/actor_denied/)
      await assert.rejects(db.query('select public.read_first_250_team_branding_management($1,$2,$3)',[actor,team(40),club]),/actor_denied/)
      await assert.rejects(db.query('select public.save_first_250_team_branding($1,$2,$3,$4,$5,$6)',[actor,team(40),club,null,'blue','solid']),/actor_denied/)
    }
    // Team-specific promotion keeps the base Coach profile/membership rank.
    await db.query("update public.users set role='coach',role_rank=30 where id=$1",[actor])
    await db.query("update public.user_club_memberships set role='coach',role_rank=30 where auth_user_id=$1",[actor])
    assert.equal((await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4) slot',[actor,team(40),club,'synthetic-v1'])).rows[0].slot,40)
    await db.query('select public.save_first_250_team_branding($1,$2,$3,$4,$5,$6)',[actor,team(40),club,null,'blue','solid'])
    await db.query('delete from public.user_club_memberships where auth_user_id=$1',[actor])
    await assert.rejects(db.query('select public.save_first_250_team_branding($1,$2,$3,$4,$5,$6)',[actor,team(40),club,null,'red','solid']),/actor_denied/)
    assert.equal((await db.query('select theme_accent from app_private.first_250_team_branding where team_id=$1',[team(40)])).rows[0].theme_accent,'blue')
  } finally { await db.close() }
})

test('authority revoked during allocation rolls back the new place and qualification writes', async () => {
  const db=await database()
  try {
    await mapExisting(db); await enableSynthetic(db)
    // Synthetic trigger introduces a revocation inside the allocator, before its
    // post-lock authority check. This tests rollback, not independent sessions.
    await db.exec(`create function public.synthetic_revoke_branding_actor() returns trigger language plpgsql as $$
      begin update public.users set status='suspended' where id='${admin}'; return new; end $$;
      create trigger synthetic_revoke_actor before insert on app_private.first_250_branding_entries
      for each row execute function public.synthetic_revoke_branding_actor();`)
    await assert.rejects(db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[admin,team(40),club,'synthetic-v1']),/actor_denied/)
    assert.equal((await db.query('select count(*)::int n from app_private.first_250_branding_entries where team_id=$1',[team(40)])).rows[0].n,0)
    assert.equal((await db.query('select status from public.users where id=$1',[admin])).rows[0].status,'active')
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
    await db.query("insert into app_private.first_250_team_branding(team_id,club_id,logo_url,theme_accent,theme_button_style) values ($1,$2,'https://example.test/logo.png','#047857','solid')",[team(40),club])
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

test('authorised claims observe distinct accepted players and concluded matches durably; expiry retains artwork', async () => {
  const db = await database()
  try {
    await mapExisting(db); await enableSynthetic(db)
    await assert.rejects(db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[team(1),team(40),club,'synthetic-v1']),/actor_denied/)
    await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[admin,team(40),club,'synthetic-v1'])
    for(let n=1;n<=7;n++) {
      await db.query('insert into public.players(id,team_id,club_id) values($1,$2,$3)',[team(100+n),team(40),club])
      await db.query("insert into public.parent_player_links values($1,$2,$3,$4,$5,'parent','active',clock_timestamp())",[team(110+n),team(100+n),team(40),club,admin])
    }
    for(let n=1;n<=10;n++) await db.query("insert into public.match_days values($1,$2,$3,'full_time',null,clock_timestamp(),timezone('Europe/London',clock_timestamp())::date)",[team(120+n),team(40),club])
    const entry=(await db.query('select state,qualified_at from app_private.first_250_branding_entries where slot=40')).rows[0]
    assert.equal(entry.state,'permanent'); assert(entry.qualified_at)
    assert.deepEqual((await db.query('select players_with_parent,completed_matches from app_private.first_250_branding_observations')).rows[0],{players_with_parent:7,completed_matches:10})
    await db.exec("update public.parent_player_links set status='revoked'")
    assert.equal((await db.query('select state from app_private.first_250_branding_entries where slot=40')).rows[0].state,'permanent')
    await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[admin,team(41),club,'synthetic-v1'])
    await db.query('select public.save_first_250_team_branding($1,$2,$3,$4,$5,$6)',[admin,team(41),club,null,'#047857','solid'])
    const artwork=(await db.query('select * from app_private.first_250_team_branding')).rows
    await db.exec("update app_private.first_250_branding_entries set started_at=clock_timestamp()-interval '4 months',deadline_at=clock_timestamp()-interval '1 month' where slot=41")
    await db.query('select public.reconcile_first_250_branding_offer()')
    assert.equal((await db.query('select state from app_private.first_250_branding_entries where slot=41')).rows[0].state,'failed')
    assert.deepEqual((await db.query('select * from app_private.first_250_team_branding')).rows,artwork)
    await assert.rejects(db.query('select public.extend_branding_offer_team($1,$2,$3,$4)',[team(41),club,admin,'Late']),/extension_not_applicable/)
    await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false)`)
    const failed=(await db.query('select public.get_team_branding_display($1,$2) value',[team(41),club])).rows[0].value
    assert.equal(failed.coloursAllowed,false);assert.equal(failed.accent,'')
    await db.query("update public.clubs set plan_key='club',theme_accent='#123456',logo_url='https://example.test/club.png' where id=$1",[club])
    const paid=(await db.query('select public.get_team_branding_display($1,$2) value',[team(41),club])).rows[0].value
    assert.equal(paid.source,'paid_club');assert.equal(paid.accent,'#123456')
    assert.deepEqual((await db.query('select * from app_private.first_250_team_branding')).rows,artwork)
  } finally { await db.close() }
})

test('completed approved transfers reconcile private scope atomically and preserve saved artwork and clocks',async()=>{
  const db=await database()
  const destination='10000000-0000-4000-8000-000000000002'
  try {
    await mapExisting(db);await enableSynthetic(db)
    await db.query('select public.claim_first_250_branding_team($1,$2,$3,$4)',[admin,team(40),club,'synthetic-v1'])
    await db.query('select public.save_first_250_team_branding($1,$2,$3,$4,$5,$6)',[admin,team(40),club,null,'#047857','solid'])
    const entry=(await db.query('select * from app_private.first_250_branding_entries where slot=40')).rows[0]
    await db.query("insert into public.clubs(id,plan_key) values($1,'club')",[destination])
    await db.query("insert into public.workspace_team_transfer_requests values($1,$2,$3,$4,'ready',$5,$5,null)",[team(260),team(40),club,destination,admin])
    await db.exec('begin')
    await db.query('update public.teams set club_id=$1 where id=$2',[destination,team(40)])
    await db.query("update public.workspace_team_transfer_requests set status='completed',completed_by=$1 where id=$2",[admin,team(260)])
    assert.equal((await db.query('select club_id from app_private.first_250_branding_entries where slot=40')).rows[0].club_id,destination)
    await db.exec('rollback')
    assert.deepEqual((await db.query('select * from app_private.first_250_branding_entries where slot=40')).rows[0],entry)
    await db.exec('begin')
    await db.query('update public.teams set club_id=$1 where id=$2',[destination,team(40)])
    await db.query("update public.workspace_team_transfer_requests set status='completed',completed_by=$1 where id=$2",[admin,team(260)])
    await db.exec('commit')
    const migrated=(await db.query('select * from app_private.first_250_branding_entries where slot=40')).rows[0]
    assert.deepEqual({...migrated,club_id:club},entry)
    const artwork=(await db.query('select team_id,club_id,theme_accent from app_private.first_250_team_branding')).rows[0]
    assert.deepEqual(artwork,{team_id:team(40),club_id:destination,theme_accent:'#047857'})
  } finally {await db.close()}
})
