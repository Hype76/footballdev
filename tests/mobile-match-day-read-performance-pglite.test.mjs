import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const tables = ['match_days', 'match_day_player_availability', 'calendar_events', 'calendar_event_invites', 'assessment_sessions']
const baseline = `
alter table match_day_player_availability add column club_id uuid, add column team_id uuid;
alter table calendar_event_invites add column club_id uuid, add column team_id uuid;
create table calendar_events(id uuid primary key,club_id uuid,team_id uuid);
create table assessment_sessions(id uuid primary key,club_id uuid,team_id uuid,created_by uuid);
CREATE OR REPLACE FUNCTION public.can_manage_match_day(target_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_user_can_access_team(team.club_id, team.id)
    and public.current_user_role() <> 'parent_portal'
    and (
      public.current_user_role() in ('admin', 'super_admin')
      or public.current_user_role_rank() >= 20
    )
  from public.teams team
  where team.id = target_team_id;
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_match_day(target_team_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.current_user_can_access_team(team.club_id, team.id)
  from public.teams team
  where team.id = target_team_id;
$function$
;
alter table assessment_sessions enable row level security;
create policy assessment_sessions_select_scoped on assessment_sessions for select to authenticated using(((current_user_role() = 'super_admin'::text) OR ((club_id = current_user_club_id()) AND ((created_by = auth.uid()) OR (current_user_role_rank() >= 50) OR (EXISTS ( SELECT 1
   FROM team_staff ts
  WHERE ((ts.team_id = assessment_sessions.team_id) AND (ts.user_id = auth.uid()))))))));
grant select on assessment_sessions to authenticated;

alter table calendar_event_invites enable row level security;
create policy calendar_event_invites_select_scoped on calendar_event_invites for select to authenticated using(((current_user_role() = 'super_admin'::text) OR (EXISTS ( SELECT 1
   FROM parent_player_links link
  WHERE ((link.player_id = calendar_event_invites.player_id) AND (link.club_id = calendar_event_invites.club_id) AND (link.auth_user_id = auth.uid()) AND (link.status = 'active'::text)))) OR ((club_id = current_user_club_id()) AND (current_user_role_rank() >= 20) AND ((current_user_role_rank() >= 50) OR (EXISTS ( SELECT 1
   FROM team_staff ts
  WHERE ((ts.team_id = calendar_event_invites.team_id) AND (ts.user_id = auth.uid()))))))));
grant select on calendar_event_invites to authenticated;

alter table calendar_events enable row level security;
create policy calendar_events_select_scoped on calendar_events for select to authenticated using(((current_user_role() = 'super_admin'::text) OR ((club_id = current_user_club_id()) AND (current_user_role() <> 'parent_portal'::text) AND ((team_id IS NULL) OR (current_user_role_rank() >= 50) OR (EXISTS ( SELECT 1
   FROM team_staff ts
  WHERE ((ts.team_id = calendar_events.team_id) AND (ts.user_id = auth.uid()))))))));
grant select on calendar_events to authenticated;

alter table match_days enable row level security;
create policy match_days_staff_select_scoped on match_days for select to authenticated using(current_user_role()='super_admin' or (club_id=current_user_club_id() and can_read_match_day(team_id)));
grant select on match_days to authenticated;

alter table match_day_player_availability enable row level security;
create policy match_day_player_availability_staff_select_exact_team on match_day_player_availability for select to authenticated using(current_user_can_access_team(club_id,team_id));
grant select on match_day_player_availability to authenticated;
`

test('Match Day and Calendar read optimization preserves every role and scope result', async () => {
  const db = new PGlite()
  try {
    await db.exec(await readFile(new URL('./fixtures/mobile-speed-baseline.sql', import.meta.url), 'utf8'))
    await db.exec(await readFile(new URL('../supabase/migrations/20260903134841_mobile_read_path_performance.sql', import.meta.url), 'utf8'))
    await db.exec(baseline)
    for (const club of [1, 2]) await db.query('insert into clubs(id,name) values ($1,$2)', [uuid(club), `FP TEST ${club}`])
    for (const [team, club, archived] of [[10,1,false],[11,1,false],[12,2,false],[13,1,true]]) {
      await db.query('insert into teams(id,club_id,name,archived_at) values ($1,$2,$3,$4)', [uuid(team),uuid(club),'FP TEST',archived?'2026-01-01':null])
      await db.query('insert into players(id,club_id,team_id,player_name) values ($1,$2,$3,$4)', [uuid(100+team),uuid(club),uuid(team),'FP TEST Player'])
      await db.query('insert into match_days(id,club_id,team_id) values ($1,$2,$3)', [uuid(200+team),uuid(club),uuid(team)])
      await db.query('insert into match_day_player_availability(id,match_day_id,club_id,team_id) values ($1,$2,$3,$4)', [uuid(300+team),uuid(200+team),uuid(club),uuid(team)])
      await db.query('insert into calendar_events values ($1,$2,$3)', [uuid(400+team),uuid(club),uuid(team)])
      await db.query('insert into calendar_event_invites(id,match_day_id,player_id,club_id,team_id) values ($1,$2,$3,$4,$5)', [uuid(500+team),uuid(200+team),uuid(100+team),uuid(club),uuid(team)])
      await db.query('insert into assessment_sessions values ($1,$2,$3,$4)', [uuid(600+team),uuid(club),uuid(team),uuid(22)])
    }
    await db.query('insert into calendar_events values ($1,$2,null)', [uuid(499),uuid(1)])
    await db.query('insert into match_days(id,club_id,team_id) values ($1,$2,null)', [uuid(299),uuid(1)])
    for (const [id,role,rank,club] of [[20,'coach',40,1],[21,'admin',100,1],[22,'parent_portal',0,1],[23,'super_admin',1000,1],[24,'coach',40,2],[25,'coach',40,1],[26,'coach',40,1],[27,'head_manager',70,1]]) {
      await db.query('insert into users(id,role,role_rank,club_id) values ($1,$2,$3,$4)', [uuid(id),role,rank,uuid(club)])
      if (id !== 25) await db.query('insert into user_club_memberships values ($1,$2,$3,$4)', [uuid(id),uuid(club),role,rank])
    }
    await db.query('insert into platform_admins(id) values ($1)', [uuid(23)])
    for (const [id,team] of [[20,10],[20,13],[24,12],[25,10],[26,10]]) await db.query('insert into team_staff values ($1,$2)', [uuid(id),uuid(team)])
    await db.query("update users set status='suspended' where id=$1", [uuid(26)])
    await db.query("insert into parent_player_links(id,player_id,auth_user_id,club_id,team_id) values ($1,$2,$3,$4,$5)", [uuid(40),uuid(110),uuid(22),uuid(1),uuid(10)])
    const snapshot = async () => {
      const result = {}
      for (const actor of [20,21,22,23,24,25,26,27,null]) {
        await db.exec('reset role')
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor ? uuid(actor) : ''])
        await db.exec('set role authenticated')
        result[actor] = {}
        for (const table of tables) result[actor][table] = (await db.query(`select id from ${table} order by id`)).rows
      }
      return result
    }
    const before = await snapshot()
    assert.equal(before[20].match_days.length, 1)
    assert.equal(before[21].match_days.length, 2)
    assert.equal(before[23].match_days.length, 5)
    for (const actor of [22,25,26,27,null]) assert.equal(before[actor].match_days.length, 0)
    assert.equal(before[22].calendar_event_invites.length, 1)
    assert.equal(before[20].calendar_events.length, 3)
    await db.exec('reset role')
    const migration = await readFile(new URL('../supabase/migrations/20260903143259_mobile_match_day_read_performance.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    assert.deepEqual(await snapshot(), before)
  } finally { await db.close() }
})
