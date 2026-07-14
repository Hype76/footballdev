import { useState } from 'react'
import { ParentChatWorkspace } from '../components/chat/ParentChatWorkspace.jsx'
import { ParentPortalRouteShell } from '../components/parent-portal/ParentPortalShell.jsx'
import { useAuth } from '../lib/auth.js'

export function ParentChatPage() {
  const { user } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  return (
    <ParentPortalRouteShell
      activeSection="chat"
      counts={{ chat: unreadCount, polls: 0 }}
      user={user}
    >
      <ParentChatWorkspace
        onUnreadCountChange={setUnreadCount}
        user={user}
        variant="parent"
      />
    </ParentPortalRouteShell>
  )
}
