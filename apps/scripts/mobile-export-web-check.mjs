import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileApps } from './mobile-apps.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function assertExportFile(app, relativePath) {
  const filePath = join(repoRoot, app.path, 'dist-web-check', relativePath)

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    console.error(`${app.label} web export is missing ${relativePath}.`)
    process.exit(1)
  }
}

function assertExportDirectoryHasFiles(app, relativePath) {
  const directoryPath = join(repoRoot, app.path, 'dist-web-check', relativePath)

  if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
    console.error(`${app.label} web export is missing ${relativePath}.`)
    process.exit(1)
  }

  if (readdirSync(directoryPath, { recursive: true }).length === 0) {
    console.error(`${app.label} web export has an empty ${relativePath} directory.`)
    process.exit(1)
  }
}

for (const app of mobileApps) {
  console.log(`Running ${app.label} web export check...`)

  const result = spawnSync('npm', ['run', 'export:web'], {
    cwd: join(repoRoot, app.path),
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`${app.label} web export check failed.`)
    process.exit(result.status || 1)
  }

  assertExportFile(app, 'index.html')
  assertExportFile(app, 'metadata.json')
  assertExportDirectoryHasFiles(app, '_expo')
  assertExportDirectoryHasFiles(app, 'assets')
}

console.log('Mobile web export checks passed.')
