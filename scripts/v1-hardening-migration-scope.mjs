import { createHash } from 'node:crypto'

// A bounded two-migration candidate. This does not authorise production application.
export const hardeningMigrationScope = {
  base: '7829b58c0b8a87e2615236069d3c76a820fafb5b',
  hashes: {
    'supabase/migrations/20260907093937_v1_internal_audit_permissions.sql': 'b2dcb28d839e01036360cd1e645ed614eb4f1f67803c0a272cb23783a9e6c9d3',
    'supabase/migrations/20260907094825_v1_atomic_team_labels.sql': '6a85d6bb69772e719f09b418ea8c3e5f0fd07c75cce9a89a387a6cd8f3ff821d',
  },
}

export function matchesHardeningMigrationScope(base, entries) {
  if (base !== hardeningMigrationScope.base) return false
  const expected = Object.keys(hardeningMigrationScope.hashes).sort()
  if (entries.length !== expected.length) return false
  return entries.every(({ path, status, source }, index) => path === expected[index] && status === 'A'
    && createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex') === hardeningMigrationScope.hashes[path])
}

// Combined V1 local candidate only. Exact bytes and current-main base remain
// mandatory; this static validation does not authorise migration application.
export const completeV1MigrationScope = {
  "base": "2a18b4e50d4987c2651faa612a6318293ea946e2",
  "hashes": {
    "supabase/migrations/20261003060000_first_250_branding_preparation.sql": "188aa136e4c87fdec3f3a52f084e2fa1eabee6ae43cf30c7cba46dee099d9201",
    "supabase/migrations/20261004152308_atomic_match_day_participation_renewal.sql": "0f72132d9c6ff68aea9ce39b0b8ae65b3298e8f4d2023a9e7a1748e7c5136827",
    "supabase/migrations/20261004153000_matchday_unconfigured_participant_roster.sql": "5a66fdb5bd2a19bf2e8486b35aba538943995dd99e9d01f13db3d6d4355f0b9a",
    "supabase/migrations/20261005085925_mobile_attendance_durable_commands.sql": "b3fe9b2893a9d8082d3af15ac76a8fffe258b811d2bb7460def0c6b9324038f0",
    "supabase/migrations/20261006062722_team_current_league_url.sql": "417ff09057a6fef38016e7268644e23c268724e5cf322cf2406123ee2eb5cb70"
  }
}

export function matchesCompleteV1MigrationScope(base, entries) {
  if (base !== completeV1MigrationScope.base) return false
  const expected = Object.keys(completeV1MigrationScope.hashes).sort()
  if (entries.length !== expected.length) return false
  return entries.every(({ path, status, source }, index) => path === expected[index] && status === 'A'
    && createHash('sha256').update(source.replaceAll('\r\n', '\n')).digest('hex') === completeV1MigrationScope.hashes[path])
}
