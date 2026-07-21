import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const policy = JSON.parse(await readFile(path.join(root, 'security', 'supply-chain-policy.json'), 'utf8'))
const failures = []

assert.equal(lock.lockfileVersion, 3, 'package-lock.json must remain lockfileVersion 3')

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/'
  const index = packagePath.lastIndexOf(marker)
  return index >= 0 ? packagePath.slice(index + marker.length) : packagePath
}

const lifecycle = []
const licenseCounts = new Map()
const unknownLicensePackages = new Set()

for (const [packagePath, entry] of Object.entries(lock.packages || {})) {
  if (!packagePath) continue

  const name = packageNameFromPath(packagePath)

  if (entry.resolved && !policy.approvedRegistryPrefixes.some((prefix) => entry.resolved.startsWith(prefix))) {
    failures.push(`Unapproved package source: ${name}`)
  }

  if (entry.link || /^(?:git\+|github:|https?:\/\/(?!registry\.npmjs\.org\/))/i.test(String(entry.resolved || ''))) {
    failures.push(`Git, linked or remote package is not allowed: ${name}`)
  }

  if (entry.hasInstallScript) {
    lifecycle.push({ name, version: entry.version, development: Boolean(entry.dev), optional: Boolean(entry.optional) })
    if (!policy.allowedLifecyclePackages.includes(name)) {
      failures.push(`Unapproved install lifecycle package: ${name}`)
    }
  }

  try {
    const installed = JSON.parse(await readFile(path.join(root, packagePath, 'package.json'), 'utf8'))
    const license = typeof installed.license === 'string'
      ? installed.license
      : typeof installed.license?.type === 'string'
        ? installed.license.type
        : ''
    licenseCounts.set(license || 'UNKNOWN', (licenseCounts.get(license || 'UNKNOWN') || 0) + 1)

    if (!license) {
      unknownLicensePackages.add(installed.name || name)
    }

    if (policy.prohibitedLicenseMarkers.some((marker) => license.toUpperCase().includes(marker))) {
      failures.push(`Prohibited license marker for ${installed.name || name}: ${license}`)
    }
  } catch {
    if (!entry.optional) failures.push(`Installed package metadata missing: ${name}`)
  }
}

for (const packageName of unknownLicensePackages) {
  if (!policy.licenseMetadataExceptions.includes(packageName)) {
    failures.push(`License metadata missing without exception: ${packageName}`)
  }
}

const remoteImportPattern = /https:\/\/esm\.sh\/[^'"\s]+/g
const edgeSource = await readFile(path.join(root, 'supabase', 'functions', 'create-staff-user', 'index.ts'), 'utf8')
const remoteImports = [...new Set(edgeSource.match(remoteImportPattern) || [])]

for (const remoteImport of remoteImports) {
  if (!policy.approvedRemoteImports.includes(remoteImport)) {
    failures.push(`Unapproved or unpinned Edge import: ${remoteImport}`)
  }
}

for (const approvedImport of policy.approvedRemoteImports) {
  if (!remoteImports.includes(approvedImport)) {
    failures.push(`Approved Edge import not found: ${approvedImport}`)
  }
}

const artifacts = path.join(root, '.security-artifacts')
await mkdir(artifacts, { recursive: true })
await writeFile(path.join(artifacts, 'dependency-inventory.json'), `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  direct: {
    production: packageJson.dependencies || {},
    development: packageJson.devDependencies || {},
    optional: packageJson.optionalDependencies || {},
  },
  totals: {
    lockedPackages: Object.keys(lock.packages || {}).length - 1,
    lifecyclePackages: lifecycle.length,
    licenses: [...licenseCounts.values()].reduce((sum, count) => sum + count, 0),
  },
  lifecycle,
  licenseCounts: Object.fromEntries([...licenseCounts].sort(([left], [right]) => left.localeCompare(right))),
  remoteImports,
  policyReview: policy.review,
}, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`Supply-chain gate failed with ${failures.length} finding(s).`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Supply-chain gate passed: ${Object.keys(lock.packages || {}).length - 1} locked package entries, ${lifecycle.length} approved install lifecycle entries, ${remoteImports.length} pinned remote import.`)
}
