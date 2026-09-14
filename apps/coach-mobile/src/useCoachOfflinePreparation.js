import { useEffect } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { readMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { getCoachCalendarResources } from '../../mobile-core/src/coachCalendarData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getCoachDevelopmentWorkspace } from '../../mobile-core/src/coachPhase31EData'
import { getCoachMatchDayList, getCoachMatchDayDetail } from '../../mobile-core/src/coachMatchDayData'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { readCoachOfflineResources, readCoachMatchDayOutbox, saveCoachOfflineResources, updateCoachMatchDayOutbox } from './offline'
import { createCoachPreparationRunner, prepareCoachOfflineData } from './coachOfflinePreparation'
import { createMatchDayOutbox } from '../../mobile-core/src/matchDayOutboxCore'
import { syncCoachMatchDayCommand } from '../../mobile-core/src/coachMatchDayData'
import { getPendingCoachMatchDays, readCoachOfflineReadiness } from './offline'

const timed = loader => (...args) => withMobileAsyncTimeout(() => loader(...args))
const shared = (key, loader) => user => readMobileResource(user, key, () => withMobileAsyncTimeout(() => loader(user)))
const dependencies = {
  readResources: readCoachOfflineResources, saveResources: saveCoachOfflineResources,
  readOutbox: readCoachMatchDayOutbox,
  updateOutbox: updateCoachMatchDayOutbox, getPlayers: shared('coach:players', getCoachPlayerList),
  getDevelopment: shared('coach:phase31e:development', getCoachDevelopmentWorkspace), getCalendar: shared('coach:calendar', getCoachCalendarResources),
  getMatches: shared('coach:match-list', getCoachMatchDayList), getMatch: timed(getCoachMatchDayDetail),
}

export function useCoachOfflinePreparation({ user, context, enabled }) {
  useEffect(() => {
    if (!enabled || !user?.id || user.isOfflineProfile || !context?.teamId) return undefined
    const runner = createCoachPreparationRunner({
      isActive: () => AppState.currentState === 'active',
      run: async isCurrent => {
        await new Promise(resolve => InteractionManager.runAfterInteractions(resolve))
        if (!isCurrent()) return { cancelled: true }
        return prepareCoachOfflineData({ user, context, dependencies, isCurrent })
      },
    })
    const initial = setTimeout(() => void runner.refresh(), 3000)
    const interval = setInterval(() => void runner.refresh(), 30_000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void runner.refresh() })
    return () => { runner.stop(); clearTimeout(initial); clearInterval(interval); subscription.remove() }
  }, [user, context, enabled])
}

export async function syncCoachOfflineNow(user, context) {
  if (!user?.id || user.isOfflineProfile || !context?.teamId) throw new Error('Connect and choose your team before syncing.')
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
  await prepareCoachOfflineData({ user, context, force: true, dependencies: { ...dependencies,
    getPlayers: timed(getCoachPlayerList), getDevelopment: timed(getCoachDevelopmentWorkspace),
    getCalendar: timed(getCoachCalendarResources), getMatches: timed(getCoachMatchDayList),
  } })
  const state = await readCoachOfflineReadiness(user.id, context)
  if (state.pending) throw new Error(`${state.pending} saved changes still need attention. Open the affected match to review and sync them.`)
  return state
}
