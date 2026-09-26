import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { canCorrectMatchDayScore } from '../src/lib/matchday-lifecycle.js'
import { getCoachMatchDayActions } from '../apps/mobile-core/src/coachMatchDayCore.js'

const migration = await readFile(new URL('../supabase/migrations/20260926144304_match_day_full_time_score_and_parent_goal_undo.sql', import.meta.url), 'utf8')
const writeFix = await readFile(new URL('../supabase/migrations/20260926165000_authorised_full_time_event_corrections.sql', import.meta.url), 'utf8')
assert.match(migration, /perform public\.void_parent_match_day_goal\(m\.id,target_event_id,parent_link_id_value,payload_value->>'reason'\)/)

test('Parent and Coach may correct the score at full time before conclusion', () => {
  const match = { status: 'full_time', timerStatus: 'full_time' }
  assert.equal(canCorrectMatchDayScore(match), true)
  assert.equal(canCorrectMatchDayScore({ ...match, concludedAt: '2026-09-26T12:00:00Z' }), false)
  const context = { role: 'coach', roleRank: 30, paymentAccess: { canMutate: true } }
  assert.equal(getCoachMatchDayActions({ context, match }).canCorrectScore, true)
  assert.equal(getCoachMatchDayActions({ context, match }).canRecordEvents, false)
})

test('full-time correction and Parent goal removal enforce assignment and preserve audit', async () => {
  const db = new PGlite()
  const actor = randomUUID(), other = randomUUID(), fixture = randomUUID(), club = randomUUID(), team = randomUUID(), link = randomUUID(), goal = randomUUID()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
      create table public.match_days(id uuid primary key, club_id uuid, team_id uuid, deleted_at timestamptz,
        status text, timer_status text, concluded_at timestamptz, home_away text default 'home',
        current_match_phase text default 'second_half', home_score integer default 0, away_score integer default 0,
        updated_at timestamptz default now());
      create table public.match_day_events(id uuid primary key default gen_random_uuid(), match_day_id uuid,
        club_id uuid, team_id uuid, event_type text, team_side text, event_status text default 'active',
        scorer_name text, home_score integer, away_score integer, notes text, created_by uuid,
        created_by_parent_link_id uuid, created_by_name text, match_phase text, phase_order integer,
        request_id uuid, voided_at timestamptz, voided_by uuid, voided_by_parent_link_id uuid,
        voided_by_name text, correction_reason text, correction_metadata jsonb);
      create table public.match_day_event_log(club_id uuid, team_id uuid, match_day_id uuid,
        actor_user_id uuid, actor_display_name text, actor_role text, event_type text, event_label text,
        previous_value jsonb, new_value jsonb, metadata jsonb);
      create table public.match_day_role_assignments(match_day_id uuid, role text, parent_link_id uuid,
        auth_user_id uuid, club_id uuid, team_id uuid);
      create table public.parent_player_links(id uuid, auth_user_id uuid, status text, club_id uuid, team_id uuid);
      create function private.is_guest_match_scorer(uuid) returns boolean language sql as $$select false$$;
      create function public.match_day_phase_order(text) returns integer language sql as $$select 20$$;
      create function public.current_user_has_match_day_scorer_assignment(target uuid) returns boolean language sql
        as $$select exists(select 1 from public.match_day_role_assignments where match_day_id=target and auth_user_id=auth.uid())$$;
      create function public.resolve_match_day_mutation_actor(target uuid, parent_link uuid)
        returns table(actor_user_id uuid, actor_parent_link_id uuid, actor_name text, actor_role text)
        language sql as $$select auth.uid(),parent_link,'FP TEST','scorer_parent'$$;
    `)
    await db.exec(writeFix)
    await db.query('insert into public.match_days(id,club_id,team_id,status,timer_status,away_score) values($1,$2,$3,$4,$5,2)', [fixture, club, team, 'full_time', 'full_time'])
    await db.query('insert into public.parent_player_links values($1,$2,$3,$4,$5)', [link, actor, 'active', club, team])
    await db.query('insert into public.match_day_role_assignments values($1,$2,$3,$4,$5,$6)', [fixture, 'scorer', link, actor, club, team])
    await db.query('insert into public.match_day_events(id,match_day_id,club_id,team_id,event_type,team_side,scorer_name) values($1,$2,$3,$4,$5,$6,$7)', [goal, fixture, club, team, 'goal', 'opponent', 'FP TEST'])
    await db.exec('create trigger match_day_events_enforce_write before insert or update or delete on public.match_day_events for each row execute function public.enforce_match_day_event_write()')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
    await assert.rejects(db.query('insert into public.match_day_events(match_day_id,event_type) values($1,$2)', [fixture, 'score_correction']), /Completed or closed matches are read only/)
    await db.query('select public.record_match_day_score_correction_v2($1,$2,0,2,$3,$4)', [fixture, link, 'Reviewed score', randomUUID()])
    const removed = (await db.query('select public.void_parent_match_day_goal($1,$2,$3,$4) as result', [fixture, goal, link, 'Duplicate goal'])).rows[0].result
    assert.equal(removed.awayScore, 1)
    assert.deepEqual((await db.query('select home_score,away_score from public.match_days where id=$1', [fixture])).rows[0], { home_score: 0, away_score: 1 })
    assert.equal((await db.query('select event_status,correction_reason from public.match_day_events where id=$1', [goal])).rows[0].correction_reason, 'Duplicate goal')
    assert.equal((await db.query('select count(*)::integer as total from public.match_day_event_log where match_day_id=$1', [fixture])).rows[0].total, 2)
    await assert.rejects(db.query('select public.void_parent_match_day_goal($1,$2,$3,$4)', [fixture, goal, link, 'Duplicate goal']), /already been removed/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other])
    await assert.rejects(db.query('select public.void_parent_match_day_goal($1,$2,$3,$4)', [fixture, goal, link, 'Duplicate goal']), /Parent scorer access/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
    await db.query('update public.match_days set concluded_at=now() where id=$1', [fixture])
    await assert.rejects(db.query('select public.record_match_day_score_correction_v2($1,$2,0,1,$3,$4)', [fixture, link, 'Too late', randomUUID()]), /Start the match/)
    const grants = (await db.query("select has_function_privilege('anon','public.void_parent_match_day_goal(uuid,uuid,uuid,text)','execute') as anon")).rows[0]
    assert.equal(grants.anon, false)
  } finally { await db.close() }
})
