import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { createInvitationCacheWriter } from '../../mobile-core/src/invitationCacheWriter'

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
  const cacheSessionRef = useRef(null)
  useLayoutEffect(() => {
    const session = { active: true, scope }
    session.writer = createInvitationCacheWriter({
      isCurrent: () => session.active && cacheSessionRef.current === session && scopeRef.current === scope,
      onSaved: () => publish({ ...valueRef.current, saveFailed: false }),
      onFailure: () => publish({ ...valueRef.current, saveFailed: true }),
    })
    cacheSessionRef.current = session
    return () => { session.active = false }
  }, [scope, publish])
  const refresh = useCallback(async () => {
    const currentOptions = optionsRef.current
    const cacheSession = cacheSessionRef.current
    if (scopeRef.current !== scope || cacheSession?.scope !== scope || !cacheSession.active || !currentOptions.fixture || currentOptions.user.isOfflineProfile) return false
    const request = ++generation.current
    const current = () => scopeRef.current === scope && generation.current === request
    const previous = valueRef.current?.scope === scope ? valueRef.current : null
    publish({ ...previous, scope, checking: true })
    let complete = false
    let snapshot = null
    const write = currentOptions.createSaver(currentOptions.user, currentOptions.context, currentOptions.fixture.id)
    const accept = rows => {
      if (!current()) return
      complete = true
      snapshot = { scope, owner, fixtureId: currentOptions.fixture.id, sourceRevision: currentOptions.sourceRevision,
        rows, fresh: true, checking: false, saveFailed: valueRef.current?.saveFailed === true, checkedAt: new Date().toISOString() }
      publish(snapshot)
    }
    try {
      const rows = await withMobileAsyncTimeout(() => currentOptions.loadRows(currentOptions.user, currentOptions.fixture, { onReady: accept }), { timeoutMs: 30000 })
      accept(rows)
      if (current() && snapshot) void cacheSession.writer.schedule({ snapshot, write, key: JSON.stringify(snapshot.rows) })
      return current() && complete
    } catch {
      if (current()) {
        if (snapshot) void cacheSession.writer.schedule({ snapshot, write, key: JSON.stringify(snapshot.rows) })
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
    retrySave: () => !user.isOfflineProfile && cacheSessionRef.current?.scope === scope && cacheSessionRef.current.writer.retry(),
    lastSnapshot: value?.owner === owner && value.sourceRevision === options.sourceRevision && value.rows ? value : null }
}
