import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const textHash = (bytes) => hash(Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n')))
const implementationFiles = [
  'scripts/security-supply-chain-gate.mjs', 'scripts/security-apply-reviewed-backports.mjs',
  'scripts/security-verify-reviewed-backports.mjs', 'security/patches/braces-3.0.3.patch',
  'security/patches/node-forge-1.4.0.patch', 'security/patches/reviewed-source-manifest.json',
  'tests/security-reviewed-backports.test.mjs',
]
const safe = (root, relative) => {
  assert.ok(relative && !relative.includes('\\') && !relative.split('/').includes('..') && !path.isAbsolute(relative), 'Unsafe relative path')
  const file = path.join(root, relative)
  const resolved = fs.realpathSync(file)
  assert.equal(resolved.toLowerCase(), path.resolve(file).toLowerCase(), `Linked path forbidden: ${relative}`)
  assert.ok(!fs.lstatSync(file).isSymbolicLink(), `Linked path forbidden: ${relative}`)
  return file
}
export function artifactPath(root, name) {
  assert.match(name, /^[a-z][a-z0-9-]*\.json$/, 'Unsafe artifact filename')
  const directory = path.join(root, '.security-artifacts')
  if (!fs.existsSync(directory)) fs.mkdirSync(directory)
  safe(root, '.security-artifacts')
  const file = path.join(directory, name)
  if (fs.existsSync(file)) safe(root, '.security-artifacts/' + name)
  return file
}
export function inventory(directory) {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file)
    assert.ok(!stat.isSymbolicLink(), 'Package links forbidden')
    assert.ok(stat.isDirectory() || stat.isFile(), 'Unexpected package file type')
    return stat.isDirectory() ? inventory(file).map(x => ({ ...x, path: name + '/' + x.path }))
      : [{ path: name, bytes: stat.size, sha256: hash(fs.readFileSync(file)) }]
  })
}
export function loadRecord(root) {
  const record = JSON.parse(fs.readFileSync(safe(root, 'security/reviewed-source-remediations.json')))
  assert.equal(record.schemaVersion, 1)
  assert.equal(record.baseline, '1f635088b522079c119048e3ca996c93f0e106f1')
  assert.equal(record.expiresAt, '2026-10-11T22:59:59Z')
  assert.match(record.adoptionProposalSha256 || '', /^[a-f0-9]{64}$/)
  assert.equal(hash(Buffer.from(JSON.stringify(record.dependencyRemediation, null, 2) + '\n')), record.dependencyRemediationSha256, 'Dependency remediation pins drift')
  for (const [file, expected] of Object.entries(record.dependencyRemediation.changedSourceHashes)) assert.equal(textHash(fs.readFileSync(safe(root, file))), expected, 'Approved dependency/test source drift: ' + file)
  assert.ok(Date.now() <= Date.parse(record.expiresAt), 'Reviewed backports have expired')
  assert.equal(record.targets.length, 5)
  assert.deepEqual(Object.keys(record.implementationHashes).sort(), [...implementationFiles].sort(), 'Implementation allowlist changed')
  assert.deepEqual(record.targets.map(t => [t.scope, t.packagePath, t.name, t.version]), [
    ['.', 'node_modules/braces', 'braces', '3.0.3'],
    ['apps/parent-mobile', 'node_modules/braces', 'braces', '3.0.3'],
    ['apps/parent-mobile', 'node_modules/node-forge', 'node-forge', '1.4.0'],
    ['apps/coach-mobile', 'node_modules/braces', 'braces', '3.0.3'],
    ['apps/coach-mobile', 'node_modules/node-forge', 'node-forge', '1.4.0'],
  ], 'Exact reviewed copy/version scope changed')
  assert.deepEqual(record.eligibleAdvisories, { braces: ['GHSA-vfj7-8cjw-p6xm'], 'node-forge': ['GHSA-86w9-cpqp-85rv'] })
  for (const t of record.targets) {
    const trees = t.name === 'braces'
      ? ['ac0f50ef3e9a557dccb4805fc6bb0c8bf9b9502783b7d5baed4c9c8c55cd91a4', 'b024f34af0a56743116dec3c1da981519a0744e9dffe0dd1d31fecc1c0a50c77']
      : ['078e10a11e2520deed99274a0ecf33560c3a728a55bd30dfe7e810955dd0926d', 'f97be7606683a2feba1f78317c4a8c13edba053d33df61396270efabb31e6adf']
    assert.deepEqual([t.originalTreeSha256, t.patchedTreeSha256], trees, 'Reviewed package-tree identities changed')
  }
  const expectedPatches = {
    'patches/braces-3.0.3.patch': 'e07abe26dbd330daea0e448ca1382327322dd5eccc08c5dd1a9b9f7bf5a6d699',
    'patches/node-forge-1.4.0.patch': '2de065ac998bf58917a14d0935112d97ec2957ac41b5f06958d500934f188ed4',
  }
  assert.deepEqual(Object.fromEntries(record.patches.map(p => [p.file, p.sha256])), expectedPatches)
  for (const p of record.patches) assert.equal(hash(fs.readFileSync(safe(root, 'security/' + p.file))), p.sha256, 'Patch bytes changed')
  const payloadFile = safe(root, 'security/patches/reviewed-source-manifest.json')
  assert.equal(hash(fs.readFileSync(payloadFile)), record.payloadSha256, 'Reviewed payload drift')
  const payload = JSON.parse(fs.readFileSync(payloadFile))
  assert.equal(payload.qualificationManifestSha256, 'c6b590786dac4bf3ffeeec900f9d3e47e9550f649aa6c5820da83b3a64afc47d')
  for (const [file, expected] of Object.entries(record.implementationHashes)) assert.equal(textHash(fs.readFileSync(safe(root, file))), expected, `Implementation drift: ${file}`)
  for (const item of record.nativeInputs) assert.equal(textHash(fs.readFileSync(safe(root, item.path))), item.normalisedUtf8Sha256, `Native/dependency input drift: ${item.path}`)
  return { record, payload }
}
export function verifySource(root, record) {
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, ...args], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim()
  const allowed = new Set([...Object.keys(record.implementationHashes), 'security/reviewed-source-remediations.json'])
  const changed = git('diff', '--name-only', record.baseline).split('\n').filter(Boolean)
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
  for (const file of [...changed, ...untracked]) {
    if (untracked.includes(file) && /^(?:output|\.security-artifacts|\.netlify)\//.test(file)) continue
    assert.ok(allowed.has(file), `Unapproved source change: ${file}`)
  }
  return { head: git('rev-parse', 'HEAD'), changed }
}
function discover(root, scope) {
  const copies = []
  const walk = (relative) => {
    const dir = safe(root, relative)
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.startsWith('.')) continue
      if (name.startsWith('@')) {
        const namespace = safe(root, relative + '/' + name)
        for (const child of fs.readdirSync(namespace).sort()) visit(relative + '/' + name + '/' + child)
      } else visit(relative + '/' + name)
    }
  }
  const visit = relative => {
    const dir = safe(root, relative)
    assert.ok(fs.statSync(dir).isDirectory(), 'Unexpected dependency entry')
    const metadata = path.join(dir, 'package.json')
    if (fs.existsSync(metadata)) {
      const pkg = JSON.parse(fs.readFileSync(metadata))
      if (['braces', 'node-forge'].includes(pkg.name)) copies.push({ scope, packagePath: path.relative(path.resolve(root, scope), dir).replaceAll('\\', '/'), name: pkg.name, version: pkg.version })
    }
    if (fs.existsSync(path.join(dir, 'node_modules'))) walk(relative + '/node_modules')
  }
  walk((scope === '.' ? '' : scope + '/') + 'node_modules')
  return copies
}
export function verifyCopies(root, record, mode = 'patched') {
  const scopes = ['.', 'apps/parent-mobile', 'apps/coach-mobile']
  const expected = record.targets.map(({ scope, packagePath, name, version }) => ({ scope, packagePath, name, version }))
  const actual = scopes.flatMap(scope => discover(root, scope))
  const sort = items => items.map(x => JSON.stringify(x)).sort()
  assert.deepEqual(sort(actual), sort(expected), 'Physical affected-copy set differs from reviewed five copies')
  const locks = new Map()
  for (const item of record.scopeLocks) {
    const scope = item.scope === 'root' ? '.' : item.scope
    const file = safe(root, (scope === '.' ? '' : scope + '/') + 'package-lock.json')
    const bytes = fs.readFileSync(file)
    assert.equal(textHash(bytes), item.normalisedUtf8Sha256, `Lock drift: ${scope}`)
    locks.set(scope, JSON.parse(bytes))
  }
  return record.targets.map(target => {
    const relative = (target.scope === '.' ? '' : target.scope + '/') + target.packagePath
    const dir = safe(root, relative)
    const entry = locks.get(target.scope).packages[target.packagePath]
    assert.equal(entry.version, target.version, 'Locked version drift')
    assert.equal(entry.integrity, target.registryIntegrity, 'Registry integrity drift')
    assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), 'Unapproved registry source')
    const treeSha256 = hash(Buffer.from(JSON.stringify(inventory(dir))))
    assert.ok(treeSha256 === target.patchedTreeSha256 || (mode === 'install' && treeSha256 === target.originalTreeSha256), `Package tree drift: ${relative}`)
    return { target, relative, dir, treeSha256 }
  })
}
export function verifyReview(root, record, source, trustedReceiptSha256 = process.env.FOOTBALL_REVIEW_RECEIPT_SHA256) {
  const file = artifactPath(root, 'implementation-review.json')
  // This pin is supplied by the trusted caller from the independent review result.
  // A self-authored local receipt, by itself, never authorises acceptance.
  assert.match(trustedReceiptSha256 || '', /^[a-f0-9]{64}$/, 'Trusted independent-review receipt SHA256 is required')
  const bytes = fs.readFileSync(file)
  assert.equal(hash(bytes), trustedReceiptSha256, 'Independent-review receipt is not the externally approved identity')
  const review = JSON.parse(bytes)
  assert.equal(review.status, 'ACCEPTED_LOCAL_IMPLEMENTATION')
  assert.ok(review.reviewer && review.reviewedAt)
  assert.equal(review.head, source.head, 'Independent review is not for this exact HEAD')
  assert.equal(review.recordSha256, hash(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json'))), 'Review record drift')
  assert.equal(review.proposalSha256, record.adoptionProposalSha256, 'Review proposal identity mismatch')
  assert.equal(review.dependencyRemediationSha256, record.dependencyRemediationSha256, 'Review dependency-remediation identity mismatch')
  assert.equal(review.payloadSha256, record.payloadSha256, 'Review payload identity mismatch')
  assert.deepEqual(review.implementationHashes, record.implementationHashes, 'Review implementation identity mismatch')
  assert.deepEqual(review.nativeInputs, record.nativeInputs, 'Review native input identity mismatch')
  assert.equal(review.expiresAt, record.expiresAt, 'Review expiry mismatch')
  assert.ok(Date.parse(review.reviewedAt) <= Date.now(), 'Invalid review date')
  const dirty = execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, '-C', root, 'diff', 'HEAD', '--name-only'], { encoding: 'utf8' }).trim()
  assert.equal(dirty, '', 'Reviewed HEAD has tracked working changes')
  return review
}
export function verifyInstallation(root, record, source, copies, review) {
  const receipt = JSON.parse(fs.readFileSync(artifactPath(root, 'backport-installation.json')))
  assert.equal(receipt.head, source.head, 'Installation HEAD differs from reviewed HEAD')
  assert.equal(receipt.recordSha256, hash(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json'))), 'Installation record drift')
  assert.equal(receipt.installerSha256, record.implementationHashes['scripts/security-apply-reviewed-backports.mjs'], 'Installation used a different installer')
  assert.deepEqual(receipt.patches, record.patches, 'Installation patch identity drift')
  assert.deepEqual(receipt.copies, copies.map(({ relative, treeSha256 }) => ({ relative, treeSha256 })), 'Installation copy identity drift')
  assert.ok(Date.parse(receipt.installedAt) >= Date.parse(review.reviewedAt) && Date.parse(receipt.installedAt) <= Date.now(), 'Installation receipt is stale or invalid')
  assert.equal(receipt.publicationApproved, false)
  return receipt
}
export async function verifyUpstream(record, payload) {
  const get = async url => {
    const response = await fetch(url, { headers: { 'User-Agent': 'Football-local-security-verification', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(20000) })
    assert.ok(response.ok, `Official upstream lookup failed: ${response.status}`)
    return response.json()
  }
  const receipts = []
  for (const snapshot of payload.advisories) {
    const current = await get('https://api.github.com/advisories/' + snapshot.ghsaId)
    const semantic = { ghsaId: current.ghsa_id, cveId: current.cve_id, severity: current.severity, summary: current.summary, description: current.description, vulnerabilities: current.vulnerabilities, references: current.references, withdrawnAt: current.withdrawn_at }
    for (const field of Object.keys(semantic)) assert.deepEqual(semantic[field], snapshot[field], `Advisory meaning changed: ${snapshot.ghsaId}/${field}`)
    receipts.push({ type: 'advisory', id: current.ghsa_id, updatedAt: current.updated_at, semanticSha256: hash(Buffer.from(JSON.stringify(semantic))) })
  }
  for (const source of Object.values(record.sourceRevisions)) {
    const current = await get(`https://api.github.com/repos/${source.repository}/pulls/${source.number}`)
    assert.equal(current.head.sha, source.headSha, 'Upstream patch revision changed')
    assert.equal(current.state, source.state, 'Upstream patch status changed; replacement review required')
    assert.equal(current.merged, source.merged, 'Upstream merge changed; replacement review required')
    receipts.push({ type: 'pull-request', url: source.url, head: current.head.sha, state: current.state, merged: current.merged })
  }
  return { checkedAt: new Date().toISOString(), receipts }
}
export function evaluateAudit(audit, lock, scope, record) {
  assert.ok(audit && audit.auditReportVersion === 2 && !audit.error && audit.vulnerabilities && typeof audit.vulnerabilities === 'object' && !Array.isArray(audit.vulnerabilities) && audit.metadata?.vulnerabilities, 'Invalid full audit data')
  const accepted = [], failures = [], observed = new Set()
  const roots = (start) => {
    // npm's Metro findings contain legitimate cross-package cycles. Walk the
    // complete reachable closure once, without dropping any unknown edge.
    const pending = [start], visited = new Set(), leaves = []
    while (pending.length) {
      const name = pending.pop()
      if (visited.has(name)) continue
      visited.add(name)
      const finding = audit.vulnerabilities[name]
      if (!finding || !Array.isArray(finding.via) || !finding.via.length) {
        failures.push(`Missing audit graph entry: ${scope}/${name}`)
        continue
      }
      for (const via of finding.via) {
        if (typeof via === 'string') {
          if (via === name) failures.push(`Self-referencing audit finding: ${scope}/${name}`)
          else pending.push(via)
        } else if (!via || typeof via !== 'object' || Array.isArray(via)) {
          failures.push(`Invalid advisory object: ${scope}/${name}`)
        } else leaves.push({ ...via, owner: name })
      }
    }
    return leaves
  }
  for (const [name, finding] of Object.entries(audit.vulnerabilities)) {
    assert.ok(finding && typeof finding === 'object' && !Array.isArray(finding), 'Invalid finding object')
    assert.ok(Array.isArray(finding.nodes) && Array.isArray(finding.via), 'Invalid finding paths or graph')
    const leaves = roots(name)
    if (!leaves.length || !Array.isArray(finding.nodes) || !finding.nodes.length) failures.push(`Untraceable audit finding: ${scope}/${name}`)
    if (!['info', 'low', 'moderate', 'high', 'critical'].includes(finding.severity)) failures.push(`Invalid finding severity: ${scope}/${name}`)
    for (const node of finding.nodes || []) if (typeof node !== 'string' || !lock.packages[node]) failures.push(`Unknown affected audit path: ${scope}/${node}`)
    for (const leaf of leaves) {
      const id = String(leaf.url || '').match(/GHSA-[a-z0-9-]+/i)?.[0]
      observed.add(id)
      const eligible = record.eligibleAdvisories[leaf.owner] || []
      const leafFinding = audit.vulnerabilities[leaf.owner]
      const paths = leafFinding?.nodes || []
      const covered = paths.length > 0 && paths.every(node => record.targets.some(t => t.scope === scope && t.name === leaf.owner && t.packagePath === node && lock.packages[node]?.version === t.version))
      if (!id || !eligible.includes(id) || leaf.severity !== 'high' || finding.severity !== 'high' || (leaf.name && leaf.name !== leaf.owner) || !covered) failures.push(`Unaccepted advisory: ${scope}/${name}/${id || 'unknown'}`)
      else accepted.push({ scope, package: name, advisory: id, patchedPackage: leaf.owner, affectedPaths: paths })
    }
  }
  const count = Object.keys(audit.vulnerabilities).length
  for (const level of ['info', 'low', 'moderate', 'high', 'critical', 'total']) assert.ok(Number.isInteger(audit.metadata.vulnerabilities[level]) && audit.metadata.vulnerabilities[level] >= 0, 'Invalid audit count schema')
  for (const level of ['info', 'low', 'moderate', 'high', 'critical']) assert.equal(Object.values(audit.vulnerabilities).filter(f => f.severity === level).length, audit.metadata.vulnerabilities[level], 'Audit per-severity counts disagree')
  const metadataCount = ['info', 'low', 'moderate', 'high', 'critical'].reduce((n, level) => n + Number(audit.metadata.vulnerabilities[level] || 0), 0)
  assert.equal(count, metadataCount, 'Audit counts disagree with finding data')
  assert.equal(count, audit.metadata.vulnerabilities.total, 'Audit total disagrees with finding data')
  return { registryCounts: audit.metadata.vulnerabilities, acceptedSourceRemediations: failures.length ? [] : accepted, observedAdvisories: [...observed], failures }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd(), { record, payload } = loadRecord(root)
  const source = verifySource(root, record), copies = verifyCopies(root, record)
  const review = verifyReview(root, record, source), upstream = await verifyUpstream(record, payload)
  const installation = verifyInstallation(root, record, source, copies, review)
  console.log(JSON.stringify({ source, copies: copies.map(({ relative, treeSha256 }) => ({ relative, treeSha256 })), review, installation, upstream }, null, 2))
}
