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

export function assertReviewedFile(file, repoRoot, size, sha256) {
  const stat = fs.lstatSync(file)
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Reviewed archive must be a regular file')
  const relative = path.relative(repoRoot, fs.realpathSync(file))
  assert.ok(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Reviewed archive escapes workspace')
  assert.equal(stat.size, size, 'Reviewed archive size changed')
  assert.equal(fileDigest(file), sha256, 'Reviewed archive content changed')
}

export function assertFrameworkInventory(directory, repoRoot, prefix, expectedSha256, allowLinks = false) {
  const items = nativeInventory(directory, repoRoot, prefix).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  assert.ok(items.length > 0 && items.every(item => item.type === 'file' || (allowLinks && item.type === 'link')), 'Unexpected framework inventory')
  if (allowLinks) for (const item of items.filter(entry => entry.type === 'link')) {
    const target = fs.realpathSync(path.join(directory, item.path))
    const relative = path.relative(directory, target)
    assert.ok(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Framework link escapes its directory')
  }
  assert.equal(hash(Buffer.from(JSON.stringify(items))), expectedSha256, 'Release framework inventory changed')
}

export function codegenDiagnostic(file) {
  const source = fs.readFileSync(file, 'utf8')
  const expression = source.match(/return\s+@\[([\s\S]*?)\];/)
  assert.ok(expression && expression[1].length <= 10000, 'Unexpected generated module list')
  const matches = [...expression[1].matchAll(/@"([A-Za-z_][A-Za-z0-9_]{0,79})"/g)]
  assert.ok(matches.length <= 100 && !expression[1].replace(/@"[A-Za-z_][A-Za-z0-9_]{0,79}"/g, '').replace(/[\s,]/g, ''), 'Unexpected generated module list')
  return { sha256: hash(Buffer.from(source)), modules: matches.map(match => match[1]) }
}

export function prepareIosCodegen(repoRoot, env, fixture) {
  assert.equal(env.EAS_BUILD_PLATFORM, 'ios')
  const app = path.join(repoRoot, 'apps/coach-mobile')
  const ios = path.join(app, 'ios')
  const rn = path.join(app, 'node_modules/react-native')
  const evidenceDir = path.join(repoRoot, '.security-artifacts')
  assert.ok(fs.lstatSync(ios).isDirectory() && !fs.lstatSync(ios).isSymbolicLink(), 'Unsafe iOS project directory')
  assert.equal(fs.realpathSync(ios), path.join(fs.realpathSync(repoRoot), 'apps/coach-mobile/ios'), 'iOS project directory escapes workspace')
  assert.ok(fs.lstatSync(evidenceDir).isDirectory() && !fs.lstatSync(evidenceDir).isSymbolicLink(), 'Unsafe security evidence directory')
  assert.equal(fs.realpathSync(rn), path.join(fs.realpathSync(repoRoot), 'apps/coach-mobile/node_modules/react-native'), 'React Native path escapes workspace')
  const buildDir = path.join(ios, 'build')
  if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir)
  assert.ok(fs.lstatSync(buildDir).isDirectory() && !fs.lstatSync(buildDir).isSymbolicLink(), 'Unsafe iOS build directory')
  const expectedOutput = path.join(buildDir, 'Build/Intermediates.noindex/ArchiveIntermediates/FootballPlayerCoach/IntermediateBuildFilesPath/Pods.build/Release-iphoneos/ReactCodegen.build/DerivedSources/generated/source/codegen/out')
  const scratch = fs.mkdtempSync(path.join(buildDir, 'coach-codegen-'))
  try {
    const results = []
    for (const name of ['first', 'second']) {
      const output = path.join(scratch, ...Array(11).fill('level'), name)
      fs.mkdirSync(output, { recursive: true })
      assert.equal(fs.realpathSync(output), output, 'Codegen replay path escapes workspace')
      assert.equal(path.relative(output, app), path.relative(expectedOutput, app), 'Codegen replay app path differs from observed Xcode path')
      assert.equal(path.relative(output, rn), path.relative(expectedOutput, rn), 'Codegen replay React Native path differs from observed Xcode path')
      if (fixture?.run) fixture.run(output)
      else execFileSync(process.execPath, [path.join(rn, 'scripts/generate-codegen-artifacts.js'), '--path', app, '--outputPath', output, '--targetPlatform', 'ios'], { cwd: rn, stdio: 'inherit', env })
      const items = nativeInventory(output, repoRoot).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      assert.ok(items.length && items.every(item => item.type === 'file' && item.path.startsWith('build/generated/ios/')), 'Unexpected codegen output')
      results.push(items)
    }
    assert.deepEqual(results[0], results[1], 'Codegen output differs between identical runs')
    for (const item of results[0]) {
      const components = item.path.split('/')
      let parent = ios
      for (const part of components.slice(0, -1)) {
        parent = path.join(parent, part)
        if (!fs.existsSync(parent)) fs.mkdirSync(parent)
        const stat = fs.lstatSync(parent)
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Unsafe generated output directory')
      }
      const destination = path.join(ios, item.path)
      try {
        const stat = fs.lstatSync(destination)
        assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Unsafe generated output file')
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      fs.copyFileSync(path.join(scratch, ...Array(11).fill('level'), 'first', item.path), destination)
    }
  } finally {
    assert.equal(path.dirname(scratch), buildDir, 'Unsafe codegen scratch directory')
    assert.ok(path.basename(scratch).startsWith('coach-codegen-') && !fs.lstatSync(scratch).isSymbolicLink(), 'Unsafe codegen scratch directory')
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

export function assertNoIosArchiveOverrides(env) {
  for (const name of ['ENTERPRISE_REPOSITORY', 'RCT_TESTONLY_RNCORE_TARBALL_PATH', 'RCT_TESTONLY_RNCORE_VERSION', 'RCT_USE_LOCAL_RN_DEP', 'RCT_DEPS_VERSION', 'HERMES_ENGINE_TARBALL_PATH', 'REACT_NATIVE_OVERRIDE_HERMES_DIR', 'HERMES_COMMIT', 'HERMES_OVERRIDE_HERMESC_PATH', 'RCT_BUILD_HERMES_FROM_SOURCE']) assert.ok(!Object.hasOwn(env, name), 'Unreviewed React Native archive override')
}

export function prepareIosReleaseFrameworks(repoRoot, env, fixture) {
  assert.equal(env.EAS_BUILD_PLATFORM, 'ios')
  assertNoIosArchiveOverrides(env)
  const pods = path.join(repoRoot, 'apps/coach-mobile/ios/Pods')
  const rn = path.join(repoRoot, 'apps/coach-mobile/node_modules/react-native')
  assert.equal(JSON.parse(fs.readFileSync(path.join(rn, 'package.json'))).version, '0.81.5')
  // These exact Maven Central 0.81.5 release archives were independently
  // inspected for unsafe paths, duplicate names and escaping hard links.
  const archives = fixture?.archives || [
    ['ReactNativeCore-artifacts/reactnative-core-0.81.5-release.tar.gz', 27595635, 'd60f971fd81c64086e5ea0ed7100b1e72ce4cbea733bf4a40dcafc2086548446'],
    ['ReactNativeDependencies-artifacts/reactnative-dependencies-0.81.5-release.tar.gz', 10474526, '702dfc90aed09da439b37c6f15266643259c198fed5c0052e23439680e362b5d'],
    ['hermes-engine-artifacts/hermes-ios-0.81.5-release.tar.gz', 21342402, '4300c010d756c1d939e8bd8402fc28b70cad070c744ca2ed9059961fe067b512'],
  ]
  for (const [name, size, digest] of archives) assertReviewedFile(path.join(pods, name), repoRoot, size, digest)
  for (const marker of ['React-Core-prebuilt/.last_build_configuration', 'ReactNativeDependencies/.last_build_configuration', '.last_build_configuration']) assert.ok(!fs.existsSync(path.join(pods, marker)), 'Unexpected prior framework configuration')
  for (const script of ['scripts/replace-rncore-version.js', 'third-party-podspecs/replace_dependencies_version.js', 'sdks/hermes-engine/utils/replace_hermes_version.js']) {
    execFileSync(process.execPath, [path.join(rn, script), '-c', 'Release', '-r', '0.81.5', '-p', pods], { cwd: pods, stdio: 'inherit', env })
  }
  for (const [name, size, digest] of archives) assertReviewedFile(path.join(pods, name), repoRoot, size, digest)
  for (const marker of ['React-Core-prebuilt/.last_build_configuration', 'ReactNativeDependencies/.last_build_configuration', '.last_build_configuration']) assert.equal(fs.readFileSync(path.join(pods, marker), 'utf8'), 'Release', 'Framework release marker missing')
  assertFrameworkInventory(path.join(pods, 'React-Core-prebuilt/React.xcframework'), repoRoot, 'React.xcframework', fixture?.coreInventory || '360aaf50a7ef7caa3e9b3df0bb49ccf7352d3708c29a7902fbddf94fc4348e6f')
  assertFrameworkInventory(path.join(pods, 'ReactNativeDependencies/framework'), repoRoot, '', fixture?.depsInventory || '2d76f99cf3953b9bf46e399ff572fe7793e2d6453232093e794e89b228f96824')
  assertFrameworkInventory(path.join(pods, 'hermes-engine'), repoRoot, '', fixture?.hermesInventory || '7508fdb9f2e47f20c691477e1e88c40ee50e949359124c9beca660421214e63f', true)
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
  if (env.EAS_BUILD_PLATFORM === 'ios') assertNoIosArchiveOverrides(env)
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
  assert.ok(['provision', 'verify', 'prepare-ios', 'prepare-codegen', 'capture', 'finalize'].includes(mode), 'Unknown EAS security gate mode')
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
  const codegenEvidence = path.join(evidenceDir, 'eas-coach-codegen-diagnostic.json')
  if (mode === 'prepare-ios') prepareIosReleaseFrameworks(root, env)
  if (mode === 'prepare-codegen') prepareIosCodegen(root, env)
  if (mode === 'capture') {
    if (env.EAS_BUILD_PLATFORM === 'ios') fs.writeFileSync(codegenEvidence, JSON.stringify(codegenDiagnostic(path.join(root, 'apps/coach-mobile/ios/build/generated/ios/RCTUnstableModulesRequiringMainQueueSetupProvider.mm'))))
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
    if (env.EAS_BUILD_PLATFORM === 'ios') {
      const before = JSON.parse(fs.readFileSync(codegenEvidence))
      const after = codegenDiagnostic(path.join(root, 'apps/coach-mobile/ios/build/generated/ios/RCTUnstableModulesRequiringMainQueueSetupProvider.mm'))
      if (before.sha256 !== after.sha256) console.log(`FP_COACH_CODEGEN_DIAGNOSTIC=${JSON.stringify({ before, after })}`)
    }
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
