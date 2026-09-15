import assert from 'node:assert/strict'
import test from 'node:test'
import { parseFanAppLink } from '../apps/mobile-core/src/fanAppLinkCore.js'

test('Parent app links route invitations and Fans without carrying auth credentials', () => {
  assert.deepEqual(parseFanAppLink('footballplayerparents://fans'), { kind: 'fans' })
  assert.deepEqual(parseFanAppLink('footballplayerparents://fan-invite/12345678-1234-1234-1234-123456789012'), { kind: 'invite', token: '12345678-1234-1234-1234-123456789012' })
  for (const input of [null, '', 'https://evil.test/fans', 'footballplayercoaches://fans', 'footballplayerparents://fans?access_token=secret', 'footballplayerparents://fan-invite/../fans', 'footballplayerparents://fan-invite/short', 'footballplayerparents://fan-invite/1234567890123456#token', 'footballplayerparents://fans/extra']) assert.equal(parseFanAppLink(input), null)
})
