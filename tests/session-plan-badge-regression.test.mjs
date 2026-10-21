import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { CAPABILITIES } from '../src/lib/paywall-access.js'
import { canUseUiFeature } from '../src/lib/paywall-ui.js'
import { getCalendarEventCapability } from '../src/lib/calendar-event-access.js'
import { MATCHDAY_DEFAULT_FLAGS } from '../src/lib/matchday-policy.js'
import { getScopedTeamBranding } from '../src/lib/team-branding-display.js'

const source = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
const user = { planKey: 'matchday', role: 'head_manager', roleRank: 70, clubId: 'club', activeTeamId: 'team', planStatus: 'active', matchdayPolicy: { flags: MATCHDAY_DEFAULT_FLAGS } }
const options = new Function('EVENT_TYPE_OPTIONS', 'canUseUiFeature', 'getCalendarEventCapability', 'canCreateClubCalendarEvent', `return (${source.match(/function getCalendarEventTypeOptions\([^]*?\n\}/)[0]})`)(
  ['training', 'match', 'general', 'meeting'].map(value => ({ value, label: value })), canUseUiFeature, getCalendarEventCapability, () => false,
)

test('disabled training is absent while fixtures remain available, and the admin flag is honoured', () => {
  assert.deepEqual(options(user).map(option => option.value), ['match'])
  const enabled = { ...user, matchdayPolicy: { flags: { ...MATCHDAY_DEFAULT_FLAGS, trainingEvents: true } } }
  assert.deepEqual(options(enabled).map(option => option.value), ['training', 'match'])
  assert.equal(getCalendarEventCapability('training'), CAPABILITIES.trainingEvents)
  assert.equal(getCalendarEventCapability('match'), CAPABILITIES.fixtures)
})

test('all Create session calls use the guarded handler before opening a training form', () => {
  const handler = source.match(/function handleOpenSessionCreateModal\(\) \{([^]*?)\n  \}/)[1]
  const calls = []
  const run = context => new Function('user', 'CAPABILITIES', 'canUseUiFeature', 'handleOpenCalendarCreate', 'setErrorMessage', handler)(context, CAPABILITIES, canUseUiFeature, (...args) => calls.push(args), () => { throw new Error('training form reached') })
  run(user)
  assert.deepEqual(calls, [['', 'match']])
  assert.throws(() => run({ ...user, matchdayPolicy: { flags: { ...MATCHDAY_DEFAULT_FLAGS, trainingEvents: true } } }), /training form reached/)
  assert.match(source, /if \(!canUseUiFeature\(user, getCalendarEventCapability\(calendarForm.eventType\)\)\)/)
})

test('create and update reject disabled training before persistence using fresh plan checks', async () => {
  const domain = await readFile(new URL('../src/lib/domain/calendar-events.js', import.meta.url), 'utf8')
  for (const name of ['createCalendarEvent', 'updateCalendarEvent']) {
    const body = domain.match(new RegExp(`export async function ${name}\\([^]*?\\n\\}`))[0].replace('export ', '')
    const calls = []
    const deps = { blockDemoMutation: async () => {}, assertCalendarAccess: () => {}, buildCalendarPayload: () => ({ team_id: 'team', event_type: 'training' }), getEntryUserId: () => 'coach', getEntryIdentity: () => ({}), assertCalendarTeamAccess: async () => {}, assertCalendarFeatureAccess: async () => {}, assertClubFeature: async ({ featureName }) => { calls.push(featureName); throw new Error('disabled training') }, getCalendarEventCapability }
    const save = new Function(...Object.keys(deps), `return (${body})`)(...Object.values(deps))
    await assert.rejects(save({ user, eventId: 'event', event: {} }), /disabled training/)
    assert.deepEqual(calls, [CAPABILITIES.trainingEvents])
  }
})

test('header uses the same scoped badge grant as the sidebar, including revoked and cross-team grants', async () => {
  const topbar = await readFile(new URL('../src/components/layout/Topbar.jsx', import.meta.url), 'utf8')
  const declarations = topbar.match(/  const scopedBranding =[^]*?\n  const logoUrl =[^\n]*/)[0]
  const logo = new Function('displayUser', 'getScopedTeamBranding', 'fallbackLogo', `${declarations}; return logoUrl`)
  const display = { teamId: 'team', clubId: 'club', source: 'team', logoAllowed: true, coloursAllowed: false, logoUrl: 'https://example.test/team.png' }
  const context = { ...user, clubLogoUrl: 'https://example.test/club.png', teamBrandingDisplay: display }
  assert.equal(logo(context, getScopedTeamBranding, 'fp'), display.logoUrl)
  assert.equal(logo({ ...context, teamBrandingDisplay: { ...display, logoAllowed: false } }, getScopedTeamBranding, 'fp'), 'fp')
  assert.equal(logo({ ...context, activeTeamId: 'other' }, getScopedTeamBranding, 'fp'), context.clubLogoUrl)
  assert.equal(logo({ ...user }, getScopedTeamBranding, 'fp'), 'fp')
})
