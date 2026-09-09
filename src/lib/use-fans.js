import { useCallback, useEffect, useRef, useState } from 'react'
export function useFans({ rpc, request }) {
  const [connections, setConnections] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState(null)
  const [content, setContent] = useState(null)
  const [contentError, setContentError] = useState('')
  const sequence = useRef(0)
  const reload = useCallback(async () => {
    const result = await rpc('list_fan_connections')
    setConnections(Array.isArray(result) ? result : [])
    return Array.isArray(result) ? result : []
  }, [rpc])
  const clearView = useCallback(() => { ++sequence.current; setView(null); setContent(null); setContentError('') }, [])
  useEffect(() => {
    let alive = true
    const generation = sequence
    const refresh = async () => {
      try { await reload(); if (alive) setError('') }
      catch (e) { if (alive) { setError(e.message); setConnections([]); clearView() } }
      finally { if (alive) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(refresh, 30000)
    return () => { alive = false; clearInterval(timer); ++generation.current }
  }, [clearView, reload])
  useEffect(() => {
    if (!view) return
    const permission = { matches: 'game_day', notifications: 'game_day', schedule: 'schedule', development: 'development', resources: 'resources' }[view.action]
    if (!connections.some((c) => c.id === view.connectionId && !c.is_owner && c.status === 'active' && c.permissions[permission])) clearView()
  }, [connections, clearView, view])
  const open = useCallback(async (connectionId, action, extra = {}) => {
    const current = ++sequence.current
    const next = { connectionId, action, ...extra }
    setView(next); setContent(null); setContentError(''); setError('')
    try {
      const result = await request(next)
      if (sequence.current === current) setContent(result)
    } catch (e) { if (sequence.current === current) setContentError(e.message) }
  }, [request])
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
    let alive = true
    const timer = setInterval(async () => {
      const generation = ++sequence.current
      try {
        const result = await request(view)
        if (alive && sequence.current === generation) { setContent(result); setContentError('') }
      } catch (e) { if (alive && sequence.current === generation) { setContent(null); setContentError(e.message) } }
    }, view.action === 'matches' ? 15000 : 30000)
    return () => { alive = false; clearInterval(timer) }
  }, [clearView, request, view])
  return { connections, loading, error, setError, reload, view, content, contentError, clearView, open, manage, deleteInvitation }
}
