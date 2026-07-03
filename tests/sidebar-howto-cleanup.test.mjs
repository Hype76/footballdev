import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const routerUrl = new URL('../src/app/router.jsx', import.meta.url)

test('sidebar no longer renders the How to use navigation link', async () => {
  const source = await readFile(sidebarUrl, 'utf8')

  assert.doesNotMatch(source, /How to use/)
  assert.doesNotMatch(source, /sidebar-information/)
  assert.doesNotMatch(source, /to="\/information"/)
})

test('information route and page are preserved for direct URL access', async () => {
  const source = await readFile(routerUrl, 'utf8')

  assert.match(source, /const InformationPage = lazyRoute\(\(\) => import\('\.\.\/pages\/InformationPage\.jsx'\), 'InformationPage'\)/)
  assert.match(source, /path: 'information'/)
  assert.match(source, /<InformationPage \/>/)
})

test('other expected sidebar navigation entries remain defined', async () => {
  const source = await readFile(navigationUrl, 'utf8')

  assert.match(source, /label: 'Feedback',\s+path: '\/assess-player',\s+helper: 'Records and notes'/)
  assert.doesNotMatch(source, /label: 'Development',\s+path: '\/assess-player'/)

  for (const label of [
    'Calendar',
    'Players',
    'Feedback',
    'Polls',
    'Match Day',
    'Teams',
    'Parent Invites',
    'Activity Log',
  ]) {
    assert.match(source, new RegExp(`label: '${label}'`))
  }
})
