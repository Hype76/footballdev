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
