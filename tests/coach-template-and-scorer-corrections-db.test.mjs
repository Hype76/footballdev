import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const read = file => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8')
const migration = await read('20261013144500_coach_template_access_and_scorer_corrections.sql')
const correctionSection = migration.slice(migration.indexOf('do $migration$'))
const accessSection = migration.slice(0, migration.indexOf('do $migration$'))
const functionSql = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  assert.ok(start >= 0, name)
  return sql.slice(start, sql.indexOf('\n$$;', start) + 4)
}
const v1 = functionSql(await read('20260926144304_match_day_full_time_score_and_parent_goal_undo.sql'), 'apply_parent_match_day_command')
const v2 = functionSql(await read('20261004153000_matchday_unconfigured_participant_roster.sql'), 'apply_parent_match_day_command_v2')

test('the migration preserves existing scorer authority and replay, adding a notification only for a committed score change', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.match_days(id uuid primary key,club_id uuid,team_id uuid,deleted_at timestamptz,previous_hidden_at timestamptz,
        status text default 'live',concluded_at timestamptz,timer_started_at timestamptz,phase_started_at timestamptz,timer_paused_at timestamptz,
        timer_status text default 'paused',current_match_phase text default 'first_half',home_score int default 1,away_score int default 0,updated_at timestamptz default now());
      create table public.match_day_role_assignments(match_day_id uuid,role text,parent_link_id uuid,auth_user_id uuid);
      create table public.match_day_shootout_kicks(match_day_id uuid,created_at timestamptz);
      create function public.current_user_has_match_day_scorer_assignment(target uuid) returns boolean language sql as $$select exists(select 1 from public.match_day_role_assignments where match_day_id=target and auth_user_id=auth.uid())$$;
      create function public.correct_match_day_goal_v2(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer) returns jsonb language plpgsql as $$
        begin if $4='opponent' then update public.match_days set home_score=0,away_score=1,updated_at=clock_timestamp() where id=$1;
        else update public.match_days set updated_at=clock_timestamp() where id=$1; end if;
        return jsonb_build_object('id',$2,'event_type','goal'); end; $$;
      create function public.correct_match_day_goal_v3(uuid,uuid,uuid,text,text,text,text,text,integer,text,text,boolean,integer,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('event',public.correct_match_day_goal_v2($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13))$$;
      create function public.void_parent_match_day_goal(uuid,uuid,uuid,text) returns jsonb language plpgsql as $$begin update public.match_days set home_score=0,away_score=0,updated_at=clock_timestamp() where id=$1; return '{}'::jsonb; end; $$;
      create function public.record_match_day_score_correction_v2(uuid,uuid,integer,integer,text,uuid) returns jsonb language plpgsql as $$begin update public.match_days set home_score=$3,away_score=$4,updated_at=clock_timestamp() where id=$1; return jsonb_build_object('id',$6,'event_type','score_correction'); end; $$;`)
    const original = await read('20260926114556_parent_scorer_offline_commands.sql')
    await db.exec(original.slice(0, original.indexOf('create or replace function public.apply_parent_match_day_command')))
    await db.exec(v1); await db.exec(v2)
    for (const name of ['apply_parent_match_day_command', 'apply_parent_match_day_command_v2']) await db.exec(`revoke all on function public.${name}(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) from public,anon; grant execute on function public.${name}(uuid,uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid) to authenticated`)
    const before = (await db.query("select proname,pg_get_functiondef(oid) as source,prosecdef,proacl::text from pg_proc where proname in ('apply_parent_match_day_command','apply_parent_match_day_command_v2') order by proname")).rows
    await db.exec(correctionSection)
    const after = (await db.query("select proname,pg_get_functiondef(oid) as source,prosecdef,proacl::text from pg_proc where proname in ('apply_parent_match_day_command','apply_parent_match_day_command_v2') order by proname")).rows
    const addition = "\n  if kind_value in ('correct-goal', 'void-goal')\n    and (next_match.home_score is distinct from m.home_score or next_match.away_score is distinct from m.away_score) then\n    notification_type := 'score_correction';\n    saved_event_id := target_event_id;\n  end if;"
    for (let index = 0; index < after.length; index++) {
      assert.equal(after[index].source.replace(addition, ''), before[index].source)
      assert.equal(after[index].prosecdef, before[index].prosecdef)
      assert.equal(after[index].proacl, before[index].proacl)
    }
    const actor = randomUUID(), other = randomUUID()
    await db.query('insert into auth.users values($1),($2)', [actor, other])
    for (const name of ['apply_parent_match_day_command', 'apply_parent_match_day_command_v2']) {
      const match = randomUUID(), link = randomUUID(), goalCommand = randomUUID(), goalEvent = randomUUID()
      await db.query('insert into public.match_days(id) values($1)', [match])
      await db.query('insert into public.match_day_role_assignments values($1,\'scorer\',$2,$3)', [match, link, actor])
      const version = (await db.query('select updated_at from public.match_days where id=$1', [match])).rows[0].updated_at
      const captured = new Date(Date.now() - 30_000).toISOString()
      await db.query("insert into private.parent_scorer_match_day_commands(id,match_day_id,parent_link_id,actor_user_id,kind,payload,captured_at,result,result_updated_at,event_id) values($1,$2,$3,$4,'goal','{}',$5,'{}',$6,$7)", [goalCommand,match,link,actor,captured,version,goalEvent])
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor])
      let previous = goalCommand
      const call = (id, kind, payload) => db.query(`select public.${name}($1,$2,$3,$4,$5,$6,null,$7) as result`, [id,match,link,kind,JSON.stringify(payload),captured,previous])
      const nameCorrection = randomUUID()
      await call(nameCorrection,'correct-goal',{eventId:goalCommand,goal:{teamSide:'club',scorerName:'Correct name',minute:5}})
      previous = nameCorrection
      const correction = randomUUID(), payload = {eventId:goalCommand,goal:{teamSide:'opponent',minute:5}}
      const result = (await call(correction,'correct-goal',payload)).rows[0].result
      assert.equal(result.match.away_score,1)
      assert.deepEqual((await call(correction,'correct-goal',payload)).rows[0].result,result,'A replay does not queue another correction')
      previous = correction
      const removal = randomUUID()
      assert.equal((await call(removal,'void-goal',{eventId:goalCommand,reason:'Mistake'})).rows[0].result.match.away_score,0)
      previous = removal
      const manual = randomUUID()
      assert.equal((await call(manual,'score',{homeScore:2,awayScore:1,reason:'Score corrected'})).rows[0].result.match.home_score,2)
      const notifications = (await db.query('select id,notification_type,event_id from private.parent_scorer_match_day_commands where match_day_id=$1 order by created_at,id',[match])).rows
      assert.equal(notifications.find(row=>row.id===nameCorrection).notification_type,'')
      for (const id of [correction,removal,manual]) assert.equal(notifications.find(row=>row.id===id).notification_type,'score_correction')
      assert.equal(notifications.find(row=>row.id===removal).event_id,goalEvent)
      assert.equal(notifications.length,5)
      previous = manual
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other])
      await assert.rejects(call(randomUUID(),'score',{homeScore:0,awayScore:0}),/Parent scorer access/)
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
      await db.query('update public.match_days set concluded_at=now() where id=$1',[match])
      await assert.rejects(call(randomUUID(),'score',{homeScore:0,awayScore:0}),/closed/)
    }
  } finally { await db.close() }
})

test('private templates remain owner-only through RLS and definer assessment writes, without broadening manager permissions', async () => {
  const db = new PGlite()
  const owner=randomUUID(),staff=randomUUID(),outsider=randomUUID(),club=randomUUID(),team=randomUUID(),otherTeam=randomUUID(),form=randomUUID()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create schema private;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.rank() returns int language sql as $$select coalesce(nullif(current_setting('test.rank',true),''),'20')::int$$;
      create function public.plan() returns boolean language sql as $$select coalesce(nullif(current_setting('test.plan',true),''),'true')::boolean$$;
      create table public.team_staff(team_id uuid,user_id uuid);
      create table public.feedback_forms(id uuid primary key,club_id uuid,team_id uuid,created_by uuid,name text,fields jsonb default '[]');
      create table public.evaluation_drafts(id uuid primary key,created_by_user_id uuid,draft_data jsonb);
      create table public.evaluations(id uuid primary key,coach_id uuid,feedback_form_id uuid,feedback_form_snapshot jsonb);
      alter table public.feedback_forms enable row level security;
      create policy existing_team_read on public.feedback_forms for select to authenticated using (public.plan() and exists(select 1 from public.team_staff where team_id=feedback_forms.team_id and user_id=auth.uid()));
      create policy existing_manager_insert on public.feedback_forms for insert to authenticated with check (public.rank()>=50 and public.plan() and exists(select 1 from public.team_staff where team_id=feedback_forms.team_id and user_id=auth.uid()));
      create policy existing_manager_update on public.feedback_forms for update to authenticated using (public.rank()>=50 and public.plan() and exists(select 1 from public.team_staff where team_id=feedback_forms.team_id and user_id=auth.uid())) with check (public.rank()>=50 and public.plan() and exists(select 1 from public.team_staff where team_id=feedback_forms.team_id and user_id=auth.uid()));
      grant usage on schema auth to authenticated; grant select on public.team_staff to authenticated; grant select,insert,update on public.feedback_forms to authenticated;`)
    await db.exec(accessSection)
    await db.query('insert into public.team_staff values($1,$2),($1,$3),($4,$5)',[team,owner,staff,otherTeam,outsider])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]); await db.exec("select set_config('test.rank','50',false); set role authenticated")
    const insert=(id,scope='creator',creator=owner)=>db.query('insert into public.feedback_forms(id,club_id,team_id,created_by,name,access_scope) values($1,$2,$3,$4,\'FP TEST\',$5)',[id,club,team,creator,scope])
    await insert(form)
    assert.equal((await db.query('select id from public.feedback_forms')).rows.length,1)
    await assert.rejects(insert(randomUUID(),'creator',staff),/row-level security/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[staff])
    assert.equal((await db.query('select id from public.feedback_forms')).rows.length,0)
    assert.equal((await db.query("update public.feedback_forms set access_scope='team' where id=$1 returning id",[form])).rows.length,0)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner])
    await db.query("update public.feedback_forms set access_scope='team' where id=$1",[form])
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[staff])
    assert.equal((await db.query('select id from public.feedback_forms')).rows.length,1)
    await assert.rejects(db.query("update public.feedback_forms set created_by=$1,access_scope='creator' where id=$2",[staff,form]),/creator cannot be changed/)
    await assert.rejects(db.query("update public.feedback_forms set access_scope='creator' where id=$1",[form]),/row-level security/)
    await db.exec("select set_config('test.rank','30',false)")
    await assert.rejects(insert(randomUUID(),'team',staff),/row-level security/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[outsider])
    assert.equal((await db.query('select id from public.feedback_forms')).rows.length,0)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec("select set_config('test.rank','50',false); select set_config('test.plan','false',false)")
    assert.equal((await db.query('select id from public.feedback_forms')).rows.length,0)
    await assert.rejects(insert(randomUUID()),/row-level security/)
    await db.exec("select set_config('test.plan','true',false)")
    await db.query("update public.feedback_forms set access_scope='creator' where id=$1",[form])
    await db.exec('reset role')
    // These owner-level writes exercise the trigger even when RLS is bypassed by a definer.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[staff])
    await assert.rejects(db.query('insert into public.evaluation_drafts values($1,$2,$3)',[randomUUID(),staff,{selectedFeedbackFormId:form}]),/private to its creator/)
    await assert.rejects(db.query('insert into public.evaluations values($1,$2,$3,$4)',[randomUUID(),staff,form,{id:form}]),/private to its creator/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner])
    await db.query('insert into public.evaluation_drafts values($1,$2,$3)',[randomUUID(),owner,{selectedFeedbackFormId:form}])
    await db.query('insert into public.evaluations values($1,$2,$3,$4)',[randomUUID(),owner,form,{id:form}])
    const privileges=(await db.query("select has_function_privilege('authenticated','private.guard_assessment_template_access()','execute') as assessment,has_function_privilege('anon','private.guard_feedback_template_owner()','execute') as owner")).rows[0]
    assert.deepEqual(privileges,{assessment:false,owner:false})
  } finally { await db.close() }
})
