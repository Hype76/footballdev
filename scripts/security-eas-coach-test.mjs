import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { hash, loadRecord, verifyCopies, verifyInstallation, verifyReviewBytes, verifySource } from './security-verify-reviewed-backports.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselineRepository = 'https://github.com/Hype76/footballdev.git'

export function assertGeneratedPaths(paths, platform, allowSigningFiles = false) {
  assert.ok(['android', 'ios'].includes(platform), 'Unexpected build platform')
  const prefix = `apps/coach-mobile/${platform}/`
  for (const name of paths) {
    const signingFile = allowSigningFiles && platform === 'android' && (name === 'credentials.json' || /^keystore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name))
    assert.ok(signingFile || (name.startsWith(prefix) && !name.includes('\\') && !name.split('/').includes('..')), `Unexpected generated path: ${name}`)
  }
}

export function assertAndroidSigningFiles(repoRoot) {
  const names = fs.readdirSync(repoRoot).filter(name => name === 'credentials.json' || /^keystore-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name))
  assert.equal(names.length, 2, 'Expected two Android signing files')
  assert.ok(names.includes('credentials.json'), 'Android credentials file missing')
  for (const name of names) {
    const stat = fs.lstatSync(path.join(repoRoot, name))
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Android signing file is not a regular file')
  }
}

export function readTrustedReview(env) {
  const parts = [env.FP_COACH_QA_REVIEW_GZIP_1, env.FP_COACH_QA_REVIEW_GZIP_2]
  assert.ok(parts.every(value => typeof value === 'string' && value.length > 0 && value.length <= 5000), 'Protected review receipt parts required')
  const encoded = parts.join('')
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid review receipt encoding')
  const compressed = Buffer.from(encoded, 'base64')
  assert.equal(compressed.toString('base64'), encoded, 'Noncanonical review receipt')
  const bytes = gunzipSync(compressed, { maxOutputLength: 65536 })
  assert.match(env.FP_COACH_QA_REVIEW_SHA256 || '', /^[a-f0-9]{64}$/, 'Protected review identity required')
  assert.equal(hash(bytes), env.FP_COACH_QA_REVIEW_SHA256, 'Review receipt identity mismatch')
  return bytes
}

export function assertEasIdentity(env, nodeVersion = process.versions.node) {
  assert.equal(env.EAS_BUILD, 'true')
  assert.equal(env.EAS_BUILD_RUNNER, 'eas-build')
  assert.equal(env.EAS_BUILD_PROJECT_ID, '347965b1-f32f-47b1-8c86-7aa910fe2cb5')
  assert.equal(env.EAS_BUILD_PROFILE, 'store-live')
  assert.equal(env.FP_COACH_QA_SCOPE, 'FP-COACH-OFFLINE-15MB-20261102')
  assert.equal(nodeVersion, '22.17.0', 'Coach test builds require the pinned Node version')
  assert.match(env.EAS_BUILD_ID || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  assert.match(env.EAS_BUILD_GIT_COMMIT_HASH || '', /^[0-9a-f]{40}$/)
  assert.ok(['android', 'ios'].includes(env.EAS_BUILD_PLATFORM))
}

function git(...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
}

export function assertPristineInputs(repoRoot) {
  for (const name of ['node_modules', 'apps/parent-mobile/node_modules', 'apps/coach-mobile/node_modules', 'apps/coach-mobile/android', 'apps/coach-mobile/ios', 'apps/coach-mobile/.expo', 'apps/coach-mobile/dist-web-check']) {
    let present = true
    try { fs.lstatSync(path.join(repoRoot, name)) } catch (error) { if (error.code === 'ENOENT') present = false; else throw error }
    assert.ok(!present, `Unexpected pre-existing build input: ${name}`)
  }
}

function fileDigest(file) {
  const digest = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024), fd = fs.openSync(file, 'r')
  try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, n)) } finally { fs.closeSync(fd) }
  return digest.digest('hex')
}

export function nativeInventory(directory, repoRoot, prefix = '') {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name), relative = prefix ? `${prefix}/${name}` : name, stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(file), inside = path.relative(repoRoot, target)
      assert.ok(inside && !inside.startsWith('..' + path.sep) && !path.isAbsolute(inside), 'Native input link escapes the reviewed workspace')
      return [{ path: relative, type: 'link', target: fs.readlinkSync(file) }]
    }
    assert.ok(stat.isDirectory() || stat.isFile(), 'Unexpected native input type')
    return stat.isDirectory() ? nativeInventory(file, repoRoot, relative) : [{ path: relative, type: 'file', bytes: stat.size, sha256: fileDigest(file) }]
  })
}

export function findArtifacts(directory, extension) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name), stat = fs.lstatSync(file)
    if (stat.isSymbolicLink()) return []
    return stat.isDirectory() ? findArtifacts(file, extension) : stat.isFile() && file.endsWith(extension) ? [file] : []
  })
}

export function assertNativeInputsUnchanged(directory, repoRoot, items) {
  assert.ok(Array.isArray(items) && items.length > 0, 'Native input inventory missing')
  for (const item of items) {
    assert.ok(item.path && !item.path.includes('\\') && !item.path.split('/').includes('..') && !path.isAbsolute(item.path), 'Unsafe native input path')
    const components = item.path.split('/')
    let parent = directory
    for (const component of components.slice(0, -1)) {
      parent = path.join(parent, component)
      const parentStat = fs.lstatSync(parent)
      assert.ok(parentStat.isDirectory() && !parentStat.isSymbolicLink(), 'Native input parent changed')
    }
    const file = path.join(directory, item.path), stat = fs.lstatSync(file)
    if (item.type === 'link') {
      assert.ok(stat.isSymbolicLink(), 'Native input link changed')
      const target = fs.realpathSync(file), inside = path.relative(repoRoot, target)
      assert.ok(inside && !inside.startsWith('..' + path.sep) && !path.isAbsolute(inside), 'Native input link escapes the reviewed workspace')
      assert.equal(fs.readlinkSync(file), item.target, 'Native input link changed')
    } else {
      assert.equal(item.type, 'file')
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Native input file changed')
      assert.equal(stat.size, item.bytes, `Native input size changed: ${item.path}`)
      assert.equal(fileDigest(file), item.sha256, `Native input content changed: ${item.path}`)
    }
  }
}

export function runEasSecurityGate(mode, env = process.env) {
  assertEasIdentity(env)
  const bytes = readTrustedReview(env)
  const { record } = loadRecord(root)
  assert.equal(git('rev-parse', 'HEAD'), env.EAS_BUILD_GIT_COMMIT_HASH, 'EAS checkout differs from the submitted commit')
  if (mode === 'preflight') {
    // EAS archives can contain an empty index; reset only the index, never worktree files.
    git('reset', '--mixed', 'HEAD')
    try { git('cat-file', '-e', `${record.baseline}^{commit}`) } catch {
      git('fetch', '--no-tags', '--depth=1', baselineRepository, record.baseline)
    }
    const source = verifySource(root, record)
    verifyReviewBytes(root, record, source, bytes, env.FP_COACH_QA_REVIEW_SHA256)
    assertPristineInputs(root)
    assert.equal(git('ls-files', '--others', '--ignored', '--exclude-standard', '-z'), '', 'Ignored files present in the source archive')
    return { head: source.head }
  }
  assert.ok(['provision', 'verify', 'capture', 'finalize'].includes(mode), 'Unknown EAS security gate mode')
  const source = { head: env.EAS_BUILD_GIT_COMMIT_HASH }
  const review = verifyReviewBytes(root, record, source, bytes, env.FP_COACH_QA_REVIEW_SHA256)
  if (mode === 'provision') {
    verifySource(root, record)
    execFileSync('npm', ['run', 'security:provision', '--', '--install-mobile'], {
      cwd: root, stdio: 'inherit', env: { ...env, FOOTBALL_REVIEW_RECEIPT_BASE64: bytes.toString('base64'), FOOTBALL_REVIEW_RECEIPT_SHA256: env.FP_COACH_QA_REVIEW_SHA256 },
    })
  }
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)
  const signingInjected = env.EAS_BUILD_PLATFORM === 'android' && ['capture', 'finalize'].includes(mode)
  assertGeneratedPaths(untracked, env.EAS_BUILD_PLATFORM, signingInjected)
  if (signingInjected) assertAndroidSigningFiles(root)
  const copies = verifyCopies(root, record)
  verifyInstallation(root, record, source, copies, review)
  const evidence = { buildId: env.EAS_BUILD_ID, head: source.head, platform: env.EAS_BUILD_PLATFORM, reviewSha256: env.FP_COACH_QA_REVIEW_SHA256, recordSha256: hash(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json'))), copies: copies.map(({ relative, treeSha256 }) => ({ path: relative, treeSha256 })) }
  const evidenceDir = path.join(root, '.security-artifacts')
  const nativeEvidence = path.join(evidenceDir, 'eas-coach-native-inputs.json')
  const nativeManifest = path.join(evidenceDir, 'eas-coach-native-inputs-private.json')
  if (mode === 'capture') {
    const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/coach-mobile/package.json')))
    const eas = JSON.parse(fs.readFileSync(path.join(root, 'apps/coach-mobile/eas.json')))
    const appConfig = createRequire(import.meta.url)(path.join(root, 'apps/coach-mobile/app.config.js')).expo
    assert.equal(app.version, '1.1.2')
    assert.equal(appConfig.version, '1.1.2')
    assert.equal(appConfig.runtimeVersion?.policy, 'appVersion')
    assert.equal(appConfig.ios?.bundleIdentifier, 'com.footballplayer.coach')
    assert.equal(appConfig.android?.package, 'com.footballplayer.coach')
    assert.equal(appConfig.extra?.eas?.projectId, env.EAS_BUILD_PROJECT_ID)
    assert.equal(eas.build['store-live'].channel, 'production')
    const nativeDir = path.join(root, 'apps/coach-mobile', env.EAS_BUILD_PLATFORM)
    const items = nativeInventory(nativeDir, root)
    assert.ok(items.length > 0, 'Native inputs are missing')
    fs.writeFileSync(nativeEvidence, JSON.stringify({ buildId: env.EAS_BUILD_ID, head: source.head, platform: env.EAS_BUILD_PLATFORM, runtime: app.version, channel: 'production', count: items.length, sha256: hash(Buffer.from(JSON.stringify(items))) }) + '\n')
    fs.writeFileSync(nativeManifest, JSON.stringify(items))
  }
  if (mode === 'finalize') {
    const native = JSON.parse(fs.readFileSync(nativeEvidence))
    assert.equal(native.buildId, env.EAS_BUILD_ID)
    assert.equal(native.head, source.head)
    assert.equal(native.platform, env.EAS_BUILD_PLATFORM)
    const nativeDir = path.join(root, 'apps/coach-mobile', env.EAS_BUILD_PLATFORM)
    const items = JSON.parse(fs.readFileSync(nativeManifest))
    assert.equal(hash(Buffer.from(JSON.stringify(items))), native.sha256, 'Native input inventory changed')
    assertNativeInputsUnchanged(nativeDir, root, items)
    const artifacts = findArtifacts(path.join(nativeDir, 'build'), env.EAS_BUILD_PLATFORM === 'ios' ? '.ipa' : '.aab')
      .concat(env.EAS_BUILD_PLATFORM === 'android' ? findArtifacts(path.join(nativeDir, 'app/build/outputs'), '.aab') : [])
    assert.equal(artifacts.length, 1, 'Expected one finished store artifact')
    evidence.nativeInputs = native
    evidence.artifact = { name: path.basename(artifacts[0]), sha256: fileDigest(artifacts[0]) }
    fs.writeFileSync(path.join(evidenceDir, 'eas-coach-test-verification.json'), JSON.stringify(evidence, null, 2) + '\n')
    console.log(`FP_COACH_QA_SECURITY_EVIDENCE=${JSON.stringify(evidence)}`)
  }
  return evidence
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Choose one EAS security gate mode')
  const result = runEasSecurityGate(process.argv[2])
  console.log(`Coach internal build security ${process.argv[2]} passed for ${result.head}.`)
}
