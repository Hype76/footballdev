import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const patterns = [
  { name: 'private key', expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'AWS access key', expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'Stripe live secret', expression: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Supabase service JWT', expression: /\beyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}\b/ },
]

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const findings = []

for (const relativePath of tracked) {
  const extension = path.extname(relativePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.zip', '.pdf'].includes(extension)) continue

  let source
  try {
    source = await readFile(relativePath, 'utf8')
  } catch {
    continue
  }

  for (const pattern of patterns) {
    if (pattern.expression.test(source)) findings.push({ path: relativePath, type: pattern.name })
  }
}

if (findings.length > 0) {
  console.error(`Secret scan failed with ${findings.length} high-confidence finding(s).`)
  for (const finding of findings) console.error(`- ${finding.path}: ${finding.type}`)
  process.exitCode = 1
} else {
  console.log(`Secret scan passed for ${tracked.length} tracked files.`)
}
