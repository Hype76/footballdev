import { getMatchDayFinishAction, getParentScorerTimerActions } from './matchday-lifecycle.js'

export const PLATFORM_MATCH_DAY_PAGE_SIZE = 50

export function getPlatformMatchDaySupportActions(match) {
  const actions = getParentScorerTimerActions(match)
  const finish = getMatchDayFinishAction(match, actions)
  if (finish && !actions.some(({ action }) => action === finish.action)) actions.push(finish)
  return actions.flatMap((item) => {
    if (item.action === 'start' && !match.isToday) return []
    if (item.action === 'full_time' && match.currentMatchPhase === 'penalties') {
      return match.shootoutCanFinish ? [{ action: 'full_time', label: 'Finish shootout' }]
        : [{ action: 'end_shootout_without_result', label: 'End shootout without a winner' }]
    }
    return item.disabled ? [] : [item]
  })
}

export function getPlatformMatchDaySupportError(error) {
  if (error?.code === '42501') return 'This team or match is unavailable. Check your Platform Admin access and reload.'
  if (['40001', '55P03'].includes(error?.code)) return 'The match changed or is being updated. Review the latest match before trying again.'
  return 'The action could not be confirmed. Review the latest match before trying again.'
}
