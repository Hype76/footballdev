import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../supabase/migrations/20261123072500_direct_player_resource_notifications.sql', import.meta.url), 'utf8')
const id = value => `'00000000-0000-4000-8000-${String(value).padStart(12, '0')}'`

test('direct share queues once for the eligible Player account and can only be claimed by the service', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema app_private;
    create table players (id uuid primary key, club_id uuid, team_id uuid, status text, archived_at timestamptz);
    create table parent_player_links (id uuid primary key, player_id uuid, club_id uuid, auth_user_id uuid, team_id uuid, link_type text, status text);
    create table fan_connections (id uuid primary key, player_id uuid, club_id uuid, parent_link_id uuid,
      invited_by uuid, auth_user_id uuid, status text, relationship_type text, notifications_enabled boolean, permissions jsonb);
    create table resource_library_items (id uuid primary key, club_id uuid, team_id uuid, archived_at timestamptz);
    create table resource_library_links (id uuid primary key, resource_id uuid, club_id uuid, team_id uuid,
      linked_type text, linked_id uuid, parent_visible boolean not null, removed_at timestamptz);
    create table fan_notifications (id uuid primary key default gen_random_uuid(), connection_id uuid, event_key text, title text, body text,
      match_id uuid, calendar_event_id uuid, resource_id uuid, occurrence_date date, push_sent_at timestamptz, created_at timestamptz default now(),
      unique (connection_id, event_key), constraint fan_notifications_exact_target_check check (
        (match_id is not null and calendar_event_id is null and resource_id is null and occurrence_date is null)
        or (match_id is null and calendar_event_id is not null and resource_id is not null and occurrence_date is not null)));
    insert into players values (${id(1)}, ${id(2)}, ${id(3)}, 'active', null);
    insert into parent_player_links values
      (${id(4)}, ${id(1)}, ${id(2)}, ${id(5)}, ${id(3)}, 'parent', 'active'),
      (${id(14)}, ${id(1)}, ${id(2)}, ${id(15)}, ${id(3)}, 'parent', 'active');
    insert into resource_library_items values (${id(6)}, ${id(2)}, ${id(3)}, null);
    insert into resource_library_links values (${id(7)}, ${id(6)}, ${id(2)}, ${id(3)}, 'player', ${id(1)}, true, null);
    insert into fan_connections values
      (${id(10)}, ${id(1)}, ${id(2)}, ${id(4)}, ${id(5)}, ${id(9)}, 'active', 'player', true, '{"resources":true,"development":true}'),
      (${id(11)}, ${id(1)}, ${id(2)}, ${id(14)}, ${id(15)}, ${id(9)}, 'active', 'player', true, '{"resources":true,"development":true}'),
      (${id(12)}, ${id(1)}, ${id(2)}, ${id(4)}, ${id(5)}, ${id(18)}, 'active', 'fan', true, '{"resources":true,"development":true}'),
      (${id(13)}, ${id(1)}, ${id(2)}, ${id(4)}, ${id(5)}, ${id(19)}, 'active', 'player', false, '{"resources":true,"development":true}'),
      (${id(16)}, ${id(1)}, ${id(2)}, ${id(4)}, ${id(5)}, ${id(17)}, 'active', 'player', true, '{"resources":true,"development":false}');
    insert into fan_notifications(connection_id, event_key, match_id) values (${id(10)}, 'match', ${id(20)});
    insert into fan_notifications(connection_id, event_key, calendar_event_id, resource_id, occurrence_date)
      values (${id(10)}, 'calendar', ${id(21)}, ${id(6)}, current_date);
  `)
  await db.exec(migration)
  const directNotices = async () => (await db.query('select connection_id, direct_resource_link_id from fan_notifications where direct_resource_link_id is not null')).rows
  assert.deepEqual(await directNotices(), [])

  await db.exec(`
    insert into resource_library_links values
      (${id(22)}, ${id(6)}, ${id(2)}, ${id(3)}, 'team', ${id(3)}, true, null),
      (${id(23)}, ${id(6)}, ${id(2)}, ${id(99)}, 'player', ${id(1)}, true, null),
      (${id(24)}, ${id(6)}, ${id(2)}, ${id(3)}, 'player', ${id(1)}, false, null);
  `)
  assert.deepEqual(await directNotices(), [])
  await db.exec(`update resource_library_links set parent_visible = true where id = ${id(24)}`)
  await db.exec(`update resource_library_links set parent_visible = false where id = ${id(24)}`)
  await db.exec(`update resource_library_links set parent_visible = true where id = ${id(24)}`)
  assert.deepEqual(await directNotices(), [{ connection_id: id(10).slice(1, -1), direct_resource_link_id: id(24).slice(1, -1) }])

  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from public.claim_direct_player_resource_pushes(8)'), { code: '42501' })
  await db.exec('reset role; set role service_role')
  const first = await db.query('select * from public.claim_direct_player_resource_pushes(8)')
  assert.equal(first.rows.length, 1)
  assert.equal(first.rows[0].direct_push_attempts, 1)
  assert.deepEqual((await db.query('select * from public.claim_direct_player_resource_pushes(8)')).rows, [])
})
