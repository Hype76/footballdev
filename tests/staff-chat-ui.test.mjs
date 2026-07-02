import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const pageUrl = new URL('../src/pages/StaffChatPage.jsx', import.meta.url)

test('Staff Chat route and navigation are behind the staff-only helper', async () => {
  const [router, sidebar, navigation] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(sidebarUrl, 'utf8'),
    readFile(navigationUrl, 'utf8'),
  ])

  assert.match(navigation, /label: 'Staff Chat'/)
  assert.match(navigation, /path: '\/staff-chat'/)
  assert.match(router, /function RequireStaffChatAccess\(\)/)
  assert.match(router, /canUseStaffChat\(user\)/)
  assert.match(router, /path: 'staff-chat'/)
  assert.match(sidebar, /item\.path === '\/staff-chat'/)
  assert.match(sidebar, /canUseStaffChat\(displayUser\)/)
})

test('Staff Chat UI keeps V1 labels and excludes parent or player chat controls', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /Club Staff/)
  assert.match(page, /Team Staff/)
  assert.match(page, /Groups/)
  assert.match(page, /Direct Messages/)
  assert.match(page, /Staff Chat/)
  assert.doesNotMatch(page, /Parent Chat/i)
  assert.doesNotMatch(page, /Player Chat/i)
  assert.doesNotMatch(page, /push notification/i)
  assert.doesNotMatch(page, /attachment/i)
})
