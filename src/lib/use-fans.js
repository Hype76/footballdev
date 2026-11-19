import { useCallback, useEffect, useRef, useState } from 'react'
import { isTransientConnectionMessage } from '../../apps/mobile-core/src/useConfirmedConnectionIssue'
import { canViewFanNotifications } from './fans.js'

const CONTENT_CACHE_MS = 60_000
const MAX_CONTENT_SNAPSHOTS = 32

function contentKey({ connectionId, action, matchId }) {
  return JSON.stringify([connectionId, action, matchId || null])
}

function readSnapshot(cache, key) {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.savedAt <= CONTENT_CACHE_MS) return entry.value
  cache.delete(key)
  return null
}

function saveSnapshot(cache, view, value) {
  if (!['schedule', 'matches'].includes(view.action)) return
  const key = contentKey(view)
  cache.delete(key)
  cache.set(key, { value, savedAt: Date.now() })
  if (cache.size > MAX_CONTENT_SNAPSHOTS) cache.delete(cache.keys().next().value)
}

export function useFans({ rpc, request, cacheContent = false }) {
  const cache = useRef(new Map())
  const permissions = useRef(new Map())
  const [connections, setConnections] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState(null)
  const viewRef = useRef(null)
  const [content, setContent] = useState(null)
  const [contentError, setContentError] = useState('')
  const [contentLoading, setContentLoading] = useState(false)
  const requestVersions = useRef({ authority: 0, content: 0 })
  const contentRequest = useRef(null)
  const clearView = useCallback(() => {
    ++requestVersions.current.content
    contentRequest.current = null
    viewRef.current = null
    setView(null)
    setContent(null)
    setContentError('')
    setContentLoading(false)
  }, [])
  const reload = useCallback(async () => {
    const revision = ++requestVersions.current.authority
    const result = await rpc('list_fan_connections')
    const rows = Array.isArray(result) ? result : []
    if (cacheContent) {
      if (revision !== requestVersions.current.authority) return rows
      const nextPermissions = new Map(rows.map(c => [c.id, JSON.stringify([
        c.status, c.is_owner, c.relationship_type, c.permissions, c.club_id, c.team_id, c.player_id,
        c.parent_link_id, c.plan_key, c.planKey, c.plan_status, c.planStatus,
      ])]))
      let viewedAccessChanged = false
      for (const [id, signature] of permissions.current) {
        if (nextPermissions.get(id) === signature) continue
        if (viewRef.current?.connectionId === id) viewedAccessChanged = true
        for (const key of cache.current.keys()) if (JSON.parse(key)[0] === id) cache.current.delete(key)
      }
      permissions.current = nextPermissions
      if (viewedAccessChanged) clearView()
    }
    setConnections(rows)
    return rows
  }, [cacheContent, clearView, rpc])
  useEffect(() => {
    let alive = true
    const versions = requestVersions.current
    const refresh = async () => {
      try { await reload(); if (alive) setError('') }
      catch (e) {
        if (!alive) return
        setError(e.message)
        if (e.status || e.code || !isTransientConnectionMessage(e.message)) {
          cache.current.clear()
          setConnections([])
          clearView()
        }
      } finally { if (alive) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(refresh, 30000)
    return () => {
      alive = false
      clearInterval(timer)
      ++versions.content
      ++versions.authority
    }
  }, [clearView, reload])
  useEffect(() => {
    if (!view) return
    const permission = { matches: 'game_day', stats: 'game_day', schedule: 'schedule', attendance: 'schedule', development: 'development', resources: 'resources' }[view.action]
    if (!connections.some((c) => c.id === view.connectionId && !c.is_owner && c.status === 'active'
      && (view.action === 'notifications' ? c.permissions?.game_day || canViewFanNotifications(c) : c.permissions?.[permission])
      && (!['attendance', 'stats'].includes(view.action) || c.relationship_type === 'player'))) clearView()
  }, [connections, clearView, view])
  const loadContent = useCallback(async (next, showActivity) => {
    const generation = ++requestVersions.current.content
    contentRequest.current = generation
    if (showActivity) setContentLoading(true)
    try {
      const result = await request(next)
      if (requestVersions.current.content !== generation) return
      if (cacheContent) saveSnapshot(cache.current, next, result)
      setContent(result)
      setContentError('')
    } catch (e) {
      if (requestVersions.current.content !== generation) return
      if (e.status || e.code || !isTransientConnectionMessage(e.message)) {
        cache.current.clear()
        setContent(null)
      }
      setContentError(e.message)
    } finally {
      if (contentRequest.current === generation) {
        contentRequest.current = null
        if (requestVersions.current.content === generation) setContentLoading(false)
      }
    }
  }, [cacheContent, request])
  const open = useCallback(async (connectionId, action, extra = {}) => {
    const next = { connectionId, action, ...extra }
    viewRef.current = next
    setView(next)
    setContent(cacheContent ? readSnapshot(cache.current, contentKey(next)) : null)
    setContentError('')
    setError('')
    return loadContent(next, true)
  }, [cacheContent, loadContent])
  const manage = useCallback(async (connectionId, action, permissions) => {
    clearView()
    await rpc('manage_fan_connection', { connection_id_value: connectionId, action_value: action, permissions_value: permissions || null })
    await reload()
  }, [clearView, reload, rpc])
  const deleteInvitation = useCallback(async (connectionId) => {
    await rpc('delete_cancelled_fan_invitation', { connection_id_value: connectionId })
    await reload()
  }, [reload, rpc])
  useEffect(() => {
    if (!view) return
    const timer = setInterval(() => {
      if (viewRef.current !== view || (cacheContent && contentRequest.current !== null)) return
      void loadContent(view, false)
    }, view.action === 'matches' ? 15000 : 30000)
    return () => clearInterval(timer)
  }, [cacheContent, loadContent, view])
  return { connections, loading, error, setError, reload, view, content, contentError, contentLoading, clearView, open, manage, deleteInvitation }
}
