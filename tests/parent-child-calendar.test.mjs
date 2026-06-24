import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const footballCalendarUrl = new URL('../src/components/sessions/FootballCalendar.jsx', import.meta.url)

test('parent child selector labels include child name and team name', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const formatterStart = source.indexOf('function formatParentChildTeamLabel')
  const formatterEnd = source.indexOf('function isPreviousMatch', formatterStart)
  const formatterSection = source.slice(formatterStart, formatterEnd)
  const selectorStart = source.indexOf('function ParentChildSelector')
  const selectorEnd = source.indexOf('function PushNotificationPanel', selectorStart)
  const selectorSection = source.slice(selectorStart, selectorEnd)

  assert.match(formatterSection, /const childName = String\(link\?\.playerName/)
  assert.match(formatterSection, /const teamName = String\(link\?\.teamName/)
  assert.match(formatterSection, /Team not available/)
  assert.match(formatterSection, /return `\$\{childName\} - \$\{teamName\}`/)
  assert.match(selectorSection, /links\.map\(\(link\) => \(/)
  assert.match(selectorSection, /\{formatParentChildTeamLabel\(link\)\}/)
})

test('parent child context removes duplicate other linked children list and keeps sign out', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const selectorStart = source.indexOf('function ParentChildSelector')
  const selectorEnd = source.indexOf('function PushNotificationPanel', selectorStart)
  const selectorSection = source.slice(selectorStart, selectorEnd)

  assert.match(selectorSection, /<ParentPortalSignOutButton/)
  assert.match(selectorSection, /Team: \{selectedLink\.teamName \|\| 'No team assigned'\}/)
  assert.match(selectorSection, /Club: \{selectedLink\.clubName \|\| 'No club assigned'\}/)
  assert.doesNotMatch(selectorSection, /Other linked children/)
  assert.doesNotMatch(selectorSection, /otherLinks/)
})

test('parent calendar defaults to selected child mode and can switch to all linked children', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const panelStart = source.indexOf('function ParentCalendarPanel')
  const panelEnd = source.indexOf('function ParentMatchCardsPanel', panelStart)
  const panelSection = source.slice(panelStart, panelEnd)

  assert.match(source, /const \[calendarScope, setCalendarScope\] = useState\('selected'\)/)
  assert.match(source, /visibleCalendarEvents = calendarScope === 'all' \? allLinkedParentCalendarEvents : parentCalendarEvents/)
  assert.match(panelSection, /Selected child\/team only/)
  assert.match(panelSection, /All linked children/)
  assert.match(panelSection, /onClick=\{\(\) => onScopeChange\(option\.id\)\}/)
  assert.match(panelSection, /disabled=\{option\.id === 'all' && links\.length < 2\}/)
})

test('all linked calendar loads only authorised parent link contexts and labels events', async () => {
  const source = await readFile(parentPortalPageUrl, 'utf8')
  const loaderStart = source.indexOf('async function runLoadAllLinkedCalendar')
  const loaderEnd = source.indexOf('useEffect(() => {', loaderStart + 1)
  const loaderSection = source.slice(loaderStart, loaderEnd)
  const builderStart = source.indexOf('function attachParentCalendarContext')
  const builderEnd = source.indexOf('function ParentOverviewPanel', builderStart)
  const builderSection = source.slice(builderStart, builderEnd)

  assert.match(loaderSection, /calendarScope !== 'all'/)
  assert.match(loaderSection, /links\.map\(async \(link\) =>/)
  assert.match(loaderSection, /getParentPortalMatchDays\(\{ parentLinkId: link\.id \}\)/)
  assert.match(loaderSection, /getParentPortalEventInvites\(\{ parentLinkId: link\.id \}\)/)
  assert.match(loaderSection, /getParentPortalSharedCalendarEvents\(\{ parentLinkId: link\.id \}\)/)
  assert.doesNotMatch(loaderSection, /teamId/)
  assert.doesNotMatch(loaderSection, /playerId/)
  assert.match(builderSection, /contextLabel/)
  assert.match(builderSection, /childName/)
  assert.match(builderSection, /id: `\$\{link\.id\}:\$\{event\.id\}`/)
})

test('calendar month week agenda views render parent context labels', async () => {
  const source = await readFile(footballCalendarUrl, 'utf8')

  assert.match(source, /function getEventContextLabel\(event\)/)
  assert.match(source, /Month/)
  assert.match(source, /Week/)
  assert.match(source, /Agenda/)
  assert.match(source, /getEventContextLabel\(event\)/)
  assert.match(source, /\[event\.time \? `Time: \$\{event\.time\}` : '', getEventContextLabel\(event\), event\.location/)
})
