import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260814184353_mobile_chat_sessions_poll_60.sql', import.meta.url)

test('Parent Chat audit keeps auth-only Parent accounts outside the staff foreign key', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /audit_actor_id := actor_record\.id/)
  assert.match(migration, /insert into public\.audit_logs[\s\S]*audit_actor_id/)
  assert.match(migration, /'actorAuthUserId', actor_id_value/)
  assert.match(migration, /from auth\.users auth_actor/)
  assert.doesNotMatch(migration, /club_id_value,\s*actor_id_value,\s*coalesce/)
})

test('Parent Chat audit records an auth-only Parent without violating the staff profile reference', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()
  await db.exec(`
    create role service_role;
    create schema auth;
    create table public.users (
      id uuid primary key,
      name text,
      email text,
      role_label text,
      role text,
      role_rank integer
    );
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create table public.audit_logs (
      id uuid primary key default gen_random_uuid(),
      club_id uuid,
      actor_id uuid references public.users(id),
      actor_name text,
      actor_email text,
      actor_role_label text,
      actor_role_rank integer,
      action text,
      entity_type text,
      entity_id uuid,
      event_category text,
      severity text,
      outcome text,
      source text,
      metadata jsonb
    );
  `)
  await db.exec(migration)
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'parent@example.test',
      '{"name":"FP Test Parent"}'::jsonb
    );
    select public.record_player_chat_audit(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'player_chat_message_sent',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'success',
      '{"messageId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}'::jsonb
    );
  `)

  const result = await db.query(`
    select actor_id, actor_name, actor_email, actor_role_label, metadata
    from public.audit_logs
  `)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].actor_id, null)
  assert.equal(result.rows[0].actor_name, 'FP Test Parent')
  assert.equal(result.rows[0].actor_email, 'parent@example.test')
  assert.equal(result.rows[0].actor_role_label, 'parent')
  assert.equal(result.rows[0].metadata.actorAuthUserId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await db.close()
})

test('Coach More opens the canonical Sessions workspace instead of a placeholder route', async () => {
  const app = await readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8')
  const moreStart = app.indexOf("if (activeRoute === 'more')")
  const moreBranch = app.slice(moreStart, moreStart + 900)

  assert.match(moreBranch, /moreRoute === 'sessions'[\s\S]*<CoachSessionsScreen/)
  assert.ok(moreBranch.indexOf("moreRoute === 'sessions'") < moreBranch.indexOf('<FoundationRoute'))
})

test('Coach Poll results refresh without replacing the visible workspace', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  const pollsStart = screen.indexOf('function PollsDomain')
  const pollsSource = screen.slice(pollsStart, screen.indexOf('function InvitesDomain', pollsStart))

  assert.match(screen, /load\(\{ silent: true \}\)/)
  assert.match(screen, /setInterval\(refreshResults, 15000\)/)
  assert.match(screen, /AppState\.addEventListener\('change'/)
  assert.match(pollsSource, /label="Refresh Poll results"/)
  assert.match(screen, /if \(!silent\) setLoading\(false\)/)
})

test('release guards and native versions cover both apps', async () => {
  const [buildGuard, submitGuard, coachConfig, coachPackage, parentConfig, parentPackage] = await Promise.all([
    readFile(new URL('../apps/scripts/mobile-build-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/scripts/mobile-submit-guard.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/app.config.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/package.json', import.meta.url), 'utf8'),
  ])

  assert.match(buildGuard, /authorisedParentProductionReferences[\s\S]*FP-MOBILE-CHAT-SESSIONS-POLL-60/)
  assert.match(buildGuard, /authorisedCoachProductionReferences[\s\S]*FP-MOBILE-CHAT-SESSIONS-POLL-60/)
  assert.match(submitGuard, /promotionReference === 'FP-MOBILE-CHAT-SESSIONS-POLL-60'/)
  assert.match(coachConfig, /version: '1\.0\.17'/)
  assert.equal(JSON.parse(coachPackage).version, '1.0.17')
  assert.match(parentConfig, /version: '1\.0\.14'/)
  assert.equal(JSON.parse(parentPackage).version, '1.0.14')
})
