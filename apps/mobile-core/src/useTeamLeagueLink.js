import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { createTeamLeagueRequestGate, openTeamLeagueWebsite, readTeamLeagueLink, saveTeamLeagueLink, teamLeagueScopeKey } from '../../../src/lib/team-league-link.js'
import { mobileResourceCache } from './mobileResourceCache'

export function useTeamLeagueLink(client, scope) {
  const key = teamLeagueScopeKey(scope)
  const scopeJson = JSON.stringify(scope)
  // Derive an immutable scope from the key rather than a changing profile object.
  const session = useMemo(() => ({ gate: createTeamLeagueRequestGate(), key, scope: JSON.parse(scopeJson), client }), [key, scopeJson, client])
  const cacheKey = 'team-league:' + key
  const [state, setState] = useState(() => {
    const value = key ? mobileResourceCache.peek(cacheKey, 300000) : null
    return { session, value, status: value ? 'ready' : 'loading', error: '' }
  })
  const load = useCallback(async ({ force = false } = {}) => {
    if (!session.gate.isActive()) return null
    const token = session.gate.begin()
    setState(current => ({ session, value: current.session === session ? current.value : null, status: 'loading', error: '' }))
    if (!session.key) { setState({ session, value: null, status: 'ready', error: '' }); return null }
    try {
      const value = await mobileResourceCache.read(cacheKey, () => readTeamLeagueLink(client, session.scope), { force, maxAgeMs: 300000 })
      if (!session.gate.isCurrent(token)) return null
      setState({ session, value, status: 'ready', error: '' })
      return { value, token }
    } catch {
      if (session.gate.isCurrent(token)) mobileResourceCache.invalidate(cacheKey)
      if (session.gate.isCurrent(token)) setState({ session, value: null, status: 'error', error: 'The league link is unavailable. Refresh your team access and try again.' })
      return null
    }
  }, [cacheKey, client, session])
  useLayoutEffect(() => {
    session.gate.activate()
    const token = session.gate.begin()
    void Promise.resolve().then(() => { if (session.gate.isCurrent(token)) void load() })
    return () => {
      session.gate.invalidate()
      // A new visit must not inherit an unfinished request from an old scope.
      if (mobileResourceCache.peek(cacheKey, 300000) === undefined) mobileResourceCache.invalidate(cacheKey)
    }
  }, [cacheKey, load, session])
  const save = useCallback(async values => {
    if (state.session !== session || !state.value?.canEdit || state.status !== 'ready') return false
    const token = session.gate.beginSave()
    if (token === null) return false
    setState({ session, value: state.value, status: 'saving', error: '' })
    try {
      const value = await saveTeamLeagueLink(client, session.scope, values)
      if (!session.gate.isCurrent(token)) return false
      mobileResourceCache.invalidate(cacheKey)
      setState({ session, value, status: 'ready', error: '' })
      return true
    } catch (error) {
      if (session.gate.isCurrent(token)) setState({ session, value: null, status: 'error', error: error.message })
      return false
    } finally {
      session.gate.finishSave(token)
    }
  }, [cacheKey, client, session, state])
  const open = useCallback(async opener => {
    const fresh = await load({ force: true })
    if (!fresh || !fresh.value.enabled || !fresh.value.url) return false
    try { return await openTeamLeagueWebsite(fresh.value.url, opener, () => session.gate.isCurrent(fresh.token)) }
    catch (error) {
      if (session.gate.isCurrent(fresh.token)) setState({ session, value: fresh.value, status: 'ready', error: error.message })
      return false
    }
  }, [load, session])
  return { ...(state.session === session ? state : { value: null, status: 'loading', error: '' }), load, save, open }
}
