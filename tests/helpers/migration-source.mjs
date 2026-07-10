import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const MIGRATION_SOURCE_MODES = Object.freeze({
  active: 'active',
  archivedNotAppliedProduction: 'archivedNotAppliedProduction',
  anyKnownMigration: 'anyKnownMigration',
})

const roots = Object.freeze({
  [MIGRATION_SOURCE_MODES.active]: new URL('../../supabase/migrations/', import.meta.url),
  [MIGRATION_SOURCE_MODES.archivedNotAppliedProduction]: new URL(
    '../../supabase/archived-migrations/not-applied-production/',
    import.meta.url,
  ),
})

function assertFilename(filename) {
  if (typeof filename !== 'string' || !/^\d{14}_[A-Za-z0-9_-]+\.sql$/.test(filename)) {
    throw new Error(`Invalid migration filename: ${String(filename)}`)
  }
}

function existingUrl(filename, mode) {
  const url = new URL(filename, roots[mode])
  return existsSync(fileURLToPath(url)) ? url : null
}

export function migrationSourceUrl(filename, mode) {
  assertFilename(filename)

  if (mode === MIGRATION_SOURCE_MODES.active || mode === MIGRATION_SOURCE_MODES.archivedNotAppliedProduction) {
    const url = existingUrl(filename, mode)
    if (!url) {
      throw new Error(`Required ${mode} migration is missing: ${filename}`)
    }
    return url
  }

  if (mode === MIGRATION_SOURCE_MODES.anyKnownMigration) {
    const matches = [
      existingUrl(filename, MIGRATION_SOURCE_MODES.active),
      existingUrl(filename, MIGRATION_SOURCE_MODES.archivedNotAppliedProduction),
    ].filter(Boolean)

    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? `Known migration is missing: ${filename}`
          : `Known migration is ambiguous across active and archive sources: ${filename}`,
      )
    }

    return matches[0]
  }

  throw new Error(`Unsupported migration source mode: ${String(mode)}`)
}
