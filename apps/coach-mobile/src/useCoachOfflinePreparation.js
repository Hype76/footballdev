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
