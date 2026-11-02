import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('calendar cancellation RPCs preserve parent scope and include ongoing recurring series', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid', true), '')::uuid$$;
      create table public.calendar_events(id uuid, club_id uuid, team_id uuid, event_type text, title text, starts_at timestamptz, ends_at timestamptz, location text, notes text, parent_visible boolean, parent_audience text, cancelled_at timestamptz, recurrence_frequency text, recurrence_until date);
      create table public.parent_player_links(id uuid, auth_user_id uuid, club_id uuid, team_id uuid, player_id uuid, status text, email text);
      create table public.calendar_event_invites(calendar_event_id uuid, club_id uuid, parent_link_id uuid, player_id uuid, invite_status text);
      create table public.training_availability_requests(id uuid, club_id uuid, team_id uuid, calendar_event_id uuid, occurrence_starts_at timestamptz);
      create table public.training_availability_request_players(request_id uuid, club_id uuid, team_id uuid, player_id uuid, parent_link_id uuid, recipient_email text);
      insert into parent_player_links values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','active','parent@example.test');
      insert into calendar_events values ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','general','Series', now() - interval '30 days', null,'','',true,'all_team_parents',now(),'weekly',current_date + 30);
      select set_config('test.uid','00000000-0000-0000-0000-000000000002', false);
    `)
    await db.exec((await readFile(new URL('../supabase/migrations/20261102083200_event_cancellation_reasons.sql', import.meta.url), 'utf8')).split('-- section: calendar')[1])
    await db.exec("update calendar_events set cancellation_reason = 'Rain'")
    const query = "select * from get_parent_portal_cancelled_shared_calendar_events('00000000-0000-0000-0000-000000000001')"
    assert.equal((await db.query(query)).rows[0].cancellation_reason, 'Rain')
    await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000099',false)")
    assert.equal((await db.query(query)).rows.length, 0)
    await db.exec("select set_config('test.uid','00000000-0000-0000-0000-000000000002',false); update calendar_events set cancellation_reason = null")
    assert.equal((await db.query(query)).rows.length, 0)
    await db.exec("update calendar_events set cancellation_reason = '', team_id = '00000000-0000-0000-0000-000000000099'")
    assert.equal((await db.query(query)).rows.length, 0)
    await db.exec(`update calendar_events set team_id = '00000000-0000-0000-0000-000000000004', event_type = 'training', parent_visible = false, parent_audience = 'none', cancellation_reason = 'Weather';
      insert into training_availability_requests values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000006',now());
      insert into training_availability_request_players values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','parent@example.test');`)
    const invitedQuery = "select * from get_parent_portal_invited_calendar_events('00000000-0000-0000-0000-000000000001')"
    assert.equal((await db.query(invitedQuery)).rows[0].cancellation_reason, 'Weather')
    await db.exec("update training_availability_request_players set player_id = '00000000-0000-0000-0000-000000000099'")
    assert.equal((await db.query(invitedQuery)).rows.length, 0)
    await db.exec("update training_availability_request_players set player_id = '00000000-0000-0000-0000-000000000005'; select set_config('test.uid','00000000-0000-0000-0000-000000000099',false)")
    assert.equal((await db.query(invitedQuery)).rows.length, 0)
  } finally { await db.close() }
})
