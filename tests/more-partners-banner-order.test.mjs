import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sources = {
  coach: new URL('../apps/coach-mobile/App.js', import.meta.url),
  parent: new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url),
  fans: new URL('../apps/parent-mobile/src/FansScreen.js', import.meta.url),
}

function assertBannerPrecedesMenu(source, menuMarker) {
  const bannerIndex = source.indexOf('<PartnersBanner')
  const menuIndex = source.indexOf(menuMarker)
  assert.ok(bannerIndex >= 0, 'More menu must render PartnersBanner')
  assert.ok(menuIndex >= 0, `More menu must render ${menuMarker}`)
  assert.ok(bannerIndex < menuIndex)
}

test('Partners and Special Offers banner precedes every More menu', async () => {
  const [coach, parent, fans] = await Promise.all(Object.values(sources).map(url => readFile(url, 'utf8')))

  const coachMore = coach.slice(coach.indexOf('function MoreScreen'))
  assertBannerPrecedesMenu(coachMore, '<IconMenu')

  const parentMore = parent.slice(parent.indexOf('export function MoreScreen'))
  assertBannerPrecedesMenu(parentMore, '<View style={styles.moreGrid}>')

  const fansMore = fans.slice(fans.indexOf("{section === 'more' && !state.view ?"))
  assertBannerPrecedesMenu(fansMore, '<Action icon="settings"')
})
