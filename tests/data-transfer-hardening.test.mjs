import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { canUseDataTransfer } from '../src/lib/auth-permissions.js'

test('role access matrix grants only approved staff roles', () => {
  const base = { clubId: 'club-1', planKey: 'small_club', planStatus: 'active', roleRank: 50 }
  assert.equal(canUseDataTransfer({ ...base, role: 'admin', roleRank: 90 }), true)
  assert.equal(canUseDataTransfer({ ...base, role: 'head_manager' }), true)
  assert.equal(canUseDataTransfer({ ...base, role: 'manager' }), true)
  assert.equal(canUseDataTransfer({ ...base, role: 'coach', roleRank: 30 }), false)
  assert.equal(canUseDataTransfer({ ...base, role: 'assistant_coach', roleRank: 20 }), false)
  assert.equal(canUseDataTransfer({ role: 'super_admin', roleRank: 100, planStatus: 'active' }), true)
})

test('migration keeps transfer internals service-role only and RPCs out of authenticated grants', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20260717102324_data_transfer_v1.sql', import.meta.url), 'utf8')
  assert.match(migration, /enable row level security/g)
  assert.match(migration, /revoke all on public\.data_transfer_batches from public, anon, authenticated/i)
  assert.match(migration, /revoke all on function public\.execute_data_transfer_import\(uuid, text\) from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.execute_data_transfer_import\(uuid, text\) to service_role/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(migration, /state = 'rollback_blocked'/i)
  assert.match(migration, /transfer_type <> 'import'/i)
  assert.doesNotMatch(migration, /grant execute on function public\.execute_data_transfer_import\(uuid, text\) to authenticated/i)
})

test('server flow exposes inspect and preview before the separate confirmation RPC', async () => {
  const source = await readFile(new URL('../netlify/functions/data-transfer.js', import.meta.url), 'utf8')
  const inspectIndex = source.indexOf("operation === 'inspect'")
  const confirmIndex = source.indexOf("operation === 'confirm'")
  assert.ok(inspectIndex > 0 && confirmIndex > inspectIndex)
  assert.match(source, /confirmation_sha256/)
  assert.match(source, /ACTOR_BINDING_MISMATCH/)
  assert.match(source, /CROSS_TEAM_SCOPE_DENIED/)
  assert.match(source, /accessRows\?\.\[0\]\?\.status === 'suspended'/)
  assert.match(source, /PLATFORM_ACCESS_DENIED/)
  assert.match(source, /PRIVATE_BUCKET = 'data-transfer-private'/)
  assert.match(source, /batch\.transfer_type !== 'import'/)
  assert.match(source, /operation === 'raw-workbook'/)
  assert.match(source, /RAW_WORKBOOK_EXPIRED/)
  assert.match(source, /RAW_WORKBOOK_INTEGRITY_FAILED/)
  assert.match(source, /data_transfer_raw_workbook_downloaded/)
  assert.match(source, /affectedRecords/)
  assert.match(source, /teamFilter = scope\.isClubWideScope/)
  assert.match(source, /const scopedClub = scope\.canManageClub/)
  assert.match(source, /scope\.isClubWideScope \|\| \(batch\.authorized_team_ids \|\| \[\]\)\.every/)
  assert.match(source, /authorizedTeamIds: batchTeamIds/)
  assert.match(source, /requireSelection: true/)
  assert.match(source, /TEAM_SCOPE_REQUIRED/)
  assert.doesNotMatch(source, /send.*email|send.*sms|send.*push/i)
})

test('navigation and cleanup are centrally wired', async () => {
  const [navigation, router, sidebar, cleanup] = await Promise.all([
    readFile(new URL('../src/app/navigation.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/router.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/layout/Sidebar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/cleanup-expired-retention.js', import.meta.url), 'utf8'),
  ])
  assert.match(navigation, /path: '\/data-transfer'/)
  assert.match(router, /RequireDataTransferAccess/)
  assert.match(sidebar, /Controlled XLSX onboarding/)
  assert.match(cleanup, /deleteExpiredDataTransferFiles/)
  assert.match(router, /DataTransferPage/)
})
