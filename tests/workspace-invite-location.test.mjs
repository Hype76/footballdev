import assert from 'node:assert/strict'
import test from 'node:test'
import { readWorkspaceInviteLocation } from '../src/lib/workspace-invite-location.js'

const location = (value) => new URL(value, 'https://example.test')

test('query invite becomes a reloadable fragment and preserves other parameters', () => {
  const input = location('/workspace-invite?token=synthetic%2Bvalue&source=tutorial#step=setup')
  const before = input.href
  const first = readWorkspaceInviteLocation(input)
  const replay = readWorkspaceInviteLocation(input)
  assert.deepEqual(first, replay, 'reading during repeated renders must be pure')
  assert.equal(input.href, before)
  assert.equal(first.token, 'synthetic+value')
  assert.deepEqual(first.replacement, { pathname: '/workspace-invite', search: '?source=tutorial', hash: '#step=setup&token=synthetic%2Bvalue' })
  const canonical = readWorkspaceInviteLocation(first.replacement)
  assert.equal(canonical.token, first.token)
  assert.equal(canonical.replacement, null)
  assert.equal(new URL(first.replacement.pathname + first.replacement.search, input.origin).href.includes('synthetic'), false)
})

test('fragment and legacy aliases survive remount without browser storage', () => {
  for (const pathname of ['/workspace-invite', '/club-invite']) {
    const canonical = readWorkspaceInviteLocation(location(`${pathname}#token=synthetic-fragment`))
    assert.equal(canonical.token, 'synthetic-fragment')
    assert.equal(canonical.replacement, null)
    const legacy = readWorkspaceInviteLocation(location(`${pathname}/synthetic-path`), 'synthetic-path')
    assert.deepEqual(legacy.replacement, { pathname, search: '', hash: '#token=synthetic-path' })
    assert.equal(readWorkspaceInviteLocation(legacy.replacement).token, 'synthetic-path')
  }
})

test('new links take precedence and a bare URL never recovers another invitation', () => {
  assert.equal(readWorkspaceInviteLocation(location('/workspace-invite?token=synthetic-new#token=synthetic-old'), 'synthetic-legacy').token, 'synthetic-new')
  assert.equal(readWorkspaceInviteLocation(location('/workspace-invite#token=synthetic-second')).token, 'synthetic-second')
  assert.deepEqual(readWorkspaceInviteLocation(location('/workspace-invite')), { token: '', replacement: null })
})
