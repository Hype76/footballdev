import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('calendar cancellation RPCs preserve parent scope and include ongoing recurring series', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role; create schema auth; create schema app_private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
      create function public.current_user_can_access_parent_link(uuid, uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.user_status', true), 'active') = 'active' and coalesce(current_setting('test.player_status', true), 'active') <> 'archived' and coalesce(current_setting('test.plan_enabled', true), 'true') = 'true' $$;
      create function public.can_use_plan_feature(uuid, text) returns boolean language sql stable as $$select coalesce(current_setting('test.plan_enabled', true), 'true') = 'true'$$;
      create table public.players(id uuid, club_id uuid, status text);
      create table public.users(id uuid, club_id uuid, role text, status text);
      create table public.calendar_events(id uuid primary key, club_id uuid, team_id uuid, event_type text, title text, starts_at timestamptz, ends_at timestamptz, location text, notes text, parent_visible boolean, parent_audience text, cancelled_at timestamptz, recurrence_frequency text, recurrence_until date, deleted_occurrence_dates date[] default '{}');
      create table public.parent_player_links(id uuid, auth_user_id uuid, club_id uuid, team_id uuid, player_id uuid, status text, email text);
      create table public.calendar_event_invites(calendar_event_id uuid, club_id uuid, parent_link_id uuid, player_id uuid, invite_status text);
      create table public.training_availability_requests(id uuid primary key, club_id uuid, team_id uuid, calendar_event_id uuid, occurrence_starts_at timestamptz, status text, occurrence_date date, updated_at timestamptz);
      create table public.training_availability_request_players(id uuid primary key, request_id uuid, calendar_event_id uuid, club_id uuid, team_id uuid, player_id uuid, parent_link_id uuid, recipient_email text, recipient_type text, status text, token_revoked_at timestamptz, response_deadline_at timestamptz, updated_at timestamptz);
      insert into players values ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','active');
      insert into users values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','parent_portal','active');
      insert into parent_player_links values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','active','parent@example.test');
      insert into calendar_events values ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','general','Series', now() - interval '30 days', null,'','',true,'all_team_parents',now(),'weekly',current_date + 30, array['2026-11-09'::date]);
      select set_config('test.uid','00000000-0000-0000-0000-000000000002', false);
    `)
    const existingTrigger = await readFile(new URL('../supabase/migrations/20260928094023_calendar_occurrence_deletion_scopes.sql', import.meta.url), 'utf8')
    await db.exec(existingTrigger.slice(existingTrigger.indexOf('create or replace function app_private.cancel_removed_calendar_occurrence_requests()')))
    await db.exec((await readFile(new URL('../supabase/migrations/20261102083200_event_cancellation_reasons.sql', import.meta.url), 'utf8')).split('-- section: calendar')[1])
    await db.exec("update calendar_events set cancellation_reason = 'Rain'")
    const query = "select * from get_parent_portal_cancelled_shared_calendar_events('00000000-0000-0000-0000-000000000001')"
    assert.equal((await db.query(query)).rows[0].cancellation_reason, 'Rain')
    assert.equal((await db.query(query)).rows[0].deleted_occurrence_dates[0].toISOString().slice(0, 10), '2026-11-09')
    for (const [key, denied, allowed] of [['test.user_status', 'suspended', 'active'], ['test.player_status', 'archived', 'active'], ['test.plan_enabled', 'false', 'true']]) {
      await db.query("select set_config($1, $2, false)", [key, denied])
      assert.equal((await db.query(query)).rows.length, 0, denied)
      await db.query("select set_config($1, $2, false)", [key, allowed])
    }
    await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000099',false)")
    assert.equal((await db.query(query)).rows.length, 0)
    await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000002',false); update calendar_events set cancellation_reason = null")
    assert.equal((await db.query(query)).rows.length, 0)
    await db.exec("update calendar_events set cancellation_reason = '', team_id = '00000000-0000-0000-0000-000000000099'")
    assert.equal((await db.query(query)).rows.length, 0)
    await db.exec(`update calendar_events set cancelled_at = null, team_id = '00000000-0000-0000-0000-000000000004', event_type = 'training', parent_visible = true, parent_audience = 'involved_players', cancellation_reason = 'Weather';
      insert into training_availability_requests (id, club_id, team_id, calendar_event_id, occurrence_starts_at, status, occurrence_date) values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006',now() + interval '1 day','pending',current_date + 1);
      insert into training_availability_request_players (id, request_id, calendar_event_id, club_id, team_id, player_id, parent_link_id, recipient_email, recipient_type, status, response_deadline_at) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','parent@example.test','parent','pending',now() + interval '1 day');
      update calendar_events set cancelled_at = now();`)
    assert.equal((await db.query('select status from training_availability_requests')).rows[0].status, 'cancelled')
    assert.equal((await db.query('select status from training_availability_request_players')).rows[0].status, 'cancelled')
    const invitedQuery = "select * from get_parent_portal_invited_calendar_events('00000000-0000-0000-0000-000000000001')"
    assert.equal((await db.query(invitedQuery)).rows[0].cancellation_reason, 'Weather')
    const notificationQuery = "select * from public.get_cancelled_training_notification_parent_links('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004')"
    assert.equal((await db.query(notificationQuery)).rows.length, 1)
    assert.equal((await db.query("select has_function_privilege('authenticated', 'public.get_cancelled_training_notification_parent_links(uuid,uuid,uuid)', 'EXECUTE') as allowed")).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('service_role', 'public.get_cancelled_training_notification_parent_links(uuid,uuid,uuid)', 'EXECUTE') as allowed")).rows[0].allowed, true)
    await db.exec("insert into parent_player_links values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','active','other@example.test')")
    assert.equal((await db.query(notificationQuery)).rows.length, 1)
    const authorityQuery = "select * from public.get_authorized_notification_parent_links('00000000-0000-0000-0000-000000000003', array['00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000012'::uuid]) order by parent_link_id"
    assert.equal((await db.query(authorityQuery)).rows.length, 2)
    assert.equal((await db.query("select has_function_privilege('authenticated', 'public.get_authorized_notification_parent_links(uuid,uuid[])', 'EXECUTE') as allowed")).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('service_role', 'public.get_authorized_notification_parent_links(uuid,uuid[])', 'EXECUTE') as allowed")).rows[0].allowed, true)
    await db.exec("update parent_player_links set auth_user_id = null where id = '00000000-0000-0000-0000-000000000001'")
    assert.equal((await db.query(notificationQuery)).rows.length, 1)
    assert.equal((await db.query(authorityQuery)).rows.length, 2)
    await db.exec("update parent_player_links set email = '' where id = '00000000-0000-0000-0000-000000000001'")
    assert.equal((await db.query(notificationQuery)).rows.length, 0)
    assert.equal((await db.query(authorityQuery)).rows.length, 1)
    await db.exec("update parent_player_links set auth_user_id = '00000000-0000-0000-0000-000000000002', email = 'parent@example.test' where id = '00000000-0000-0000-0000-000000000001'")
    await db.exec("update parent_player_links set status = 'revoked' where id = '00000000-0000-0000-0000-000000000001'")
    assert.equal((await db.query(authorityQuery)).rows.length, 1)
    await db.exec("update parent_player_links set status = 'active' where id = '00000000-0000-0000-0000-000000000001'")
    assert.equal((await db.query("select * from public.get_authorized_notification_parent_links('00000000-0000-0000-0000-000000000099', array['00000000-0000-0000-0000-000000000001'::uuid])")).rows.length, 0)
    await db.exec("update training_availability_request_players set parent_link_id = null")
    assert.equal((await db.query(notificationQuery)).rows[0].parent_link_id, '00000000-0000-0000-0000-000000000001')
    await db.exec("update training_availability_request_players set parent_link_id = '00000000-0000-0000-0000-000000000001'")
    for (const [change, restore] of [
      ["update calendar_events set parent_visible = false", "update calendar_events set parent_visible = true"],
      ["update training_availability_request_players set token_revoked_at = now()", "update training_availability_request_players set token_revoked_at = null"],
      ["update players set status = 'archived'", "update players set status = 'active'"],
      ["update users set status = 'suspended'", "update users set status = 'active'"],
      ["select set_config('test.plan_enabled', 'false', false)", "select set_config('test.plan_enabled', 'true', false)"],
    ]) {
      await db.exec(change)
      assert.equal((await db.query(notificationQuery)).rows.length, 0, change)
      if (change.startsWith('update players') || change.includes('plan_enabled')) assert.equal((await db.query(authorityQuery)).rows.length, 0, change)
      if (change.includes('users')) assert.equal((await db.query(authorityQuery)).rows.length, 1, change)
      await db.exec(restore)
    }

    for (const [key, denied, allowed] of [['test.user_status', 'suspended', 'active'], ['test.player_status', 'archived', 'active'], ['test.plan_enabled', 'false', 'true']]) {
      await db.query("select set_config($1, $2, false)", [key, denied])
      assert.equal((await db.query(invitedQuery)).rows.length, 0, denied)
      await db.query("select set_config($1, $2, false)", [key, allowed])
    }
    for (const change of ["parent_visible = false", "parent_audience = 'none'"]) {
      await db.exec(`update calendar_events set ${change}`)
      assert.equal((await db.query(invitedQuery)).rows.length, 0, change)
      await db.exec("update calendar_events set parent_visible = true, parent_audience = 'involved_players'")
    }
    for (const change of ["token_revoked_at = now()", "status = 'expired'", "response_deadline_at = now() - interval '1 minute'"]) {
      await db.exec(`update training_availability_request_players set ${change}`)
      assert.equal((await db.query(invitedQuery)).rows.length, 0, change)
      await db.exec("update training_availability_request_players set token_revoked_at = null, status = 'cancelled', response_deadline_at = now() + interval '1 day'")
    }
    for (const prior of ["update training_availability_requests set status = 'cancelled'", "update training_availability_request_players set status = 'cancelled'", "update training_availability_request_players set token_revoked_at = now()", "update training_availability_request_players set status = 'expired'"]) {
      await db.exec("update calendar_events set cancelled_at = null; update training_availability_requests set status = 'pending'; update training_availability_request_players set status = 'pending', token_revoked_at = null")
      await db.exec(prior)
      await db.exec("update calendar_events set cancelled_at = now()")
      assert.equal((await db.query(invitedQuery)).rows.length, 0, prior)
    }
    await db.exec("update calendar_events set cancelled_at = null; update training_availability_requests set status = 'pending'; update training_availability_request_players set status = 'pending', token_revoked_at = null; update calendar_events set cancelled_at = now()")
    await db.exec("update training_availability_request_players set player_id = '00000000-0000-0000-0000-000000000099'")
    assert.equal((await db.query(invitedQuery)).rows.length, 0)
    await db.exec("update training_availability_request_players set player_id = '00000000-0000-0000-0000-000000000005'; select set_config('test.uid','00000000-0000-0000-0000-000000000099',false)")
    assert.equal((await db.query(invitedQuery)).rows.length, 0)
  } finally { await db.close() }
})
