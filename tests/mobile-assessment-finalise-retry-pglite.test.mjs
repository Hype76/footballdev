import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261007071022_coach_team_administration_reminders.sql', import.meta.url), 'utf8')
const start = migration.indexOf('-- Phone assessment finalisation:')
const end = migration.indexOf('grant execute on function public.finalise_coach_mobile_assessment(uuid,bigint,jsonb) to authenticated;', start)
const sql = migration.slice(start, end + 'grant execute on function public.finalise_coach_mobile_assessment(uuid,bigint,jsonb) to authenticated;'.length)
const ids = { actor: '10000000-0000-4000-8000-000000000001', other: '10000000-0000-4000-8000-000000000002', club: '20000000-0000-4000-8000-000000000001', team: '30000000-0000-4000-8000-000000000001', player: '40000000-0000-4000-8000-000000000001', draft: '50000000-0000-4000-8000-000000000001', form: '60000000-0000-4000-8000-000000000001' }
const payload = { club_id: ids.club, team_id: ids.team, player_id: ids.player, coach_id: ids.actor, player_name: 'FP TEST Alex', team: 'FP TEST Team', coach: 'FP TEST Coach', scores: { Passing: 7 }, average_score: 7, comments: { overall: 'Look up first' }, form_responses: { passing: 7 }, feedback_form_id: ids.form, feedback_form_name: 'Passing', feedback_form_version: 1, feedback_form_snapshot: { id: ids.form, fields: [] } }

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fp.actor',true),'')::uuid$$;
    create function public.current_user_role() returns text language sql stable as $$select coalesce(nullif(current_setting('fp.role',true),''),'coach')$$;
    create function public.current_user_role_rank() returns int language sql stable as $$select 30$$;
    create function public.current_user_can_access_team(uuid,uuid) returns boolean language sql stable as $$select coalesce(current_setting('fp.access',true),'') <> 'denied'$$;
    create function public.can_use_plan_feature(uuid,text) returns boolean language sql stable as $$select coalesce(current_setting('fp.plan',true),'') <> 'denied'$$;
    create function public.can_insert_evaluation_for_plan(uuid) returns boolean language sql stable as $$select coalesce(current_setting('fp.plan',true),'') <> 'denied' and coalesce(current_setting('fp.insert',true),'') <> 'denied'$$;
    create table public.players(id uuid primary key,club_id uuid,team_id uuid);
    create table public.feedback_forms(id uuid primary key,club_id uuid,team_id uuid);
    create table public.assessment_sessions(id uuid primary key,club_id uuid,team_id uuid);
    create table public.evaluation_drafts(id uuid primary key,club_id uuid,team_id uuid,player_id uuid,created_by_user_id uuid,report_type text,status text,client_save_version bigint,draft_data jsonb,submitted_at timestamptz,updated_at timestamptz);
    create table public.evaluations(id uuid primary key,club_id uuid,team_id uuid,player_id uuid,player_name text,section text,team text,session text,assessment_session_id uuid,date text,status text,coach text,coach_id uuid,average_score numeric,scores jsonb,comments jsonb,form_responses jsonb,feedback_form_id uuid,feedback_form_name text,feedback_form_version int,feedback_form_snapshot jsonb,created_by_email text,created_by_name text,updated_by uuid,updated_by_email text,updated_by_name text);
    insert into public.players values('${ids.player}','${ids.club}','${ids.team}');
    insert into public.feedback_forms values('${ids.form}','${ids.club}','${ids.team}');
    insert into public.evaluation_drafts values('${ids.draft}','${ids.club}','${ids.team}','${ids.player}','${ids.actor}','development_record','draft',2,'{"responseValues":{"passing":7},"notes":"Look up first","selectedFeedbackFormId":"${ids.form}"}',null,null);
    grant usage on schema auth to authenticated; grant select on public.players,public.feedback_forms,public.assessment_sessions to authenticated;
    grant select,insert,update on public.evaluation_drafts,public.evaluations to authenticated;
    alter table public.evaluation_drafts enable row level security;
    create policy read_drafts on public.evaluation_drafts for select to authenticated using(created_by_user_id=auth.uid());
    create policy update_drafts on public.evaluation_drafts for update to authenticated using(created_by_user_id=auth.uid() and status='draft') with check(created_by_user_id=auth.uid() and status in('draft','submitted'));
    alter table public.evaluations enable row level security;
    create policy read_evaluations on public.evaluations for select to authenticated using(coach_id=auth.uid());
    create policy insert_evaluations on public.evaluations for insert to authenticated with check(coach_id=auth.uid() and public.current_user_can_access_team(club_id,team_id) and public.can_insert_evaluation_for_plan(club_id));
  `)
  await db.exec(sql)
  await db.exec(`set role authenticated; select set_config('fp.actor','${ids.actor}',false);`)
  return db
}

async function finalise(db, value = payload, version = 2) {
  return (await db.query('select public.finalise_coach_mobile_assessment($1::uuid,$2::bigint,$3::jsonb) as record', [ids.draft, version, JSON.stringify(value)])).rows[0].record
}

test('atomic finalise closes original draft and every response-loss retry returns one stable record', async () => {
  const db = await setup()
  try {
    const first = await finalise(db)
    await db.exec("select set_config('fp.insert','denied',false)")
    const retry = await finalise(db)
    assert.equal(first.id, ids.draft)
    assert.equal(retry.id, first.id)
    assert.equal((await db.query('select count(*)::int as n from public.evaluations')).rows[0].n, 1)
    assert.equal((await db.query('select status from public.evaluation_drafts')).rows[0].status, 'submitted')
    await db.exec("select set_config('fp.plan','denied',false)")
    await assert.rejects(finalise(db), /no longer authorised/)
  } finally { await db.close() }
})

for (const [name, configure, value, version] of [
  ['different actor', db => db.query("select set_config('fp.actor',$1,false)", [ids.other]), payload, 2],
  ['revoked team access', db => db.exec("select set_config('fp.access','denied',false)"), payload, 2],
  ['inactive plan', db => db.exec("select set_config('fp.plan','denied',false)"), payload, 2],
  ['parent account', db => db.exec("select set_config('fp.role','parent_portal',false)"), payload, 2],
  ['stale saved version', () => {}, payload, 1],
  ['changed values', () => {}, { ...payload, form_responses: { passing: 8 } }, 2],
  ['cross-team player payload', () => {}, { ...payload, team_id: ids.other }, 2],
  ['cross-team form reference', () => {}, { ...payload, feedback_form_id: ids.other }, 2],
  ['cross-team session reference', () => {}, { ...payload, assessment_session_id: ids.other }, 2],
]) test(`${name} cannot finalise or create a duplicate`, async () => {
  const db = await setup()
  try {
    await configure(db)
    await assert.rejects(finalise(db, value, version))
    await db.exec('reset role')
    assert.equal((await db.query('select count(*)::int as n from public.evaluations')).rows[0].n, 0)
    assert.equal((await db.query('select status from public.evaluation_drafts')).rows[0].status, 'draft')
  } finally { await db.close() }
})

test('closing failure rolls back the final record rather than leaving a partial save', async () => {
  const db = await setup()
  try {
    await db.exec(`reset role; create function public.reject_close() returns trigger language plpgsql as $$begin raise exception 'Close failed'; end$$; create trigger reject_close before update on public.evaluation_drafts for each row execute function public.reject_close(); set role authenticated;`)
    await assert.rejects(finalise(db), /Close failed/)
    assert.equal((await db.query('select count(*)::int as n from public.evaluations')).rows[0].n, 0)
    assert.equal((await db.query('select status from public.evaluation_drafts')).rows[0].status, 'draft')
  } finally { await db.close() }
})

test('anonymous role has no execute grant', async () => {
  const db = await setup()
  try {
    await db.exec('reset role; set role anon')
    await assert.rejects(finalise(db), /permission denied/)
  } finally { await db.close() }
})
