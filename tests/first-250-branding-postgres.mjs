// Explicit local-only rehearsal, not a production connection or CI prerequisite.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import net from 'node:net'

const exec = promisify(execFile)
const bin = process.env.BRANDING_TEST_POSTGRES_BIN
if (!bin || !process.argv.includes('--local-only')) throw new Error('Set BRANDING_TEST_POSTGRES_BIN and pass --local-only.')
const suffix = process.platform === 'win32' ? '.exe' : ''
const outputRoot = path.join(process.cwd(), 'output')
await mkdir(outputRoot, { recursive: true })
const directory = await mkdtemp(path.join(outputRoot, 'fp-branding-synthetic-'))
const data = path.join(directory, 'data')
const probe = net.createServer()
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
const psqlArgs = ['-X','-h','127.0.0.1','-p',String(port),'-U','branding_test_owner','-d','postgres','-v','ON_ERROR_STOP=1','-A','-t']
const query = async sql => (await exec(path.join(bin, `psql${suffix}`), [...psqlArgs,'-c',sql], { timeout: 30000 })).stdout.trim()
const club = '10000000-0000-4000-8000-000000000001'
const admin = '20000000-0000-4000-8000-000000000001'
const team = n => `30000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const call = n => query(`set role service_role; select set_config('request.jwt.claim.role','service_role',false);
  select public.reserve_new_branding_team('${team(n)}','${club}','synthetic-v1');`)
let started = false
try {
  await exec(path.join(bin, `initdb${suffix}`), ['-D',data,'-U','branding_test_owner','--auth=trust','--no-locale','-E','UTF8'], { timeout: 60000 })
  await exec(path.join(bin, `pg_ctl${suffix}`), ['-D',data,'-l',path.join(directory,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'], { timeout: 30000 })
  started = true
  const migration = await readFile(new URL('../supabase/migrations/20261003060000_first_250_branding_preparation.sql',import.meta.url),'utf8')
  const source = await readFile(new URL('../supabase/migrations/20260725174533_platform_club_access_management.sql',import.meta.url),'utf8')
  const authority = source.slice(source.indexOf('create or replace function public.platform_access_is_admin_v1'),source.indexOf('create or replace function public.platform_access_audit_v1'))
  const planSource = await readFile(new URL('../supabase/migrations/20260918104253_matchday_tier_entitlement_security.sql',import.meta.url),'utf8')
  const canonicalPlan = planSource.slice(planSource.indexOf('create or replace function public.normalize_subscription_plan_key'),planSource.indexOf('alter table if exists public.clubs drop constraint'))
  const fixture = `create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to service_role;
    create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz,email text);
    create table public.clubs(id uuid primary key,status text default 'active',archived_at timestamptz,
      plan_key text default 'matchday',logo_url text,theme_accent text,theme_button_style text);
    create table public.teams(id uuid primary key,club_id uuid,name text,status text default 'active',archived_at timestamptz);
    create table public.users(id uuid primary key,role text,status text,club_id uuid,role_rank integer);
    create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table public.team_staff(user_id uuid,team_id uuid,role_key text,role_rank integer);
    create table public.players(id uuid primary key,team_id uuid,club_id uuid,status text,archived_at timestamptz,created_at timestamptz);
    create table public.parent_player_links(id uuid primary key,player_id uuid,team_id uuid,club_id uuid,auth_user_id uuid,link_type text,status text,accepted_at timestamptz);
    create table public.match_days(id uuid primary key,team_id uuid,club_id uuid,status text,deleted_at timestamptz,concluded_at timestamptz,match_date date);
    create table public.workspace_team_transfer_requests(id uuid primary key,team_id uuid,source_club_id uuid,destination_club_id uuid,
      status text,source_approved_by uuid,destination_approved_by uuid,completed_by uuid);
    create function public.current_user_can_access_team(c uuid,t uuid) returns boolean language sql as $$ select auth.uid()='${admin}'::uuid and c='${club}'::uuid $$;
    create function public.current_user_can_access_parent_team(t uuid) returns boolean language sql as $$ select false $$;
    create function public.list_fan_connections() returns jsonb language sql as $$ select '[]'::jsonb $$;
    create function public.get_own_adult_player_account_state() returns table(team_id uuid,club_id uuid,access_granted boolean) language sql as $$ select null::uuid,null::uuid,false where false $$;
    create function public.can_use_plan_feature(c uuid,f text) returns boolean language sql as $$ select exists(select 1 from public.clubs where id=c and plan_key='club') $$;
    create function public.workspace_scope_for_plan_key(p text) returns text language sql as $$ select case when p='club' then 'club' else 'team' end $$;
    create table public.platform_admins(id uuid primary key,status text);
    insert into public.clubs(id) values('${club}');
    insert into public.teams(id,club_id,name) select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${club}','Synthetic' from generate_series(1,270) n;
    ${authority}
    ${canonicalPlan}
    ${migration}
    select set_config('request.jwt.claim.role','service_role',false);
    do $$ begin for n in 1..39 loop perform public.prepare_existing_branding_team(('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${club}'); end loop; end $$;
    update app_private.first_250_branding_offer set terms_version='synthetic-v1',release_enabled=true;`
  const fixturePath = path.join(directory,'fixture.sql')
  await writeFile(fixturePath,fixture)
  await exec(path.join(bin,`psql${suffix}`),[...psqlArgs,'-f',fixturePath],{timeout:30000})
  await Promise.all(Array.from({length:20},()=>call(40)))
  assert.equal(await query('select count(*) from app_private.first_250_branding_entries where slot>=40'), '1')
  await Promise.all(Array.from({length:20},(_,i)=>call(41+i)))
  assert.equal(await query('select count(distinct slot) from app_private.first_250_branding_entries where slot>=40'), '21')
  await query(`select set_config('request.jwt.claim.role','service_role',false);
    do $$ begin for n in 61..248 loop perform public.reserve_new_branding_team(('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${club}','synthetic-v1'); end loop; end $$;`)
  await Promise.all(Array.from({length:12},(_,i)=>call(249+i)))
  assert.equal(await query('select count(*) from app_private.first_250_branding_entries'), '250')
  assert.equal(await query('select count(*) from app_private.first_250_branding_entries where slot>=40'), '211')
  assert.equal(await query('select count(distinct team_id) from app_private.first_250_branding_entries'), '250')
  const receipt = { result:'pass',backend:'real local PostgreSQL',independentClaimSessions:52,
    assertions:5,records:'synthetic only',port,temporaryDirectory:directory,
    limitations:['JWT/PostgREST and full installed schema not exercised','no production/provider/handset access'] }
  await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2))
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
} finally {
  if (started) await exec(path.join(bin,`pg_ctl${suffix}`),['-D',data,'-m','fast','-w','stop'],{timeout:30000})
}
