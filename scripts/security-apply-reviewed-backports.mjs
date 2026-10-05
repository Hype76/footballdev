import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { hash, inventory, loadRecord, verifySource, verifyCopies, verifyReview, artifactPath } from './security-verify-reviewed-backports.mjs'

// Validate every package, source file and complete postimage before the first write.
export function prepareWrites(record, payload, copies) {
const writes = []
for (const copy of copies) {
  const library = payload.libraries.find(item => item.name === copy.target.name)
  assert.ok(library, 'Missing reviewed library payload')
  assert.deepEqual(library.files.map(x => x.path).sort(), copy.target.files.map(x => x.path).sort(), 'Incomplete payload file set')
  const prospective = inventory(copy.dir)
  for (const file of library.files) {
    assert.match(file.path, /^lib\/[a-z]+\.js$/, 'Unsafe payload path')
    assert.ok(copy.target.files.some(x => x.path === file.path && x.originalSha256 === file.originalSha256 && x.patchedSha256 === file.patchedSha256), 'Payload not in reviewed scope')
    const content = Buffer.from(file.contentBase64, 'base64')
    assert.equal(hash(content), file.patchedSha256, 'Payload source hash mismatch')
    const destination = path.join(copy.dir, file.path)
    assert.equal(fs.realpathSync(destination).toLowerCase(), path.resolve(destination).toLowerCase(), 'Linked payload destination')
    const original = fs.readFileSync(destination)
    const item = prospective.find(x => x.path === file.path)
    assert.ok(item, 'Missing prospective package file')
    item.bytes = content.length
    item.sha256 = hash(content)
    assert.equal(hash(original), copy.treeSha256 === copy.target.patchedTreeSha256 ? file.patchedSha256 : file.originalSha256, 'File preimage drift')
    if (copy.treeSha256 !== copy.target.patchedTreeSha256) writes.push({ destination, original, content })
  }
  assert.equal(hash(Buffer.from(JSON.stringify(prospective))), copy.target.patchedTreeSha256, 'Prospective postimage tree mismatch: no writes')
}
return writes
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
const root = process.cwd(), { record, payload } = loadRecord(root)
const source = verifySource(root, record)
verifyReview(root, record, source)
const receiptPath = artifactPath(root, 'backport-installation.json')
const copies = verifyCopies(root, record, 'install')
const writes = prepareWrites(record, payload, copies)
try {
  for (const item of writes) fs.writeFileSync(item.destination, item.content)
  verifyCopies(root, record)
} catch (error) {
  for (const item of writes) fs.writeFileSync(item.destination, item.original)
  throw error
}
fs.writeFileSync(receiptPath, JSON.stringify({ head: source.head, installerSha256: record.implementationHashes['scripts/security-apply-reviewed-backports.mjs'], installedAt: new Date().toISOString(), filesWritten: writes.length, recordSha256: hash(fs.readFileSync(path.join(root, 'security/reviewed-source-remediations.json'))), patches: record.patches, copies: verifyCopies(root, record).map(({ relative, treeSha256 }) => ({ relative, treeSha256 })), publicationApproved: false }, null, 2) + '\n')
console.log(`Verified the exact root copy; wrote ${writes.length} exact reviewed source files. No release action.`)
}
