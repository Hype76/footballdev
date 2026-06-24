import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PARENT_PORTAL_BRANDING,
  resolveParentPortalBranding,
} from '../src/lib/parent-portal-branding.js'

const clubAFirstTeam = {
  id: 'link-club-a-team-1',
  clubId: 'club-a',
  teamId: 'club-a-team-1',
  themeMode: 'dark',
  themeAccent: 'blue',
  themeButtonStyle: 'gradient',
}

const clubASecondTeam = {
  id: 'link-club-a-team-2',
  clubId: 'club-a',
  teamId: 'club-a-team-2',
  themeMode: 'light',
  themeAccent: 'red',
  themeButtonStyle: 'solid',
}

const clubBTeam = {
  id: 'link-club-b-team-1',
  clubId: 'club-b',
  teamId: 'club-b-team-1',
  themeMode: 'system',
  themeAccent: 'green',
  themeButtonStyle: 'solid',
}

test('parent with one linked child gets selected child club branding from the current club source', () => {
  const branding = resolveParentPortalBranding({
    selectedLink: clubAFirstTeam,
    links: [clubAFirstTeam],
  })

  assert.deepEqual(branding, {
    mode: 'dark',
    accent: 'blue',
    buttonStyle: 'gradient',
    sourceClubId: 'club-a',
    sourceLinkId: 'link-club-a-team-1',
  })
})

test('parent with two children in the same club keeps consistent branding across teams', () => {
  const links = [clubAFirstTeam, clubASecondTeam]

  assert.equal(resolveParentPortalBranding({ selectedLink: clubAFirstTeam, links }).accent, 'blue')
  assert.equal(resolveParentPortalBranding({ selectedLink: clubASecondTeam, links }).accent, 'blue')
  assert.equal(resolveParentPortalBranding({ selectedLink: clubASecondTeam, links }).sourceLinkId, 'link-club-a-team-1')
})

test('parent with children in different clubs changes branding when selected child changes', () => {
  const links = [clubAFirstTeam, clubBTeam]

  assert.equal(resolveParentPortalBranding({ selectedLink: clubAFirstTeam, links }).accent, 'blue')
  assert.equal(resolveParentPortalBranding({ selectedLink: clubBTeam, links }).accent, 'green')
})

test('switching back to the first child restores the first club branding without stale colours', () => {
  const links = [clubAFirstTeam, clubBTeam]
  const firstBranding = resolveParentPortalBranding({ selectedLink: clubAFirstTeam, links })
  const secondBranding = resolveParentPortalBranding({ selectedLink: clubBTeam, links })
  const restoredBranding = resolveParentPortalBranding({ selectedLink: clubAFirstTeam, links })

  assert.equal(firstBranding.accent, 'blue')
  assert.equal(secondBranding.accent, 'green')
  assert.equal(restoredBranding.accent, 'blue')
  assert.equal(restoredBranding.sourceClubId, 'club-a')
})

test('missing or invalid club branding falls back safely without parent account override', () => {
  const branding = resolveParentPortalBranding({
    selectedLink: {
      id: 'link-no-branding',
      clubId: 'club-no-branding',
      themeMode: 'unsupported',
      themeAccent: 'orange',
      themeButtonStyle: 'outline',
    },
    links: [],
  })

  assert.deepEqual(branding, {
    ...DEFAULT_PARENT_PORTAL_BRANDING,
    sourceClubId: 'club-no-branding',
    sourceLinkId: 'link-no-branding',
  })
})
