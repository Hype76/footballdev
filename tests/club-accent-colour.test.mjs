import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  normalizeClubMembershipRow,
  normalizeUserProfile,
} from '../src/lib/domain/profile-normalizers.js'
import {
  resolveParentPortalBranding,
} from '../src/lib/parent-portal-branding.js'
import {
  THEME_ACCENTS,
  normalizeClubAccentColour,
  themeAccentOptions,
} from '../src/lib/theme.js'

const actionUrl = new URL('../src/lib/domain/club-settings-actions.js', import.meta.url)
const authUrl = new URL('../src/lib/auth.js', import.meta.url)
const constantsUrl = new URL('../src/lib/domain/core-constants.js', import.meta.url)
const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const cssUrl = new URL('../src/index.css', import.meta.url)
const onboardingUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)
const parentPortalUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const settingsUrl = new URL('../src/pages/UserSettingsPage.jsx', import.meta.url)

function luminance(hex) {
  const normalized = String(hex).replace('#', '')
  const channels = normalized.match(/.{2}/g).map((value) => {
    const channel = Number.parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

function contrastRatio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function getCssBlock(source, selector) {
  const selectorIndex = source.indexOf(selector)
  assert.notEqual(selectorIndex, -1, `${selector} not found`)
  const blockStart = source.indexOf('{', selectorIndex)
  const blockEnd = source.indexOf('\n  }', blockStart)
  assert.notEqual(blockEnd, -1, `${selector} block did not close`)
  return source.slice(blockStart + 1, blockEnd)
}

function getCssVariable(block, variableName) {
  const match = block.match(new RegExp(`${variableName}:\\s*(#[0-9a-fA-F]{6})`))
  assert.ok(match, `${variableName} not found`)
  return match[1]
}

test('staff profile and membership hydration prefer the selected club accent', () => {
  const profile = normalizeUserProfile({
    id: 'user-a',
    email: 'admin@example.test',
    role: 'admin',
    role_rank: 90,
    club_id: 'club-a',
    theme_accent: 'red',
    clubs: {
      name: 'Club A',
      theme_accent: 'purple',
      plan_key: 'small_club',
      plan_status: 'active',
      is_plan_comped: true,
    },
  })
  const membership = normalizeClubMembershipRow({
    id: 'membership-a',
    auth_user_id: 'user-a',
    email: 'admin@example.test',
    role: 'admin',
    role_rank: 90,
    club_id: 'club-b',
    clubs: {
      name: 'Club B',
      theme_accent: 'blue',
      plan_key: 'small_club',
      plan_status: 'active',
      is_plan_comped: true,
    },
  })

  assert.equal(profile.themeAccent, 'purple')
  assert.equal(membership.themeAccent, 'blue')
})

test('club accent input accepts the full valid set and rejects unsupported values', () => {
  for (const accent of THEME_ACCENTS) {
    assert.equal(normalizeClubAccentColour(` ${accent.toUpperCase()} `), accent)
  }

  assert.throws(
    () => normalizeClubAccentColour('orange'),
    /Choose a valid club accent colour/i,
  )
})

test('Parent branding uses each selected club accent without a team or club leak', () => {
  const clubAFirst = {
    id: 'a-1',
    clubId: 'club-a',
    teamId: 'team-a-1',
    themeAccent: 'purple',
    themeMode: 'dark',
    themeButtonStyle: 'solid',
  }
  const clubASecond = {
    id: 'a-2',
    clubId: 'club-a',
    teamId: 'team-a-2',
    themeAccent: 'purple',
    themeMode: 'light',
    themeButtonStyle: 'gradient',
  }
  const clubB = {
    id: 'b-1',
    clubId: 'club-b',
    teamId: 'team-b-1',
    themeAccent: 'blue',
    themeMode: 'system',
    themeButtonStyle: 'solid',
  }
  const links = [clubAFirst, clubASecond, clubB]

  assert.equal(resolveParentPortalBranding({ selectedLink: clubAFirst, links }).accent, 'purple')
  assert.equal(resolveParentPortalBranding({ selectedLink: clubASecond, links }).accent, 'purple')
  assert.equal(resolveParentPortalBranding({ selectedLink: clubB, links }).accent, 'blue')
  assert.equal(resolveParentPortalBranding({ selectedLink: clubAFirst, links }).accent, 'purple')
})

test('club accent action and hydration paths remain club scoped', async () => {
  const [actionSource, authSource, constantsSource, coreSource, onboardingSource, parentPortalSource, settingsSource] = await Promise.all([
    readFile(actionUrl, 'utf8'),
    readFile(authUrl, 'utf8'),
    readFile(constantsUrl, 'utf8'),
    readFile(coreUrl, 'utf8'),
    readFile(onboardingUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
    readFile(settingsUrl, 'utf8'),
  ])

  assert.match(actionSource, /export async function updateClubAccentColour/)
  assert.match(actionSource, /user\?\.role !== 'admin'/)
  assert.match(actionSource, /String\(user\?\.clubId[\s\S]*!== normalizedClubId/)
  assert.match(actionSource, /normalizeClubAccentColour\(themeAccent\)/)
  assert.match(actionSource, /CAPABILITIES\.customColoursBranding/)
  assert.match(actionSource, /\.from\('clubs'\)[\s\S]*theme_accent: normalizedThemeAccent/)
  assert.match(constantsSource, /CLUB_SELECT = '[^']*theme_accent/)
  assert.match(constantsSource, /MEMBERSHIP_CLUB_SELECT = '[^']*theme_accent/)
  assert.match(coreSource, /clubs:club_id \(name, logo_url, contact_email, theme_accent\)/)
  assert.match(parentPortalSource, /clubs:club_id \(name, contact_email, theme_accent\)/)
  assert.match(settingsSource, /await updateClubAccentColour\(/)
  assert.match(onboardingSource, /await updateClubAccentColour\(/)
  assert.doesNotMatch(authSource, /themeAccent:\s*selectedTeam\.themeAccent/)
  assert.doesNotMatch(authSource, /themeAccent:\s*onlyTeam\.themeAccent/)
})

test('all valid accent choices are exposed and light and dark button text meets AA contrast', async () => {
  assert.deepEqual(themeAccentOptions.map((option) => option.value), THEME_ACCENTS)

  const css = await readFile(cssUrl, 'utf8')

  for (const accent of THEME_ACCENTS) {
    const lightBlock = getCssBlock(css, `html.accent-${accent},`)
    const darkBlock = getCssBlock(css, `html.theme-dark.accent-${accent},`)
    const lightBackground = getCssVariable(lightBlock, '--button-primary')
    const lightText = getCssVariable(lightBlock, '--button-primary-text')
    const darkBackground = getCssVariable(darkBlock, '--button-primary')
    const darkText = getCssVariable(darkBlock, '--button-primary-text')

    assert.ok(contrastRatio(lightText, lightBackground) >= 4.5, `${accent} light contrast is below 4.5`)
    assert.ok(contrastRatio(darkText, darkBackground) >= 4.5, `${accent} dark contrast is below 4.5`)
  }
})
