import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildEmailLogoMarkup,
  getEventMapLinks,
  resolveEmailLogo,
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

test('event map links are generated only for usable locations', () => {
  assert.deepEqual(getEventMapLinks(''), [])

  const links = getEventMapLinks('Back Lane, Cambourne')

  assert.equal(links.length, 2)
  assert.equal(links[0].label, 'Open in Google Maps')
  assert.equal(links[0].href, 'https://www.google.com/maps/search/?api=1&query=Back%20Lane%2C%20Cambourne')
  assert.equal(links[1].label, 'Open in Apple Maps')
  assert.equal(links[1].href, 'https://maps.apple.com/?q=Back%20Lane%2C%20Cambourne')
})
