import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createParentOfflineDocument,
  getParentOfflineResources,
  parentOfflineResourceAuthority,
  setParentOfflineProfile,
  setParentOfflineResources,
} from '../apps/mobile-core/src/parentOfflineCore.js'

const link = { id: 'link', clubId: 'club-a', teamId: 'team-a', playerId: 'player-a', linkType: 'parent' }
const profile = { id: 'account', accountStatus: 'active', parentPortalLinks: [link], selectedParentLinkId: 'link' }
function savedDocument() {
  const document = createParentOfflineDocument({ profile, selectedLinkId: 'link', userScope: profile.id })
  return setParentOfflineResources(document, 'link', { messages: [{ id: 'old' }], calendar: [{ id: 'old-event' }] })
}
function legacyDocument() {
  const document = savedDocument()
  const { authority, ...entry } = document.resources.link
  return { ...document, resources: { ...document.resources, link: entry } }
}

for (const [field, value] of [['clubId', 'club-b'], ['teamId', 'team-b'], ['playerId', 'player-b'], ['linkType', 'other']]) {
  test(`same link with changed ${field} clears old saved resources`, () => {
    const document = savedDocument()
    const next = setParentOfflineProfile(document, { ...profile, parentPortalLinks: [{ ...link, [field]: value }] })
    assert.equal(getParentOfflineResources(next, 'link'), null)
    assert.equal(next.resources.link, undefined)
  })
}

test('same link with changed account status clears old saved resources', () => {
  const next = setParentOfflineProfile(savedDocument(), { ...profile, accountStatus: 'suspended' })
  assert.equal(getParentOfflineResources(next, 'link'), null)
})

test('unchanged legacy cache migrates without losing data', () => {
  const document = legacyDocument()
  assert.deepEqual(getParentOfflineResources(document, 'link').resources.messages, [{ id: 'old' }])
  const next = setParentOfflineProfile(document, { ...profile, displayName: 'Updated name' })
  assert.equal(next.resources.link.authority, parentOfflineResourceAuthority(profile, link))
  assert.deepEqual(getParentOfflineResources(next, 'link').resources.calendar, [{ id: 'old-event' }])
})

test('legacy cache is discarded when saved profile scope changed', () => {
  const next = setParentOfflineProfile(legacyDocument(), { ...profile, parentPortalLinks: [{ ...link, teamId: 'team-b' }] })
  assert.equal(getParentOfflineResources(next, 'link'), null)
})

test('partial write cannot preserve resources with an explicit mismatched authority', () => {
  const original = savedDocument()
  const changed = { ...original, profile: { ...original.profile, value: { ...profile, parentPortalLinks: [{ ...link, playerId: 'player-b' }] } } }
  const next = setParentOfflineResources(changed, 'link', { messages: [{ id: 'new' }] })
  assert.deepEqual(getParentOfflineResources(next, 'link').resources.messages, [{ id: 'new' }])
  assert.deepEqual(getParentOfflineResources(next, 'link').resources.calendar, [])
})

test('read rejects explicit mismatched authority', () => {
  const original = savedDocument()
  const changed = { ...original, profile: { ...original.profile, value: { ...profile, parentPortalLinks: [{ ...link, clubId: 'club-b' }] } } }
  assert.equal(getParentOfflineResources(changed, 'link'), null)
})

for (const [field, value] of [['hasActivePlanAccess', true], ['planStatus', 'expired']]) {
  test(`same link with changed profile ${field} clears saved resources`, () => {
    const next = setParentOfflineProfile(savedDocument(), { ...profile, [field]: value })
    assert.equal(getParentOfflineResources(next, 'link'), null)
  })
}

for (const [field, value] of [['planStatus', 'expired'], ['planKey', 'matchday']]) {
  test(`same link with changed link ${field} clears saved resources`, () => {
    const next = setParentOfflineProfile(savedDocument(), { ...profile, parentPortalLinks: [{ ...link, [field]: value }] })
    assert.equal(getParentOfflineResources(next, 'link'), null)
  })
}

test('a late result captured for the previous team cannot be written under new authority', () => {
  const original = savedDocument()
  const oldAuthority = parentOfflineResourceAuthority(profile, link)
  const newLink = { ...link, teamId: 'team-b' }
  const newProfile = { ...profile, parentPortalLinks: [newLink] }
  const changed = setParentOfflineProfile(original, newProfile)
  const newAuthority = parentOfflineResourceAuthority(newProfile, newLink)
  const fresh = setParentOfflineResources(changed, 'link', { messages: [{ id: 'team-b' }] }, { expectedAuthority: newAuthority })
  assert.throws(() => setParentOfflineResources(fresh, 'link', { messages: [{ id: 'late-team-a' }] }, { expectedAuthority: oldAuthority }), /offline_resource_authority_changed/)
  assert.deepEqual(getParentOfflineResources(fresh, 'link').resources.messages, [{ id: 'team-b' }])
})
