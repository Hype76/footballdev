import assert from 'node:assert/strict'
import test from 'node:test'
import { createParentMobileTheme, normalizeParentThemeAccent, resolveParentMobileBranding } from '../apps/mobile-core/src/parentThemeCore.js'
import { createCoachTheme } from '../apps/coach-mobile/src/coachThemeCore.js'
import { themeContrastRatio } from '../apps/mobile-core/src/themeContrast.js'
import { resolveParentPortalBranding } from '../src/lib/parent-portal-branding.js'
import { createThemeColorTokens } from '../src/lib/theme.js'

function assertParity(link, expectedAccent, mode) {
  const original = structuredClone(link)
  const web = resolveParentPortalBranding({ selectedLink: link, links: link ? [link] : [], matchdayPolicy: link?.matchdayPolicy })
  const mobile = createParentMobileTheme({ mode, selectedLink: link })
  assert.equal(web.accent, expectedAccent)
  assert.equal(mobile.branding.accent, expectedAccent)
  assert.equal(mobile.branding.buttonStyle, web.buttonStyle)
  const webTokens = createThemeColorTokens(web.accent, mode)
  assert.equal(mobile.tokens.accent, webTokens.accent)
  assert.equal(mobile.tokens.buttonPrimary, webTokens.buttonPrimary)
  assert.ok(themeContrastRatio(mobile.tokens.accentForeground, mobile.tokens.buttonPrimary) >= 4.5)
  assert.ok(themeContrastRatio(mobile.tokens.accentText, mobile.tokens.surface) >= 7)
  assert.deepEqual(link, original, 'Presentation never rewrites saved branding')
  return mobile
}

for (const mode of ['light', 'dark']) {
  test(`free Parent ${mode} uses Coach green with web/mobile palette parity`, () => {
    for (const planField of ['planKey', 'plan_key']) {
      for (const accent of ['', 'yellow', '#facc15', '#625008', 'purple']) {
        const link = { id: 'free-child', clubId: 'free-club', teamId: 'free-team', [planField]: ' MATCHDAY ', themeAccent: accent, themeButtonStyle: 'gradient' }
        const mobile = assertParity(link, 'green', mode)
        assert.equal(mobile.tokens.accent, createCoachTheme({ mode, context: { planKey: 'matchday' } }).tokens.accent)
        assert.equal(mobile.branding.buttonStyle, 'solid')
      }
    }
  })

  test(`paid and trusted branding ${mode} keeps named and custom colours`, () => {
    for (const planKey of ['team', 'club', 'matchday']) {
      for (const accent of ['yellow', 'blue', 'green', 'red', 'purple', '#000000', '#ffffff', '#2ba7aa']) {
        const link = { id: 'paid-child', clubId: 'paid-club', teamId: 'paid-team', planKey, themeAccent: accent, themeButtonStyle: 'gradient', clubLogoUrl: 'https://example.invalid/logo.png' }
        if (planKey === 'matchday') link.matchdayPolicy = { flags: { customColoursBranding: true, basicLogoBranding: true } }
        const mobile = assertParity(link, accent, mode)
        assert.equal(mobile.branding.buttonStyle, 'gradient')
        assert.equal(mobile.branding.clubLogoUrl, link.clubLogoUrl)
        if (accent.startsWith('#')) assert.equal(mobile.tokens.buttonPrimary, accent)
      }
    }
  })

  test(`missing and legacy plan ${mode} defaults green and retains saved branding`, () => {
    for (const planKey of [undefined, '', 'free', 'starter', 'pro', 'legacy', 'unknown']) {
      for (const themeAccent of [undefined, '', 'invalid', 'yellow', '#123abc']) {
        assertParity({ id: 'legacy-child', clubId: 'legacy-club', planKey, themeAccent }, ['yellow', '#123abc'].includes(themeAccent) ? themeAccent : 'green', mode)
      }
    }
    assertParity(null, 'green', mode)
  })

  test(`child/club switching ${mode} cannot retain paid colours on free children`, () => {
    const paid = { id: 'paid-child', clubId: 'paid-club', teamId: 'paid-team', planKey: 'club', themeAccent: '#123abc', themeButtonStyle: 'gradient' }
    const free = { id: 'free-child', clubId: 'free-club', teamId: 'free-team', planKey: 'matchday', themeAccent: 'yellow' }
    const sibling = { ...free, id: 'free-sibling' }
    const links = [paid, free, sibling]
    for (const selected of [paid, free, sibling, paid, free]) {
      const expected = selected === paid ? '#123abc' : 'green'
      const web = resolveParentPortalBranding({ selectedLink: selected, links })
      const mobile = resolveParentMobileBranding(selected)
      assert.equal(web.accent, expected)
      assert.equal(mobile.accent, expected)
      assert.equal(web.sourceLinkId, selected.id)
      assert.equal(mobile.sourceLinkId, selected.id)
      assert.equal(mobile.sourceClubId, selected.clubId)
    }
  })
}

test('mobile invalid accent and invalid fallback both resolve to green', () => {
  assert.equal(normalizeParentThemeAccent('invalid'), 'green')
  assert.equal(normalizeParentThemeAccent('invalid', 'invalid'), 'green')
  assert.equal(normalizeParentThemeAccent('invalid', 'yellow'), 'yellow')
})
