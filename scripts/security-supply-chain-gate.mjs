import { loadRecord, verifySource, verifyCopies, verifyReview, verifyInstallation, verifyUpstream, evaluateAudit, artifactPath } from './security-verify-reviewed-backports.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
const policy = JSON.parse(await readFile(path.join(root, 'security', 'supply-chain-policy.json'), 'utf8'))
const failures = []
assert.deepEqual(policy.advisoryExceptions, [], 'Generic advisory exceptions must remain empty')

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
    const review = policy.reviewedLifecycleScripts?.[name]
    if (review) {
      const source = await readFile(path.join(root, packagePath, review.path)).catch(() => null)
      if (entry.version !== review.version || !source || createHash('sha256').update(source).digest('hex') !== review.sha256) {
        failures.push(`Install lifecycle review no longer matches: ${name}`)
      }
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
assert.ok(npmExecutable, 'Run through the repository-pinned npm script so its CLI is identified.')
const rawAudits = []
const sourceReports = []
let validAuditScopes = 0
let zeroFindingScopes = 0
let remediation
let verified = false
try {
  remediation = loadRecord(root)
  const source = verifySource(root, remediation.record)
  const copies = verifyCopies(root, remediation.record)
  const review = verifyReview(root, remediation.record, source)
  const installation = verifyInstallation(root, remediation.record, source, copies, review)
  const upstream = await verifyUpstream(remediation.record, remediation.payload)
  sourceReports.push({ source, copies: copies.map(({ relative, treeSha256 }) => ({ relative, treeSha256 })), review, installation, upstream })
  verified = true
} catch (error) {
  failures.push('Reviewed source remediation failed: ' + error.message)
}
let audit = { metadata: { vulnerabilities: {} } }
const observedAdvisories = new Set()
for (const scope of ['.']) {
  const auditResult = spawnSync(process.execPath, [npmExecutable, 'audit', '--json'], {
    cwd: path.resolve(root, scope), encoding: 'utf8', maxBuffer: 25 * 1024 * 1024,
    timeout: 120000,
  })
  const raw = { scope, exitStatus: auditResult.status, signal: auditResult.signal, error: auditResult.error?.message || null, stdout: String(auditResult.stdout || ''), stderr: String(auditResult.stderr || '') }
  rawAudits.push(raw)
  try {
    assert.ok(!raw.error && raw.signal === null && [0, 1].includes(raw.exitStatus), 'Audit command did not complete normally')
    const data = JSON.parse(raw.stdout)
    const scopeLock = JSON.parse(await readFile(path.resolve(root, scope, 'package-lock.json'), 'utf8'))
    const result = evaluateAudit(data, scopeLock, scope, remediation?.record || { eligibleAdvisories: {}, targets: [] })
    assert.equal(raw.exitStatus, Object.keys(data.vulnerabilities).length ? 1 : 0, 'Audit exit status contradicts findings')
    validAuditScopes += 1
    if (Object.keys(data.vulnerabilities).length === 0) zeroFindingScopes += 1
    if (scope === '.') audit = data
    for (const id of result.observedAdvisories) observedAdvisories.add(id)
    failures.push(...result.failures)
    sourceReports.push({ scope, ...result, acceptedSourceRemediations: verified ? result.acceptedSourceRemediations : [], sourceVerificationPassed: verified })
    if (!verified && Object.keys(data.vulnerabilities).length) failures.push('No advisory acceptance without complete source and independent review verification: ' + scope)
  } catch (error) {
    failures.push('Full audit invalid for ' + scope + ': ' + error.message)
  }
}

await writeFile(artifactPath(root, 'raw-audits.json'), JSON.stringify(rawAudits, null, 2) + '\n')
await writeFile(artifactPath(root, 'reviewed-source-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), registryAuditCompletedAndValid: validAuditScopes === 1, registryAuditIsClean: validAuditScopes === 1 && zeroFindingScopes === 1, sourceReports, failures }, null, 2) + '\n')
await writeFile(artifactPath(root, 'dependency-inventory.json'), `${JSON.stringify({
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
    observedRegistryAdvisories: [...observedAdvisories].sort(),
  },
}, null, 2)}\n`)

if (failures.length > 0) {
  console.error(`Supply-chain gate failed with ${failures.length} finding(s).`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Supply-chain gate passed: ${Object.keys(lock.packages || {}).length - 1} locked package entries, ${lifecycle.length} approved install lifecycle entries, ${remoteImports.length} pinned remote import, ${observedAdvisories.size} registry advisories accepted only against verified temporary source remediation. Raw audit findings and exit statuses remain visible.`)
}
