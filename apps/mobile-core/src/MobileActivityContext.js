import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'

const MobileActivityContext = createContext(null)

export function MobileActivityProvider({ active = false, offline = false, children }) {
  const [sources, setSources] = useState({})
  const [offlineSources, setOfflineSources] = useState({})
  const reportOffline = useCallback((id, value) => setOfflineSources(current => {
    if (Boolean(current[id]) === value) return current
    const next = { ...current }
    if (value) next[id] = true
    else delete next[id]
    return next
  }), [])
  const report = useCallback((id, label) => {
    setSources(current => {
      if ((current[id] || null) === label) return current
      const next = { ...current }
      if (label) next[id] = label
      else delete next[id]
      return next
    })
  }, [])
  const value = useMemo(() => ({ report, reportOffline, active: active || Object.keys(sources).length > 0, offline: offline || Object.keys(offlineSources).length > 0 }), [active, offline, offlineSources, report, reportOffline, sources])
  return <MobileActivityContext.Provider value={value}>{children}</MobileActivityContext.Provider>
}

export function useMobileOffline(offline) {
  const context = useContext(MobileActivityContext)
  const id = useId()
  const reportOffline = context?.reportOffline
  useEffect(() => {
    if (!reportOffline || !offline) return undefined
    reportOffline(id, true)
    return () => reportOffline(id, false)
  }, [id, offline, reportOffline])
}

export function useMobileActivity(active = false, label = 'Updating') {
  const context = useContext(MobileActivityContext)
  const id = useId()
  const report = context?.report
  useEffect(() => {
    if (!report || !active) return undefined
    report(id, label)
    return () => report(id, null)
  }, [active, id, label, report])
  return context
}
