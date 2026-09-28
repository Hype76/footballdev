import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20260928081904_coach_goal_penalty_correction.sql', import.meta.url), 'utf8')

test('Coach goal correction changes penalty status at full time with audit and scoped access', async () => {
  const db = new PGlite()
  const actor = randomUUID(), fixture = randomUUID(), club = randomUUID(), otherClub = randomUUID(), team = randomUUID(), goal = randomUUID(), secondGoal = randomUUID()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
      create function public.can_manage_match_day(uuid) returns boolean language sql as $$select true$$;
      create function public.current_user_role() returns text language sql as $$select 'coach'$$;
      create function public.current_user_club_id() returns uuid language sql as $$select current_setting('test.club_id')::uuid$$;
      create table public.match_days(id uuid primary key, club_id uuid, team_id uuid, deleted_at timestamptz,
        concluded_at timestamptz, status text, timer_status text default 'full_time');
      create table public.match_day_events(id uuid primary key, match_day_id uuid, club_id uuid, team_id uuid,
        event_type text, event_status text, is_penalty_goal boolean, is_own_goal boolean,
        correction_metadata jsonb, correction_reason text, home_score integer default 0, away_score integer default 0);
      create table public.match_day_event_log(club_id uuid, team_id uuid, match_day_id uuid,
        actor_user_id uuid, actor_display_name text, actor_role text, event_type text, event_label text,
        previous_value jsonb, new_value jsonb, metadata jsonb);
      create function public.correct_match_day_goal_v2(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer)
        returns jsonb language plpgsql as $$begin
          update public.match_day_events set event_status='corrected', correction_reason=$11,
            is_own_goal=$12 where id=$2 and match_day_id=$1;
          return jsonb_build_object('id',$2);
        end$$;
      create function public.void_match_day_event(uuid,uuid,text,text)
        returns jsonb language plpgsql as $$begin
          update public.match_day_events set event_status='voided'
            where id=$2 and match_day_id=$1;
          update public.match_day_events set home_score=1
            where match_day_id=$1;
          return jsonb_build_object('id',$2,'eventStatus','voided');
        end$$;
    `)
    await db.exec(migration)
    await db.query('insert into public.match_days(id,club_id,team_id,status) values($1,$2,$3,$4)', [fixture, club, team, 'full_time'])
    await db.query('insert into public.match_day_events(id,match_day_id,club_id,team_id,event_type,event_status,is_penalty_goal,is_own_goal) values($1,$2,$3,$4,$5,$6,$7,$8)', [goal, fixture, club, team, 'goal', 'active', false, false])
    await db.query('insert into public.match_day_events(id,match_day_id,club_id,team_id,event_type,event_status,is_penalty_goal,is_own_goal) values($1,$2,$3,$4,$5,$6,$7,$8)', [secondGoal, fixture, club, team, 'goal', 'active', false, false])
    await db.exec('create trigger goal_guard before insert or update or delete on public.match_day_events for each row execute function public.enforce_match_day_event_write()')
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
    await db.query("select set_config('test.club_id',$1,false)", [club])
    await assert.rejects(db.query('insert into public.match_day_events(id,match_day_id,event_type,event_status) values($1,$2,$3,$4)', [randomUUID(), fixture, 'goal', 'active']), /read only/)
    await assert.rejects(db.query('update public.match_day_events set is_penalty_goal=true where id=$1', [goal]), /read only/)
    const args = [fixture, goal, 'club', 'Scorer', '9', '', '', 43, '', 'Penalty was omitted', false, true, null]
    await db.query('select public.correct_coach_match_day_goal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', args)
    const updated = (await db.query('select is_penalty_goal,event_status,correction_metadata from public.match_day_events where id=$1', [goal])).rows[0]
    assert.equal(updated.is_penalty_goal, true)
    assert.equal(updated.event_status, 'corrected')
    assert.equal(updated.correction_metadata.previousPenaltyGoal, false)
    assert.equal(updated.correction_metadata.correctedPenaltyGoal, true)
    assert.equal((await db.query('select count(*)::integer as total from public.match_day_event_log')).rows[0].total, 1)
    await db.query('select public.correct_coach_match_day_goal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [
      ...args.slice(0, 10), true, true, null,
    ])
    assert.equal((await db.query('select is_penalty_goal from public.match_day_events where id=$1', [goal])).rows[0].is_penalty_goal, false)
    await db.query('select public.void_coach_match_day_event_v1($1,$2,$3,$4)', [fixture, secondGoal, 'duplicate_goal', 'Duplicate'])
    assert.equal((await db.query('select event_status from public.match_day_events where id=$1', [secondGoal])).rows[0].event_status, 'voided')
    assert.equal((await db.query('select home_score from public.match_day_events where id=$1', [goal])).rows[0].home_score, 1)
    await db.query('update public.match_days set concluded_at=now() where id=$1', [fixture])
    await assert.rejects(db.query('select public.correct_coach_match_day_goal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', args), /closed or unavailable/)
    await assert.rejects(db.query('select public.void_coach_match_day_event_v1($1,$2,$3,$4)', [fixture, goal, 'duplicate_goal', 'Too late']), /closed or unavailable/)
    await db.query('update public.match_days set concluded_at=null where id=$1', [fixture])
    await db.query("select set_config('test.club_id',$1,false)", [otherClub])
    await assert.rejects(db.query('select public.correct_coach_match_day_goal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', args), /Coach or manager access/)
    await assert.rejects(db.query('select public.void_coach_match_day_event_v1($1,$2,$3,$4)', [fixture, goal, 'duplicate_goal', 'Wrong club']), /Coach or manager access/)
    const grants = (await db.query("select has_function_privilege('anon','public.correct_coach_match_day_goal_v1(uuid,uuid,text,text,text,text,text,integer,text,text,boolean,boolean,integer)','execute') as anon")).rows[0]
    assert.equal(grants.anon, false)
    assert.equal((await db.query("select has_function_privilege('anon','public.void_coach_match_day_event_v1(uuid,uuid,text,text)','execute') as anon")).rows[0].anon, false)
  } finally { await db.close() }
})
