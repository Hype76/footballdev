import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261102101356_direct_match_day_parent_assignment.sql', import.meta.url), 'utf8')
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

test('direct assignment is atomic, team scoped, preserves other responses and creates scorer access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create schema app_private; create schema auth; create table auth.users(id uuid primary key); create table public.users(id uuid, status text, role text, club_id uuid);
      create table match_days (id uuid primary key, club_id uuid, team_id uuid, deleted_at timestamptz, concluded_at timestamptz, status text);
      create table players (id uuid primary key, club_id uuid, team_id uuid, status text, player_name text);
      create table parent_player_links (id uuid primary key, club_id uuid, team_id uuid, player_id uuid, status text, auth_user_id uuid, email text);
      create table match_day_availability_requests (id uuid primary key default gen_random_uuid(), match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, player_name text, recipient_email text, recipient_name text, recipient_type text, channel text, token_hash text, parent_link_id uuid, created_by uuid, created_by_name text, status text default 'pending', expires_at timestamptz default now(), created_at timestamptz default now(), updated_at timestamptz default now(), volunteer_scorer_response text default 'no_response', volunteer_linesman_response text default 'no_response', volunteer_referee_response text default 'no_response', volunteer_responded_at timestamptz, unique(match_day_id, player_id, recipient_email, recipient_type, channel));
      create table match_day_role_assignments (id uuid default gen_random_uuid(), match_day_id uuid, club_id uuid, team_id uuid, role text, parent_link_id uuid, auth_user_id uuid, assigned_by uuid, assigned_by_name text, created_at timestamptz, updated_at timestamptz, unique(match_day_id, role));
      create function public.sync_match_day_scorer_assignment(uuid, uuid, uuid, text, boolean) returns void language plpgsql as $$ begin if $4 = 'Fail' then raise exception 'assignment failed'; end if; insert into public.match_day_role_assignments(match_day_id, role, parent_link_id) values ($1, 'scorer', $2) on conflict(match_day_id, role) do update set parent_link_id = excluded.parent_link_id; end $$;
    `)
    await db.exec(migration)
    await db.query(`insert into match_days values ($1,$2,$3,null,null,'scheduled')`, [id(1),id(2),id(3)])
    await db.query(`insert into players values ($1,$2,$3,'active','Player')`, [id(4),id(2),id(3)])
    await db.query('insert into auth.users values ($1)', [id(6)])
    await db.query(`insert into parent_player_links values ($1,$2,$3,$4,'active',$5,'parent@example.test')`, [id(5),id(2),id(3),id(4),id(6)])
    const assign = (role, link = id(5)) => db.query('select public.assign_match_day_parent_directly($1,$2,$3,$4,$5)', [id(1),link,role,id(7),'Coach'])
    await assign('scorer')
    const retry = await assign('scorer')
    assert.equal(retry.rows[0].assign_match_day_parent_directly.previousAssignment.parent_link_id, id(5))
    assert.equal((await db.query('select count(*)::int as n from match_day_availability_requests')).rows[0].n, 1)
    assert.equal((await db.query("select has_function_privilege('authenticated', 'public.assign_match_day_parent_directly(uuid,uuid,text,uuid,text)', 'execute') as allowed")).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('service_role', 'public.assign_match_day_parent_directly(uuid,uuid,text,uuid,text)', 'execute') as allowed")).rows[0].allowed, true)
    await db.exec("update match_day_availability_requests set status='available'")
    let rows = (await db.query('select volunteer_scorer_response from match_day_availability_requests')).rows
    assert.equal(rows[0].volunteer_scorer_response, 'yes')
    assert.equal((await db.query('select status from match_day_availability_requests')).rows[0].status, 'available')
    assert.equal((await db.query("select parent_link_id from match_day_role_assignments where role='scorer'")).rows[0].parent_link_id, id(5))
    await db.exec("update match_day_availability_requests set volunteer_scorer_response='no'")
    await assert.rejects(db.query('select public.assign_match_day_parent_directly($1,$2,$3,$4,$5)', [id(1),id(5),'scorer',id(7),'Fail']), /assignment failed/)
    assert.equal((await db.query('select volunteer_scorer_response from match_day_availability_requests')).rows[0].volunteer_scorer_response, 'no')
    await assign('scorer')
    await db.exec("update match_day_availability_requests set volunteer_referee_response='no'")
    await assign('referee')
    assert.equal((await db.query('select volunteer_referee_response, volunteer_scorer_response from match_day_availability_requests')).rows[0].volunteer_scorer_response, 'yes')
    assert.equal((await db.query("select count(*)::int as n from match_day_role_assignments where role='referee'")).rows[0].n, 1)
    await assert.rejects(assign('linesman', id(99)), /active linked parent/)
    await db.query("insert into public.users values ($1,'suspended','parent_portal',$2)", [id(6), id(2)])
    await assert.rejects(assign('linesman'), /active linked parent/)
    await db.exec('delete from public.users')
    await db.query('update parent_player_links set team_id=$1', [id(99)])
    await assert.rejects(assign('linesman'), /active linked parent/)
    await db.query('update parent_player_links set team_id=$1', [id(3)])
    await db.exec("update match_days set status='full_time'")
    await assert.rejects(assign('linesman'), /no longer available/)
    assert.equal((await db.query('select volunteer_linesman_response from match_day_availability_requests')).rows[0].volunteer_linesman_response, 'no_response')
  } finally { await db.close() }
})
