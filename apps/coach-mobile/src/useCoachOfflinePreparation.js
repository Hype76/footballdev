import { useEffect, useMemo, useRef } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { createCoachPreparationRunner } from './coachOfflinePreparation'
import { createMatchDayOutbox } from '../../mobile-core/src/matchDayOutboxCore'
import { syncCoachMatchDayCommand } from '../../mobile-core/src/coachMatchDayData'
import { getPendingCoachMatchDays, readCoachMatchDayOutbox, readCoachOfflineReadiness, updateCoachMatchDayOutbox } from './offline'
import { prepareCoachAccount } from './coachAccountOfflineService'

export function useCoachOfflinePreparation({ user, contexts = null, context = null, activeContext = context, enabled, refreshActiveHome }) {
  const availableContexts = useMemo(() => contexts || (context ? [context] : []), [contexts, context])
  const selectedId = useRef('')
  const refreshHomeRef = useRef(refreshActiveHome)
  useEffect(() => { selectedId.current = activeContext?.id || ''; refreshHomeRef.current = refreshActiveHome }, [activeContext?.id, refreshActiveHome])
  useEffect(() => {
    if (!enabled || !user?.id || user.isOfflineProfile || !availableContexts.some(item => item.clubId)) return undefined
    const runner = createCoachPreparationRunner({
      isActive: () => AppState.currentState === 'active',
      run: async runnerIsCurrent => {
        await user.waitForCoachAuthority?.()
        const generation = user.getCoachAuthorityGeneration?.()
        const isCurrent = () => runnerIsCurrent() && generation === user.getCoachAuthorityGeneration?.()
        await new Promise(resolve => InteractionManager.runAfterInteractions(resolve))
        if (!isCurrent()) return { cancelled: true }
        refreshHomeRef.current?.()
        const result = await prepareCoachAccount(user, availableContexts, selectedId.current, isCurrent)
        if (!result.cancelled && result.retryNeeded) throw new Error('Some club information still needs downloading.')
        return result
      },
    })
    const initial = setTimeout(() => void runner.refresh(), 3000)
    const interval = setInterval(() => void runner.refresh(), 30_000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void runner.refresh() })
    return () => { runner.stop(); clearTimeout(initial); clearInterval(interval); subscription.remove() }
  }, [user, availableContexts, enabled])
}

export async function syncCoachOfflineNow(user, context) {
  if (!user?.id || user.isOfflineProfile || !context?.clubId) throw new Error('Connect and choose your club before syncing.')
  const pending = await getPendingCoachMatchDays(user.id)
  for (const { contextId, matchId } of pending) {
    if (contextId !== context.id) continue
    const controller = createMatchDayOutbox({ key: `${user.id}:${contextId}:${matchId}`,
      read: () => readCoachMatchDayOutbox(user.id, context, matchId),
      update: change => updateCoachMatchDayOutbox(user.id, context, matchId, change),
      send: (command, baseMatch) => withMobileAsyncTimeout(() => syncCoachMatchDayCommand(user, command, baseMatch), { timeoutMs: 35000 }),
    })
    await controller.sync()
  }
  const result = await prepareCoachAccount(user, user.coachContexts || [context], context.id)
  const state = await readCoachOfflineReadiness(user.id, context)
  if (state.pending) throw new Error(`${state.pending} saved changes still need attention. Open the affected match to review and sync them.`)
  if (result.retryNeeded) throw new Error('Some records or files still need downloading. Check the team statuses and retry while connected.')
  return { ...state, accountPreparation: result }
}
