import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260904091454_disable_volunteer_acceptance_staff_emails.sql', import.meta.url)
const migration = await readFile(migrationUrl, 'utf8')

test('volunteer acceptance remains visible without queuing staff email', async () => {
  assert.doesNotMatch(migration, /queue_match_day_transition_email|scheduled_email_queue|resendPayload/i)
  assert.match(migration, /'emailSuppressed', true/i)
  assert.match(migration, /'suppressionReason', 'staff_volunteer_acceptance_email_disabled'/i)

  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.parent_player_links (
        id uuid primary key,
        auth_user_id uuid,
        club_id uuid not null,
        player_id uuid not null,
        email text,
        status text not null
      );
      create table public.match_day_availability_requests (
        id uuid primary key,
        club_id uuid not null,
        team_id uuid not null,
        match_day_id uuid not null,
        player_id uuid not null,
        parent_link_id uuid,
        player_name text,
        recipient_name text,
        recipient_email text,
        volunteer_scorer_response text,
        volunteer_linesman_response text,
        volunteer_referee_response text
      );
      create table public.match_day_event_log (
        club_id uuid,
        team_id uuid,
        match_day_id uuid,
        player_id uuid,
        actor_user_id uuid,
        actor_display_name text,
        actor_role text,
        event_type text,
        event_label text,
        previous_value jsonb,
        new_value jsonb,
        metadata jsonb
      );
    `)
    await db.exec(migration)
    await db.exec(`
      create trigger match_day_volunteer_acceptance_staff_notification
      after update of volunteer_scorer_response, volunteer_linesman_response, volunteer_referee_response
      on public.match_day_availability_requests
      for each row
      execute function public.notify_staff_on_volunteer_acceptance();

      insert into public.parent_player_links (id, auth_user_id, club_id, player_id, email, status)
      values (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
        'parent@example.test',
        'active'
      );
      insert into public.match_day_availability_requests (
        id, club_id, team_id, match_day_id, player_id, parent_link_id, player_name,
        recipient_name, recipient_email, volunteer_scorer_response,
        volunteer_linesman_response, volunteer_referee_response
      ) values (
        '55555555-5555-4555-8555-555555555555',
        '33333333-3333-4333-8333-333333333333',
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        'FP TEST Player',
        'FP TEST Parent',
        'parent@example.test',
        'no_response',
        'no_response',
        'no_response'
      );
      update public.match_day_availability_requests
      set volunteer_linesman_response = 'yes'
      where id = '55555555-5555-4555-8555-555555555555';
    `)

    const { rows } = await db.query(`
      select event_type, metadata
      from public.match_day_event_log
    `)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].event_type, 'volunteer_role_accepted')
    assert.equal(rows[0].metadata.emailSuppressed, true)
    assert.equal(rows[0].metadata.queuedNotificationCount, 0)
  } finally {
    await db.close()
  }
})
