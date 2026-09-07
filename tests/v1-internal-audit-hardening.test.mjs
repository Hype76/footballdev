import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const directory = new URL('../supabase/migrations/', import.meta.url)
const migration = readFileSync(new URL('20260907093937_v1_internal_audit_permissions.sql', directory), 'utf8')
const signatures = [
  'record_player_chat_audit(uuid,uuid,text,uuid,text,jsonb)',
  'record_adult_player_response_audit_internal(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text)',
]
const helpers = ['set_players_updated_at', 'set_tester_feedback_reports_updated_at', 'set_email_logs_updated_at', 'set_calendar_event_invites_updated_at', 'get_initials_from_full_name', 'set_scheduled_email_queue_updated_at', 'normalize_subscription_plan_key', 'set_parent_email_templates_updated_at']
const definitions = new Map()
for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()) {
  const source = readFileSync(new URL(file, directory), 'utf8')
  for (const match of source.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\bas (\$[\w]*\$)[\s\S]*?\2\s*;/gi)) {
    if ([...helpers, ...signatures.map((signature) => signature.split('(')[0])].includes(match[1])) definitions.set(match[1], match[0])
  }
}

test('internal audit grants reject direct anonymous, authenticated and spoofed calls while trusted callers work', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table public.users (id uuid primary key, name text, email text, role_label text, role text, role_rank integer);
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create table public.audit_logs (id uuid default gen_random_uuid(), club_id uuid, actor_id uuid references public.users(id), actor_name text, actor_email text, actor_role_label text, actor_role_rank integer, action text, entity_type text, entity_id uuid, event_category text, severity text, outcome text, source text, metadata jsonb, created_at timestamptz);
    `)
    assert.equal(definitions.size, 10)
    for (const definition of definitions.values()) await db.exec(definition)
    for (const signature of signatures) await db.exec(`grant execute on function public.${signature} to public, anon, authenticated, service_role`)
    await db.exec(migration)
    await db.exec(migration)
    for (const signature of signatures) {
      for (const role of ['anon', 'authenticated']) {
        const result = await db.query('select has_function_privilege($1, $2, \'execute\') allowed', [role, `public.${signature}`])
        assert.equal(result.rows[0].allowed, false)
      }
      assert.equal((await db.query('select has_function_privilege(\'service_role\', $1, \'execute\') allowed', [`public.${signature}`])).rows[0].allowed, true)
    }
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      for (const actor of ['null', "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid"]) {
        await assert.rejects(db.exec(`select public.record_player_chat_audit(${actor}, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'forged', null, 'success', '{}')`), { code: '42501' })
        await assert.rejects(db.exec(`select public.record_adult_player_response_audit_internal('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ${actor}, null, null, null, null, null, 'forged', 'success', '', '', '')`), { code: '42501' })
      }
      await db.exec('reset role')
    }
    assert.equal((await db.query('select count(*)::int count from audit_logs')).rows[0].count, 0)
    await db.exec(`
      insert into auth.users values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'parent@example.test', '{"name":"Test Parent"}');
      create function public.test_trusted_workflow() returns void language plpgsql security definer set search_path = '' as $$ begin
        perform public.record_player_chat_audit('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'player_chat_message_sent', null, 'success', '{}');
        perform public.record_adult_player_response_audit_internal('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, null, null, null, null, 'adult_response', 'success', '', 'available', '');
      end $$;
      set role authenticated; select public.test_trusted_workflow(); reset role;
    `)
    const rows = (await db.query('select actor_id, metadata, club_id from audit_logs')).rows
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.equal(row.actor_id, null)
      assert.equal(row.metadata.actorAuthUserId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      assert.equal(row.club_id, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    }
    for (const helper of helpers) {
      const config = (await db.query('select proconfig from pg_proc where proname = $1', [helper])).rows[0].proconfig
      assert.ok(config.some((item) => item.startsWith('search_path=')))
      if (helper.startsWith('set_')) {
        await db.exec(`create table ${helper}_fixture (id int, updated_at timestamptz); create trigger stamp before update on ${helper}_fixture for each row execute function public.${helper}(); insert into ${helper}_fixture values (1, null); update ${helper}_fixture set id=2;`)
        assert.ok((await db.query(`select updated_at from ${helper}_fixture`)).rows[0].updated_at)
      }
    }
    assert.equal((await db.query("select public.get_initials_from_full_name('Test Parent') value")).rows[0].value, 'TP')
    assert.equal((await db.query("select public.normalize_subscription_plan_key('Development Club') value")).rows[0].value, 'development_club')
  } finally { await db.close() }
})
