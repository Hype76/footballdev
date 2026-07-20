import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../supabase/migrations/20260719092052_p0_demo_reset_atomic_recovery.sql', import.meta.url)
const backupContainmentMigrationUrl = new URL('../supabase/migrations/20260720071943_p0_demo_recovery_backup_side_effect_containment.sql', import.meta.url)

function readyState() {
  return { type: 'ready' }
}

function nextState(state, character, data) {
  if (state.type === 'ready') {
    if (character === '$') return { type: 'tag', offset: data.length - 1 }
    if (character === "'" || character === '"') return { type: 'quote', delimiter: character, escape: false }
    if (character === '-') return { type: 'comment' }
    if (character === '/') return { type: 'block', depth: 0 }
    if (character === '\\') return { type: 'escape' }
    if (character === ';') return null
    if (character === '(') return { type: 'atomic', previous: state, delimiter: ')' }
    if ((character === 'c' || character === 'C') && data.slice(-6).toLowerCase() === 'atomic') {
      return { type: 'atomic', previous: state, delimiter: 'END' }
    }
    return state
  }

  if (state.type === 'comment') {
    if (character === '-') return { type: 'dollar', delimiter: '\n' }
    return nextState(readyState(), character, data)
  }

  if (state.type === 'block') {
    const window = data.slice(-2)
    if (window === '/*') state.depth += 1
    if (state.depth === 0) return nextState(readyState(), character, data)
    if (window === '*/') {
      state.depth -= 1
      if (state.depth === 0) return readyState()
    }
    return state
  }

  if (state.type === 'quote') {
    if (state.escape) {
      if (character === state.delimiter) {
        state.escape = false
        return state
      }
      return nextState(readyState(), character, data)
    }
    if (character === state.delimiter) state.escape = true
    return state
  }

  if (state.type === 'dollar') {
    if (data.endsWith(state.delimiter)) return readyState()
    return state
  }

  if (state.type === 'tag') {
    if (character === '$') return { type: 'dollar', delimiter: data.slice(state.offset) }
    if (/^[A-Za-z0-9_]$/.test(character)) return state
    return nextState(readyState(), character, data)
  }

  if (state.type === 'escape') return readyState()

  if (state.type === 'atomic') {
    const previous = nextState(state.previous, character, data)
    if (previous !== null) state.previous = previous
    if (state.previous.type === 'ready' && data.slice(-state.delimiter.length).toLowerCase() === state.delimiter.toLowerCase()) {
      return readyState()
    }
    return state
  }

  throw new Error(`Unsupported parser state: ${state.type}`)
}

function splitLikeSupabaseCli2655(sql) {
  const statements = []
  let state = readyState()
  let start = 0

  for (let index = 0; index < sql.length; index += 1) {
    const data = sql.slice(start, index + 1)
    state = nextState(state, sql[index], data)
    if (state !== null) continue

    const statement = data.replace(/;+$/, '').trim()
    if (statement) statements.push(statement)
    start = index + 1
    state = readyState()
  }

  const finalStatement = sql.slice(start).trim()
  if (finalStatement) statements.push(finalStatement)
  return statements
}

test('quoted recovery RPC name avoids the Supabase CLI 2.65.5 BEGIN ATOMIC tokenizer collision', () => {
  const broken = 'create function public.reset_demo_account_atomic() returns void language sql as $$ select 1 $$; revoke all on function public.reset_demo_account_atomic() from public;'
  const corrected = 'create function public."reset_demo_account_atomic"() returns void language sql as $$ select 1 $$; revoke all on function public."reset_demo_account_atomic"() from public;'

  assert.equal(splitLikeSupabaseCli2655(broken).length, 1)
  assert.equal(splitLikeSupabaseCli2655(corrected).length, 2)
})

test('the corrected recovery migration remains split into one command per runner statement', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const statements = splitLikeSupabaseCli2655(migration)

  assert.equal(statements.length, 37)
  assert.match(statements[14], /^create or replace function public\."reset_demo_account_atomic"\(/)
  assert.doesNotMatch(statements[14], /revoke all on table public\.demo_reset_operations/)
  assert.match(statements[15], /^revoke all on table public\.demo_reset_operations from public$/)
  assert.match(statements[36], /^comment on function public\."reset_demo_account_atomic"\(uuid, uuid\) is/)
})

test('backup containment migration is forward-only, runner-safe, and preserves the evidence ledger', async () => {
  const migration = await readFile(backupContainmentMigrationUrl, 'utf8')
  const statements = splitLikeSupabaseCli2655(migration)

  assert.ok(statements.length > 20)
  assert.match(migration, /create schema if not exists app_private authorization postgres/)
  assert.match(migration, /create table app_private\.demo_reset_backup_context/)
  assert.match(migration, /alter function public\."reset_demo_account_atomic"\(uuid, uuid\)\s+rename to "reset_demo_account_atomic_impl"/)
  assert.match(migration, /create function public\."reset_demo_account_atomic"\(/)
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path = ''/)
  assert.match(migration, /create or replace function public\.capture_record_backup\(\)/)
  assert.match(migration, /TG_TABLE_NAME in \([\s\S]*'team_staff'[\s\S]*'assessment_session_players'[\s\S]*\)/)
  assert.match(migration, /pg_catalog\.current_setting\('app\.demo_reset_backup_context_nonce', true\)/)
  assert.match(migration, /context\.transaction_id = pg_catalog\.txid_current\(\)/)
  assert.match(migration, /revoke all on function public\."reset_demo_account_atomic_impl"\(uuid, uuid\) from service_role/)
  assert.match(migration, /grant execute on function public\."reset_demo_account_atomic"\(uuid, uuid\) to service_role/)
  assert.doesNotMatch(migration, /(?:delete from|update|truncate) public\.record_backups/i)
  assert.doesNotMatch(migration, /(?:delete from|update|truncate) public\.audit_logs/i)
  assert.doesNotMatch(migration, /insert into public\.audit_logs/i)
  assert.doesNotMatch(migration, /auth\.users\s+(?:set|delete|insert|update)/i)
  assert.equal(statements.some((statement) => /^revoke all on function public\."reset_demo_account_atomic_impl"/.test(statement)), true)
  assert.equal(statements.some((statement) => /^create or replace function public\.capture_record_backup/.test(statement)), true)
})
