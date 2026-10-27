import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('resource notification migration preserves match alerts and rejects ambiguous targets without opening table access', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.calendar_events(id uuid primary key);
      create table public.resource_library_items(id uuid primary key);
      create table public.fan_notifications(id uuid primary key, connection_id uuid not null,
        match_id uuid not null, event_key text not null, title text not null, body text not null,
        push_sent_at timestamptz, created_at timestamptz default now(), unique(connection_id,event_key));
      insert into public.fan_notifications values ('10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','match','Goal','Goal');
      insert into public.calendar_events values ('10000000-0000-4000-8000-000000000004');
      insert into public.resource_library_items values ('10000000-0000-4000-8000-000000000005');`)
    await db.exec(await readFile(new URL('../supabase/migrations/20261027160846_player_training_resource_notifications.sql', import.meta.url), 'utf8'))
    assert.equal((await db.query('select match_id from public.fan_notifications')).rows[0].match_id, '10000000-0000-4000-8000-000000000003')
    const insert = `insert into public.fan_notifications(id,connection_id,match_id,event_key,title,body,calendar_event_id,resource_id,occurrence_date)
      values ('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002',null,'resource','Training','Card',
      '10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000005','2026-10-29')`
    await db.exec(insert)
    assert.equal((await db.query('select count(*)::integer as n from public.fan_notifications')).rows[0].n, 2)
    await assert.rejects(() => db.exec("update public.fan_notifications set match_id='10000000-0000-4000-8000-000000000003' where event_key='resource'"), /fan_notifications_exact_target_check/)
    await assert.rejects(() => db.exec("update public.fan_notifications set occurrence_date=null where event_key='resource'"), /fan_notifications_exact_target_check/)
    const privileges = (await db.query(`select relrowsecurity,
      has_table_privilege('anon','public.fan_notifications','select') as anon_read,
      has_table_privilege('authenticated','public.fan_notifications','select') as authenticated_read,
      has_table_privilege('service_role','public.fan_notifications','select') as service_read
      from pg_class where oid='public.fan_notifications'::regclass`)).rows[0]
    assert.deepEqual(privileges, { relrowsecurity: true, anon_read: false, authenticated_read: false, service_read: true })
  } finally { await db.close() }
})
