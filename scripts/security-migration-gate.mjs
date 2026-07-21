import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const migrationDirectory = path.join(process.cwd(), 'supabase', 'migrations')
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

try {
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim()
  const changed = execFileSync('git', ['diff', '--name-only', base, '--', 'supabase/migrations'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
  if (changed.length > 1) failures.push(`Migration allowlist exceeded: ${changed.length} changed migrations`)
} catch {
  failures.push('Could not establish the origin/main migration allowlist base')
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Migration gate passed for ${migrations.length} ordered migration files.`)
}
