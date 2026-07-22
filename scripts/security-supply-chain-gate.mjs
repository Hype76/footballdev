import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
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

const npmExecutable = process.env.npm_execpath
const auditCommand = npmExecutable ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
const auditArgs = npmExecutable ? [npmExecutable, 'audit', '--json'] : ['audit', '--json']
const auditResult = spawnSync(auditCommand, auditArgs, {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 25 * 1024 * 1024,
})

let audit
try {
  audit = JSON.parse(String(auditResult.stdout || ''))
} catch {
  failures.push('Full dependency audit did not return valid JSON.')
  audit = { vulnerabilities: {}, metadata: { vulnerabilities: {} } }
}

const advisoryExceptions = new Map(
  (policy.advisoryExceptions || []).map((exception) => [String(exception.id || '').toUpperCase(), exception]),
)
const observedAdvisories = new Set()
const vulnerabilities = audit.vulnerabilities || {}

function advisoryIdFromUrl(url) {
  return String(url || '').match(/GHSA-[a-z0-9-]+/i)?.[0]?.toUpperCase() || ''
}

function rootAdvisoriesFor(packageName, visited = new Set()) {
  if (visited.has(packageName)) return []
  visited.add(packageName)

  const vulnerability = vulnerabilities[packageName]
  if (!vulnerability) return []

  const roots = []
  for (const via of vulnerability.via || []) {
    if (typeof via === 'string') {
      roots.push(...rootAdvisoriesFor(via, visited))
      continue
    }

    const id = advisoryIdFromUrl(via.url)
    if (id) roots.push({ id, severity: String(via.severity || vulnerability.severity || '').toLowerCase() })
  }
  return roots
}

for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
  const roots = rootAdvisoriesFor(packageName)
  if (roots.length === 0) {
    failures.push(`Audit finding has no traceable advisory: ${packageName}`)
  }

  for (const node of vulnerability.nodes || []) {
    const entry = lock.packages?.[node]
    if (!entry || entry.dev !== true) {
      failures.push(`Audit finding is not confined to development dependencies: ${packageName} at ${node}`)
    }
  }

  for (const rootAdvisory of roots) {
    observedAdvisories.add(rootAdvisory.id)
    const exception = advisoryExceptions.get(rootAdvisory.id)
    if (!exception) {
      failures.push(`Undocumented development advisory: ${rootAdvisory.id}`)
      continue
    }

    if (exception.productionReachable !== false) {
      failures.push(`Advisory exception must be unreachable from production: ${rootAdvisory.id}`)
    }
    if (String(exception.severity || '').toLowerCase() !== rootAdvisory.severity) {
      failures.push(`Advisory severity does not match policy: ${rootAdvisory.id}`)
    }
    if (!exception.owner || !exception.packageChain || !exception.compensatingControl) {
      failures.push(`Advisory exception is incomplete: ${rootAdvisory.id}`)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.reviewBy || '')
      || !/^\d{4}-\d{2}-\d{2}$/.test(exception.expires || '')) {
      failures.push(`Advisory exception dates are invalid: ${rootAdvisory.id}`)
    } else if (new Date(`${exception.expires}T23:59:59Z`) < new Date()) {
      failures.push(`Advisory exception has expired: ${rootAdvisory.id}`)
    }
  }
}

for (const advisoryId of advisoryExceptions.keys()) {
  if (!observedAdvisories.has(advisoryId)) {
    failures.push(`Stale advisory exception must be removed: ${advisoryId}`)
  }
}

if (Number(audit.metadata?.vulnerabilities?.critical || 0) > 0) {
  failures.push('Critical development advisories are not accepted.')
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
  audit: {
    vulnerabilities: audit.metadata?.vulnerabilities || {},
    documentedDevelopmentAdvisories: [...observedAdvisories].sort(),
  },
}, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`Supply-chain gate failed with ${failures.length} finding(s).`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Supply-chain gate passed: ${Object.keys(lock.packages || {}).length - 1} locked package entries, ${lifecycle.length} approved install lifecycle entries, ${remoteImports.length} pinned remote import, ${observedAdvisories.size} documented development advisories.`)
}
