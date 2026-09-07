import { useCallback, useEffect, useMemo, useState } from 'react'
import { createMatchDayOutbox, projectMatchDayOutbox } from '../../mobile-core/src/matchDayOutboxCore'
import { createCoachMatchDayCommandId, syncCoachMatchDayCommand } from '../../mobile-core/src/coachMatchDayData'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { readCoachMatchDayOutbox, updateCoachMatchDayOutbox } from './offline'
import NetInfo from '@react-native-community/netinfo'
import { AppState } from 'react-native'

export function useCoachMatchDayOutbox({ user, context, matchId }) {
  const [state, setState] = useState(null)
  const scopeKey = JSON.stringify([user.id, context.id, context.authorityId, context.authoritySource, context.role, context.clubId, context.teamId, matchId || ''])
  const stableContext = useMemo(() => ({ id: context.id, authorityId: context.authorityId, authoritySource: context.authoritySource,
    clubId: context.clubId, teamId: context.teamId, role: context.role }),
  [context.id, context.authorityId, context.authoritySource, context.clubId, context.teamId, context.role])
  const controller = useMemo(() => matchId ? createMatchDayOutbox({
    key: `${user.id}:${stableContext.id}:${matchId}`,
    read: () => readCoachMatchDayOutbox(user.id, stableContext, matchId),
    update: change => updateCoachMatchDayOutbox(user.id, stableContext, matchId, change),
    send: (command, baseMatch) => withMobileAsyncTimeout(() => syncCoachMatchDayCommand(user, command, baseMatch)),
    onChange: journal => setState({ scopeKey, journal }),
  }) : null, [stableContext, matchId, scopeKey, user])
  useEffect(() => {
    controller?.start()
    controller?.load().then(() => controller.sync()).catch(() => {})
    const sync = () => { if (AppState.currentState === 'active') void controller?.sync().catch(() => {}) }
    const removeNetwork = NetInfo.addEventListener(state => { if (state.isConnected !== false && state.isInternetReachable !== false) sync() })
    const appState = AppState.addEventListener('change', state => { if (state === 'active') sync() })
    const interval = setInterval(sync, 15000)
    return () => { controller?.stop(); removeNetwork(); appState.remove(); clearInterval(interval) }
  }, [controller])
  const enqueue = useCallback(async (kind, payload) => {
    if (!controller) throw new Error('Choose a fixture first.')
    const journal = await controller.enqueue({ id: createCoachMatchDayCommandId(), kind, payload })
    void controller.sync().catch(() => {})
    return projectMatchDayOutbox(journal)
  }, [controller])
  const refresh = useCallback(async match => {
    if (!controller) return null
    const journal = await controller.refresh(match)
    void controller.sync().catch(() => {})
    return journal
  }, [controller])
  const journal = state?.scopeKey === scopeKey ? state.journal : null
  return { enqueue, refresh, discard: match => controller?.discardPending(match), retry: () => controller?.sync(), journal, projected: journal ? projectMatchDayOutbox(journal) : null }
}
