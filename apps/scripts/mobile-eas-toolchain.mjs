import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function prepareStoreToolchain({ profile = process.env.EAS_BUILD_PROFILE, nodeVersion = process.versions.node, run = args => execFileSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32' }) } = {}) {
  if (profile !== 'store-live') return
  assert.equal(nodeVersion, '22.17.0', 'Store builds require Node22.17.0')
  if (run(['--version']).trim() !== '11.7.0') run(['install', '--global', 'npm@11.7.0', '--no-audit', '--no-fund'])
  assert.equal(run(['--version']).trim(), '11.7.0', 'Store builds require npm11.7.0 before clean install')
  console.log('Store toolchain verified: Node22.17.0, npm11.7.0. Standard EAS clean install follows.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) prepareStoreToolchain()
