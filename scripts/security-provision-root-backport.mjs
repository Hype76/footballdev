import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {hash,loadRecord,verifySource,verifyCopies,verifyReviewBytes,artifactPath} from './security-verify-reviewed-backports.mjs'
export function decodeReceipt(encoded, trustedSha256) {
  assert.match(trustedSha256 || '', /^[a-f0-9]{64}$/, 'Externally approved receipt SHA256 is required')
  assert.ok(typeof encoded === 'string' && encoded.length > 0 && encoded.length <= 65536, 'Invalid encoded receipt size')
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, 'Invalid receipt base64')
  const bytes = Buffer.from(encoded, 'base64')
  assert.equal(bytes.toString('base64'), encoded, 'Noncanonical receipt base64')
  assert.equal(hash(bytes), trustedSha256, 'Receipt does not match externally approved SHA256')
  const parsed = JSON.parse(bytes)
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Receipt must be a JSON object')
  return bytes
}

export function provision(root=process.cwd()){
  assert.equal(process.argv.length,2,'No install or scope arguments permitted')
  const {record}=loadRecord(root),source=verifySource(root,record),pin=process.env.FOOTBALL_REVIEW_RECEIPT_SHA256
  let bytes
  if(process.env.FOOTBALL_REVIEW_RECEIPT_BASE64)bytes=decodeReceipt(process.env.FOOTBALL_REVIEW_RECEIPT_BASE64,pin)
  else {const file=path.join(root,'.security-artifacts','implementation-review.json');assert.equal(fs.realpathSync(file).toLowerCase(),path.resolve(file).toLowerCase(),'Linked review receipt forbidden');bytes=fs.readFileSync(file)}
  verifyReviewBytes(root,record,source,bytes,pin)
  verifyCopies(root,record,'install')
  // No package installation, npm execution or mobile dependency access.
  fs.writeFileSync(artifactPath(root,'implementation-review.json'),bytes)
  execFileSync(process.execPath,[path.join(root,'scripts/security-apply-reviewed-backports.mjs')],{cwd:root,stdio:'inherit',env:{...process.env,FOOTBALL_REVIEW_RECEIPT_SHA256:pin}})
  verifyCopies(root,record)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)provision()
