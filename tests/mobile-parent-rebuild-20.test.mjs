import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  getParentPortalLinks,
  getSelectedParentLink,
  withSelectedParentLink,
} from '../apps/mobile-core/src/parentLinks.js'
import {
  canSubmitParentPoll,
  getBuildClassification,
  getParentFriendlyError,
  getParentHomeFixtureCards,
  getParentHomeModel,
  getParentMatchGroups,
  getPollDraftOption,
} from '../apps/parent-mobile/src/parentExperience.js'

const root = fileURLToPath(new URL('..', import.meta.url))

const [appSource, notificationSource, authSource, startupStateSource, experienceSource, dataSource, profileSource, parentLinksSource, prestoreSource, parentConfig, coachConfig] = await Promise.all([
  fs.readFile(`${root}/apps/parent-mobile/App.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/src/notifications.js`, 'utf8'),
  fs.readFile(`${root}/apps/mobile-core/src/auth.js`, 'utf8'),
  fs.readFile(`${root}/apps/mobile-core/src/startupStateCore.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/src/parentExperience.js`, 'utf8'),
  fs.readFile(`${root}/apps/mobile-core/src/data.js`, 'utf8'),
  fs.readFile(`${root}/apps/mobile-core/src/profile.js`, 'utf8'),
  fs.readFile(`${root}/apps/mobile-core/src/parentLinks.js`, 'utf8'),
  fs.readFile(`${root}/apps/scripts/mobile-prestore-check.mjs`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/app.config.js`, 'utf8'),
  fs.readFile(`${root}/apps/coach-mobile/app.config.js`, 'utf8'),
])
const [portalDataSource, portalScreensSource] = await Promise.all([
  fs.readFile(`${root}/apps/parent-mobile/src/parentPortalData.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/src/ParentPortalScreens.js`, 'utf8'),
])

function makeLink(overrides = {}) {
  return {
    clubId: 'club-one',
    clubName: 'FP TEST Club',
    id: 'link-one',
    playerId: 'player-one',
    playerName: 'FP TEST Player',
    teamId: 'team-one',
    teamName: 'FP TEST Mobile U12',
    ...overrides,
  }
}

test('Parent links count unique Players and never turn a Team label into a child', () => {
  const user = {
    parentPortalLinks: [
      makeLink(),
      makeLink({ id: 'duplicate-membership-row', teamId: 'team-two', teamName: 'FP TEST Mobile U13' }),
      { id: 'team-row', playerId: '', playerName: 'FP TEST Mobile U12', teamId: 'team-one', teamName: 'FP TEST Mobile U12' },
    ],
  }

  const links = getParentPortalLinks(user)
  assert.equal(links.length, 1)
  assert.equal(links[0].playerName, 'FP TEST Player')
  assert.equal(links[0].teamName, 'FP TEST Mobile U12')
  assert.doesNotMatch(parentLinksSource, /teamName.*seen|seen.*teamName/i)
})

test('multiple genuine children render as separate contexts and switch by Parent link', () => {
  const first = makeLink()
  const second = makeLink({
    id: 'link-two',
    playerId: 'player-two',
    playerName: 'FP TEST Player Two',
    teamId: 'team-two',
    teamName: 'FP TEST Mobile U14',
  })
  const unrelated = makeLink({
    id: 'link-unrelated',
    playerId: '',
    playerName: 'Unrelated Player',
  })
  const user = { parentPortalLinks: [first, second, unrelated], selectedParentLinkId: first.id }
  const links = getParentPortalLinks(user)

  assert.deepEqual(links.map((link) => link.playerName), ['FP TEST Player', 'FP TEST Player Two'])
  assert.equal(getSelectedParentLink(user).playerId, 'player-one')
  const switchedUser = withSelectedParentLink(user, second)
  assert.equal(getSelectedParentLink(switchedUser).playerId, 'player-two')
  assert.equal(getSelectedParentLink(switchedUser).teamName, 'FP TEST Mobile U14')
})

test('Parent shell exposes only approved mobile areas with Android back and detail handling', () => {
  for (const label of ['Home', 'Calendar', 'Matchday', 'Chat', 'More']) {
    assert.match(appSource, new RegExp(`label: '${label}'`))
  }

  assert.match(appSource, /BackHandler\.addEventListener\('hardwareBackPress'/)
  assert.match(appSource, /setSelectedMessageId\(''\)/)
  assert.match(appSource, /setSelectedMatchId\(''\)/)
  assert.match(appSource, /setSelectedRoomId\(''\)/)
  assert.match(appSource, /setMoreSection\(''\)/)
  assert.match(appSource, /if \(activeTab !== 'home'\)/)
  assert.doesNotMatch(`${appSource}\n${portalScreensSource}`, /Staff tactics|Admin controls|staff-only/i)
})

test('Parent notifications request permission only from Settings and scorer controls use Parent RPC authority', () => {
  const initialize = notificationSource.slice(
    notificationSource.indexOf('export async function initializeParentNotifications'),
    notificationSource.indexOf('export function addParentPushTokenListener'),
  )
  const enable = notificationSource.slice(
    notificationSource.indexOf('export async function enableParentNotifications'),
    notificationSource.indexOf('export async function updateParentNotificationPreference'),
  )
  assert.doesNotMatch(initialize, /requestPermissionsAsync/)
  assert.match(enable, /requestPermissionsAsync/)
  assert.match(appSource, /onPress=\{\(\) => onNotificationModeChange\(choice\.key\)\}/)
  assert.doesNotMatch(appSource, /accessibilityLabel="Parent notifications"/)
  assert.doesNotMatch(appSource, /useMobileDeviceControls|enableNotifications/)
  assert.doesNotMatch(appSource, /volunteerAsMatchScorer|updateCoachMatchStatus|addCoachMatchGoal|undoCoachLastMatchGoal/)
  assert.match(portalDataSource, /express_match_day_scorer_interest/)
  assert.match(portalDataSource, /record_match_day_goal_v2/)
  assert.match(portalScreensSource, /selectedMatch\.events/)
})

test('Home model remains child-scoped and distinguishes upcoming, recent, unread and polls', () => {
  const matches = [
    { id: 'future', matchDate: '2099-01-02', kickoffTime: '10:00', status: 'scheduled' },
    { id: 'past', matchDate: '2020-01-02', kickoffTime: '10:00', status: 'full_time' },
  ]
  const groups = getParentMatchGroups(matches, new Date('2026-08-06T12:00:00Z'))
  assert.deepEqual(groups.upcoming.map((match) => match.id), ['future'])
  assert.deepEqual(groups.recent.map((match) => match.id), ['past'])

  const model = getParentHomeModel({
    calendarEvents: [],
    matches,
    messages: [{ id: 'message-one', readAt: '', subject: 'Training update' }],
    polls: [{ id: 'poll-one', currentOptionId: '', currentOptionIds: [], status: 'open', title: 'Arrival time' }],
  })
  assert.equal(model.nextActivity.item.id, 'future')
  assert.equal(model.unreadMessages, 1)
  assert.equal(model.unansweredPolls, 1)
})

test('Parent Home keeps the next Match in Fixtures when a Calendar item is Next up and orders fixtures chronologically', () => {
  const home = getParentHomeModel({
    calendarEvents: [{ id: 'training', startsAt: '2026-08-28T17:00:00Z', status: 'scheduled' }],
    matches: [
      { id: 'dk', kickoffTime: '10:00', matchDate: '2026-09-12', status: 'scheduled' },
      { id: 'haverhill', kickoffTime: '09:15', matchDate: '2026-08-29', status: 'scheduled' },
      { id: 'st-neots', kickoffTime: '11:45', matchDate: '2026-09-05', status: 'scheduled' },
    ],
    messages: [],
    now: new Date('2026-08-27T16:30:00Z'),
    polls: [],
  })

  assert.equal(home.nextActivity.type, 'calendar')
  assert.deepEqual(
    getParentHomeFixtureCards(home).map((match) => match.id),
    ['haverhill', 'st-neots', 'dk'],
  )
})

test('Parent Home removes only a Match already shown as Next up from the chronological Fixtures list', () => {
  const home = getParentHomeModel({
    calendarEvents: [],
    matches: [
      { id: 'st-neots', kickoffTime: '11:45', matchDate: '2026-09-05', status: 'scheduled' },
      { id: 'haverhill', kickoffTime: '09:15', matchDate: '2026-08-29', status: 'scheduled' },
      { id: 'dk', kickoffTime: '10:00', matchDate: '2026-09-12', status: 'scheduled' },
    ],
    messages: [],
    now: new Date('2026-08-27T16:30:00Z'),
    polls: [],
  })

  assert.equal(home.nextActivity.item.id, 'haverhill')
  assert.deepEqual(
    getParentHomeFixtureCards(home).map((match) => match.id),
    ['st-neots', 'dk'],
  )
})

test('Matchday, calendar, message and poll reads use existing Parent-authorised RPCs', () => {
  assert.match(dataSource, /supabase\.rpc\('get_parent_portal_match_days'/)
  assert.match(dataSource, /supabase\.rpc\('get_parent_portal_shared_calendar_events'/)
  assert.match(dataSource, /supabase\.rpc\('get_parent_portal_email_messages'/)
  assert.match(dataSource, /supabase\.rpc\('mark_parent_portal_message_read'/)
  assert.match(dataSource, /supabase\.rpc\('get_parent_portal_polls'/)
  assert.match(dataSource, /supabase\.rpc\('submit_parent_portal_poll_vote'/)
  assert.doesNotMatch(dataSource.slice(dataSource.indexOf('export async function submitParentPollVote'), dataSource.indexOf('export async function volunteerAsMatchScorer')), /\.from\('polls'\)/)
})

test('Matchday mapping includes Parent-visible fixture, availability, selection and location fields', () => {
  for (const field of [
    'arrivalTime',
    'availabilityStatus',
    'fixtureType',
    'kickoffTimeTbc',
    'squadDecisionState',
    'venueAddress',
    'venueName',
    'volunteerScorerResponse',
  ]) {
    assert.match(dataSource, new RegExp(`${field}:`))
  }
})

test('poll drafts support server-authorised initial responses and permitted changes only', () => {
  const poll = {
    allowVoteChanges: true,
    currentOptionId: 'one',
    currentOptionIds: ['one'],
    id: 'poll-one',
    isExpired: false,
    status: 'open',
  }

  assert.equal(getPollDraftOption(poll, {}), 'one')
  assert.equal(canSubmitParentPoll(poll, 'one'), false)
  assert.equal(canSubmitParentPoll(poll, 'two'), true)
  assert.equal(canSubmitParentPoll({ ...poll, allowVoteChanges: false }, 'two'), false)
  assert.equal(canSubmitParentPoll({ ...poll, allowMultiple: true, allowVoteChanges: false }, 'two'), true)
  assert.equal(canSubmitParentPoll({ ...poll, allowMultiple: true, allowVoteChanges: false }, 'one'), false)
  assert.equal(canSubmitParentPoll({ ...poll, allowMultiple: true, maxChoices: 1 }, 'two'), false)
  assert.equal(canSubmitParentPoll({ ...poll, isExpired: true }, 'two'), false)
  assert.match(appSource, /poll\.allowMultiple \? 'checkbox' : 'radio'/)
  assert.match(appSource, /Each change is saved separately/)
  assert.match(appSource, /poll\.allowOwnChildVotes === false/)
  assert.match(dataSource, /allowOwnChildVotes:/)
  assert.match(dataSource, /playerId: normalizeText\(option\?\.player_id/)
})

test('every major Parent screen has loading, empty, failure and retryable refresh treatment', () => {
  assert.match(appSource, /LoadingPanel/)
  assert.match(appSource, /EmptyPanel/)
  assert.match(appSource, /ResourceError/)
  assert.match(appSource, /RefreshControl/)
  assert.match(appSource, /Showing the last available information/)
  assert.match(experienceSource, /No connection\. Check your network and try again\./)
})

test('friendly errors fail closed without rendering raw exceptions', () => {
  assert.equal(
    getParentFriendlyError(new Error('Network request failed')),
    'No connection. Check your network and try again.',
  )
  assert.equal(
    getParentFriendlyError({ code: '42501', message: 'permission denied for table' }),
    'You do not have access to this information.',
  )
  assert.equal(
    getParentFriendlyError(new Error('unexpected database internals'), 'Messages could not be loaded.'),
    'Messages could not be loaded.',
  )
})

test('signed-in accounts with no active link receive the safe no-child state', () => {
  assert.doesNotMatch(profileSource, /links\.length === 0[\s\S]{0,100}throw new Error/)
  assert.match(profileSource, /hasParentAccess: Boolean\(selectedLink\?\.id\)/)
  assert.match(appSource, /No child linked/)
})

test('Settings contain local biometric explanation, identity, child summary and restrained test classification', () => {
  assert.match(appSource, /Biometric app lock/)
  assert.match(appSource, /does not change your Football Player password/)
  assert.match(appSource, /Signed-in Parent/)
  assert.match(appSource, /Linked children/)
  assert.equal(getBuildClassification('internal'), 'Internal test build')
  assert.equal(getBuildClassification('store-test'), 'TestFlight test build')
  assert.match(appSource, /Application\.nativeApplicationVersion/)
  assert.match(appSource, /Application\.nativeBuildVersion/)
  assert.doesNotMatch(appSource, /<InfoRow[^>]*(supabase|eas|project ref|access token)/i)
  assert.doesNotMatch(appSource, /Supabase:|API:|Access token:/i)
})

test('cold session restoration resolves biometric lock before exposing the authenticated session', () => {
  const biometricRead = startupStateSource.indexOf('getBiometricEnabled()')
  const restoredSessionWrite = startupStateSource.indexOf('onSession?.(session)')

  assert.ok(biometricRead >= 0)
  assert.ok(restoredSessionWrite > biometricRead)
  assert.match(startupStateSource, /onLock\?\.\(Boolean\(biometricEnabled\)\)/)
  assert.match(authSource, /setStartupState\(nextState\)/)
  assert.match(authSource, /event === 'INITIAL_SESSION'/)
})

test('native identities remain the existing Parent and Coach applications', () => {
  assert.match(parentConfig, /bundleIdentifier: 'com\.footballplayer\.parents'/)
  assert.match(parentConfig, /packageName: 'com\.footballplayer\.parents'/)
  assert.match(parentConfig, /scheme: 'footballplayerparents'/)
  assert.match(parentConfig, /slug: 'football-player-parents'/)
  assert.match(coachConfig, /bundleIdentifier: 'com\.footballplayer\.coach'/)
})

test('pre-store guard verifies the rebuilt Parent architecture and server poll authority', () => {
  assert.match(prestoreSource, /Parents safe-area shell/)
  assert.match(prestoreSource, /Parents mobile tab shell/)
  assert.match(prestoreSource, /Parents child context shell/)
  assert.match(prestoreSource, /Mobile parent poll authority/)
  assert.match(prestoreSource, /Mobile no-child state/)
})
