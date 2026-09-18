import test from 'node:test'
import assert from 'node:assert/strict'
import { getCoachNavigationModel, resolveCoachRoute } from '../apps/coach-mobile/src/coachNavigationCore.js'
import { isMobileRouteAllowed, resolveMobilePlan } from '../apps/mobile-core/src/matchdayPolicyCore.js'
import { getCoachPlayerMutationPolicy } from '../apps/mobile-core/src/coachPlayersCore.js'
import { buildCoachCalendarPayload, coachCalendarFormFromEvent } from '../apps/mobile-core/src/coachCalendarCore.js'
import { resolveCoachBranding } from '../apps/coach-mobile/src/coachThemeCore.js'
import { resolveParentMobileBranding } from '../apps/mobile-core/src/parentThemeCore.js'

const coach = { id: 'ctx', clubId: 'club', teamId: 'team', role: 'coach', roleRank: 30, planKey: 'matchday' }
const matchdayConfig = { revision: 'test', flags: {
  players: true, teamCalendar: true, fixtures: true, matchDay: true, parentPortal: true,
  parentInvitations: true, parentEmails: true, pdfReports: true,
  trainingEvents: false, generalEvents: false, teamPolls: false,
  basicDevelopmentRecords: false, assessments: false, resourceLibrary: false,
  staffChat: false, parentChat: false, trialPlayers: false,
  basicLogoBranding: false, customColoursBranding: false,
} }

test('Matchday plan keeps matchday navigation and hides paid Coach tools', () => {
  const navigation = getCoachNavigationModel(coach, matchdayConfig)
  assert.deepEqual(navigation.primary.map((item) => item.key), ['home', 'calendar', 'players', 'matchday', 'more'])
  assert.ok(navigation.more.some((item) => item.key === 'invites'))
  assert.ok(navigation.more.some((item) => item.key === 'formation'))
  assert.equal(navigation.more.some((item) => item.key === 'development'), false)
  assert.equal(navigation.more.some((item) => item.key === 'resources'), false)
  assert.equal(navigation.more.some((item) => item.key === 'chat'), false)
  assert.equal(resolveCoachRoute('development', coach, matchdayConfig), '')
  assert.equal(resolveCoachRoute('matchday', coach, matchdayConfig), 'matchday')
})

test('Matchday navigation fails closed before trusted config and legacy plans retain routes', () => {
  assert.equal(isMobileRouteAllowed(coach, 'development', null), false)
  assert.equal(resolveCoachRoute('development', coach, null), '')
  const legacy = { ...coach, planKey: 'small_club' }
  assert.equal(resolveMobilePlan(legacy), 'legacy')
  assert.equal(resolveCoachRoute('development', legacy, null), 'development')
})

test('Parent context plan is evaluated per selected link', () => {
  const paid = { id: 'paid', planKey: 'team' }
  const free = { id: 'free', planKey: 'matchday' }
  assert.equal(isMobileRouteAllowed(paid, 'chat', null), true)
  assert.equal(isMobileRouteAllowed(free, 'chat', matchdayConfig), false)
  assert.equal(isMobileRouteAllowed(free, 'matchday', matchdayConfig), true)
})

test('Matchday Coach can create squad players but cannot create trial players', () => {
  const context = { ...coach, activeTeamId: 'team', activeTeamName: 'Team', hasActivePlanAccess: true, paymentAccess: { canMutate: true }, matchdayPolicy: matchdayConfig }
  const policy = getCoachPlayerMutationPolicy({ context })
  assert.equal(policy.canCreate, true)
  assert.equal(policy.canCreateTrial, false)
  assert.equal(policy.canViewDevelopment, false)
})

test('Matchday calendar defaults to fixtures and rejects non-match submissions', () => {
  const form = coachCalendarFormFromEvent(null, coach)
  assert.equal(form.eventType, 'match')
  assert.throws(() => buildCoachCalendarPayload({ context: coach, form: { ...form, eventType: 'training', opponent: '' } }), /only add Match fixtures/i)
})

test('Matchday presentation uses Football Player branding without changing saved branding', () => {
  const context = { planKey: 'matchday', clubAccent: 'purple', clubLogoUrl: 'https://example.com/paid-logo.png', paymentAccess: { canMutate: true } }
  assert.equal(resolveCoachBranding(context).source, 'default')
  assert.equal(resolveCoachBranding(context).logoUrl, '')
  assert.equal(resolveParentMobileBranding({ planKey: 'matchday', themeAccent: 'purple', clubLogoUrl: 'https://example.com/paid-logo.png' }).clubLogoUrl, '')
})

test('Trusted Matchday branding flags can re-enable saved presentation branding', () => {
  const policy = { ...matchdayConfig, flags: { ...matchdayConfig.flags, basicLogoBranding: true, customColoursBranding: true } }
  const context = { planKey: 'matchday', matchdayPolicy: policy, role: 'coach', roleRank: 30, clubId: 'club', teamId: 'team', clubAccent: 'purple', clubLogoUrl: 'https://example.com/paid-logo.png', paymentAccess: { canMutate: true } }
  assert.equal(resolveCoachBranding(context).source, 'club')
  assert.equal(resolveCoachBranding(context).logoUrl, 'https://example.com/paid-logo.png')
  assert.equal(resolveParentMobileBranding({ ...context, themeAccent: 'purple' }).clubLogoUrl, 'https://example.com/paid-logo.png')
})
