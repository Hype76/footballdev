import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { transformSync } from 'esbuild'
import { resolveCoachBranding } from '../apps/coach-mobile/src/coachThemeCore.js'

const source = readFileSync('apps/coach-mobile/App.js', 'utf8')
const component = source.slice(source.indexOf('function ContextOptionBadge('), source.indexOf('\nfunction ContextSwitcher('))
const compiled = transformSync(component, { loader: 'jsx', jsxFactory: 'h' }).code

function mount(logoUrl) {
  let failed = false, foreground, cleanup, effectInstalled = false
  const useState = () => [failed, value => { failed = typeof value === 'function' ? value(failed) : value }]
  const useEffect = callback => { if (!effectInstalled) { effectInstalled = true; cleanup = callback() } }
  const AppState = { addEventListener: (_name, callback) => { foreground = callback; return { remove() {} } } }
  const h = (_type, props) => props
  const badge = new Function('useState', 'useEffect', 'AppState', 'h', 'Image', 'require', 'useCoachSavedBadge', `${compiled}; return ContextOptionBadge`)(
    useState, useEffect, AppState, h, 'Image', () => 'fallback', (_user, _context, remoteUrl) => remoteUrl,
  )
  return { render: () => badge({ logoUrl, styles: {} }), foreground: () => foreground('active'), unmount: () => cleanup() }
}

test('picker badge retries an authorized image after foregrounding', () => {
  const url = 'https://example.test/badge.png'
  const badge = mount(url)
  assert.equal(badge.render().source.uri, url)
  badge.render().onError()
  assert.equal(badge.render().source, 'fallback')
  badge.foreground()
  assert.equal(badge.render().source.uri, url)
  assert.equal(typeof badge.render().onError, 'function')
  badge.unmount()
})

test('denied branding never triggers a remote image attempt on foreground', () => {
  const context = { teamId: 'team', clubId: 'club', clubLogoUrl: 'https://example.test/club.png', teamBrandingDisplay: {
    teamId: 'team', clubId: 'club', source: 'paid_club', logoAllowed: false, coloursAllowed: true, logoUrl: 'https://example.test/club.png',
  } }
  const badge = mount(resolveCoachBranding(context).logoUrl)
  assert.equal(badge.render().source, 'fallback')
  assert.equal(badge.render().onError, undefined)
  badge.foreground()
  assert.equal(badge.render().source, 'fallback')
  badge.unmount()
})

test('closing the picker unmounts its badges so reopening retries once', () => {
  assert.match(source.slice(source.indexOf('function ContextSwitcher('), source.indexOf('\nfunction ', source.indexOf('function ContextSwitcher(') + 1)), /\{open \? options : null\}/)
  const first = mount('https://example.test/badge.png')
  first.render().onError()
  assert.equal(first.render().source, 'fallback')
  first.unmount()
  assert.equal(mount('https://example.test/badge.png').render().source.uri, 'https://example.test/badge.png')
})
