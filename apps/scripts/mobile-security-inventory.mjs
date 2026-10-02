import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, realpathSync, lstatSync, writeFileSync } from 'node:fs'
import { resolve, relative, basename, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const auditRoots = ['brace-expansion', 'image-size', 'js-yaml', 'node-forge', 'undici']

export function sourcePaths(map) {
  if (Array.isArray(map.sections)) {
    if (map.sections.length === 0) throw new Error('Source map has no module inventory')
    return map.sections.flatMap(({ map: child }) => sourcePaths(child))
  }
  if (!Array.isArray(map.sources) || map.sources.length === 0) throw new Error('Source map has no module inventory')
  return map.sources.map((source) => `${map.sourceRoot || ''}/${source}`.replaceAll('\\', '/'))
}

export function packageName(source) {
  const remainder = source.split('/node_modules/').at(-1)
  if (remainder === source) return null
  const parts = remainder.split('/')
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function files(path) {
  return readdirSync(path).flatMap((name) => {
    const item = resolve(path, name)
    if (lstatSync(item).isSymbolicLink()) throw new Error('Export may not contain symbolic links')
    return lstatSync(item).isDirectory() ? files(item) : [item]
  })
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function exactSet(actual, expected, label) {
  if (new Set(actual).size !== actual.length || [...actual].sort().join('\n') !== [...expected].sort().join('\n')) {
    throw new Error(`${label} is incomplete, duplicated or unexpected`)
  }
}

function exportPath(root, path) {
  if (typeof path !== 'string' || path.includes('\\') || isAbsolute(path) || path.split('/').some((part) => !part || part === '..' || part === '.')) {
    throw new Error('Invalid export-relative artifact path')
  }
  const target = resolve(root, path)
  let actual
  try { actual = realpathSync(target) } catch { throw new Error(`Missing paired export artifact: ${path}`) }
  if (actual !== target || relative(root, actual).startsWith('..')) throw new Error('Artifact escapes export directory')
  if (!lstatSync(actual).isFile() || lstatSync(actual).size === 0) throw new Error('Export artifact must be a nonempty regular file')
  return actual
}

export function inventory(exportRoot, expected) {
  const root = realpathSync(resolve(exportRoot))
  if (!expected?.manifestPath || !/^[a-f0-9]{64}$/.test(expected.manifestSha256 || '') || !/^[a-f0-9]{40}$/.test(expected.sourceCommit || '') || !expected.runtimeVersion || !expected.appVersion || !['appVersion', 'explicit'].includes(expected.runtimePolicy) || !Array.isArray(expected.platforms) || expected.platforms.length === 0) {
    throw new Error('Trusted manifest hash, expected commit, runtime and platforms are required')
  }
  exactSet(expected.platforms, [...new Set(expected.platforms)], 'Expected platforms')
  if (expected.platforms.some((platform) => !['ios', 'android', 'web'].includes(platform))) throw new Error('Unsupported expected platform')
  const manifestBytes = readFileSync(expected.manifestPath)
  if (sha256(manifestBytes) !== expected.manifestSha256) throw new Error('Trusted manifest hash mismatch')
  const manifest = JSON.parse(manifestBytes)
  if (manifest.schemaVersion !== 1 || manifest.sourceCommit !== expected.sourceCommit) throw new Error('Export source commit mismatch')
  if (manifest.runtimeVersion !== expected.runtimeVersion || manifest.appVersion !== expected.appVersion || manifest.runtimePolicy !== expected.runtimePolicy) throw new Error('Export runtime/appVersion mismatch')
  if (manifest.runtimePolicy === 'appVersion' && manifest.runtimeVersion !== manifest.appVersion) throw new Error('appVersion runtime policy mismatch')
  for (const platform of expected.platforms.filter((p) => p !== 'web')) {
    if (manifest.resolvedRuntimeVersions?.[platform] !== expected.runtimeVersion) throw new Error('Resolved native runtime mismatch')
  }
  if (!Array.isArray(manifest.artifacts)) throw new Error('Missing declared export set')
  exactSet(manifest.artifacts.map((artifact) => artifact.platform), expected.platforms, 'Declared platforms')
  const mapPaths = manifest.artifacts.map((artifact) => artifact.sourceMap)
  const bundlePaths = manifest.artifacts.map((artifact) => artifact.bundle)
  exactSet(files(root).filter((path) => path.endsWith('.map')).map((path) => relative(root, path).replaceAll('\\', '/')), mapPaths, 'Source-map set')
  exactSet(files(resolve(root, '_expo/static/js')).filter((path) => /\.(hbc|js)$/.test(path)).map((path) => relative(root, path).replaceAll('\\', '/')), bundlePaths, 'Bundle set')
  const metadataBytes = readFileSync(resolve(root, 'metadata.json'))
  if (sha256(metadataBytes) !== manifest.metadataSha256) throw new Error('Export metadata hash mismatch')
  const metadata = JSON.parse(metadataBytes)
  for (const platform of expected.platforms.filter((p) => p !== 'web')) {
    if (metadata.fileMetadata?.[platform]?.bundle !== manifest.artifacts.find((a) => a.platform === platform).bundle) throw new Error('Metadata bundle/platform mismatch')
  }
  return manifest.artifacts.map((artifact) => {
    const { platform, bundle: bundlePath, sourceMap, bundleSha256, sourceMapSha256 } = artifact
    if (!new RegExp(`^_expo/static/js/${platform}/[^/]+\\.${platform === 'web' ? 'js' : 'hbc'}$`).test(bundlePath) || sourceMap !== `${bundlePath}.map`) throw new Error('Map/bundle/platform pair mismatch')
    if (!/^[a-f0-9]{64}$/.test(bundleSha256 || '') || !/^[a-f0-9]{64}$/.test(sourceMapSha256 || '')) throw new Error('Missing artifact hash')
    const path = exportPath(root, sourceMap), bundle = exportPath(root, bundlePath)
    const bytes = readFileSync(path)
    const bundleBytes = readFileSync(bundle)
    if (sha256(bytes) !== sourceMapSha256 || sha256(bundleBytes) !== bundleSha256) throw new Error('Map/bundle hash mismatch')
    const map = JSON.parse(bytes)
    if (map.version !== 3 || (map.file && map.file !== basename(bundlePath) && map.file !== bundlePath)) throw new Error('Source-map bundle identity mismatch')
    const sources = [...new Set(sourcePaths(map))].sort()
    const modules = sources.map((source) => {
      const marker = source.lastIndexOf('/node_modules/')
      return marker >= 0 ? source.slice(marker + 1) : source.slice(source.indexOf('/apps/') + 1)
    })
    const packages = [...new Set(sources.map(packageName).filter(Boolean))].sort()
    return {
      platform,
      sourceCommit: manifest.sourceCommit,
      runtimeVersion: platform === 'web' ? null : manifest.runtimeVersion,
      appVersion: manifest.appVersion,
      manifestSha256: expected.manifestSha256,
      sourceMap,
      sourceMapSha256,
      bundle: bundlePath,
      bundleSha256,
      moduleCount: sources.length,
      packages,
      roots: Object.fromEntries(auditRoots.map((name) => [name, { shipped: packages.includes(name), modules: sources.filter((source) => packageName(source) === name).map((source) => source.slice(source.lastIndexOf('/node_modules/') + 1)) }])),
      modules,
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [exportRoot, manifestPath, output, sourceCommit, runtimeVersion, platformList, manifestSha256, appVersion, runtimePolicy] = process.argv.slice(2)
  if (!output) throw new Error('Usage: node apps/scripts/mobile-security-inventory.mjs <export-directory> <manifest.json> <output.json> <expected-commit> <expected-runtime> <expected-platforms-csv> <trusted-manifest-sha256> <expected-appVersion> <expected-runtime-policy>')
  const result = { scope: 'Hash-bound exported JavaScript membership only; does not establish native, publisher or handset safety. Expected inputs and manifest hash must come from trusted export/review evidence.', artifacts: inventory(exportRoot, {manifestPath, manifestSha256, sourceCommit, runtimeVersion, appVersion, runtimePolicy, platforms: platformList?.split(',')}) }
  writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result.artifacts.map(({ sourceMap, moduleCount, roots }) => ({ sourceMap, moduleCount, roots })), null, 2))
}
