import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const checks = [
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'build']],
  ['npm', ['run', 'mobile:config']],
  ['npm', ['run', 'mobile:prestore']],
  ['npm', ['run', 'mobile:doctor']],
  ['npm', ['run', 'mobile:export:web']],
  ['git', ['diff', '--check']],
]

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
}

console.log('Mobile release checks passed.')
