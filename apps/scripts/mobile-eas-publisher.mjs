import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const publisherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../mobile-publisher')
export function publisherTreeDigest(root) {
  const hash = createHash('sha256')
  function visit(path) {
    for (const name of readdirSync(path).sort()) {
      const item = resolve(path, name), stats = lstatSync(item), label = relative(root, item).replaceAll('\\', '/')
      if (stats.isSymbolicLink()) {
        const target = relative(resolve(root, 'node_modules'), realpathSync(item))
        if (target.startsWith('..') || isAbsolute(target)) throw new Error('Publisher link escapes installed artifact')
        hash.update(`${label}\0link\0${readlinkSync(item)}\n`)
      }
      else if (stats.isDirectory()) visit(item)
      else hash.update(`${label}\0${createHash('sha256').update(readFileSync(item)).digest('hex')}\n`)
    }
  }
  visit(resolve(root, 'node_modules'))
  return hash.digest('hex')
}
export function publisherInvocation(args) {
  if (!['whoami', 'env:exec', 'update'].includes(args[0])) throw new Error('This reviewed publisher adapter permits only whoami, env:exec and update')
  const installation = verifyPublisherInstallation(publisherRoot)
  return {command: process.execPath, args: [resolve(publisherRoot, 'node_modules/eas-cli/bin/run'), ...args], ...installation}
}
export function verifyPublisherInstallation(publisherRoot) {
  const lock = JSON.parse(readFileSync(resolve(publisherRoot, 'package-lock.json')))
  if (lock.packages[''].dependencies['eas-cli'] !== '24.8.0' || lock.packages['node_modules/eas-cli'].version !== '24.8.0') throw new Error('Publisher version differs from reviewed lock')
  const installed = JSON.parse(readFileSync(resolve(publisherRoot, 'node_modules/.package-lock.json')))
  for (const [path, entry] of Object.entries(installed.packages)) {
    const expected = lock.packages[path]
    if (!expected || expected.version !== entry.version || expected.integrity !== entry.integrity) throw new Error(`Publisher installed graph differs from lock: ${path}`)
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue
    const packagePath = resolve(publisherRoot, path, 'package.json')
    if (!existsSync(packagePath)) {
      if (entry.optional) continue
      throw new Error(`Publisher clean install is incomplete: ${path}`)
    }
    if (JSON.parse(readFileSync(packagePath)).version !== entry.version || !installed.packages[path]) throw new Error(`Publisher package differs from lock: ${path}`)
  }
  const executable = resolve(publisherRoot, 'node_modules/eas-cli/bin/run')
  if (!existsSync(executable)) throw new Error('Run npm ci --prefix apps/mobile-publisher --ignore-scripts before the guarded EAS command')
  const lockSha256 = createHash('sha256').update(readFileSync(resolve(publisherRoot, 'package-lock.json'))).digest('hex')
  const receipt = JSON.parse(readFileSync(resolve(publisherRoot, '.install-receipt.json')))
  const artifactSha256 = publisherTreeDigest(publisherRoot)
  if (receipt.lockSha256 !== lockSha256 || receipt.artifactSha256 !== artifactSha256 || receipt.platform !== process.platform || receipt.arch !== process.arch || receipt.nodeVersion !== process.version) throw new Error('Publisher installation receipt mismatch; reinstall using mobile-publisher-install.mjs')
  return {lockSha256, artifactSha256}
}
