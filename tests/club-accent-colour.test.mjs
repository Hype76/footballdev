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
  CUSTOM_THEME_ACCENT_OPTION,
  THEME_ACCENTS,
  THEME_BUTTON_STYLE_STORAGE_KEY,
  THEME_BUTTON_STYLE_VERSION,
  THEME_BUTTON_STYLE_VERSION_STORAGE_KEY,
  createThemeColorTokens,
  getStoredThemeButtonStyle,
  getThemeContrastRatio,
  normalizeClubAccentColour,
  normalizeClubButtonStyle,
  normalizeLegacyThemeButtonStyle,
  normalizeThemeButtonStyle,
  themeAccentOptions,
  themeButtonStyleOptions,
} from '../src/lib/theme.js'

const actionUrl = new URL('../src/lib/domain/club-settings-actions.js', import.meta.url)
const authUrl = new URL('../src/lib/auth.js', import.meta.url)
const constantsUrl = new URL('../src/lib/domain/core-constants.js', import.meta.url)
const coreUrl = new URL('../src/lib/domain/core.js', import.meta.url)
const cssUrl = new URL('../src/index.css', import.meta.url)
const displaySettingsUrl = new URL('../src/components/user-settings/DisplaySettingsSection.jsx', import.meta.url)
const onboardingUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)
const parentPortalUrl = new URL('../src/lib/domain/parent-portal.js', import.meta.url)
const settingsUrl = new URL('../src/pages/UserSettingsPage.jsx', import.meta.url)

test('staff profile and membership hydration prefer club display authority', () => {
  const profile = normalizeUserProfile({
    id: 'user-a',
    email: 'admin@example.test',
    role: 'admin',
    role_rank: 90,
    club_id: 'club-a',
    theme_accent: 'red',
    theme_button_style: 'gradient',
    clubs: {
      name: 'Club A',
      theme_accent: '#2b6cb0',
      theme_button_style: 'solid',
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
      theme_button_style: 'gradient',
      plan_key: 'small_club',
      plan_status: 'active',
      is_plan_comped: true,
    },
  })

  assert.equal(profile.themeAccent, '#2b6cb0')
  assert.equal(profile.themeButtonStyle, 'solid')
  assert.equal(membership.themeAccent, 'blue')
  assert.equal(membership.themeButtonStyle, 'gradient')
  assert.equal(normalizeUserProfile({ theme_button_style: 'gradient' }).themeButtonStyle, 'solid')
})

test('club accents accept fixed choices and strict lowercase six-digit custom values', () => {
  for (const accent of THEME_ACCENTS) {
    assert.equal(normalizeClubAccentColour(` ${accent.toUpperCase()} `), accent)
  }

  assert.equal(normalizeClubAccentColour('#2b6cb0'), '#2b6cb0')
  for (const invalidValue of ['#2B6CB0', '#abc', '#2b6cb080', 'transparent', 'var(--accent)', 'orange']) {
    assert.throws(
      () => normalizeClubAccentColour(invalidValue),
      /Choose a valid club accent colour/i,
    )
  }
})

test('new button styles are canonical while both old solid choices normalize to Solid', () => {
  assert.equal(normalizeClubButtonStyle('solid'), 'solid')
  assert.equal(normalizeClubButtonStyle('gradient'), 'gradient')
  assert.equal(normalizeClubButtonStyle('Solid colour'), 'solid')
  assert.equal(normalizeClubButtonStyle('Legacy solid'), 'solid')
  assert.equal(normalizeThemeButtonStyle('Solid colour'), 'solid')
  assert.equal(normalizeThemeButtonStyle('Legacy solid'), 'solid')
  assert.equal(normalizeLegacyThemeButtonStyle('gradient'), 'solid')
  assert.throws(() => normalizeClubButtonStyle('outline'), /valid club button style/i)
  assert.deepEqual(themeButtonStyleOptions, [
    { value: 'solid', label: 'Solid' },
    { value: 'gradient', label: 'Gradient' },
  ])
})

test('an old locally stored Legacy solid key upgrades to Solid before new Gradient is accepted', () => {
  const values = new Map([[THEME_BUTTON_STYLE_STORAGE_KEY, 'gradient']])
  const previousWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
    },
  }

  try {
    assert.equal(getStoredThemeButtonStyle(), 'solid')
    values.set(THEME_BUTTON_STYLE_VERSION_STORAGE_KEY, THEME_BUTTON_STYLE_VERSION)
    assert.equal(getStoredThemeButtonStyle(), 'gradient')
  } finally {
    if (typeof previousWindow === 'undefined') {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  }
})

test('Parent branding follows the selected club display without team or club leakage', () => {
  const clubAFirst = {
    id: 'a-1',
    clubId: 'club-a',
    teamId: 'team-a-1',
    themeAccent: '#2b6cb0',
    themeMode: 'dark',
    themeButtonStyle: 'gradient',
  }
  const staleSameClubLink = {
    id: 'a-2',
    clubId: 'club-a',
    teamId: 'team-a-2',
    themeAccent: '#2b6cb0',
    themeMode: 'light',
    themeButtonStyle: 'solid',
  }
  const clubB = {
    id: 'b-1',
    clubId: 'club-b',
    teamId: 'team-b-1',
    themeAccent: 'blue',
    themeMode: 'system',
    themeButtonStyle: 'solid',
  }
  const links = [clubAFirst, staleSameClubLink, clubB]

  assert.deepEqual(
    {
      accent: resolveParentPortalBranding({ selectedLink: clubAFirst, links }).accent,
      buttonStyle: resolveParentPortalBranding({ selectedLink: clubAFirst, links }).buttonStyle,
    },
    { accent: '#2b6cb0', buttonStyle: 'gradient' },
  )
  assert.deepEqual(
    {
      accent: resolveParentPortalBranding({ selectedLink: clubB, links }).accent,
      buttonStyle: resolveParentPortalBranding({ selectedLink: clubB, links }).buttonStyle,
    },
    { accent: 'blue', buttonStyle: 'solid' },
  )
})

test('club display actions, reads, and UI remain club scoped and explicit-save', async () => {
  const [
    actionSource,
    authSource,
    constantsSource,
    coreSource,
    cssSource,
    displaySettingsSource,
    onboardingSource,
    parentPortalSource,
    settingsSource,
  ] = await Promise.all([
    readFile(actionUrl, 'utf8'),
    readFile(authUrl, 'utf8'),
    readFile(constantsUrl, 'utf8'),
    readFile(coreUrl, 'utf8'),
    readFile(cssUrl, 'utf8'),
    readFile(displaySettingsUrl, 'utf8'),
    readFile(onboardingUrl, 'utf8'),
    readFile(parentPortalUrl, 'utf8'),
    readFile(settingsUrl, 'utf8'),
  ])

  assert.match(actionSource, /export async function updateClubDisplaySettings/)
  assert.match(actionSource, /user\?\.role !== 'admin'/)
  assert.match(actionSource, /String\(user\?\.clubId[\s\S]*!== normalizedClubId/)
  assert.match(actionSource, /normalizeClubAccentColour\(themeAccent\)/)
  assert.match(actionSource, /normalizeClubButtonStyle\(themeButtonStyle\)/)
  assert.match(actionSource, /CAPABILITIES\.customColoursBranding/)
  assert.match(actionSource, /theme_accent: normalizedThemeAccent[\s\S]*theme_button_style: normalizedThemeButtonStyle/)
  assert.match(constantsSource, /CLUB_SELECT = '[^']*theme_accent, theme_button_style/)
  assert.match(constantsSource, /MEMBERSHIP_CLUB_SELECT = '[^']*theme_accent, theme_button_style/)
  assert.match(coreSource, /clubs:club_id \(name, logo_url, contact_email, theme_accent, theme_button_style\)/)
  assert.match(parentPortalSource, /clubs:club_id \(name, contact_email, theme_accent, theme_button_style\)/)
  assert.match(settingsSource, /await updateClubDisplaySettings\(/)
  assert.match(settingsSource, /savedThemeButtonStyle/)
  assert.match(displaySettingsSource, /Preview only until saved/)
  assert.match(onboardingSource, /await updateClubDisplaySettings\(/)
  assert.doesNotMatch(authSource, /themeButtonStyle:\s*selectedTeam\.themeButtonStyle/)
  assert.doesNotMatch(authSource, /themeButtonStyle:\s*onlyTeam\.themeButtonStyle/)
  assert.match(displaySettingsSource, /Save club display/)
  assert.match(displaySettingsSource, /type="color"/)
  assert.match(displaySettingsSource, /pattern="#\[0-9a-f\]\{6\}"/)
  assert.match(cssSource, /\.app-theme-scope/)
  assert.match(cssSource, /\.club-display-preview\[data-button-style='gradient'\]/)
})

test('all fixed and custom accents expose readable deterministic state tokens in Light and Dark', () => {
  assert.deepEqual(
    themeAccentOptions.map((option) => option.value),
    [...THEME_ACCENTS, CUSTOM_THEME_ACCENT_OPTION],
  )

  for (const accent of [...THEME_ACCENTS, '#2b6cb0', '#8855ff', '#777777']) {
    for (const resolvedTheme of ['light', 'dark']) {
      const tokens = createThemeColorTokens(accent, resolvedTheme)
      const gradientColours = tokens.buttonPrimaryGradient.match(/#[0-9a-f]{6}/g)
      const gradientHoverColours = tokens.buttonPrimaryGradientHover.match(/#[0-9a-f]{6}/g)
      const gradientActiveColours = tokens.buttonPrimaryGradientActive.match(/#[0-9a-f]{6}/g)

      assert.equal(gradientColours.length, 2)
      assert.notEqual(gradientColours[0], gradientColours[1])
      assert.ok(
        getThemeContrastRatio(tokens.buttonPrimaryText, tokens.buttonPrimary) >= 4.5,
        `${accent} ${resolvedTheme} solid contrast is below 4.5`,
      )
      assert.ok(
        getThemeContrastRatio(tokens.buttonPrimaryText, gradientColours[1]) >= 4.5,
        `${accent} ${resolvedTheme} gradient contrast is below 4.5`,
      )
      for (const [state, backgrounds] of [
        ['solid hover', [tokens.buttonPrimaryHover]],
        ['solid active', [tokens.buttonPrimaryActive]],
        ['gradient hover', gradientHoverColours],
        ['gradient active', gradientActiveColours],
      ]) {
        assert.ok(
          Math.min(...backgrounds.map((background) =>
            getThemeContrastRatio(tokens.buttonPrimaryText, background))) >= 4.5,
          `${accent} ${resolvedTheme} ${state} contrast is below 4.5`,
        )
      }
      assert.ok(
        getThemeContrastRatio(tokens.buttonPrimaryDisabledText, tokens.buttonPrimaryDisabled) >= 4.5,
        `${accent} ${resolvedTheme} disabled contrast is below 4.5`,
      )
      assert.match(tokens.buttonPrimaryGradientHover, /^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
      assert.match(tokens.buttonPrimaryGradientActive, /^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
      assert.match(tokens.focusRing, /^#[0-9a-f]{6}$/)
    }
  }
})
