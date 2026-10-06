import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateBrandingOfferProgress, resolvePromotionalBranding, planBrandingOfferOutcome,
  readPublicBrandingOfferCounter, resolveTeamBrandingDisplay } from '../netlify/functions/lib/_first-250-branding.js'

const scope = { teamId: 'team-a', clubId: 'club-a' }
const startedAt = '2026-01-31T12:00:00Z', deadlineAt = '2026-04-30T11:00:00Z'
const fixture = () => ({ ...scope, startedAt, deadlineAt, timezone: 'Europe/London', asOf: '2026-04-20T10:00:00Z',
  players: Array.from({ length: 7 }, (_, i) => ({ ...scope, id: `player-${i}`, status: 'active' })),
  parentLinks: Array.from({ length: 7 }, (_, i) => ({ ...scope, playerId: `player-${i}`, linkType: 'parent',
    status: 'active', authUserId: 'shared-parent', accountActive: true, acceptedAt: '2026-02-01T12:00:00Z' })),
  matches: Array.from({ length: 10 }, (_, i) => ({ ...scope, id: `match-${i}`, status: 'full_time',
    homeScore: 0, awayScore: 0, matchDate: '2026-04-01', concludedAt: '2026-04-01T12:00:00Z' })) })

test('seven players with accepted Parent links and ten distinct completed 0-0 matches qualify', () => {
  assert.deepEqual(evaluateBrandingOfferProgress(fixture()), { playersWithAcceptedParent: 7, completedMatches: 10,
    evaluatedAt: '2026-04-20T10:00:00Z', qualifies: true })
})
test('siblings can share a Parent; duplicate Parent links cannot inflate the player total', () => {
  const f = fixture(); f.parentLinks = [...f.parentLinks.slice(0, 6), ...f.parentLinks.slice(0, 6)]
  assert.equal(evaluateBrandingOfferProgress(f).playersWithAcceptedParent, 6)
  assert.equal(evaluateBrandingOfferProgress(f).qualifies, false)
})
test('revoked, invited, inactive, family and cross-team links do not qualify', () => {
  for (const mutation of [{ status: 'revoked' }, { status: 'pending' }, { accountActive: false },
    { linkType: 'family' }, { teamId: 'other' }, { clubId: 'other' }, { authUserId: '' }]) {
    const f = fixture(); Object.assign(f.parentLinks[0], mutation)
    assert.equal(evaluateBrandingOfferProgress(f).qualifies, false)
  }
})
test('duplicate, uncompleted, deleted, demo, backdated and out-of-window matches do not qualify', () => {
  for (const mutation of [{ id: 'match-1' }, { concludedAt: null }, { deletedAt: startedAt },
    { isDemo: true }, { status: 'cancelled' }, { teamId: 'other' }, { matchDate: '2026-01-01' },
    { matchDate: '2026-02-31' }, { concludedAt: '2026-05-01T12:00:00Z' }]) {
    const f = fixture(); Object.assign(f.matches[0], mutation)
    assert.equal(evaluateBrandingOfferProgress(f).qualifies, false)
  }
})
test('late processing cannot count a Parent acceptance after the deadline', () => {
  const f = fixture(); f.asOf = '2026-05-05T12:00:00Z'; f.parentLinks[0].acceptedAt = '2026-05-01T12:00:00Z'
  assert.equal(evaluateBrandingOfferProgress(f).qualifies, false)
})
test('grandfathered teams have permanent entitlement without a qualification clock', () => {
  const entry = { ...scope, cohort: 'existing_39', state: 'grandfathered' }
  assert.equal(planBrandingOfferOutcome(entry, null, null), 'grandfathered')
  assert.equal(resolvePromotionalBranding({ ...scope, entry, releaseEnabled: true, authorityAllowed: true }).promotionAllowed, true)
})
test('release OFF, lost authority and another team in the same club never receive promotional branding', () => {
  const entry = { ...scope, cohort: 'existing_39', state: 'grandfathered' }
  for (const mutation of [{ releaseEnabled: false }, { authorityAllowed: false }, { teamId: 'team-b' }, { clubId: 'club-b' }]) {
    assert.equal(resolvePromotionalBranding({ ...scope, entry, releaseEnabled: true, authorityAllowed: true, ...mutation }).promotionAllowed, false)
  }
})
test('expiry preserves saved artwork/colours and a paid package restores display', () => {
  const entry = { ...scope, cohort: 'new_211', state: 'provisional', startedAt, deadlineAt }
  const saved = { logoUrl: 'https://example.test/logo.png', accent: '#047857' }
  const before = structuredClone(saved)
  const context = { ...scope, entry, releaseEnabled: true, authorityAllowed: true, asOf: '2026-05-07T12:00:00Z' }
  assert.deepEqual(resolvePromotionalBranding(context), { logoAllowed: false, coloursAllowed: false, promotionAllowed: false })
  assert.deepEqual(resolvePromotionalBranding({ ...context, baseLogoAllowed: true, baseColoursAllowed: true }),
    { logoAllowed: true, coloursAllowed: true, promotionAllowed: false })
  assert.deepEqual(saved, before)
})
test('deadline is exclusive for provisional display; permanent reward survives later membership history changes', () => {
  const entry = { ...scope, cohort: 'new_211', state: 'provisional', startedAt, deadlineAt }
  assert.equal(resolvePromotionalBranding({ ...scope, entry, releaseEnabled: true, authorityAllowed: true, asOf: deadlineAt }).promotionAllowed, false)
  assert.equal(planBrandingOfferOutcome(entry, { qualifies: false }, deadlineAt), 'failed')
  assert.equal(planBrandingOfferOutcome(entry, { qualifies: true, evaluatedAt: deadlineAt }, deadlineAt), 'permanent')
  assert.equal(planBrandingOfferOutcome({ ...entry, state: 'permanent' }, { qualifies: false }, '2027-01-01T00:00:00Z'), 'permanent')
})
test('a late current-state read cannot fabricate historical qualification, but a timely saved observation can', () => {
  const f = fixture(); f.asOf = '2026-05-05T12:00:00Z'
  const entry = { ...scope, cohort: 'new_211', state: 'provisional', startedAt, deadlineAt }
  assert.equal(evaluateBrandingOfferProgress(f).qualifies, false)
  assert.equal(planBrandingOfferOutcome(entry, { qualifies: true, evaluatedAt: f.asOf }, f.asOf), 'failed')
  assert.equal(planBrandingOfferOutcome(entry, { qualifies: true, evaluatedAt: '2026-04-20T10:00:00Z' }, f.asOf), 'permanent')
})
test('public aggregate counter fails closed and strips private fields', async () => {
  const client = data => ({ rpc: async () => ({ data }) })
  assert.deepEqual(await readPublicBrandingOfferCounter(client({ status: 'not_active', remaining: 211 })), { status: 'not_active' })
  assert.deepEqual(await readPublicBrandingOfferCounter(client({ status: 'active', capacity: 250, reserved: 39, remaining: 211, teamId: 'secret' })),
    { status: 'active', capacity: 250, reserved: 39, remaining: 211 })
  await assert.rejects(readPublicBrandingOfferCounter(client({ status: 'active', capacity: 250, reserved: 39, remaining: 250 })), /invalid/)
  await assert.rejects(readPublicBrandingOfferCounter({ rpc: async () => ({ error: new Error('private') }) }), /unavailable/)
})
test('authorised paid Club branding takes precedence after linking without destroying saved team artwork', () => {
  const teamBranding = { ...scope, logoUrl: 'https://example.test/team.png', accent: '#112233' }
  const clubBranding = { clubId: scope.clubId, logoUrl: 'https://example.test/club.png', accent: '#445566' }
  const original = structuredClone(teamBranding)
  const context = { ...scope, authorityAllowed: true, teamBranding, clubBranding,
    entitlement: { logoAllowed: true, coloursAllowed: true } }
  assert.equal(resolveTeamBrandingDisplay(context).source, 'team')
  assert.deepEqual(resolveTeamBrandingDisplay({ ...context, paidClubBrandingEligible: true }),
    { source: 'paid_club', logoUrl: clubBranding.logoUrl, accent: clubBranding.accent })
  assert.deepEqual(teamBranding, original)
  assert.equal(resolveTeamBrandingDisplay({ ...context, teamId: 'unclaimed-team' }).source, 'platform')
  assert.equal(resolveTeamBrandingDisplay({ ...context, authorityAllowed: false, paidClubBrandingEligible: true }).source, 'platform')
})
