import { useEffect } from 'react'
import { AppState } from 'react-native'
import { getCoachCalendarResources } from '../../mobile-core/src/coachCalendarData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getCoachDevelopmentWorkspace } from '../../mobile-core/src/coachPhase31EData'
import { getCoachMatchDayList, getCoachMatchDayDetail } from '../../mobile-core/src/coachMatchDayData'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { readCoachOfflineResources, readCoachMatchDayOutbox, saveCoachOfflineResources, updateCoachMatchDayOutbox } from './offline'
import { createCoachPreparationRunner, prepareCoachOfflineData } from './coachOfflinePreparation'

const timed = loader => (...args) => withMobileAsyncTimeout(() => loader(...args))
const dependencies = {
  readResources: readCoachOfflineResources, saveResources: saveCoachOfflineResources,
  readOutbox: readCoachMatchDayOutbox,
  updateOutbox: updateCoachMatchDayOutbox, getPlayers: timed(getCoachPlayerList),
  getDevelopment: timed(getCoachDevelopmentWorkspace), getCalendar: timed(getCoachCalendarResources),
  getMatches: timed(getCoachMatchDayList), getMatch: timed(getCoachMatchDayDetail),
}

export function useCoachOfflinePreparation({ user, context, enabled }) {
  useEffect(() => {
    if (!enabled || !user?.id || user.isOfflineProfile || !context?.teamId) return undefined
    const runner = createCoachPreparationRunner({
      isActive: () => AppState.currentState === 'active',
      run: isCurrent => prepareCoachOfflineData({ user, context, dependencies, isCurrent }),
    })
    const initial = setTimeout(() => void runner.refresh(), 1000)
    const interval = setInterval(() => void runner.refresh(), 30_000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void runner.refresh() })
    return () => { runner.stop(); clearTimeout(initial); clearInterval(interval); subscription.remove() }
  }, [user, context, enabled])
}
