import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('event player review explains player and eligible recipient counts separately', async () => {
  const source = await read('../src/pages/SessionsPage.jsx')
  assert.match(source, /eligible authorised recipient/)
  assert.match(source, /No active authorised Parent or adult-player contact/)
  assert.match(source, /no invitation can be sent for them/)
})

test('web and mobile Match Day views show saved match notes', async () => {
  const [webParent, coachMobile, parentMobile] = await Promise.all([
    read('../src/pages/ParentPortalPage.jsx'),
    read('../apps/coach-mobile/src/CoachMatchDayScreen.js'),
    read('../apps/parent-mobile/src/ParentPortalScreens.js'),
  ])
  for (const source of [webParent, coachMobile, parentMobile]) {
    assert.match(source, /Match notes/)
  }
})
