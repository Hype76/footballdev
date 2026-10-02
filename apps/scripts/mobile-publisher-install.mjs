import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publisherTreeDigest, publisherInvocation } from './mobile-eas-publisher.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../mobile-publisher')
const npmExecutable = process.env.npm_execpath
if (!npmExecutable || !npmExecutable.endsWith('npm-cli.js')) throw new Error('Run through npm: npm run mobile:publisher:install')
const lockBytes = readFileSync(resolve(root, 'package-lock.json'))
execFileSync(process.execPath, [npmExecutable, 'ci', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund'], {stdio: 'inherit'})
if (!lockBytes.equals(readFileSync(resolve(root, 'package-lock.json')))) throw new Error('Publisher lock changed during clean install')
const receipt = {lockSha256: createHash('sha256').update(lockBytes).digest('hex'), artifactSha256: publisherTreeDigest(root), platform: process.platform, arch: process.arch, nodeVersion: process.version, installLifecycleScriptsExecuted: false}
writeFileSync(resolve(root, '.install-receipt.json'), JSON.stringify(receipt, null, 2) + '\n')
publisherInvocation(['whoami']) // verifies the installation without invoking EAS or changing credentials
console.log(JSON.stringify(receipt))
