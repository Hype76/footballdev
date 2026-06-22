import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const migrationUrl = new URL('../supabase/migrations/20260614030401_20260613071942_plan_b_matchday_availability_prereq.sql', import.meta.url)
const legacyTableMigrationUrl = new URL('../supabase/archived-migrations/not-applied-production/20260527093802_match_day_arrival_and_availability.sql', import.meta.url)
const legacyRpcMigrationUrl = new URL('../supabase/archived-migrations/not-applied-production/20260527095014_confirm_match_day_availability_rpc.sql', import.meta.url)
const sendFunctionUrl = new URL('../netlify/functions/send-match-day-availability-requests.js', import.meta.url)
const confirmFunctionUrl = new URL('../netlify/functions/match-day-availability-confirm.js', import.meta.url)

const sourceDirs = ['src', 'apps']
const codeExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs'])
const ignoredDirs = new Set(['node_modules', 'dist', 'build', '.git'])

async function collectCodeFiles(dir) {
  const files = []
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue
    }

    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...await collectCodeFiles(fullPath))
    } else if (entry.isFile() && codeExtensions.has(extname(entry.name))) {
      files.push(fullPath)
    }
  }

  return files
}

test('Plan B migration creates the matchday availability prerequisite schema', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter table public\.match_days\s+add column if not exists arrival_time time;/i)
  assert.match(migration, /create table if not exists public\.match_day_availability_requests/i)

  for (const column of [
    'match_day_id uuid not null references public.match_days',
    'club_id uuid not null references public.clubs',
    'team_id uuid references public.teams',
    'player_id uuid not null references public.players',
    'recipient_email text not null',
    'recipient_type text not null default',
    'channel text not null default',
    'token_hash text not null',
    "status text not null default 'pending'",
    'expires_at timestamptz not null default',
  ]) {
    assert.match(migration, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
  }
})

test('Plan B migration creates expected constraints and indexes', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /constraint match_day_availability_recipient_type_check check \(recipient_type in \('parent', 'player'\)\)/i)
  assert.match(migration, /constraint match_day_availability_channel_check check \(channel in \('email', 'push'\)\)/i)
  assert.match(migration, /constraint match_day_availability_status_check check \(status in \('pending', 'available', 'unavailable', 'maybe', 'expired'\)\)/i)
  assert.match(migration, /create unique index if not exists match_day_availability_token_hash_key/i)
  assert.match(migration, /on public\.match_day_availability_requests \(token_hash\)/i)
  assert.match(migration, /create unique index if not exists match_day_availability_request_unique_recipient/i)
  assert.match(migration, /on public\.match_day_availability_requests \(match_day_id, player_id, recipient_email, recipient_type, channel\)/i)
  assert.match(migration, /create index if not exists match_day_availability_player_status_idx/i)
  assert.match(migration, /on public\.match_day_availability_requests \(player_id, status, match_day_id\)/i)
})

test('Plan B migration makes direct table access fail closed for client roles', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const tablePolicySection = migration.split('create or replace function public.confirm_match_day_availability')[0]

  assert.match(migration, /alter table public\.match_day_availability_requests enable row level security;/i)
  assert.match(migration, /alter table public\.match_day_availability_requests force row level security;/i)
  assert.match(migration, /revoke all on public\.match_day_availability_requests from public;/i)
  assert.match(migration, /revoke all on public\.match_day_availability_requests from anon;/i)
  assert.match(migration, /revoke all on public\.match_day_availability_requests from authenticated;/i)
  assert.match(migration, /grant select, insert, update on public\.match_day_availability_requests to authenticated;/i)
  assert.doesNotMatch(migration, /grant\s+(?:select,\s*)?insert,\s*update,\s*delete on public\.match_day_availability_requests to authenticated;/i)
  assert.doesNotMatch(tablePolicySection, /\bto anon\b/i)
})

test('Plan B migration scopes authenticated staff access by club and team management', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create policy match_day_availability_staff_select_scoped/i)
  assert.match(migration, /club_id = public\.current_user_club_id\(\)/i)
  assert.match(migration, /public\.current_user_role\(\) <> 'parent_portal'/i)
  assert.match(migration, /create policy match_day_availability_staff_insert_scoped/i)
  assert.match(migration, /create policy match_day_availability_staff_update_scoped/i)
  assert.match(migration, /public\.can_manage_match_day\(team_id\)/i)
})

test('confirmation RPC is security definer with explicit search path and input validation', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /create or replace function public\.confirm_match_day_availability\(/i)
  assert.match(migration, /language plpgsql\s+security definer\s+set search_path = public/i)
  assert.match(migration, /normalized_status text := lower\(trim\(coalesce\(status_value, ''\)\)\);/i)
  assert.match(migration, /if normalized_status not in \('available', 'unavailable', 'maybe'\) then/i)
  assert.match(migration, /normalized_token_hash text := lower\(trim\(coalesce\(token_hash_value, ''\)\)\);/i)
  assert.match(migration, /if normalized_token_hash !~ '\^\[a-f0-9\]\{64\}\$' then/i)
  assert.doesNotMatch(migration, /execute\s+format\(/i)
  assert.doesNotMatch(migration, /execute\s+'/i)
})

test('confirmation RPC handles unknown, expired, single row update, and replay safely', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /if request_row\.id is null then\s+return;\s+end if;/i)
  assert.match(migration, /request_row\.status = 'expired' or request_row\.expires_at < timezone\('utc', now\(\)\)/i)
  assert.match(migration, /where id = request_row\.id\s+and status = 'pending';/i)
  assert.match(migration, /if request_row\.status <> 'pending' then/i)
  assert.match(migration, /response_status := request_row\.status;/i)
  assert.match(migration, /where id = request_row\.id\s+and status = 'pending'\s+returning id,/i)
})

test('confirmation RPC returns only minimal safe fields', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const rpcSection = migration.slice(
    migration.indexOf('create or replace function public.confirm_match_day_availability'),
    migration.indexOf('revoke all on function public.confirm_match_day_availability'),
  )

  assert.match(migration, /returns table \(\s+request_id uuid,\s+player_name text,\s+response_status text\s+\)/i)
  assert.doesNotMatch(rpcSection, /recipient_email/i)
  assert.doesNotMatch(rpcSection, /recipient_name/i)
  assert.doesNotMatch(rpcSection, /team_id,\s*player_name/i)
  assert.match(migration, /comment on function public\.confirm_match_day_availability\(text, text\)/i)
})

test('Netlify send function uses high entropy hashed tokens and the expected table', async () => {
  const source = await readFile(sendFunctionUrl, 'utf8')

  assert.match(source, /import \{ createHash, randomBytes \} from 'node:crypto'/)
  assert.match(source, /randomBytes\(32\)\.toString\('hex'\)/)
  assert.match(source, /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/)
  assert.match(source, /\.from\('match_day_availability_requests'\)/)
  assert.match(source, /onConflict: 'match_day_id,player_id,recipient_email,recipient_type,channel'/)
  assert.match(source, /createPublicSupabaseClient\(event, \{\s+global:\s+\{\s+headers:\s+\{\s+Authorization: `Bearer \$\{token\}`/s)
  assert.doesNotMatch(source, /supabaseAdmin/)
})

test('Netlify confirmation function validates raw tokens and trusts the stored RPC response', async () => {
  const source = await readFile(confirmFunctionUrl, 'utf8')

  assert.match(source, /const VALID_STATUSES = new Set\(\['available', 'unavailable', 'maybe'\]\)/)
  assert.match(source, /!\/\^\[a-f0-9\]\{64\}\$\/i\.test\(token\)/)
  assert.match(source, /supabase\.rpc\('confirm_match_day_availability'/)
  assert.match(source, /token_hash_value: hashToken\(token\)/)
  assert.match(source, /const responseStatus = normalizeText\(response\.response_status\)\.toLowerCase\(\)/)
  assert.match(source, /const statusLabel = responseStatus === 'unavailable' \? 'not available' : responseStatus \|\| status/)
})

test('browser and mobile source do not directly manage availability request rows', async () => {
  const sourceFiles = []

  for (const dir of sourceDirs) {
    sourceFiles.push(...await collectCodeFiles(join(repoRoot, dir)))
  }

  const matches = []

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    if (source.includes('match_day_availability_requests') || source.includes('confirm_match_day_availability')) {
      matches.push(file)
    }
  }

  assert.deepEqual(matches, [])
})

test('legacy local migrations were not usable as the Plan B live gate as written', async () => {
  const tableMigration = await readFile(legacyTableMigrationUrl, 'utf8')
  const rpcMigration = await readFile(legacyRpcMigrationUrl, 'utf8')

  assert.match(tableMigration, /grant select, insert, update, delete on public\.match_day_availability_requests to authenticated;/i)
  assert.doesNotMatch(tableMigration, /force row level security/i)
  assert.doesNotMatch(rpcMigration, /normalized_token_hash/i)
  assert.doesNotMatch(rpcMigration, /and status = 'pending'/i)
})
