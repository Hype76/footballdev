import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const checks = [
  ['npm', ['run', 'mobile:next']],
  ['npm', ['run', 'mobile:build:preflight']],
  ['npm', ['run', 'mobile:store:preflight']],
  ['npm', ['run', 'mobile:submit:preflight']],
]

console.log('Football Player Mobile Release Preflight')
console.log('Status: local checklist only')
console.log('This command does not call EAS, Apple, Google, Netlify, Supabase, or any live service.')
console.log('')

for (const [command, args] of checks) {
  const label = [command, ...args].join(' ')
  console.log(`Running ${label}...`)

  const result = spawnSync(command, args, {
    cwd: repoRoot,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`${label} failed.`)
    process.exit(result.status || 1)
  }

  console.log('')
}

console.log('Mobile release preflight passed.')
