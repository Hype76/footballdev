import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('parent pitch surface follows canonical fixture access and preserves clock fields', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.match_days (
        id uuid primary key, deleted_at timestamptz, pitch_type text default '',
        match_conclusion_rule text, current_match_phase text, extra_time_half_minutes integer,
        extra_time_period_count integer, normal_time_home_score integer, normal_time_away_score integer,
        extra_time_home_score integer, extra_time_away_score integer, home_shootout_score integer,
        away_shootout_score integer, shootout_winner text, match_duration_minutes integer, match_clock_mode text
      );
      create table public.match_day_shootout_kicks (
        id uuid, match_day_id uuid, team_side text, outcome text, kick_number integer, player_name text,
        notes text, event_status text, voided_at timestamptz, voided_by_name text, void_reason text,
        home_shootout_score integer, away_shootout_score integer, created_at timestamptz
      );
      create table public.match_day_events (
        id uuid, match_day_id uuid, is_penalty_goal boolean, is_own_goal boolean, minute integer,
        match_phase text, phase_order integer, stoppage_minute integer, event_sequence bigint
      );
      create table public.fixture_access(parent_link_id uuid, viewer_id uuid, match_day_id uuid);
      create function public.get_parent_portal_match_days(parent_link_id_value uuid) returns table(id uuid)
      language sql stable security definer set search_path='' as $$
        select match_day_id from public.fixture_access
        where parent_link_id=parent_link_id_value and viewer_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      create function public.get_parent_portal_match_day_extended_state(uuid) returns table(match_day_id uuid)
      language sql as $$ select id from public.match_days $$;
      insert into public.match_days(id,pitch_type,match_duration_minutes,match_clock_mode) values
        ('10000000-0000-4000-8000-000000000001','3g',80,'fixed'),
        ('10000000-0000-4000-8000-000000000002','grass',90,'continuous'),
        ('10000000-0000-4000-8000-000000000003','4g',90,'continuous');
      update public.match_days set deleted_at=now() where id='10000000-0000-4000-8000-000000000003';
      insert into public.fixture_access values
        ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
        ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),
        ('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20260908155703_parent_match_pitch_surface.sql', import.meta.url), 'utf8'))
    await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false)")
    const query = "select match_day_id,pitch_type,match_duration_minutes,match_clock_mode from public.get_parent_portal_match_day_extended_state('20000000-0000-4000-8000-000000000001')"
    assert.deepEqual((await db.query(query)).rows, [{match_day_id:'10000000-0000-4000-8000-000000000001',pitch_type:'3g',match_duration_minutes:80,match_clock_mode:'fixed'}])
    assert.deepEqual((await db.query("select * from public.get_parent_portal_match_day_extended_state('20000000-0000-4000-8000-000000000002')")).rows, [])
    await db.exec("select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000002',false)")
    assert.deepEqual((await db.query(query)).rows, [])
    await db.exec('reset role; update public.match_days set pitch_type=\'\' where pitch_type=\'3g\'; set role authenticated;')
    await db.exec("select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false)")
    assert.equal((await db.query(query)).rows[0].pitch_type,'')
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query(query), /permission denied/)
  } finally { await db.close() }
})
