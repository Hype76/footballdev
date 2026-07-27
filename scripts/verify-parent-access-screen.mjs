import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(projectRoot, 'src')
const buildRoot = path.join(projectRoot, 'dist')
const retiredCopy = [
  ['This sign-in', 'is for parent access'].join(' '),
  ['Use Club', 'login'].join(' '),
  ['Sign in with', 'another account'].join(' '),
]
const retiredSymbols = [
  ['LoginIntent', 'MismatchState'].join(''),
]

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const target = path.join(root, entry.name)

    if (entry.isDirectory()) {
      files.push(...await listFiles(target))
    } else if (entry.isFile()) {
      files.push(target)
    }
  }

  return files
}

async function assertRetiredScreenAbsent(root, label) {
  const files = await listFiles(root)
  const checkedFiles = files.filter((file) => /\.(?:css|html|js|jsx|json|mjs|ts|tsx)$/i.test(file))

  for (const file of checkedFiles) {
    const source = await readFile(file, 'utf8')

    for (const forbidden of [...retiredCopy, ...retiredSymbols]) {
      if (source.includes(forbidden)) {
        throw new Error(`${label} still contains retired Parent access screen content in ${path.relative(projectRoot, file)}.`)
      }
    }
  }
}

await assertRetiredScreenAbsent(sourceRoot, 'Source')
await assertRetiredScreenAbsent(buildRoot, 'Production build')

process.stdout.write('Parent access screen regression lock passed for source and production build.\n')
