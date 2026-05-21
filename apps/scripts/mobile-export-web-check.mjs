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
  console.log(`Running ${app.label} web export check...`)

  const result = spawnSync('npm', ['run', 'export:web'], {
    cwd: app.cwd,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`${app.label} web export check failed.`)
    process.exit(result.status || 1)
  }
}

console.log('Mobile web export checks passed.')
