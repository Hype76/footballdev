import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'

const promptUrl = new URL('../src/components/pwa/AppUpdatePrompt.jsx', import.meta.url)
const mainUrl = new URL('../src/main.jsx', import.meta.url)
const pushWorkerUrl = new URL('../public/push-sw.js', import.meta.url)
const viteConfigUrl = new URL('../vite.config.js', import.meta.url)

function createWorkerHarness({
  activeWorker = {},
  clientEntryUrl = '',
  currentEntryUrl = 'https://footballplayer.online/assets/index-current.js',
} = {}) {
  const listeners = new Map()
  const navigations = []
  const client = {
    id: 'staff-client',
    url: 'https://footballplayer.online/add-assessment',
    postMessage(message) {
      if (!clientEntryUrl) {
        return
      }

      listeners.get('message')?.forEach((listener) => {
        listener({
          data: {
            type: 'football-player:pwa-version-response',
            requestId: message.requestId,
            entryUrl: clientEntryUrl,
          },
          source: client,
        })
      })
    },
    async navigate(url) {
      navigations.push(url)
    },
  }
  const self = {
    registration: {
      active: activeWorker,
    },
    location: {
      origin: 'https://footballplayer.online',
    },
    clients: {
      async matchAll() {
        return [client]
      },
    },
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) ?? []
      typeListeners.push(listener)
      listeners.set(type, typeListeners)
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener))
    },
  }

  return {
    context: {
      URL,
      Request,
      Map,
      Math,
      Promise,
      caches: {
        async match() {
          return null
        },
      },
      fetch: async () => ({
        ok: true,
        async text() {
          return `<script type="module" src="${currentEntryUrl}"></script>`
        },
      }),
      self,
      setTimeout(callback) {
        callback()
      },
    },
    listeners,
    navigations,
  }
}

async function activateWorker(options) {
  const source = await readFile(pushWorkerUrl, 'utf8')
  const harness = createWorkerHarness(options)
  runInNewContext(source, harness.context)

  let activation
  harness.listeners.get('activate')?.forEach((listener) => {
    listener({
      waitUntil(promise) {
        activation = promise
      },
    })
  })
  await activation
  return harness.navigations
}

test('PWA update registration stays silent and reports the running entry bundle', async () => {
  const [mainSource, viteSource] = await Promise.all([
    readFile(mainUrl, 'utf8'),
    readFile(viteConfigUrl, 'utf8'),
  ])

  assert.match(mainSource, /football-player:pwa-version-request/)
  assert.match(mainSource, /football-player:pwa-version-response/)
  assert.match(mainSource, /document\.querySelector\('script\[type="module"\]\[src\]'\)/)
  assert.match(mainSource, /registerSW\(\{\s*immediate: true,\s*\}\)/)
  assert.doesNotMatch(mainSource, /AppUpdatePrompt/)
  assert.doesNotMatch(mainSource, /onNeedRefresh/)
  assert.match(viteSource, /clientsClaim: true/)
  assert.match(viteSource, /skipWaiting: true/)
})

test('PWA update reloads only a client running a stale entry bundle', async () => {
  const staleNavigations = await activateWorker({
    clientEntryUrl: 'https://footballplayer.online/assets/index-stale.js',
  })
  const currentNavigations = await activateWorker({
    clientEntryUrl: 'https://footballplayer.online/assets/index-current.js',
  })

  assert.deepEqual(staleNavigations, ['https://footballplayer.online/add-assessment'])
  assert.deepEqual(currentNavigations, [])
})

test('PWA update recovers a legacy client that cannot answer the version request', async () => {
  const navigations = await activateWorker({
    clientEntryUrl: '',
  })

  assert.deepEqual(navigations, ['https://footballplayer.online/add-assessment'])
})

test('first PWA installation does not reload the page', async () => {
  const navigations = await activateWorker({
    activeWorker: null,
    clientEntryUrl: '',
  })

  assert.deepEqual(navigations, [])
})

test('visible update prompt source remains absent', async () => {
  await assert.rejects(access(promptUrl), { code: 'ENOENT' })
})
