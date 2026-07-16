import { migrationSourceUrl } from './helpers/migration-source.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sessionsPageUrl = new URL('../src/pages/SessionsPage.jsx', import.meta.url)
const calendarDomainUrl = new URL('../src/lib/domain/calendar-events.js', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const parentPortalPageUrl = new URL('../src/pages/ParentPortalPage.jsx', import.meta.url)
const parentCalendarMigrationUrl = migrationSourceUrl('20260614030531_20260613120000_parent_calendar_visibility_controls.sql', 'active')
const calendarPolicyMigrationUrl = new URL('../supabase/migrations/20260622050850_paywall_server_enforcement.sql', import.meta.url)

function getFunctionSection(source, functionName) {
  const start = source.indexOf(`function ${functionName}`)
  assert.notEqual(start, -1, `${functionName} not found`)

  const nextFunction = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, nextFunction === -1 ? undefined : nextFunction)
}

test('club admin calendar route uses club-wide entitlement and excludes platform admin calendar access', async () => {
  const routerSource = await readFile(routerUrl, 'utf8')
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const layoutSource = await readFile(layoutUrl, 'utf8')
  const routeSection = getFunctionSection(routerSource, 'RequirePlayerWorkflowAccess')

  assert.match(routeSection, /location\.pathname === '\/calendar'/)
  assert.match(routeSection, /isClubAdmin\(user\)/)
  assert.match(routeSection, /canUseUiFeature\(user, CAPABILITIES\.clubWideCalendar\)/)
  assert.match(routeSection, /FeatureUnavailableState capability=\{CAPABILITIES\.clubWideCalendar\}/)
  assert.match(sidebarSource, /isClubAdmin\(displayUser\)[\s\S]*CAPABILITIES\.clubWideCalendar/)
  assert.match(layoutSource, /const canUseClubCalendarQuickAction =[\s\S]*isClubAdmin\(user\)[\s\S]*CAPABILITIES\.clubWideEvents/)
  assert.match(layoutSource, /Add Event'[\s\S]*canUseEvaluationQuickActions \|\| canUseClubCalendarQuickAction/)
  assert.match(routeSection, /needsTeamWorkflowContext\(user\)/)
})

test('club admin calendar loads club-wide events only and keeps calendar mutations role guarded', async () => {
  const domainSource = await readFile(calendarDomainUrl, 'utf8')
  const policyMigration = await readFile(calendarPolicyMigrationUrl, 'utf8')

  assert.match(domainSource, /export async function getCalendarEvents\(\{ user, clubWideOnly = false \} = \{\}\)/)
  assert.match(domainSource, /user\.role === 'parent_portal'/)
  assert.match(domainSource, /user\.role === 'super_admin'/)
  assert.match(domainSource, /const activeTeamId = clubWideOnly \? '' : normalizeText\(user\.activeTeamId\)/)
  assert.match(domainSource, /const cacheScope = clubWideOnly \? 'club-wide-only' : activeTeamId \|\| 'club-wide'/)
  assert.match(domainSource, /if \(clubWideOnly\) \{\s+query = query\.is\('team_id', null\)/)
  assert.match(policyMigration, /team_id is null[\s\S]*public\.current_user_role\(\) = 'admin'[\s\S]*public\.can_use_plan_feature\(calendar_events\.club_id, 'clubWideEvents'\)/)
  assert.match(policyMigration, /coalesce\(parent_visible, false\) = false[\s\S]*public\.can_use_plan_feature\(calendar_events\.club_id, 'parentPortal'\)/)
})

test('club admin calendar create flow is club-wide and uses a parent sharing toggle', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')

  assert.match(source, /const isClubWideCalendar = calendarOnly && isClubAdmin\(user\)/)
  assert.match(source, /getCalendarEvents\(\{ user, clubWideOnly: true \}\)/)
  assert.match(source, /clubWideOnly=\{isClubWideCalendar\}/)
  assert.match(source, /Club-wide events shared across the club\./)
  assert.match(source, /EVENT_TYPE_OPTIONS\.filter\(\(option\) => !\['training', 'match'\]\.includes\(option\.value\)\)/)
  assert.match(source, /const eventType = \(isClubWideCalendar \|\| calendarOnly\) \? 'general' : defaultForm\.eventType/)
  assert.match(source, /eventType,/)
  assert.match(source, /const safeTeamId = isClubWideCalendar \? '' : getSafeCalendarTeamId\(user, calendarForm\.teamId\)/)
  assert.match(source, /parentAudience: isClubWideShareableCalendarEvent\(\{ form, safeTeamId, user \}\) \? 'all_club_parents' : form\.parentAudience/)
  assert.match(source, /<span className="block text-sm font-black text-\[#101828\]">Share with parents<\/span>/)
  assert.match(source, /Parents will see this event in their Parent Portal calendar\./)
  assert.match(source, /Club Admin calendar events are shared across the club and are not tied to one team\./)
})

test('team-wide calendar parent sharing can queue linked parent emails', async () => {
  const source = await readFile(sessionsPageUrl, 'utf8')

  assert.match(source, /function buildCalendarNotificationPlayers\(form, invitePlayers, selectedPlayers\)/)
  assert.match(source, /form\.parentAudience === 'all_team_parents' && form\.notifyInvitedFamilies/)
  assert.match(source, /const sharedAllTeamParents = calendarForm\.shareWithParents && calendarForm\.parentAudience === 'all_team_parents'/)
  assert.match(source, /const notificationPlayers = buildCalendarNotificationPlayers\(calendarForm, calendarInvitePlayers, selectedCalendarInvitePlayers\)/)
  assert.match(source, /notifyRequested,\s*\n\s*\}\)/)
  assert.match(source, /Notify team families/)
  assert.match(source, /Parents will see the event in their Parent Portal and receive an email notification\./)
  assert.doesNotMatch(source, /holding queue/i)
})

test('parent portal can show shared club-wide calendar events once in all-linked mode', async () => {
  const pageSource = await readFile(parentPortalPageUrl, 'utf8')
  const migration = await readFile(parentCalendarMigrationUrl, 'utf8')
  const builderSection = getFunctionSection(pageSource, 'buildAllLinkedParentCalendarEvents')

  assert.match(pageSource, /isClubWide: event\.isClubWide === true/)
  assert.match(pageSource, /const contextLabel = event\.isClubWide \? 'Club-wide' : formatParentChildTeamLabel\(link\)/)
  assert.match(pageSource, /function getAllLinkedParentCalendarDedupeKey/)
  assert.match(builderSection, /const clubWideEventsBySource = new Map\(\)/)
  assert.match(builderSection, /getAllLinkedParentCalendarDedupeKey\(calendarEvent\)/)
  assert.match(builderSection, /club-wide:\$\{calendarEvent\.sourceType\}:\$\{calendarEvent\.sourceId\}/)
  assert.match(migration, /event\.parent_visible is true/)
  assert.match(migration, /event\.parent_audience in \('all_team_parents', 'all_club_parents'\)/)
  assert.match(migration, /event\.parent_audience = 'all_club_parents'[\s\S]*event\.club_id = link\.club_id/)
})
