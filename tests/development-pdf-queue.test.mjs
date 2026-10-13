import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { createClient } from '@supabase/supabase-js'

const source = await readFile(new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url), 'utf8')
const declaration = parse(source, { sourceType: 'module' }).program.body.map(node => node.declaration || node).find(node => node.type === 'FunctionDeclaration' && node.id.name === 'processScheduledEmails')
const functionSource = source.slice(declaration.start, declaration.end)

test('actual scheduler reserves ordinary emails outside a 25-PDF backlog and sends them before a slow PDF', async () => {
  const rows = [...Array.from({ length: 25 }, (_, index) => ({ id: `pdf-${index}`, status: 'scheduled', payload: { pendingDevelopmentPdf: { signature: 'fixture' } } })), { id: 'ordinary', status: 'scheduled', payload: {} }]
  const queries = []
  const sent = []
  let elapsed = 0
  const client = createClient('https://example.supabase.co', 'fixture-key', { auth: { persistSession: false }, global: { fetch: async url => {
    const parsed = new URL(url)
    const pdfFilter = parsed.searchParams.get('payload->pendingDevelopmentPdf')
    const limit = Number(parsed.searchParams.get('limit'))
    queries.push({ pdfFilter, limit })
    assert.match(parsed.searchParams.get('or'), /status.eq.failed.*retry_enabled.eq.true.*legacy_review_required.eq.false/)
    const selected = rows.filter(row => pdfFilter === 'not.is.null' ? row.payload.pendingDevelopmentPdf : !row.payload.pendingDevelopmentPdf).slice(0, limit)
    return new Response(JSON.stringify(selected), { headers: { 'Content-Type': 'application/json' } })
  } } })
  class FixtureDate extends Date { static now() { return elapsed } }
  const run = new Function('supabaseAdmin', 'getMissingEnvVars', 'sendScheduledEmail', 'Date', `${functionSource}; return processScheduledEmails`)(client, () => [], async row => { sent.push(row.id); elapsed += row.payload.pendingDevelopmentPdf ? 25000 : 100; return 'sent' }, FixtureDate)
  const result = await run()
  assert.deepEqual(queries, [{ pdfFilter: 'is.null', limit: 25 }, { pdfFilter: 'not.is.null', limit: 1 }])
  assert.deepEqual(sent, ['ordinary', 'pdf-0'])
  assert.equal(result.payload.sent, 2)
  assert.equal(result.payload.scanned, 2)
})

test('scheduler keeps bounded ordinary progress while reserving time for a due PDF', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({ id: `ordinary-${index}`, status: 'scheduled', payload: {} }))
  let elapsed = 0
  const sent = []
  const client = { from() { return { select() { return this }, in() { return this }, or() { return this }, order() { return this }, is() { return this }, not() { this.pdf = true; return this }, limit() { return Promise.resolve({ data: this.pdf ? [{ id: 'pdf', status: 'failed', payload: { pendingDevelopmentPdf: {} } }] : rows }) } } } }
  class FixtureDate extends Date { static now() { return elapsed } }
  const run = new Function('supabaseAdmin', 'getMissingEnvVars', 'sendScheduledEmail', 'Date', `${functionSource}; return processScheduledEmails`)(client, () => [], async (row, options) => { sent.push([row.id, options]); elapsed += 4000; return 'sent' }, FixtureDate)
  await run()
  assert.deepEqual(sent.map(item => item[0]), ['ordinary-0', 'ordinary-1', 'pdf'])
  assert.deepEqual(sent.at(-1)[1], { retryFailed: true })
})
