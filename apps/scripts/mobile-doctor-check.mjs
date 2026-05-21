import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const apps = [
  {
    label: 'Coach mobile',
    cwd: join(repoRoot, 'apps/coach-mobile'),
  },
  {
    label: 'Parents mobile',
    cwd: join(repoRoot, 'apps/parent-mobile'),
  },
]

for (const app of apps) {
  console.log(`Running ${app.label} Expo Doctor...`)

  const result = spawnSync('npm', ['run', 'doctor'], {
    cwd: app.cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`${app.label} Expo Doctor failed.`)
    process.exit(result.status || 1)
  }
}

console.log('Mobile Expo Doctor checks passed.')
