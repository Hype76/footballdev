import assert from 'node:assert/strict'
import test from 'node:test'
import { adultInvitePalette } from '../src/lib/adult-player-invite-branding.js'

test('approved club accents always keep invitation action text at accessible contrast', () => {
  const luminance = hex => {
    const channel = n => { const x = parseInt(hex.slice(n, n + 2), 16) / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4 }
    return channel(1) * .2126 + channel(3) * .7152 + channel(5) * .0722
  }
  for (const accent of ['yellow', 'blue', 'green', 'red', 'purple', '#ffffff', '#000000', '#ffff00', '#777777', '#193e7c', '#ff0000']) {
    const { background, foreground } = adultInvitePalette(accent)
    const a = luminance(background), b = luminance(foreground)
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, accent)
  }
  assert.equal(adultInvitePalette('url(javascript:invalid)').background, adultInvitePalette('').background)
})
