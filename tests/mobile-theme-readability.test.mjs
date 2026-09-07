import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoachTheme } from '../apps/coach-mobile/src/coachThemeCore.js'
import { createParentMobileTheme } from '../apps/mobile-core/src/parentThemeCore.js'
import { themeContrastRatio } from '../apps/mobile-core/src/themeContrast.js'

const accents = ['yellow', 'blue', 'green', 'red', 'purple', '#000000', '#ffffff', '#777777', '#000080', '#ffff00', '#2ba7aa', '#ff00ff']
// Sample the full RGB cube as well as the named presets and reported club colour.
for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
  accents.push(`#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`)
}
for (const app of ['coach', 'parent']) for (const mode of ['dark', 'light']) {
  test(`${app} ${mode}: readable text, controls and brand fills across ${accents.length} colours`, () => {
    for (const accent of accents) {
      const theme = app === 'coach' ? createCoachTheme({ mode, context: { clubAccent: accent, teamAccent: 'red' } }) : createParentMobileTheme({ mode, selectedLink: { themeAccent: accent } })
      const t = theme.tokens
      const surfaces = ['background', 'surface', 'surfaceRaised', 'portalBackground', 'portalSurface', 'selected', 'selectedSurface', 'successSurface', 'warningSurface', 'dangerSurface'].filter(key => t[key])
      for (const surface of surfaces) {
        for (const foreground of ['textPrimary', 'textSecondary', 'textMuted', 'muted', 'accentText', 'selectedForeground', 'success', 'warning', 'danger'].filter(key => t[key])) {
          assert.ok(themeContrastRatio(t[foreground], t[surface]) >= 7, `${accent}: ${foreground} on ${surface}`)
        }
        assert.ok(themeContrastRatio(t.border, t[surface]) >= 3, `${accent}: boundary on ${surface}`)
      }
      const fill = t.buttonPrimary || t.accent
      assert.ok(themeContrastRatio(t.accentForeground, fill) >= 4.5, `${accent}: button label`)
      assert.ok(themeContrastRatio(t.dangerForeground, t.danger) >= 4.5, `${accent}: danger button label`)
      if (accent.startsWith('#')) assert.equal(fill, accent, 'Selected custom brand colour is preserved exactly')
      assert.equal(theme.branding.accent, accent)
    }
  })
}
