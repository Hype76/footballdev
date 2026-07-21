import { createHash } from 'node:crypto'
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

async function listFiles(directory) {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await listFiles(target))
    if (entry.isFile()) output.push(target)
  }
  return output
}

async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

const root = process.cwd()
const groups = [
  { name: 'web', directory: path.join(root, 'dist') },
  { name: 'functions', directory: path.join(root, 'netlify', 'functions') },
]
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  packageLockSha256: await digest(path.join(root, 'package-lock.json')),
  groups: {},
}

for (const group of groups) {
  const files = (await listFiles(group.directory)).sort()
  const entries = []
  for (const file of files) {
    const details = await stat(file)
    entries.push({
      path: path.relative(root, file).replaceAll('\\', '/'),
      bytes: details.size,
      sha256: await digest(file),
    })
  }
  manifest.groups[group.name] = entries
}

const artifacts = path.join(root, '.security-artifacts')
await mkdir(artifacts, { recursive: true })
await writeFile(path.join(artifacts, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Artifact manifest generated for ${manifest.groups.web.length} web files and ${manifest.groups.functions.length} function source files.`)
