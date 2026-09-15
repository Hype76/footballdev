import assert from 'node:assert/strict'
import test from 'node:test'
import { getUnlistedParentAccessLinks } from '../src/lib/parent-portal-invite-actions.js'

test('unlisted access shows every outstanding Parent grant without hiding accounts or mixing family access', () => {
  const links = [
    { id: 'listed', email: ' PARENT@example.test ', status: 'active' },
    { id: 'former', email: 'former@example.test', status: 'active' },
    { id: 'duplicate', email: 'former@example.test', status: 'active' },
    { id: 'pending', email: 'invited@example.test', status: 'pending' },
    { id: 'revoked', email: 'old@example.test', status: 'revoked' },
    { id: 'family', email: 'fan@example.test', status: 'active', linkType: 'family' },
    { id: 'family-raw', email: 'family@example.test', status: 'active', link_type: 'family' },
  ]
  assert.deepEqual(getUnlistedParentAccessLinks({ contacts: [{ email: 'parent@example.test' }], links }).map((link) => link.id), ['former', 'duplicate', 'pending'])
  assert.equal(getUnlistedParentAccessLinks({ links }).length, 4)
  assert.deepEqual(getUnlistedParentAccessLinks(), [])
})
