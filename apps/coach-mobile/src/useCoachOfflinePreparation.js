import { useEffect, useMemo, useRef } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { createCoachPreparationRunner } from './coachOfflinePreparation'
import { createMatchDayOutbox } from '../../mobile-core/src/matchDayOutboxCore'
import { syncCoachMatchDayCommand } from '../../mobile-core/src/coachMatchDayData'
import { getPendingCoachMatchDays, readCoachMatchDayOutbox, readCoachOfflineReadiness, readCoachAccountPreparation, updateCoachMatchDayOutbox } from './offline'
import { prepareCoachAccount } from './coachAccountOfflineService'
import { assertCoachAccountPreparationFinished } from './coachAccountOfflinePreparation'
import { coachPreparationScopeKey } from './coachAccountPreparationCoordinator'

export function useCoachOfflinePreparation({ user, contexts = null, context = null, activeContext = context, enabled, refreshActiveHome }) {
  const availableContexts = useMemo(() => contexts || (context ? [context] : []), [contexts, context])
  const latest = useRef({ user, contexts: availableContexts })
  useEffect(() => { latest.current = { user, contexts: availableContexts } }, [user, availableContexts])
  const scopeKey = coachPreparationScopeKey(user?.id, user?.isOfflineProfile ? 'offline' : 'online', availableContexts)
  const eligible = Boolean(enabled && user?.id && !user.isOfflineProfile && availableContexts.some(item => item.clubId))
  const selectedId = useRef('')
  const refreshHomeRef = useRef(refreshActiveHome)
  useEffect(() => { selectedId.current = activeContext?.id || ''; refreshHomeRef.current = refreshActiveHome }, [activeContext?.id, refreshActiveHome])
  useEffect(() => {
    if (!eligible) return undefined
    const runner = createCoachPreparationRunner({
      isActive: () => AppState.currentState === 'active',
      run: async runnerIsCurrent => {
        await new Promise(resolve => InteractionManager.runAfterInteractions(resolve))
        if (!runnerIsCurrent()) return { cancelled: true }
        refreshHomeRef.current?.()
        const current = latest.current
        const result = await prepareCoachAccount(current.user, current.contexts, selectedId.current, runnerIsCurrent, { yieldControl: () => new Promise(resolve => setTimeout(resolve, 0)) })
        if (!result.cancelled && result.retryNeeded) throw new Error('Some club information still needs downloading.')
        return result
      },
    })
    const idleDelayMs = 15_000
    let idleAt = 0
    let idleTimer
    const refreshWhenIdle = () => {
      if (Date.now() >= idleAt) void runner.refresh()
    }
    const schedule = () => {
      clearTimeout(idleTimer)
      idleAt = Date.now() + idleDelayMs
      idleTimer = setTimeout(() => runner.refresh(), idleDelayMs)
    }
    schedule()
    const interval = setInterval(refreshWhenIdle, 30_000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') schedule() })
    return () => { runner.stop(); clearTimeout(idleTimer); clearInterval(interval); subscription.remove() }
  }, [scopeKey, eligible])
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
  const contexts = user.coachContexts || [context]
  const result = await prepareCoachAccount(user, contexts, context.id)
  assertCoachAccountPreparationFinished(result, contexts)
  const statuses = await readCoachAccountPreparation(user.id, contexts)
  const confirmed = assertCoachAccountPreparationFinished(result, contexts, statuses)
  const state = await readCoachOfflineReadiness(user.id, context)
  if (state.pending) throw new Error(`${state.pending} saved changes still need attention. Open the affected match to review and sync them.`)
  if (result.retryNeeded) throw new Error('Some records or files still need downloading. Check the team statuses and retry while connected.')
  return { ...state, accountPreparation: { ...result, ...confirmed } }
}
