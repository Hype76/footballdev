import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const migrationDirectory = path.join(process.cwd(), 'supabase', 'migrations')
const reconciliationManifestPath = path.join(process.cwd(), 'scripts', 'migration-reconciliation-manifest.json')
const approvedReferences = [
  'FP-V1-MIGRATION-LEDGER-RECONCILE-03',
  'FP-V1-ONBOARDING-LEDGER-REPAIR-04',
]
const migrations = (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()
const versions = new Set()
const failures = []

for (const migration of migrations) {
  const match = migration.match(/^(\d{14})_[a-z0-9_]+\.sql$/)
  if (!match) failures.push(`Invalid migration filename: ${migration}`)
  if (match && versions.has(match[1])) failures.push(`Duplicate migration version: ${match[1]}`)
  if (match) versions.add(match[1])

  const source = await readFile(path.join(migrationDirectory, migration), 'utf8')
  if (/llpufwzvgxyczxcjwupu/i.test(source)) failures.push(`Retired project reference in migration: ${migration}`)
}

function gitText(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function gitLines(args) {
  const output = gitText(args)
  return output ? output.split(/\r?\n/).filter(Boolean).sort() : []
}

function matchesExactly(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

async function validateReconciliationManifest(base, changed) {
  let manifest

  try {
    manifest = JSON.parse(await readFile(reconciliationManifestPath, 'utf8'))
  } catch {
    failures.push(`Migration allowlist exceeded: ${changed.length} changed migrations`)
    failures.push('Approved migration reconciliation manifest is missing or invalid')
    return
  }

  const manifestReferences = [...(manifest.references ?? [])].sort()
  const expectedReferences = [...approvedReferences].sort()
  if (!matchesExactly(manifestReferences, expectedReferences)) {
    failures.push('Migration reconciliation references do not match the approved scope')
  }
  if (manifest.baseCommit !== base) {
    failures.push(`Migration reconciliation base mismatch: expected ${manifest.baseCommit}, found ${base}`)
  }

  const expectedChangedPaths = [...(manifest.changedMigrationPaths ?? [])].sort()
  const changedWithoutRenameDetection = gitLines([
    'diff',
    '--name-only',
    '--no-renames',
    base,
    '--',
    'supabase/migrations',
  ])
  if (!matchesExactly(changedWithoutRenameDetection, expectedChangedPaths)) {
    failures.push('Migration reconciliation changed-path set does not match the approved manifest')
  }

  try {
    execFileSync('git', ['diff', '--quiet', '--', 'supabase/migrations'])
  } catch {
    failures.push('Migration reconciliation contains unstaged migration changes')
  }

  const expectedHashes = manifest.indexSha256 ?? {}
  const expectedCurrentPaths = Object.keys(expectedHashes).sort()
  if (!matchesExactly(changed, expectedCurrentPaths)) {
    failures.push('Migration reconciliation active-file set does not match the approved manifest')
  }

  for (const migrationPath of expectedCurrentPaths) {
    try {
      const source = execFileSync('git', ['show', `:${migrationPath}`])
      const sha256 = createHash('sha256').update(source).digest('hex')
      if (sha256 !== expectedHashes[migrationPath]) {
        failures.push(`Migration reconciliation hash mismatch: ${migrationPath}`)
      }
    } catch {
      failures.push(`Migration reconciliation file is not staged: ${migrationPath}`)
    }
  }

  const archiveMove = manifest.archiveMove ?? {}
  const archiveChangedPaths = gitLines([
    'diff',
    '--name-only',
    '--no-renames',
    base,
    '--',
    archiveMove.from ?? '',
    archiveMove.to ?? '',
  ])
  const expectedArchiveChangedPaths = [archiveMove.from, archiveMove.to].filter(Boolean).sort()
  if (!matchesExactly(archiveChangedPaths, expectedArchiveChangedPaths)) {
    failures.push('Onboarding migration archive move does not match the approved manifest')
  }

  try {
    const archivedSource = execFileSync('git', ['show', `${base}:${archiveMove.from}`])
    const activeSource = execFileSync('git', ['show', `:${archiveMove.to}`])
    const archivedSha256 = createHash('sha256').update(archivedSource).digest('hex')
    const activeSha256 = createHash('sha256').update(activeSource).digest('hex')
    if (archivedSha256 !== archiveMove.indexSha256 || activeSha256 !== archiveMove.indexSha256) {
      failures.push('Onboarding migration archive move did not preserve the approved repository bytes')
    }
  } catch {
    failures.push('Could not verify the onboarding migration archive move')
  }

  try {
    await readFile(path.join(process.cwd(), archiveMove.from))
    failures.push('Onboarding migration archive source still exists')
  } catch (error) {
    if (error?.code !== 'ENOENT') failures.push('Could not verify onboarding migration archive removal')
  }
}

try {
  const base = gitText(['merge-base', 'HEAD', 'origin/main'])
  const changed = gitLines(['diff', '--name-only', base, '--', 'supabase/migrations'])
  if (changed.length > 1) await validateReconciliationManifest(base, changed)
} catch {
  failures.push('Could not establish the origin/main migration allowlist base')
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Migration gate passed for ${migrations.length} ordered migration files.`)
}
