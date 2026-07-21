import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('previous platform-admin preview 502 is explained by the retired-context module boundary', async () => {
  const [platformAccessSource, supabaseHelperSource] = await Promise.all([
    readFile(new URL('../netlify/functions/platform-admin-access.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/lib/_supabase.js', import.meta.url), 'utf8'),
  ])

  assert.match(platformAccessSource, /import \{ supabaseAdmin \} from '\.\/lib\/_supabase\.js'/)
  assert.match(supabaseHelperSource, /export const supabaseAdmin = createSupabaseAdminClient\(\)/)
  assert.match(supabaseHelperSource, /context === 'deploy-preview'/)
  assert.match(supabaseHelperSource, /V1 staging runtime is retired/)
})

test('representative preview function rejects a harmless invalid method without secrets or runtime setup', async () => {
  const { handler } = await import('../netlify/functions/send-password-reset.js')
  const response = await handler({ headers: {}, httpMethod: 'GET' })

  assert.equal(response.statusCode, 405)
  assert.equal(response.headers['Cache-Control'], 'no-store, max-age=0')
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff')
  assert.match(response.headers['Content-Type'], /^application\/json/)
  assert.doesNotMatch(response.body, /stack|secret|token|node_modules|\\|:\/\//i)
  assert.deepEqual(JSON.parse(response.body), {
    success: false,
    message: 'Method not allowed.',
  })
})
