import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
function sqlFunction(source, name) {
  const start = source.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'))
  assert.ok(start >= 0, name)
  const text = source.slice(start)
  const delimiter = text.match(/as\s+(\$\w*\$)/i)[1]
  const opening = text.indexOf(delimiter)
  const end = text.indexOf(delimiter, opening + delimiter.length)
  return text.slice(0, end + delimiter.length) + ';'
}

test('database sync preserves offline times, command identity, authority and conflict boundaries', async () => {
  const source = await read('./matchday-parent-scorer-hardening-db.test.mjs')
  const schema = source.match(/const schemaSql = `([\s\S]*?)`;\r?\n\r?\nasync function setActor/)[1]
  const db = new PGlite()
  const club = randomUUID(), team = randomUUID(), coach = randomUUID(), parent = randomUUID(), match = randomUUID()
  try {
    await db.exec(schema)
    await db.exec(`create table auth.users(id uuid primary key); create schema private;
      create function private.is_guest_match_scorer(uuid) returns boolean language sql as $$select false$$;
      create function public.can_read_match_day(uuid) returns boolean language sql as $$select true$$;
      create function public.get_parent_portal_match_days(uuid) returns table(id uuid) language sql as $$select null::uuid where false$$;`)
    await db.exec(await read('../supabase/migrations/20260722084618_fp_v1_gameday_prematch_parity_harden_03.sql'))
    await db.exec(await read('../supabase/migrations/20260722195910_fp_v1_gameday_extended_ops_12a.sql'))
    await db.exec(`alter table public.match_days add column previous_hidden_at timestamptz;
      alter table public.match_day_events add column if not exists request_id uuid, add column if not exists is_penalty_goal boolean default false, add column if not exists is_own_goal boolean default false;
      create function public.resolve_match_day_mutation_actor(uuid,uuid) returns table(actor_user_id uuid,actor_parent_link_id uuid,actor_name text,actor_role text)
      language sql as $$select auth.uid(),null::uuid,'FP TEST'::text,public.current_user_role()$$;`)
    const guest = await read('../supabase/migrations/20260902151551_guest_match_day_scorer.sql')
    await db.exec(sqlFunction(guest, 'set_match_day_timer_state'))
    await db.exec(sqlFunction(guest, 'record_match_day_goal_v3'))
    await db.exec(sqlFunction(guest, 'record_match_day_score_correction_v2'))
    await db.exec("create function public.match_day_local_date_is_today(uuid) returns boolean language sql as $$select current_setting('test.fixture_today',true) = 'true'$$")
    await db.exec(sqlFunction(await read('../supabase/migrations/20260731131726_fp_v1_gameday_day_of_presentation_02b.sql'), 'start_match_day'))
    await db.exec(sqlFunction(await read('../supabase/migrations/20260903162403_guest_scorer_events_and_branding.sql'), 'record_match_day_scorer_event_v1'))
    await db.exec(await read('../supabase/migrations/20260907112202_coach_match_day_offline_commands.sql'))
    await db.query('insert into public.clubs values ($1)', [club])
    await db.query('insert into public.teams values ($1,$2)', [team, club])
    await db.query("insert into public.users(id,club_id,role) values($1,$3,'coach'),($2,$3,'parent_portal')", [coach,parent,club])
    await db.query('insert into auth.users values($1),($2)', [coach,parent])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [coach])
    const now = Date.now()
    const at = minutes => new Date(now - 60 * 60000 + minutes * 60000).toISOString()
    await db.query(`insert into public.match_days(id,club_id,team_id,status,timer_status,timer_started_at,current_match_phase,home_away,match_duration_minutes,updated_at)
      values($1,$2,$3,'live','running',$4,'first_half','away',70,$4)`, [match,club,team,at(0)])
    const current = async () => (await db.query('select to_jsonb(m) as value from public.match_days m where id=$1', [match])).rows[0].value
    let previousId = null
    let expected = (await current()).updated_at
    const call = (id, kind, payload, captured, prior = previousId, version = expected) => db.query(
      'select public.apply_coach_match_day_command($1,$2,$3,$4,$5,$6,$7) as value', [id,match,kind,JSON.stringify(payload),captured,version,prior])
    const goalId = randomUUID()
    const goalPayload = { eventType: 'goal', teamSide: 'club', minute: 5, scorerName: 'FP TEST' }
    await assert.rejects(call(randomUUID(),'event',goalPayload,at(-1441)), /over 24 hours/)
    await db.query('update public.users set club_id=$1 where id=$2', [randomUUID(),coach])
    await assert.rejects(call(randomUUID(),'event',goalPayload,at(5)), /Coach or manager/)
    await db.query('update public.users set club_id=$1 where id=$2', [club,coach])
    const billing = await read('../supabase/migrations/20260808054940_billing_access_window_v1.sql')
    await db.exec(`create schema app_private;
      create function app_private.billing_guard_club_id(jsonb,text) returns uuid language sql as $$select ($1->>'club_id')::uuid$$;
      create function app_private.billing_actor_is_exempt(uuid) returns boolean language sql as $$select false$$;
      create function app_private.billing_access_state(uuid,timestamptz) returns text language sql as $$select current_setting('test.billing_state',true)$$;`)
    await db.exec(sqlFunction(billing.replaceAll('function app_private.', 'function public.'), 'enforce_billing_access_window').replace('function public.', 'function app_private.'))
    await db.exec('create trigger enforce_billing_access_window before update on public.match_days for each row execute function app_private.enforce_billing_access_window()')
    await db.exec("select set_config('test.billing_state','payment_required',false)")
    await assert.rejects(call(goalId,'event',goalPayload,at(5)), /payment_required/)
    assert.equal((await current()).away_score,0)
    assert.equal((await db.query('select count(*)::integer as count from private.coach_match_day_commands')).rows[0].count,0)
    await db.exec("select set_config('test.billing_state','active',false)")
    const goal = (await call(goalId,'event',goalPayload,at(5))).rows[0].value
    assert.equal(goal.away_score,1)
    assert.equal(goal.savedEvent.minute,5)
    assert.deepEqual((await call(goalId,'event',goalPayload,at(5))).rows[0].value,goal)
    await assert.rejects(call(goalId,'event',{ ...goalPayload, minute: 6 },at(5)), /identifier/)
    previousId = goalId
    const cardId = randomUUID()
    const card = (await call(cardId,'event',{ eventType:'yellow_card',teamSide:'opponent',minute:6,playerName:'FP TEST Opponent' },at(6))).rows[0].value
    assert.equal(card.savedEvent.event_type,'yellow_card')
    previousId = cardId
    const pauseId = randomUUID()
    const pause = (await call(pauseId,'timer',{ action:'pause' },at(10))).rows[0].value
    assert.equal(pause.timer_elapsed_seconds,600)
    assert.equal(Date.parse(pause.timer_paused_at),Date.parse(at(10)))
    assert.equal(pause.timer_status,'paused')
    assert.deepEqual((await call(pauseId,'timer',{ action:'pause' },at(10))).rows[0].value,pause)
    previousId = pauseId
    const resumeId = randomUUID()
    const resume = (await call(resumeId,'timer',{ action:'resume' },at(15))).rows[0].value
    assert.equal(Date.parse(resume.timer_started_at),Date.parse(at(15)))
    previousId = resumeId
    const halfId = randomUUID()
    const half = (await call(halfId,'timer',{ action:'half_time' },at(40))).rows[0].value
    assert.equal(half.timer_elapsed_seconds,2100)
    assert.equal(half.current_match_phase,'half_time')
    previousId = halfId
    const secondId = randomUUID()
    await call(secondId,'timer',{action:'resume'},at(45))
    previousId = secondId
    const fullId = randomUUID()
    const full = (await call(fullId,'timer',{action:'full_time'},at(55))).rows[0].value
    assert.equal(full.timer_elapsed_seconds,2700)
    assert.equal(full.timer_status,'full_time')
    assert.equal(full.status,'full_time')
    previousId = fullId
    await db.query('update public.match_days set home_score=2,updated_at=now() where id=$1', [match])
    await assert.rejects(call(randomUUID(),'timer',{action:'resume'},at(56)), /another device/)
    assert.equal((await current()).home_score,2)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [parent])
    await assert.rejects(call(randomUUID(),'event',goalPayload,at(50)), /Coach or manager/)
    await db.query("select set_config('request.jwt.claim.sub','',false)")
    await assert.rejects(call(randomUUID(),'event',goalPayload,at(50)), /Login/)
    const grants = (await db.query(`select has_function_privilege('anon','public.apply_coach_match_day_command(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)','execute') as anon,
      has_function_privilege('authenticated','public.claim_coach_match_day_command_notifications(uuid,uuid)','execute') as claim`)).rows[0]
    assert.deepEqual(grants,{anon:false,claim:false})
    const jobs = (await db.query('select public.claim_coach_match_day_command_notifications() as value')).rows[0].value
    assert.equal(jobs.length,5)
    assert.deepEqual((await db.query('select public.claim_coach_match_day_command_notifications() as value')).rows[0].value,[])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [coach])
    const readyId = randomUUID()
    await db.query("insert into public.match_days(id,club_id,team_id,status,timer_status,current_match_phase,updated_at) values($1,$2,$3,'scheduled','not_started','pre_match',$4)", [readyId,club,team,at(0)])
    const startId = randomUUID()
    const start = () => db.query("select public.apply_coach_match_day_command($1,$2,'timer','{\"action\":\"start\"}',$3,$4,null) as value", [startId,readyId,at(5),at(0)])
    await db.exec("select set_config('test.fixture_today','false',false)")
    await assert.rejects(start(), /fixture date/)
    await db.exec("select set_config('test.fixture_today','true',false)")
    const started = (await start()).rows[0].value
    assert.equal(started.status,'live')
    assert.equal(Date.parse(started.timer_started_at),Date.parse(at(5)))
    assert.deepEqual((await start()).rows[0].value,started)
    const legacyId = randomUUID()
    await db.query("insert into public.match_days(id,club_id,team_id,status,timer_status,phase_started_at,current_match_phase,updated_at) values($1,$2,$3,'live','running',$4,'first_half',$4)", [legacyId,club,team,at(0)])
    const legacy = (await db.query("select public.apply_coach_match_day_command($1,$2,'timer','{\"action\":\"pause\"}',$3,$4,null) as value", [randomUUID(),legacyId,at(10),at(0)])).rows[0].value
    assert.equal(legacy.timer_elapsed_seconds,600)
  } finally { await db.close() }
})
