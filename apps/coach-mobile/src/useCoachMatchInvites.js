import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'

export function useCoachMatchInvites(options) {
  const { user, context, fixture, cachedRows = [] } = options
  const identity = [user.id, user.role, user.roleRank, user.activeCoachContextId, context.id,
    context.authorityId, context.authoritySource, user.clubId, user.activeTeamId, user.hasActivePlanAccess,
    user.accountStatus, user.planStatus, user.isOfflineProfile]
  const owner = JSON.stringify(identity)
  const scope = JSON.stringify([...identity, fixture?.id, fixture?.status, fixture?.matchDate])
  const optionsRef = useRef(options)
  const scopeRef = useRef(scope)
  useLayoutEffect(() => { optionsRef.current = options; scopeRef.current = scope }, [options, scope])
  const generation = useRef(0)
  const valueRef = useRef(null)
  const [value, setValue] = useState(null)
  const publish = useCallback(next => { valueRef.current = next; setValue(next) }, [])
  const refresh = useCallback(async () => {
    const currentOptions = optionsRef.current
    if (scopeRef.current !== scope || !currentOptions.fixture || currentOptions.user.isOfflineProfile) return false
    const request = ++generation.current
    const current = () => scopeRef.current === scope && generation.current === request
    const previous = valueRef.current?.scope === scope ? valueRef.current : null
    publish({ ...previous, scope, checking: true })
    let complete = false
    const accept = rows => {
      if (!current()) return
      complete = true
      const next = { scope, owner, fixtureId: currentOptions.fixture.id, sourceRevision: currentOptions.sourceRevision,
        rows, fresh: true, checking: false, checkedAt: new Date().toISOString() }
      publish(next)
      void currentOptions.saveRows(currentOptions.user, currentOptions.context, currentOptions.fixture.id, next)
        .catch(() => { if (current()) publish({ ...valueRef.current, saveFailed: true }) })
    }
    try {
      const rows = await withMobileAsyncTimeout(() => currentOptions.loadRows(currentOptions.user, currentOptions.fixture, { onReady: accept }), { timeoutMs: 30000 })
      accept(rows)
      return current() && complete
    } catch {
      if (current()) {
        publish({ ...valueRef.current, scope, checking: false, fresh: complete, failed: !complete })
        generation.current += 1
      }
      return complete
    }
  }, [scope, owner, publish])

  useEffect(() => {
    const selected = optionsRef.current
    if (!selected.fixture) return undefined
    let active = true
    void selected.readSaved(selected.user, selected.context).then(saved => {
      if (!active || scopeRef.current !== scope || saved?.fixtureId !== selected.fixture.id || !Array.isArray(saved.rows)) return
      if (valueRef.current?.scope === scope && valueRef.current.fresh) return
      publish({ ...valueRef.current, scope, owner, fixtureId: saved.fixtureId, sourceRevision: selected.sourceRevision,
        rows: saved.rows, checkedAt: saved.checkedAt, fresh: false })
    }).catch(() => {})
    void Promise.resolve().then(() => { if (active) return refresh() })
    const interval = setInterval(() => { if (AppState.currentState === 'active') void refresh() }, 30000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh() })
    return () => { active = false; generation.current += 1; clearInterval(interval); subscription.remove() }
  }, [scope, owner, refresh, publish, options.sourceRevision])

  const selected = value?.scope === scope ? value : null
  return { rows: selected?.rows || cachedRows, stale: !selected?.fresh, checking: selected?.checking === true,
    checkedAt: selected?.checkedAt, failed: selected?.failed, saveFailed: selected?.saveFailed, refresh,
    lastSnapshot: value?.owner === owner && value.sourceRevision === options.sourceRevision && value.rows ? value : null }
}
