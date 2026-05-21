import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const templatePath = resolve(repoRoot, 'apps/MOBILE_EXTERNAL_RELEASE_EVIDENCE.md')
const evidenceDir = resolve(repoRoot, 'apps/mobile-release-evidence')
const isCheckMode = process.argv.includes('--check')

const today = new Date().toISOString().slice(0, 10)
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim()

const targetPath = resolve(evidenceDir, `${today}-${commit}-external-release-evidence.md`)

if (!existsSync(templatePath)) {
  console.error('Missing apps/MOBILE_EXTERNAL_RELEASE_EVIDENCE.md.')
  process.exit(1)
}

if (isCheckMode) {
  console.log(`Mobile release evidence initializer check passed. Private folder target: ${evidenceDir}`)
  process.exit(0)
}

mkdirSync(evidenceDir, { recursive: true })

if (existsSync(targetPath)) {
  console.log(`Private evidence file already exists: ${targetPath}`)
  process.exit(0)
}

copyFileSync(templatePath, targetPath)

console.log(`Created private mobile release evidence file: ${targetPath}`)
console.log('This folder is ignored by git. Do not commit completed evidence, credentials, build links, device IDs, push tokens, or private store notes.')
