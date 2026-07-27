import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEmailLogoMarkup,
  getEventMapLinks,
  isSafeEmailImageProbeUrl,
  resolveEmailLogo,
  resolveReachableEmailLogo,
} from '../src/lib/email-branding.js'

test('email logo fallback prefers team, then club, then Football Player', () => {
  assert.deepEqual(
    resolveEmailLogo({
      clubLogoUrl: 'https://cdn.example.com/club.png',
      origin: 'https://footballplayer.online',
      teamLogoUrl: 'https://cdn.example.com/team.png',
    }),
    { source: 'team', url: 'https://cdn.example.com/team.png' },
  )

  assert.deepEqual(
    resolveEmailLogo({
      clubLogoUrl: 'https://cdn.example.com/club.png',
      origin: 'https://footballplayer.online',
      teamLogoUrl: 'http://insecure.example.com/team.png',
    }),
    { source: 'club', url: 'https://cdn.example.com/club.png' },
  )

  assert.deepEqual(
    resolveEmailLogo({
      clubLogoUrl: '',
      origin: 'https://footballplayer.online',
      teamLogoUrl: '',
    }),
    { source: 'football-player', url: 'https://footballplayer.online/football-player-logo.png' },
  )
})

test('email logo markup exposes the selected logo source and readable alt text', () => {
  const markup = buildEmailLogoMarkup({
    altText: 'Example Club',
    clubLogoUrl: 'https://cdn.example.com/club.png',
  })

  assert.match(markup, /src="https:\/\/cdn\.example\.com\/club\.png"/)
  assert.match(markup, /alt="Example Club"/)
  assert.match(markup, /data-logo-source="club"/)
})

test('email logo reachability rejects unsafe hosts and falls back when the club image is unavailable', async () => {
  assert.equal(isSafeEmailImageProbeUrl('https://127.0.0.1/logo.png'), false)
  assert.equal(isSafeEmailImageProbeUrl('https://[::1]/logo.png'), false)
  assert.equal(isSafeEmailImageProbeUrl('https://localhost/logo.png'), false)
  assert.equal(isSafeEmailImageProbeUrl('https://cdn.example.com/logo.png'), true)

  const unavailable = await resolveReachableEmailLogo({
    clubLogoUrl: 'https://cdn.example.com/missing.png',
    fetchImpl: async () => ({
      body: { cancel: async () => {} },
      headers: { get: () => 'image/png' },
      ok: false,
      status: 404,
    }),
    origin: 'https://footballplayer.online',
  })

  assert.deepEqual(unavailable, {
    source: 'football-player',
    url: 'https://footballplayer.online/football-player-logo.png',
  })

  const svg = await resolveReachableEmailLogo({
    clubLogoUrl: 'https://cdn.example.com/unsafe.svg',
    fetchImpl: async () => ({
      body: { cancel: async () => {} },
      headers: { get: () => 'image/svg+xml' },
      ok: true,
      status: 200,
    }),
    origin: 'https://footballplayer.online',
  })

  assert.equal(svg.source, 'football-player')
})

test('email logo reachability accepts an HTTPS image and supports servers that require GET', async () => {
  const methods = []
  const resolved = await resolveReachableEmailLogo({
    clubLogoUrl: 'https://cdn.example.com/club.png',
    fetchImpl: async (_url, options) => {
      methods.push(options.method)

      return options.method === 'HEAD'
        ? {
            body: { cancel: async () => {} },
            headers: { get: () => '' },
            ok: false,
            status: 405,
          }
        : {
            body: { cancel: async () => {} },
            headers: { get: () => 'image/png' },
            ok: true,
            status: 206,
          }
    },
  })

  assert.deepEqual(methods, ['HEAD', 'GET'])
  assert.deepEqual(resolved, {
    source: 'club',
    url: 'https://cdn.example.com/club.png',
  })
})

test('Football Player fallback markup remains accessible when remote images are blocked', () => {
  const markup = buildEmailLogoMarkup({
    altText: 'Unavailable Club logo',
    clubLogoUrl: 'http://insecure.example.com/logo.png',
    origin: 'https://footballplayer.online',
  })

  assert.match(markup, /football-player-logo\.png/)
  assert.match(markup, /alt="Football Player logo"/)
  assert.match(markup, /data-logo-source="football-player"/)
})

test('event map links are generated only for usable locations', () => {
  assert.deepEqual(getEventMapLinks(''), [])

  const links = getEventMapLinks('Back Lane, Cambourne')

  assert.equal(links.length, 2)
  assert.equal(links[0].label, 'Open in Google Maps')
  assert.equal(links[0].href, 'https://www.google.com/maps/search/?api=1&query=Back%20Lane%2C%20Cambourne')
  assert.equal(links[1].label, 'Open in Apple Maps')
  assert.equal(links[1].href, 'https://maps.apple.com/?q=Back%20Lane%2C%20Cambourne')
})
