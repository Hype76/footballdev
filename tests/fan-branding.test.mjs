import assert from 'node:assert/strict'
import test from 'node:test'
import { fanBrandingLink, fanBrandTheme, fanBrandWebStyle } from '../src/lib/fan-branding.js'
import { getParentThemeContrastRatio } from '../apps/mobile-core/src/parentThemeCore.js'
import { buildFanEmail } from '../netlify/functions/lib/_fan-email.js'

test('Fan branding switches clubs and retains readable custom colours in both display modes', () => {
  const blue = { club_id: 'blue', club_name: 'Blue club', club_logo_url: 'https://example.test/blue.png', theme_accent: '#123abc' }
  const red = { club_id: 'red', club_name: 'Red club', theme_accent: '#ffee22' }
  assert.equal(fanBrandingLink(blue).clubLogoUrl, blue.club_logo_url)
  assert.equal(fanBrandingLink({club_logo_url:'javascript:bad'}).clubLogoUrl,'')
  assert.equal(fanBrandingLink(null).clubName,'')
  for (const mode of ['light','dark']) {
    const first=fanBrandTheme(blue,mode),second=fanBrandTheme(red,mode)
    assert.equal(first.branding.sourceClubId,'blue')
    assert.equal(second.branding.sourceClubId,'red')
    assert.notEqual(first.tokens.accent,second.tokens.accent)
    for (const {tokens} of [first,second]) {
      assert.ok(getParentThemeContrastRatio(tokens.accentText,tokens.portalSurface)>=4.5)
      assert.ok(getParentThemeContrastRatio(tokens.accentForeground,tokens.buttonPrimary)>=4.5)
    }
    assert.equal(fanBrandWebStyle(blue,mode)['--accent'], first.tokens.accent)
  }
})

test('Invitation and verification emails use safe club branding and exact selected permissions', () => {
  const club={name:'Blue <Club>',logo_url:'https://example.test/blue.png',theme_accent:'#123abc'}
  const fan={name:'Alex <Relative>',email:'alex@example.test',permissions:{schedule:true}}
  for(const verification of [false,true]) {
    const email=buildFanEmail({club,fan,url:'https://parent.footballplayer.online/fan-invite/test',verification})
    assert.match(email.subject,/Blue <Club>/)
    assert.match(email.html,/https:\/\/example.test\/blue.png/)
    assert.match(email.html,/#123abc/)
    assert.match(email.html,/Blue &lt;Club&gt;/)
    assert.doesNotMatch(email.html,/<Relative>/)
    if(!verification) { assert.match(email.html,/View fixtures, training and events/); assert.doesNotMatch(email.html,/development records/) }
  }
  const safe=buildFanEmail({club:{name:'Club',logo_url:'javascript:bad',theme_accent:'red;display:none'},fan,url:'https://example.test'})
  assert.doesNotMatch(safe.html,/javascript:|display:none/)
})
