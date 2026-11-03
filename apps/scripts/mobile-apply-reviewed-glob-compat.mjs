import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = process.cwd()
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const scope = path.relative(root, appDir).replaceAll('\\', '/')
assert.ok(['apps/coach-mobile', 'apps/parent-mobile'].includes(scope), 'Unexpected mobile build directory')

const hash = value => createHash('sha256').update(value).digest('hex')
const record = JSON.parse(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json'), 'utf8'))
const patch = fs.readFileSync(path.join(root, 'security/patches/glob-7.2.3-minimatch11.patch'))
assert.equal(hash(patch), '0521132b1174bc849cb0c95ef463c84eead81a5b3ecd54369aba7eb1a86a7273', 'Reviewed glob patch changed')
const targets = record.targets.filter(target => target.name === 'glob' && target.scope === scope)
assert.equal(targets.length, 3, 'Expected three reviewed glob copies')

const replacements = [
  ['var rawGlob = pn._glob', 'var rawGlob = pn.pattern'],
  ['m = !e.match(pn)', 'm = !pn.test(e)'],
  ['m = e.match(pn)', 'm = pn.test(e)'],
]
const writes = []
for (const target of targets) {
  assert.equal(target.version, '7.2.3')
  const dir = path.join(appDir, target.packagePath)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, target.version)
  for (const file of target.files) {
    const destination = path.join(dir, file.path)
    const original = fs.readFileSync(destination)
    if (hash(original) === file.patchedSha256) continue
    assert.equal(hash(original), file.originalSha256, `Unreviewed glob source: ${destination}`)
    let content = original.toString('utf8')
    for (const [before, after] of replacements) {
      assert.equal(content.split(before).length - 1, 1, `Unexpected glob source: ${destination}`)
      content = content.replace(before, after)
    }
    const updated = Buffer.from(content)
    assert.equal(hash(updated), file.patchedSha256, `Reviewed glob result mismatch: ${destination}`)
    writes.push({ destination, updated })
  }
}
for (const { destination, updated } of writes) fs.writeFileSync(destination, updated)
console.log(`Verified three glob 7.2.3 copies; installed ${writes.length} reviewed compatibility files.`)
