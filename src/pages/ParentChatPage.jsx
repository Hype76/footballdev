import { useCallback } from 'react'
import { ParentChatWorkspace } from '../components/chat/ParentChatWorkspace.jsx'
import { ParentPortalRouteShell } from '../components/parent-portal/ParentPortalShell.jsx'
import { useParentPortalNavigationState } from '../hooks/use-parent-portal-navigation-state.js'
import { useAuth } from '../lib/auth.js'

export function ParentChatPage() {
  const { user } = useAuth()
  const links = Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []
  const selectedLink = links.find((link) => link.id === user?.selectedParentLinkId) ?? links[0]
  const {
    captureActivityState,
    markCategoryViewed,
    newStateByCategory,
  } = useParentPortalNavigationState({
    parentLinkId: selectedLink?.id,
  })
  const handleCategoryLoadSuccess = useCallback((activitySnapshot) => {
    void markCategoryViewed({
      categoryKey: 'chat',
      snapshot: activitySnapshot,
    }).catch(() => {})
  }, [markCategoryViewed])

  return (
    <ParentPortalRouteShell
      activeSection="chat"
      newStateByCategory={newStateByCategory}
      user={user}
    >
      <ParentChatWorkspace
        onBeforeCategoryLoad={captureActivityState}
        onCategoryLoadSuccess={handleCategoryLoadSuccess}
        user={user}
        variant="parent"
      />
    </ParentPortalRouteShell>
  )
}
