import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const routerUrl = new URL('../src/app/router.jsx', import.meta.url)
const navigationUrl = new URL('../src/app/navigation.js', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const shellUrl = new URL('../src/components/parent-portal/ParentPortalShell.jsx', import.meta.url)
const pageUrl = new URL('../src/pages/ParentChatPage.jsx', import.meta.url)
const staffPageUrl = new URL('../src/pages/ParentChatStaffPage.jsx', import.meta.url)
const workspaceUrl = new URL('../src/components/chat/ParentChatWorkspace.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/parent-chat.js', import.meta.url)

test('Parent Portal route and navigation are renamed from Messages to Chat with a legacy redirect', async () => {
  const [router, sidebar, shell] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(sidebarUrl, 'utf8'),
    readFile(shellUrl, 'utf8'),
  ])

  assert.match(router, /path: 'parent-chat'/)
  assert.match(router, /<ParentChatPage \/>/)
  assert.match(router, /title: 'Chat'/)
  assert.match(router, /path: 'parent-messages'[\s\S]*<Navigate to="\/parent-chat" replace \/>/)
  assert.match(shell, /id: 'chat', label: 'Chat'/)
  assert.match(shell, /to: '\/parent-chat'/)
  assert.doesNotMatch(shell, /label: 'Messages'/)
  assert.match(sidebar, /label: 'Chat', path: '\/parent-chat'/)
  assert.doesNotMatch(sidebar, /label: 'Messages', path: '\/parent-messages'/)
})

test('Chat home groups controlled room types and explains shared staff visibility', async () => {
  const [page, workspace] = await Promise.all([
    readFile(pageUrl, 'utf8'),
    readFile(workspaceUrl, 'utf8'),
  ])

  assert.match(page, /<ParentPortalRouteShell/)
  assert.match(page, /activeSection="chat"/)
  assert.match(workspace, /Chat with Staff/)
  assert.match(workspace, /Team Chat/)
  assert.match(workspace, /Match Chats/)
  assert.match(workspace, /This conversation is visible to you, your child's linked guardians and authorised staff for this team\./)
  assert.match(workspace, /Match Squad Chat/)
  assert.match(workspace, /Selected child/)
  assert.match(workspace, /Kickoff/)
  assert.match(workspace, /Meet time/)
  assert.match(workspace, /Venue/)
  assert.match(workspace, /Read-only/)
  assert.doesNotMatch(workspace, /return nextRooms\[0\]/)
})

test('V1 Chat supports text, safe links, unread state, realtime refresh and no expanded media capability', async () => {
  const [workspace, domain] = await Promise.all([
    readFile(workspaceUrl, 'utf8'),
    readFile(domainUrl, 'utf8'),
  ])

  assert.match(workspace, /Write a message/)
  assert.match(workspace, /maxLength=\{2000\}/)
  assert.match(workspace, /https\?:\\\/\\\//)
  assert.match(workspace, /rel="noreferrer noopener"/)
  assert.match(workspace, /target="_blank"/)
  assert.match(workspace, /unreadCount/)
  assert.match(domain, /postgres_changes/)
  assert.match(domain, /table: 'parent_chat_messages'/)
  assert.match(domain, /filter: `room_id=eq\.\$\{normalizedRoomId\}`/)
  assert.doesNotMatch(workspace, /image upload|file upload|voice note|video|poll|typing indicator|gif|live location/i)
  assert.doesNotMatch(domain, /send email|notification|invite|sms/i)
})

test('staff receives a separate Parent Chat surface without altering Staff Chat', async () => {
  const [router, navigation, staffPage] = await Promise.all([
    readFile(routerUrl, 'utf8'),
    readFile(navigationUrl, 'utf8'),
    readFile(staffPageUrl, 'utf8'),
  ])

  assert.match(router, /path: 'parent-chat-staff'/)
  assert.match(router, /<ParentChatStaffPage \/>/)
  assert.match(navigation, /label: 'Staff Chat'[\s\S]*path: '\/staff-chat'/)
  assert.match(navigation, /label: 'Parent Chat'[\s\S]*path: '\/parent-chat-staff'/)
  assert.match(staffPage, /variant="staff"/)
})

test('Chat UI has no participant controls or private-message language', async () => {
  const workspace = await readFile(workspaceUrl, 'utf8')

  assert.doesNotMatch(workspace, /add participant|remove participant|create room|new room|direct message|private coach|private message|secret message|disappearing/i)
  assert.doesNotMatch(workspace, /email body|download pdf|parent inbox|view email|compose email/i)
})
