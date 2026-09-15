import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@babel/parser'
import { safePartnerUrl } from '../src/lib/partners.js'

const source = await readFile(new URL('../apps/mobile-core/src/PartnersScreen.js', import.meta.url), 'utf8')
const screen = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
  .find(node => node.declaration?.id?.name === 'PartnersScreen').declaration
const open = screen.body.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'open')
const createOpen = new Function('supabase', 'appRole', 'safePartnerUrl', 'interaction', 'Linking', 'setNotice', `return (${source.slice(open.start, open.end)})`)
const current = { id: 'offer', url: 'https://example.com/current' }

test('mobile partner taps use the current published URL and send analytics before leaving', async () => {
  const actions = []
  const onOpen = createOpen({ rpc: async () => ({ data: { items: [current] } }) }, 'parent', safePartnerUrl,
    async (offer, kind) => { assert.equal(offer, current); assert.equal(kind, 'click'); actions.push('click') },
    { openURL: async url => actions.push(url) }, message => assert.fail(message))
  await onOpen({ id: 'offer', url: 'https://example.com/stale' })
  assert.deepEqual(actions, ['click', current.url])
})

test('hidden offers and failed feed reads cannot open stale partner links', async () => {
  for (const response of [{ data: { items: [] } }, { error: new Error('offline') }]) {
    const notices = []
    const onOpen = createOpen({ rpc: async () => response }, 'coach', safePartnerUrl,
      () => assert.fail('must not record an unavailable offer'), { openURL: () => assert.fail('must not open stale URL') }, message => notices.push(message))
    await onOpen(current)
    assert.equal(notices.length, 1)
  }
})

test('failed or stalled analytics do not prevent opening a valid partner link', { timeout: 5000 }, async () => {
  for (const interaction of [async () => { throw new Error('analytics unavailable') }, () => new Promise(() => {})]) {
    const opened = []
    const onOpen = createOpen({ rpc: async () => ({ data: { items: [current] } }) }, 'parent', safePartnerUrl,
      interaction, { openURL: async url => opened.push(url) }, message => assert.fail(message))
    await onOpen(current)
    assert.deepEqual(opened, [current.url])
  }
})
