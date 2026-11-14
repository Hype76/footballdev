import { useEffect, useMemo, useRef } from 'react'
import { AppState, InteractionManager } from 'react-native'
import { readMobileResource } from '../../mobile-core/src/mobileResourceCache'
import { getCoachCalendarResources } from '../../mobile-core/src/coachCalendarData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getCoachDevelopmentWorkspace, getCoachInvitesAndAvailability } from '../../mobile-core/src/coachPhase31EData'
import { getCoachPhase31GAttentionSnapshot, getCoachPhase31GPrimaryHomeSnapshot, mergeCoachPhase31GHomeSnapshots } from '../../mobile-core/src/coachPhase31GData'
import { getCoachMatchDayList, getCoachMatchDayDetail } from '../../mobile-core/src/coachMatchDayData'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { createCoachOfflineResourceSaver, readCoachOfflineResources, readCoachMatchDayOutbox, readCoachOverviewResources, saveCoachOfflineResources, updateCoachMatchDayOutbox } from './offline'
import { createCoachPreparationRunner, prepareCoachOfflineData, prepareCoachTeamOverview } from './coachOfflinePreparation'
import { createMatchDayOutbox } from '../../mobile-core/src/matchDayOutboxCore'
import { syncCoachMatchDayCommand } from '../../mobile-core/src/coachMatchDayData'
import { applyCoachContext } from '../../mobile-core/src/coachContextCore'
import { isMatchdayPlan } from '../../mobile-core/src/matchdayPolicyCore'
import { loadMatchdayPlanConfig } from '../../mobile-core/src/matchdayPlanData'
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

async function getTeamHome(user) {
  const [primary, attention] = await Promise.all([
    getCoachPhase31GPrimaryHomeSnapshot(user),
    withMobileAsyncTimeout(() => getCoachPhase31GAttentionSnapshot(user, { force: false })),
  ])
  const homeSources = Object.fromEntries(['development', 'chatRooms', 'polls', 'invites'].map(source => [
    source, !attention.errors.some(error => error.startsWith(`${source}:`)),
  ]))
  return { ...mergeCoachPhase31GHomeSnapshots(primary, attention), homeSources, savedAt: new Date().toISOString() }
}

const overviewDependencies = {
  readResources: readCoachOverviewResources,
  createSaver: createCoachOfflineResourceSaver,
  getHome: getTeamHome,
  getInvites: user => withMobileAsyncTimeout(() => getCoachInvitesAndAvailability(user), { timeoutMs: 30000 }),
}

export function useCoachOfflinePreparation({ user, contexts = null, context = null, activeContext = context, enabled, refreshActiveHome, activeInvites = false }) {
  const availableContexts = useMemo(() => contexts || (context ? [context] : []), [contexts, context])
  const activeContextId = useRef('')
  activeContextId.current = activeContext?.id || ''
  const refreshHomeRef = useRef(refreshActiveHome)
  refreshHomeRef.current = refreshActiveHome
  const activeInvitesRef = useRef(activeInvites)
  activeInvitesRef.current = activeInvites
  useEffect(() => {
    if (!enabled || !user?.id || user.isOfflineProfile || !availableContexts.some(item => item.teamId && item.clubId === user.clubId)) return undefined
    const runner = createCoachPreparationRunner({
      isActive: () => AppState.currentState === 'active',
      run: async isCurrent => {
        await new Promise(resolve => InteractionManager.runAfterInteractions(resolve))
        if (!isCurrent()) return { cancelled: true }
        const policy = availableContexts.some(isMatchdayPlan) ? await loadMatchdayPlanConfig().catch(() => null) : null
        const selectedId = activeContextId.current
        const teamContexts = availableContexts.filter(item => item.teamId && item.clubId === user.clubId)
          .sort((left, right) => Number(right.id === selectedId) - Number(left.id === selectedId))
        if (selectedId && teamContexts.some(item => item.id === selectedId)) refreshHomeRef.current?.()
        let firstError = null
        for (const context of teamContexts) {
          if (!isCurrent()) return { cancelled: true }
          const scopedUser = { ...applyCoachContext(user, context), matchdayPolicy: policy }
          try {
            if (isMatchdayPlan(context) && !policy) throw new Error('Matchday plan information is unavailable.')
            const isSelected = context.id === activeContextId.current
            await prepareCoachTeamOverview({ user: scopedUser, context, ...overviewDependencies, isCurrent,
              includeHome: !isSelected || !refreshHomeRef.current,
              includeInvites: !isSelected || !activeInvitesRef.current,
            })
          } catch (error) { firstError ||= error }
        }
        for (const context of teamContexts) {
          if (!isCurrent()) return { cancelled: true }
          const scopedUser = { ...applyCoachContext(user, context), matchdayPolicy: policy }
          try { await prepareCoachOfflineData({ user: scopedUser, context, dependencies, isCurrent }) }
          catch (error) { firstError ||= error }
        }
        if (firstError) throw firstError
        return { saved: true, teams: teamContexts.length }
      },
    })
    const initial = setTimeout(() => void runner.refresh(), 3000)
    const interval = setInterval(() => void runner.refresh(), 30_000)
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void runner.refresh() })
    return () => { runner.stop(); clearTimeout(initial); clearInterval(interval); subscription.remove() }
  }, [user, availableContexts, enabled])
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
