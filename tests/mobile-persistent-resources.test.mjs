import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createKitImageStorage } from '../apps/mobile-core/src/kitImageStorageCore.js'
import { createTeamLeagueStorage } from '../apps/mobile-core/src/teamLeagueStorageCore.js'

const origin = 'https://project.supabase.co'
const uri = origin + '/storage/v1/object/public/club-kits/club/home/first.png'
const digest = async value => createHash('sha256').update(value).digest('hex')
function files() {
  const saved = new Map(), downloads = []
  let fail = false, response = { status: 200, headers: { 'Content-Type': 'image/png' }, size: 512 }
  const fileSystem = {
    documentDirectory: 'file:///phone/documents/',
    getInfoAsync: async key => saved.get(key) || { exists: false },
    makeDirectoryAsync: async () => {},
    downloadAsync: async (remote, target, options) => {
      downloads.push(remote)
      assert.equal(options.sessionType, 0)
      if (fail) throw new Error('Network unavailable')
      saved.set(target, { exists: true, size: response.size, isDirectory: false })
      return response
    },
    moveAsync: async ({ from, to }) => { saved.set(to, saved.get(from)); saved.delete(from) },
    deleteAsync: async key => { saved.delete(key) },
  }
  return { fileSystem, saved, downloads, offline() { fail = true }, response(value) { response = value } }
}
test('kit file survives a cold restart offline without another download, including old artwork', async () => {
  const phone = files(), options = { fileSystem: phone.fileSystem, digest, origin }
  const first = await createKitImageStorage(options).resolve(uri)
  assert.match(first, /^file:\/\/\/phone\/documents\/fp-kit-art-v1\/[a-f0-9]{64}\.image$/)
  phone.offline()
  assert.equal(await createKitImageStorage(options).resolve(uri), first)
  assert.equal(phone.downloads.length, 1)
  assert.equal(phone.saved.size, 1)
})
test('new artwork gets its own file and failed refresh cannot replace the previous image', async () => {
  const phone = files(), options = { fileSystem: phone.fileSystem, digest, origin }
  const cache = createKitImageStorage(options), original = await cache.resolve(uri)
  const replacement = uri.replace('first', 'second')
  assert.notEqual(await cache.resolve(replacement), original)
  phone.offline()
  assert.equal(await cache.resolve(uri.replace('first', 'third')), uri.replace('first', 'third'))
  assert.equal(await cache.resolve(uri), original)
  assert.equal(phone.saved.size, 2)
})
test('simultaneous thumbnails and preview coalesce; lost local files are downloaded again', async () => {
  const phone = files(), cache = createKitImageStorage({ fileSystem: phone.fileSystem, digest, origin })
  const [first, second] = await Promise.all([cache.resolve(uri), cache.resolve(uri)])
  assert.equal(first, second)
  assert.equal(phone.downloads.length, 1)
  phone.saved.clear()
  assert.equal(await cache.resolve(uri), first)
  assert.equal(phone.downloads.length, 2)
})
test('untrusted hosts and missing native capabilities use normal paths without downloads or a startup crash', async () => {
  const phone = files(), cache = createKitImageStorage({ fileSystem: phone.fileSystem, digest, origin })
  for (const remote of ['https://evil.example/a.png', origin + '/storage/v1/object/public/private/a.png', uri + '?token=secret', 'file:///outside']) assert.equal(await cache.resolve(remote), remote)
  assert.equal(phone.downloads.length, 0)
  assert.equal(await createKitImageStorage({ fileSystem: null, digest, origin }).resolve(uri), uri)
})
test('failed HTTP, HTML responses and oversized files never become saved images', async () => {
  for (const response of [{ status: 403, headers: { 'Content-Type': 'image/png' }, size: 10 }, { status: 200, headers: { 'Content-Type': 'text/html' }, size: 10 }, { status: 200, headers: { 'Content-Type': 'image/png' }, size: 11 * 1024 * 1024 }]) {
    const phone = files()
    phone.response(response)
    assert.equal(await createKitImageStorage({ fileSystem: phone.fileSystem, digest, origin }).resolve(uri), uri)
    assert.equal(phone.saved.size, 0)
  }
})
function storage() {
  const values = new Map()
  return { values, getItem: async key => values.get(key) || null, setItem: async (key, value) => { values.set(key, value) }, removeItem: async key => { values.delete(key) } }
}
const league = { teamId: 'a', teamName: 'U14', url: 'https://league.example/a', enabled: true, canEdit: true }
test('league cold restart restores display only and isolates account, role, team and environment', async () => {
  const phone = storage(), cache = createTeamLeagueStorage(phone, 'live:')
  await cache.write('coach:account:a', league, () => true)
  assert.deepEqual(await createTeamLeagueStorage(phone, 'live:').read('coach:account:a', 'a'), { ...league, canEdit: false })
  for (const key of ['coach:other:a', 'parent:account:a', 'coach:account:b']) assert.equal(await cache.read(key, 'a'), null)
  assert.equal(await cache.read('coach:account:a', 'b'), null)
  assert.equal(await createTeamLeagueStorage(phone, 'test:').read('coach:account:a', 'a'), null)
})
test('stale replies cannot persist or delete another visit, and revocation removes the saved display', async () => {
  const phone = storage(), cache = createTeamLeagueStorage(phone, 'live:')
  await cache.write('a', league, () => false)
  assert.equal(await cache.read('a', 'a'), null)
  await cache.write('a', league, () => true)
  await cache.remove('a', () => false)
  assert.ok(await cache.read('a', 'a'))
  await cache.remove('a', () => true)
  assert.equal(await createTeamLeagueStorage(phone, 'live:').read('a', 'a'), null)
})
test('malformed saved league URLs cannot restore and storage errors do not block normal loading', async () => {
  const phone = storage(), cache = createTeamLeagueStorage(phone, 'live:')
  phone.values.set('live:a', JSON.stringify({ key: 'a', value: { ...league, url: 'javascript:alert(1)' } }))
  assert.equal(await cache.read('a', 'a'), null)
  phone.getItem = async () => { throw new Error('Storage unavailable') }
  assert.equal(await cache.read('a', 'a'), null)
})
test('an unresponsive saved league read expires without publishing a late value', async () => {
  let finish
  const phone = storage()
  phone.getItem = () => new Promise(resolve => { finish = resolve })
  const cache = createTeamLeagueStorage(phone, 'live:', { readTimeoutMs: 10 })
  assert.equal(await cache.read('a', 'a'), null)
  finish(JSON.stringify({ key: 'a', value: league }))
})
