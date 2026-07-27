import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ParentChatWorkspace } from '../components/chat/ParentChatWorkspace.jsx'
import { ParentPortalRouteShell } from '../components/parent-portal/ParentPortalShell.jsx'
import { useParentPortalNavigationState } from '../hooks/use-parent-portal-navigation-state.js'
import { useAuth } from '../lib/auth.js'
import {
  getParentPortalChatContext,
  markParentPortalChatViewed,
} from '../lib/supabase.js'

export function ParentChatPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [childOnly, setChildOnly] = useState(false)
  const [filterContext, setFilterContext] = useState({
    available: false,
    linkId: '',
  })
  const links = useMemo(
    () => (Array.isArray(user?.parentPortalLinks) ? user.parentPortalLinks : []),
    [user],
  )
  const requestedParentLinkId = searchParams.get('parentLinkId') || ''
  const selectedLink = useMemo(
    () =>
      links.find((link) => link.id === requestedParentLinkId)
      ?? links.find((link) => link.id === user?.selectedParentLinkId)
      ?? links[0],
    [links, requestedParentLinkId, user],
  )
  const {
    captureActivityState,
    newStateByCategory,
    refreshActivityState,
  } = useParentPortalNavigationState({
    parentLinkId: selectedLink?.id,
  })

  useEffect(() => {
    let isCurrent = true

    async function loadContext() {
      if (!selectedLink?.id) {
        setFilterContext({ available: false, linkId: '' })
        setChildOnly(false)
        return
      }

      try {
        const context = await getParentPortalChatContext({
          parentLinkId: selectedLink.id,
        })
        if (!isCurrent) {
          return
        }

        setFilterContext({
          available: context.childFilterAvailable,
          linkId: selectedLink.id,
        })
        if (!context.childFilterAvailable) {
          setChildOnly(false)
        }
      } catch (error) {
        console.error(error)
        if (isCurrent) {
          setFilterContext({ available: false, linkId: selectedLink.id })
          setChildOnly(false)
        }
      }
    }

    void loadContext()

    return () => {
      isCurrent = false
    }
  }, [selectedLink])

  const handleSelectedParentLinkChange = useCallback((parentLinkId) => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('parentLinkId', parentLinkId)
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchParams, setSearchParams])

  const handleRoomLoadSuccess = useCallback(({ activitySnapshot, roomId }) => {
    const observedChatState = activitySnapshot?.chat
    if (
      !selectedLink?.id
      || !roomId
      || !observedChatState?.isNew
      || !observedChatState.latestActivityAt
    ) {
      return
    }

    void markParentPortalChatViewed({
      observedActivityAt: observedChatState.latestActivityAt,
      parentLinkId: selectedLink.id,
      roomId,
    })
      .then(() => refreshActivityState())
      .catch(() => {})
  }, [refreshActivityState, selectedLink])

  const childFilterAvailable = filterContext.linkId === selectedLink?.id
    && filterContext.available

  return (
    <ParentPortalRouteShell
      activeSection="chat"
      newStateByCategory={newStateByCategory}
      selectedParentLinkId={selectedLink?.id}
      user={user}
    >
      <ParentChatWorkspace
        key={`${selectedLink?.id || 'none'}:${childOnly ? 'child' : 'all'}`}
        childFilterAvailable={childFilterAvailable}
        childOnly={childOnly}
        links={links}
        onBeforeRoomLoad={captureActivityState}
        onChildOnlyChange={setChildOnly}
        onRoomLoadSuccess={handleRoomLoadSuccess}
        onSelectedParentLinkChange={handleSelectedParentLinkChange}
        parentLinkId={selectedLink?.id}
        selectedParentLink={selectedLink}
        user={user}
        variant="parent"
      />
    </ParentPortalRouteShell>
  )
}
