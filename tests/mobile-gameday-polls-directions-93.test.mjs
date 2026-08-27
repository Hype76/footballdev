import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildAuthoritativePollResultEmail,
  buildPollResultHtml,
  getPollResultSummary,
} from '../src/lib/poll-result-email.js'
import {
  getParentCalendarDirectionsUrl,
  getParentMatchDirectionsUrl,
} from '../apps/parent-mobile/src/parentExperience.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const [coachScreen, parentApp, parentScreens, pollSender, coachPackage] = await Promise.all([
  fs.readFile(`${root}/apps/coach-mobile/src/CoachMatchDayScreen.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/App.js`, 'utf8'),
  fs.readFile(`${root}/apps/parent-mobile/src/ParentPortalScreens.js`, 'utf8'),
  fs.readFile(`${root}/netlify/functions/send-poll-result-notifications.js`, 'utf8'),
  fs.readFile(`${root}/apps/coach-mobile/package.json`, 'utf8'),
])

const ranked = [
  { count: 3, id: 'yes', label: 'Yes' },
  { count: 1, id: 'maybe', label: 'Maybe' },
  { count: 0, id: 'no', label: 'No' },
]

test('Parent directions use the native map provider for Calendar and Match Day locations', () => {
  const calendar = { location: 'Kester Way, St Neots, PE19 6SL' }
  const match = { venueAddress: 'Kester Way, St Neots, PE19 6SL', venueName: 'Premier Plus Stadium' }

  assert.equal(
    getParentCalendarDirectionsUrl(calendar, 'ios'),
    'https://maps.apple.com/?q=Kester%20Way%2C%20St%20Neots%2C%20PE19%206SL',
  )
  assert.equal(
    getParentCalendarDirectionsUrl(calendar, 'android'),
    'https://www.google.com/maps/search/?api=1&query=Kester%20Way%2C%20St%20Neots%2C%20PE19%206SL',
  )
  assert.match(getParentMatchDirectionsUrl(match, 'ios'), /Premier%20Plus%20Stadium/)
  assert.equal(getParentCalendarDirectionsUrl({}, 'android'), '')
})

test('Parent home and Calendar cards expose directions through the existing safe link opener', () => {
  assert.match(parentApp, /getParentCalendarDirectionsUrl/)
  assert.match(parentApp, /<CalendarCard[\s\S]*event=\{event\}[\s\S]*key=\{event\.id\}[\s\S]*onOpenLink=\{onOpenLink\}/)
  assert.match(parentApp, /label="Get directions" onPress=\{\(\) => onOpenLink\?\.\(directionsUrl, 'directions'\)\}/)
  assert.match(parentScreens, /getParentCalendarDirectionsUrl\(event, Platform\.OS\)/)
  assert.match(parentScreens, /onOpenLink\?\.\(directionsUrl, 'directions'\)/)
})

test('Parent Game Day provides live read-only parity and gates scorer controls with existing authority', () => {
  for (const copy of ['Live sync on', 'Match timer', 'Parent view', 'Match Timeline', 'No match events yet']) {
    assert.match(parentScreens, new RegExp(copy))
  }
  assert.match(parentScreens, /getCoachMatchDayPresentation\(selectedMatch, now\)/)
  assert.match(parentScreens, /setInterval\(\(\) => onLiveRefresh\(\), 15000\)/)
  assert.match(parentScreens, /!selectedMatch\.isScorer \? <View/)
  assert.match(parentScreens, /selectedMatch\.isScorer \? <ScorerControls/)
  assert.match(parentScreens, /Accepted Parent scorer/)
  assert.match(parentApp, /onLiveRefresh=\{refreshParentMatchDay\}/)
  assert.doesNotMatch(parentScreens, /getCoachMatchDayActions|selectCoachMatchDayVolunteer/)
})

test('Coach Game Day matches the canonical live controller while preserving confirmations and server checks', () => {
  for (const copy of ['Game Day', 'Live controller', 'Manage fixture', 'Exit Game Mode', 'Keep screen awake', 'Goal', 'Yellow', 'Red', 'Sub', 'Pause', 'Hydration', 'HT', 'Match Timeline', 'Coach view']) {
    assert.match(coachScreen, new RegExp(copy))
  }
  assert.match(coachScreen, /activateKeepAwakeAsync/)
  assert.match(coachScreen, /setPanel\(isLiveMatch\(detail\) \? 'live' : 'overview'\)/)
  assert.match(coachScreen, /Start this match\?/)
  assert.match(coachScreen, /getCoachMatchDayActions\(\{ context, match, reconciling, stale \}\)/)
  assert.match(coachScreen, /runCoachMatchDayTimerAction/)
  assert.match(coachScreen, /recordCoachMatchDayEvent/)
  assert.match(coachScreen, /selectedMatchId\.current = match\?\.id \|\| requestedFixtureId \|\| ''/)
  assert.match(coachScreen, /setPanel\(isLiveMatch\(match\) \? 'live' : 'overview'\)/)
  assert.match(coachPackage, /"expo-keep-awake": "~15\.0\.8"/)
})

test('Poll result summary covers winners, ties and no-vote outcomes', () => {
  assert.equal(getPollResultSummary(ranked), 'Yes finished first with 3 votes.')
  assert.equal(getPollResultSummary([{ count: 2, label: 'One' }, { count: 2, label: 'Two' }]), 'One, Two finished level with 2 votes each.')
  assert.equal(getPollResultSummary([{ count: 0, label: 'One' }]), 'The poll closed without any recorded votes.')
})

test('Poll result email is branded, complete and safe for email clients', async () => {
  const fetchImpl = async () => ({
    body: { cancel: async () => {} },
    headers: { get: () => 'image/png' },
    ok: true,
    status: 200,
  })
  const email = await buildAuthoritativePollResultEmail({
    clubLogoUrl: 'https://assets.example.com/st-neots.png',
    clubName: 'St Neots',
    fetchImpl,
    pollId: 'poll-one',
    pollTitle: 'Choose arrival time',
    ranked,
    teamName: 'U14 EJA',
    themeAccent: '#2bb8c6',
  })

  assert.equal(email.fromDisplayName, 'St Neots via Football Player')
  assert.equal(email.subject, 'St Neots: Poll result - Choose arrival time')
  for (const copy of ['St Neots', 'U14 EJA', 'Choose arrival time', 'Yes finished first with 3 votes.', 'Yes', 'Maybe', 'No', '4 votes recorded', 'Open polls', 'Delivered securely through Footballplayer.online.']) {
    assert.match(email.html, new RegExp(copy))
  }
  assert.match(email.html, /data-logo-source="club"/)
  assert.match(email.html, /75%/)
  assert.match(email.html, /pollId=poll-one/)
  assert.match(email.text, /Maybe: 1 vote \(25%\)/)

  const escaped = buildPollResultHtml({
    clubName: '<script>bad</script>',
    pollTitle: '<b>Question</b>',
    ranked: [{ count: 1, label: '<img src=x>' }],
    teamName: '<Team>',
  })
  assert.doesNotMatch(escaped, /<script>|<b>Question<\/b>|<img src=x>/)
  assert.match(escaped, />bQuestion\/b<\/h2>/)
})

test('Poll result sender loads authoritative club and Team branding without weakening idempotency', () => {
  assert.match(pollSender, /from\('clubs'\)[\s\S]*select\('id, name, logo_url, theme_accent'\)/)
  assert.match(pollSender, /from\('teams'\)[\s\S]*select\('id, club_id, name, notification_display_name'\)/)
  assert.match(pollSender, /resolveTeamNotificationDisplayName\(brand\.team \|\| \{\}, brand\.team\?\.name\)/)
  assert.match(pollSender, /buildAuthoritativePollResultEmail/)
  assert.match(pollSender, /createFromAddress\(emailPresentation\.fromDisplayName\)/)
  assert.match(pollSender, /idempotencyKey: `poll-results:\$\{poll\.id\}:\$\{authUserId\}`/)
  assert.match(pollSender, /onConflict: 'poll_id,auth_user_id'/)
})
