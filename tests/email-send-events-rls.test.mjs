import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const migrationUrl = new URL('../supabase/migrations/20260613065704_harden_email_send_events_rls.sql', import.meta.url)
const emailLogStoreUrl = new URL('../netlify/functions/_email-log-store.js', import.meta.url)
const supabaseHelperUrl = new URL('../netlify/functions/_supabase.js', import.meta.url)
const repoRoot = fileURLToPath(new URL('../', import.meta.url))

const browserSourceDirs = ['src', 'apps']
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

test('browser and mobile source do not reference email_send_events directly', async () => {
  const sourceFiles = []

  for (const dir of browserSourceDirs) {
    sourceFiles.push(...await collectCodeFiles(join(repoRoot, dir)))
  }

  const matches = []

  for (const file of sourceFiles) {
    const source = await readFile(file, 'utf8')
    if (source.includes('email_send_events')) {
      matches.push(file)
    }
  }

  assert.deepEqual(matches, [])
})

test('email send event logging uses the server admin Supabase client', async () => {
  const emailLogStore = await readFile(emailLogStoreUrl, 'utf8')
  const supabaseHelper = await readFile(supabaseHelperUrl, 'utf8')

  assert.match(emailLogStore, /import \{ supabaseAdmin \} from '\.\/_supabase\.js'/)
  assert.doesNotMatch(emailLogStore, /createPublicSupabaseClient/)
  assert.doesNotMatch(emailLogStore, /createClient\(/)
  assert.match(emailLogStore, /supabaseAdmin\s*\n\s*\.from\('email_send_events'\)/)
  assert.match(supabaseHelper, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(supabaseHelper, /export const supabaseAdmin = createSupabaseAdminClient\(\)/)
})

test('email send event logging failures do not throw from the send path', async () => {
  const emailLogStore = await readFile(emailLogStoreUrl, 'utf8')

  assert.match(
    emailLogStore,
    /if \(eventError\) \{\s*console\.error\('Email send event logging failed', eventError\)\s*\}/,
  )
})

test('email send events hardening migration enables RLS and removes client grants', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /alter table public\.email_send_events enable row level security;/i)
  assert.match(migration, /revoke all privileges on table public\.email_send_events from anon;/i)
  assert.match(migration, /revoke all privileges on table public\.email_send_events from authenticated;/i)
  assert.match(migration, /revoke all privileges on table public\.email_send_events from PUBLIC;/)
  assert.match(migration, /grant select, insert, update, delete on table public\.email_send_events to service_role;/i)
})

test('email send events hardening migration does not add client policies or grants', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.doesNotMatch(migration, /create\s+policy[\s\S]*email_send_events/i)
  assert.doesNotMatch(migration, /alter\s+policy[\s\S]*email_send_events/i)
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete|all)[\s\S]*on\s+table\s+public\.email_send_events[\s\S]*to\s+(anon|authenticated|PUBLIC)/i)
})
