import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const participationMigration = await readFile(new URL('../supabase/migrations/20261109155100_player_participation_and_chat_communities.sql', import.meta.url), 'utf8')
const playerTypeRules = participationMigration.slice(
  participationMigration.indexOf('create function private.player_type_allows_event('),
  participationMigration.indexOf('alter function public.apply_event_player_changes('),
)
const squadTypeGuard = participationMigration.slice(
  participationMigration.indexOf('create function private.guard_match_squad_player_type('),
  participationMigration.indexOf('alter table public.parent_chat_rooms drop constraint'),
)

test('enabling auto selection atomically reconciles eligible prior responses and respects later manual edits', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create schema app_private; create schema auth; create schema private;
      create role anon; create role authenticated; create role service_role;
      create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
      create function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,int) returns boolean language sql as $$ select $2 = '00000000-0000-0000-0000-000000000010'::uuid $$;
      create table public.users (id uuid, name text);
      create table public.match_days (id uuid, club_id uuid, team_id uuid, status text, deleted_at timestamptz, previous_hidden_at timestamptz, auto_select_available_players boolean, fixture_type text);
      create table public.players (id uuid, club_id uuid, team_id uuid, status text, archived_at timestamptz, section text);
      create table public.club_player_types (club_id uuid, name text, can_friendly boolean, can_cup boolean, can_league boolean, can_training boolean);
      create table public.assessment_sessions (id uuid, club_id uuid, team_id uuid, session_type text);
      create table public.calendar_events (id uuid, club_id uuid, team_id uuid, event_type text);
      create table public.match_day_player_availability (match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text);
      create table public.calendar_event_invites (match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, invite_status text, cancelled_at timestamptz);
      create table public.match_day_availability_requests (match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text);
      create table public.match_day_player_squad_decisions (match_day_id uuid, club_id uuid, team_id uuid, player_id uuid, status text, decided_by uuid, decided_by_name text, decided_at timestamptz, updated_at timestamptz, constraint match_day_player_squad_decisions_match_player_key unique(match_day_id, player_id));
      insert into public.users values ('00000000-0000-0000-0000-000000000001','Coach');
      insert into public.match_days values ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','scheduled',null,null,false,'league');
      insert into public.club_player_types values
        ('00000000-0000-0000-0000-000000000010','Squad',true,true,true,true),
        ('00000000-0000-0000-0000-000000000010','Training-only',true,false,false,true);
      insert into public.players select ('00000000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid, '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
        case when i=4 then 'archived' else 'active' end, null, case when i=7 then 'Training-only' else 'Squad' end from generate_series(1,7) i;
      insert into public.match_day_player_availability select '00000000-0000-0000-0000-000000000100',club_id,team_id,id,case when id::text like '%000006' then 'unavailable' else 'available' end from public.players;
      insert into public.calendar_event_invites select match_day_id,club_id,team_id,player_id,case when player_id::text like '%000005' then 'cancelled' else 'sent' end,null from public.match_day_player_availability where player_id::text not like '%000003';
      insert into public.match_day_availability_requests select match_day_id,club_id,team_id,player_id,'sent' from public.match_day_player_availability where player_id::text like '%000003';
      insert into public.match_day_player_squad_decisions select match_day_id,club_id,team_id,player_id,'not_selected',null,'Previous',now(),now() from public.match_day_player_availability where player_id::text like '%000002';
    `)
    await db.exec(playerTypeRules)
    await db.exec(squadTypeGuard)
    await db.exec(await readFile(new URL('../supabase/migrations/20261112071853_reconcile_available_players_on_enable.sql', import.meta.url), 'utf8'))
    await db.exec(`alter table public.match_day_player_squad_decisions add constraint fail_selection check (player_id::text not like '%000003')`)
    await assert.rejects(db.exec(`update public.match_days set auto_select_available_players=true`))
    assert.equal((await db.query(`select auto_select_available_players from public.match_days`)).rows[0].auto_select_available_players, false)
    assert.equal((await db.query(`select count(*)::int as n from public.match_day_player_squad_decisions where status='selected'`)).rows[0].n, 0)
    await db.exec(`alter table public.match_day_player_squad_decisions drop constraint fail_selection; update public.match_days set auto_select_available_players=true`)
    assert.deepEqual((await db.query(`select right(player_id::text, 1) as player from public.match_day_player_squad_decisions where status='selected' order by player_id`)).rows.map(row => row.player), ['1', '2', '3'])
    await db.exec(`update public.match_day_player_squad_decisions set status='not_selected' where player_id::text like '%000002'; update public.match_days set auto_select_available_players=true`)
    assert.equal((await db.query(`select status from public.match_day_player_squad_decisions where player_id::text like '%000002'`)).rows[0].status, 'not_selected')
    await db.exec(`update public.match_days set auto_select_available_players=false, club_id='00000000-0000-0000-0000-000000000011'`)
    await assert.rejects(db.exec(`update public.match_days set auto_select_available_players=true`), /Coach or manager access/)
  } finally { await db.close() }
})
