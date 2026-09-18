import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { MATCHDAY_DEFAULT_FLAGS } from '../src/lib/matchday-policy.js'
import {
  getFirstAllowedParentSection,
  isParentSectionAllowed,
} from '../src/lib/parent-plan-access.js'
import {
  getFanAccessForPlan,
  isFanAccessAllowedForPlan,
  normalizeFanProfileLink,
  restrictFanPermissionsForPlan,
} from '../src/lib/fans.js'

const matchdayPolicy = { revision: 'test', flags: { ...MATCHDAY_DEFAULT_FLAGS } }

test('Parent sections inherit the selected player team plan and keep paid plans complete', () => {
  const matchdayLink = { planKey: 'matchday' }
  assert.equal(isParentSectionAllowed(matchdayLink, 'calendar', matchdayPolicy), true)
  assert.equal(isParentSectionAllowed(matchdayLink, 'matches', matchdayPolicy), true)
  assert.equal(isParentSectionAllowed(matchdayLink, 'development', matchdayPolicy), false)
  assert.equal(isParentSectionAllowed(matchdayLink, 'resources', matchdayPolicy), false)
  assert.equal(isParentSectionAllowed(matchdayLink, 'chat', matchdayPolicy), false)
  assert.equal(isParentSectionAllowed(matchdayLink, 'polls', matchdayPolicy), false)
  assert.equal(isParentSectionAllowed(matchdayLink, 'matches', null), false)
  assert.equal(isParentSectionAllowed({}, 'matches', matchdayPolicy, 'club'), false)
  assert.equal(isParentSectionAllowed({ planKey: 'team' }, 'development'), true)
  assert.equal(isParentSectionAllowed({ planKey: 'club' }, 'resources'), true)
  assert.equal(getFirstAllowedParentSection(matchdayLink, matchdayPolicy), 'overview')
})

test('switching Fan players recalculates visible and directly openable access', () => {
  const permissions = { schedule: true, game_day: true, development: true, resources: true }
  const matchdayConnection = { plan_key: 'matchday', permissions }
  const teamConnection = { plan_key: 'team', permissions }

  assert.deepEqual(getFanAccessForPlan(matchdayConnection, matchdayPolicy).map((item) => item.key), ['schedule', 'game_day'])
  assert.equal(isFanAccessAllowedForPlan(matchdayConnection, 'notifications', matchdayPolicy), true)
  assert.equal(isFanAccessAllowedForPlan(matchdayConnection, 'development', matchdayPolicy), false)
  assert.equal(isFanAccessAllowedForPlan(matchdayConnection, 'matches', null), false)
  assert.equal(isFanAccessAllowedForPlan({ permissions }, 'matches', matchdayPolicy), false)
  assert.deepEqual(restrictFanPermissionsForPlan(permissions, matchdayConnection, matchdayPolicy), {
    schedule: true,
    game_day: true,
    development: false,
    resources: false,
  })
  assert.deepEqual(getFanAccessForPlan(teamConnection).map((item) => item.key), ['schedule', 'game_day', 'development', 'resources'])
})

test('Fan profile links retain the authoritative selected player plan context', () => {
  const link = normalizeFanProfileLink({
    id: 'fan-link',
    plan_key: 'matchday',
    plan_status: 'active',
    permissions: {},
  })
  assert.equal(link.planKey, 'matchday')
  assert.equal(link.planStatus, 'active')
})

test('Parent and Fan surfaces hide denied entries and guard direct opens', async () => {
  const [shell, fansWeb, fansMobile, parentApp] = await Promise.all([
    readFile(new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/FansPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/src/FansScreen.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  ])

  assert.match(shell, /isParentSectionAllowed\(selectedLink, section\.id, matchdayPolicy/)
  assert.match(shell, /canOpenActiveSection \? children/)
  assert.match(shell, /resolveParentPortalDisplayLink\(link, matchdayPolicy\)/)
  assert.match(fansWeb, /getFanAccessForPlan\(c, matchdayPolicy\)/)
  assert.match(fansWeb, /isFanAccessAllowedForPlan\(connection, action, matchdayPolicy\)/)
  assert.match(fansMobile, /getFanAccessForPlan\(parent, matchdayPolicy\)/)
  assert.match(fansMobile, /isFanAccessAllowedForPlan\(connection, action, matchdayPolicy\)/)
  assert.match(parentApp, /isMobileCapabilityAllowed\(parentPlanContext, 'parentChat', matchdayPlanConfig\)/)
  assert.match(parentApp, /normalizedRoute === 'results'[\s\S]{0,160}isMobileCapabilityAllowed\(parentPlanContext, 'matchDay', matchdayPlanConfig\)/)
  assert.match(parentApp, /return <LoadingScreen message="Checking your player's team access\.\.\."/)
  assert.match(parentApp, /\.filter\(\(\{ key \}\) => parentRouteAllowed\(key\)\)/)
  assert.match(parentApp, /const renderedActiveTab = parentRouteAllowed\(activeTab\) \? activeTab : 'home'/)
  assert.match(parentApp, /const renderedMoreSection = moreSection && parentRouteAllowed\(moreSection\) \? moreSection : ''/)
  assert.match(parentApp, /if \(!parentRouteAllowed\(activeTab\)\) setActiveTab\('home'\)/)
  assert.doesNotMatch(parentApp, /setActiveTab\('more'\)[\s\S]{0,120}setMoreSection\('settings'\)/)
})
