import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const outputDirectory = path.join(process.cwd(), '.security-artifacts')
await mkdir(outputDirectory, { recursive: true })

const npmExecutable = process.env.npm_execpath
const command = npmExecutable ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
const args = npmExecutable
  ? [npmExecutable, 'sbom', '--sbom-format=cyclonedx', '--omit=dev']
  : ['sbom', '--sbom-format=cyclonedx', '--omit=dev']
const result = spawnSync(command, args, {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 25 * 1024 * 1024,
})

if (result.status !== 0) {
  console.error('SBOM generation failed.')
  console.error(String(result.stderr || '').trim())
  process.exit(result.status || 1)
}

const sbom = JSON.parse(result.stdout)
await writeFile(path.join(outputDirectory, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)
console.log(`SBOM generated with ${(sbom.components || []).length} production components.`)
