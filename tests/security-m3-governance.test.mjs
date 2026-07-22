import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(new URL('../.github/workflows/security-gate.yml', import.meta.url), 'utf8')
const codeowners = await readFile(new URL('../.github/CODEOWNERS', import.meta.url), 'utf8')
const pullRequestTemplate = await readFile(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8')
const netlifyConfig = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8')
const policy = JSON.parse(await readFile(new URL('../security/supply-chain-policy.json', import.meta.url), 'utf8'))

test('workflow uses least privilege, pinned actions and no production secrets', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/)
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|SUPABASE_SERVICE_ROLE_KEY|NETLIFY_AUTH_TOKEN/)
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@(?![a-f0-9]{40}\b)/i)
  assert.match(workflow, /npm ci --include=optional/)
  assert.match(workflow, /fail-on-severity: high/)
  assert.match(workflow, /include-hidden-files: true/)
  assert.match(workflow, /id: github-dependency-review[\s\S]*continue-on-error: true[\s\S]*if: steps\.github-dependency-review\.outcome == 'failure'[\s\S]*npm run security:supply-chain/)
})

test('required governance checks are named and cover the release surface', () => {
  for (const name of [
    'Supply chain',
    'Migration safety',
    'Security and V1 regression',
    'Production build',
    'Functions build',
    'Scope ownership',
    'Dependency review',
  ]) {
    assert.match(workflow, new RegExp(`name: ${name}`))
  }
  assert.match(workflow, /tests\/netlify-deploy-safety\.test\.mjs/)
  assert.match(workflow, /npm run test:v1-stabilise/)
})

test('ownership and pull request evidence cover security-sensitive paths', () => {
  assert.match(codeowners, /^\* @Hype76/m)
  assert.match(codeowners, /^\/supabase\/migrations\/ @Hype76/m)
  assert.match(codeowners, /^\/netlify\/functions\/ @Hype76/m)
  assert.match(pullRequestTemplate, /Production data, credentials, provider settings and account state were not changed/)
  assert.match(pullRequestTemplate, /Rollback or roll-forward plan/)
})

test('preview context remains payment disabled and production uses the production build', () => {
  assert.match(netlifyConfig, /\[context\.production\][\s\S]*npm run build:live/)
  assert.match(netlifyConfig, /\[context\.deploy-preview\.environment\][\s\S]*VITE_PAYMENTS_DISABLED = "true"/)
  assert.match(netlifyConfig, /\[context\.branch-deploy\.environment\][\s\S]*VITE_PAYMENTS_DISABLED = "true"/)
})

test('supply policy has bounded development-only exceptions and no production acceptance', () => {
  assert.equal(policy.review.owner, 'Steve')
  assert.match(policy.review.reviewBy, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(policy.review.reason, /No production advisory or Critical advisory is accepted/)
  assert.deepEqual(
    policy.advisoryExceptions.map((exception) => exception.id).sort(),
    ['GHSA-4x5r-pxfx-6jf8', 'GHSA-8988-4f7v-96qf', 'GHSA-v2hh-gcrm-f6hx'].sort(),
  )
  for (const exception of policy.advisoryExceptions) {
    assert.equal(exception.productionReachable, false)
    assert.equal(exception.owner, 'Steve')
    assert.equal(exception.reviewBy, '2026-08-21')
    assert.equal(exception.expires, '2026-08-21')
  }
  assert.ok(!policy.advisoryExceptions.some((exception) => exception.id === 'GHSA-f88m-g3jw-g9cj'))
  assert.deepEqual(policy.approvedRemoteImports, ['https://esm.sh/@supabase/supabase-js@2.110.8'])
})
