import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260930162515_matchday_squad_save_without_parent_chat.sql', import.meta.url), 'utf8')
const original = await readFile(new URL('../supabase/migrations/20260714120000_parent_portal_chat_v1.sql', import.meta.url), 'utf8')
const start = original.indexOf('create or replace function public.parent_chat_sync_squad_decision()')
const baseline = original.slice(start, original.indexOf('$$;', start) + 3)
const club = '10000000-0000-4000-8000-000000000001'
const team = '10000000-0000-4000-8000-000000000002'
const match = '10000000-0000-4000-8000-000000000003'
const player = '10000000-0000-4000-8000-000000000004'

test('Matchday squad saves skip unavailable chat while preserving enabled chat and its plan gate', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create table plan (enabled boolean);
    insert into plan values (false);
    create function public.can_use_plan_feature(uuid,text) returns boolean language sql as $$
      select enabled from public.plan where $2='parentChat'
    $$;
    create table public.match_days (id uuid primary key,club_id uuid,team_id uuid,status text,previous_hidden_at timestamptz);
    insert into match_days values ('${match}','${club}','${team}','scheduled',null);
    create table public.match_day_player_squad_decisions (match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,status text);
    create table public.parent_chat_rooms (id uuid primary key default gen_random_uuid(),club_id uuid,team_id uuid,match_day_id uuid,room_type text,title text,status text,updated_at timestamptz);
    create unique index chat_match on parent_chat_rooms(club_id,team_id,match_day_id) where room_type='match_squad';
    create table reconciliations (room_id uuid);
    create function public.parent_chat_reconcile_room(uuid) returns void language plpgsql as $$begin
      if public.can_use_plan_feature('${club}','parentChat') is not true then raise exception 'plan_capability_not_available'; end if;
      insert into public.reconciliations values ($1);
    end;$$;
    create function enforce_chat_plan() returns trigger language plpgsql as $$begin
      if public.can_use_plan_feature(new.club_id,'parentChat') is not true then raise exception 'plan_capability_not_available'; end if;
      return new;
    end;$$;
    create trigger chat_plan before insert or update on parent_chat_rooms for each row execute function enforce_chat_plan();
  `)
  await db.exec(baseline)
  await db.exec('create trigger squad_chat after insert or update or delete on match_day_player_squad_decisions for each row execute function public.parent_chat_sync_squad_decision();')
  const save = () => db.exec(`insert into match_day_player_squad_decisions values ('${match}','${club}','${team}','${player}','selected')`)
  await assert.rejects(save(), /plan_capability_not_available/)
  assert.equal((await db.query('select count(*)::int n from match_day_player_squad_decisions')).rows[0].n, 0, 'Original chat failure rolls back squad save')
  await db.exec(migration)
  await save()
  assert.equal((await db.query('select status from match_day_player_squad_decisions')).rows[0].status, 'selected')
  assert.equal((await db.query('select count(*)::int n from parent_chat_rooms')).rows[0].n, 0)
  await assert.rejects(db.exec(`insert into parent_chat_rooms(club_id) values ('${club}')`), /plan_capability_not_available/, 'Direct chat writes remain blocked')
  await db.exec('update plan set enabled=true; update match_day_player_squad_decisions set status=\'selected\';')
  assert.equal((await db.query('select status from parent_chat_rooms')).rows[0].status, 'active')
  assert.equal((await db.query('select count(*)::int n from reconciliations')).rows[0].n, 1)
  await db.exec('update plan set enabled=false; update match_day_player_squad_decisions set status=\'not_selected\'; delete from match_day_player_squad_decisions;')
  assert.equal((await db.query('select count(*)::int n from reconciliations')).rows[0].n, 1, 'Disabled chat skips existing room reconciliation too')
  await db.exec('update plan set enabled=null;')
  await save()
  assert.equal((await db.query('select count(*)::int n from match_day_player_squad_decisions')).rows[0].n, 1, 'Unknown chat capability also skips optional sync')
  await db.exec('update plan set enabled=true; update match_day_player_squad_decisions set status=\'selected\'; update match_day_player_squad_decisions set status=\'not_selected\'; delete from match_day_player_squad_decisions;')
  assert.equal((await db.query('select count(*)::int n from reconciliations')).rows[0].n, 4, 'Enabled insert, deselection and deletion continue to reconcile')
})
