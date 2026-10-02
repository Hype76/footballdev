import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { shouldCacheAppNavigation } from '../src/lib/workspace-invite-cache-policy.js'

const sensitivePaths = ['/workspace-invite?token=synthetic-query', '/workspace-invite/synthetic-path', '/workspace-invite/', '/club-invite#token=synthetic-fragment', '/club-invite/synthetic-path']
const otherPaths = ['/coach', '/parent-portal', '/parent-invite/synthetic-parent', '/workspace-invite-other']
const input = (path, mode = 'navigate') => ({ request: { mode }, url: new URL(path, 'https://fixture.test') })

test('invitation navigation cannot become a persistent cache key; other routes keep their policy', () => {
  for (const path of sensitivePaths) assert.equal(shouldCacheAppNavigation(input(path)), false)
  for (const path of otherPaths) assert.equal(shouldCacheAppNavigation(input(path)), true)
  assert.equal(shouldCacheAppNavigation(input('/coach', 'cors')), false)
  const serialized = vm.runInNewContext(`(${shouldCacheAppNavigation.toString()})`)
  for (const path of sensitivePaths) assert.equal(serialized(input(path)), false)
  for (const path of otherPaths) assert.equal(serialized(input(path)), true)
})

test('activation removes only invitation entries from the existing navigation cache', async () => {
  const source = await readFile(new URL('../public/workspace-invite-cache-cleanup.js', import.meta.url), 'utf8')
  const deleted = []
  let activate
  vm.runInNewContext(source, {
    URL, console,
    self: { addEventListener: (name, handler) => { assert.equal(name, 'activate'); activate = handler } },
    caches: {
      has: async (name) => { assert.equal(name, 'app-navigation'); return true },
      open: async (name) => {
        assert.equal(name, 'app-navigation')
        return {
          keys: async () => [...sensitivePaths, ...otherPaths].map((path) => ({ url: new URL(path, 'https://fixture.test').href })),
          delete: async (request) => { deleted.push(request.url); return true },
        }
      },
    },
  })
  let completion
  activate({ waitUntil: (promise) => { completion = promise } })
  await completion
  assert.deepEqual(deleted, sensitivePaths.map((path) => new URL(path, 'https://fixture.test').href))
})

test('cache cleanup failure does not log credentials or stop activation', async () => {
  const source = await readFile(new URL('../public/workspace-invite-cache-cleanup.js', import.meta.url), 'utf8')
  const warnings = []
  let activate
  vm.runInNewContext(source, {
    URL,
    console: { warn: (...args) => warnings.push(args) },
    self: { addEventListener: (_, handler) => { activate = handler } },
    caches: { has: async () => { throw new Error('synthetic-private-token') } },
  })
  let completion
  activate({ waitUntil: (promise) => { completion = promise } })
  await completion
  assert.equal(JSON.stringify(warnings), '[["Workspace invite cache cleanup failed"]]')
})

if (process.env.INVITE_CACHE_BUILT === 'true') {
  test('compiled production worker excludes invitations and imports scoped cleanup', async () => {
    const source = await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8')
    const imported = []
    const matchers = []
    const workbox = {
      clientsClaim() {}, cleanupOutdatedCaches() {}, precacheAndRoute() {},
      NetworkFirst: class {},
      registerRoute: (matcher) => { matchers.push(matcher) },
    }
    const define = (_, factory) => factory(workbox)
    vm.runInNewContext(source, {
      self: { define, skipWaiting() {} }, define, URL,
      importScripts: (...paths) => imported.push(...paths),
    }, { timeout: 1000 })
    assert(imported.includes('workspace-invite-cache-cleanup.js'))
    assert(matchers.length > 0)
    for (const path of sensitivePaths) assert.equal(matchers.some((matcher) => matcher(input(path))), false)
    for (const path of otherPaths) assert.equal(matchers.some((matcher) => matcher(input(path))), true)
    await readFile(new URL('../dist/workspace-invite-cache-cleanup.js', import.meta.url), 'utf8')
  })
}
