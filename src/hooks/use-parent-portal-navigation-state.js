import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getParentPortalActivityState,
  markParentPortalCategoryViewed,
} from '../lib/supabase.js'
import { toParentPortalNewStateMap } from '../lib/parent-portal-activity.js'

export const PARENT_PORTAL_ACTIVITY_UPDATED_EVENT = 'football-player:parent-portal-activity-updated'

const DEFAULT_SYNC_INTERVAL_MS = 15000

export function useParentPortalNavigationState({
  parentLinkId,
  syncIntervalMs = DEFAULT_SYNC_INTERVAL_MS,
} = {}) {
  const normalizedParentLinkId = String(parentLinkId ?? '').trim()
  const [state, setState] = useState({
    activityByCategory: {},
    error: '',
    isLoading: false,
    parentLinkId: '',
  })
  const activityByCategory = useMemo(
    () => (state.parentLinkId === normalizedParentLinkId ? state.activityByCategory : {}),
    [normalizedParentLinkId, state.activityByCategory, state.parentLinkId],
  )
  const error = state.parentLinkId === normalizedParentLinkId ? state.error : ''
  const isLoading = Boolean(normalizedParentLinkId)
    && (state.parentLinkId !== normalizedParentLinkId || state.isLoading)

  const captureActivityState = useCallback(async () => {
    const requestedParentLinkId = normalizedParentLinkId
    if (!requestedParentLinkId) {
      return {}
    }

    setState((currentState) => ({
      activityByCategory: currentState.parentLinkId === requestedParentLinkId
        ? currentState.activityByCategory
        : {},
      error: currentState.parentLinkId === requestedParentLinkId ? currentState.error : '',
      isLoading: true,
      parentLinkId: requestedParentLinkId,
    }))

    try {
      const nextActivityByCategory = await getParentPortalActivityState({
        parentLinkId: requestedParentLinkId,
      })

      setState({
        activityByCategory: nextActivityByCategory,
        error: '',
        isLoading: false,
        parentLinkId: requestedParentLinkId,
      })

      return nextActivityByCategory
    } catch (loadError) {
      console.error(loadError)

      setState((currentState) => ({
        activityByCategory: currentState.parentLinkId === requestedParentLinkId
          ? currentState.activityByCategory
          : {},
        error: loadError.message || 'Parent Portal activity could not be synchronised.',
        isLoading: false,
        parentLinkId: requestedParentLinkId,
      }))

      throw loadError
    }
  }, [normalizedParentLinkId])

  const refreshActivityState = useCallback(async () => {
    try {
      return await captureActivityState()
    } catch {
      return null
    }
  }, [captureActivityState])

  const markCategoryViewed = useCallback(async ({
    categoryKey,
    snapshot,
  } = {}) => {
    const requestedParentLinkId = normalizedParentLinkId
    const observedState = snapshot?.[categoryKey]

    if (!requestedParentLinkId || !observedState?.isNew || !observedState.latestActivityAt) {
      return observedState ?? null
    }

    try {
      const savedState = await markParentPortalCategoryViewed({
        categoryKey,
        observedActivityAt: observedState.latestActivityAt,
        parentLinkId: requestedParentLinkId,
      })

      setState((currentState) => ({
        activityByCategory: {
          ...(currentState.parentLinkId === requestedParentLinkId
            ? currentState.activityByCategory
            : {}),
          [categoryKey]: savedState,
        },
        error: '',
        isLoading: false,
        parentLinkId: requestedParentLinkId,
      }))

      window.dispatchEvent(new CustomEvent(PARENT_PORTAL_ACTIVITY_UPDATED_EVENT, {
        detail: { categoryKey, parentLinkId: requestedParentLinkId },
      }))

      return savedState
    } catch (saveError) {
      console.error(saveError)

      setState((currentState) => ({
        activityByCategory: currentState.parentLinkId === requestedParentLinkId
          ? currentState.activityByCategory
          : {},
        error: saveError.message || 'New could not be cleared because viewed state was not saved.',
        isLoading: false,
        parentLinkId: requestedParentLinkId,
      }))

      throw saveError
    }
  }, [normalizedParentLinkId])

  useEffect(() => {
    if (!normalizedParentLinkId) {
      return undefined
    }

    const initialRefreshId = window.setTimeout(() => {
      void refreshActivityState()
    }, 0)

    const intervalId = window.setInterval(() => {
      void refreshActivityState()
    }, syncIntervalMs)

    const handleFocus = () => {
      void refreshActivityState()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshActivityState()
      }
    }
    const handleActivityUpdated = (event) => {
      if (event.detail?.parentLinkId !== normalizedParentLinkId) {
        void refreshActivityState()
        return
      }

      void refreshActivityState()
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener(PARENT_PORTAL_ACTIVITY_UPDATED_EVENT, handleActivityUpdated)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearTimeout(initialRefreshId)
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener(PARENT_PORTAL_ACTIVITY_UPDATED_EVENT, handleActivityUpdated)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [normalizedParentLinkId, refreshActivityState, syncIntervalMs])

  const newStateByCategory = useMemo(
    () => toParentPortalNewStateMap(activityByCategory),
    [activityByCategory],
  )

  return {
    activityByCategory,
    captureActivityState,
    error,
    isLoading,
    markCategoryViewed,
    newStateByCategory,
    refreshActivityState,
  }
}
