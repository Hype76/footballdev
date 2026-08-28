import { MATCH_DAY_CONCLUSION_RULE_OPTIONS, MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS, matchUsesExtraTime, normalizeExtraTimeHalfMinutes, normalizeExtraTimePeriodCount, normalizeMatchDayConclusionRule } from '../../../src/lib/matchday-extended-ops.js'
import { assertValidMatchDayFixtureType, MATCH_DAY_FIXTURE_TYPE_OPTIONS } from '../../../src/lib/matchday-fixture-type.js'
import { assertMatchDayShirtChoice, assertNewMatchHomeAway, assertValidMatchClockMode, assertValidMatchDurationMinutes, isContinuousMatchClock, MATCH_CLOCK_MODE_OPTIONS, MATCH_DAY_HOME_AWAY_OPTIONS, MATCH_DAY_SHIRT_CHOICE_OPTIONS } from '../../../src/lib/matchday-model.js'
import { getDateInTimeZone } from './parentCalendarCore.js'
import { formatCoachCalendarFormDate, normalizeCoachCalendarFormDate } from './coachCalendarCore.js'
import { DEFAULT_EXPIRY_DURATION, expiryDurationToHours } from '../../../src/lib/expiry-duration.js'

export const COACH_MATCH_DURATION_OPTIONS = Object.freeze([60, 70, 80, 90])
export const COACH_MATCH_ARRIVAL_OPTIONS = Object.freeze([
  { label: '15 minutes before kick-off', value: '15' },
  { label: '30 minutes before kick-off', value: '30' },
  { label: '45 minutes before kick-off', value: '45' },
  { label: '60 minutes before kick-off', value: '60' },
  { label: 'Custom arrival time', value: 'custom' },
])

export { MATCH_CLOCK_MODE_OPTIONS, MATCH_DAY_CONCLUSION_RULE_OPTIONS, MATCH_DAY_EXTRA_TIME_PERIOD_COUNT_OPTIONS, MATCH_DAY_FIXTURE_TYPE_OPTIONS, MATCH_DAY_HOME_AWAY_OPTIONS, MATCH_DAY_SHIRT_CHOICE_OPTIONS, isContinuousMatchClock, matchUsesExtraTime }

function normalize(value) {
  return String(value ?? '').trim()
}

export function calculateCoachArrivalTime(kickoffTime, minutesBefore = '30') {
  const match = normalize(kickoffTime).match(/^(\d{2}):(\d{2})$/)
  const lead = Number(minutesBefore)
  if (!match || !Number.isFinite(lead)) return ''
  const totalMinutes = ((Number(match[1]) * 60) + Number(match[2]) - lead + 1440) % 1440
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

export function getCoachMatchLocationOptions(matches = []) {
  const seen = new Set()
  return [...matches]
    .sort((left, right) => new Date(right?.updatedAt || right?.matchDate || 0) - new Date(left?.updatedAt || left?.matchDate || 0))
    .map((match) => ({ address: normalize(match?.venueAddress), name: normalize(match?.venueName) }))
    .filter((location) => {
      const key = `${location.name.toLowerCase()}|${location.address.toLowerCase()}`
      if (!location.name || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((location) => Object.freeze({ ...location, id: `${location.name}|${location.address}`, label: location.address ? `${location.name} | ${location.address}` : location.name }))
}

export function createCoachFixtureForm({ defaultDuration = 90, defaultLocation = null, defaultMotmPollExpiryDuration = DEFAULT_EXPIRY_DURATION, notificationTeamName = '' } = {}) {
  const duration = assertValidMatchDurationMinutes(defaultDuration)
  const kickoffTime = '10:00'
  return {
    arrivalPreset: '30',
    arrivalTime: calculateCoachArrivalTime(kickoffTime, '30'),
    autoSelectAvailablePlayers: true,
    clockMode: 'fixed',
    conclusionRule: 'normal_time',
    enableMotmPoll: false,
    extraTimeHalfMinutes: 15,
    extraTimePeriodCount: 2,
    fixtureType: '',
    homeAway: 'home',
    shirtChoice: 'home',
    kickoffTime,
    kickoffTimeTbc: false,
    matchDate: formatCoachCalendarFormDate(getDateInTimeZone()),
    matchDurationMinutes: duration,
    motmNotifyResultsOnClose: false,
    motmPollExpiryDuration: normalize(defaultMotmPollExpiryDuration) || DEFAULT_EXPIRY_DURATION,
    notes: '',
    notificationTeamName: normalize(notificationTeamName),
    rememberNotificationTeamName: true,
    opponent: '',
    parentAudience: 'none',
    parentVisible: false,
    requestLinesman: false,
    requestReferee: false,
    requestScorer: false,
    saveDurationAsDefault: false,
    saveMotmExpiryAsDefault: false,
    selectedPlayerIds: [],
    venueAddress: normalize(defaultLocation?.address),
    venueName: normalize(defaultLocation?.name),
  }
}

export function initializeCoachFixtureForm(currentForm, options = {}) {
  if (currentForm && typeof currentForm === 'object') return currentForm
  return createCoachFixtureForm(options)
}

export function updateCoachFixtureKickoff(form, kickoffTime) {
  return {
    ...form,
    arrivalTime: form.arrivalPreset === 'custom' ? form.arrivalTime : calculateCoachArrivalTime(kickoffTime, form.arrivalPreset),
    kickoffTime,
  }
}

export function updateCoachFixtureArrivalPreset(form, arrivalPreset) {
  return {
    ...form,
    arrivalPreset,
    arrivalTime: arrivalPreset === 'custom' ? form.arrivalTime : calculateCoachArrivalTime(form.kickoffTime, arrivalPreset),
  }
}

export function validateCoachFixtureForm(form = {}) {
  const opponent = normalize(form.opponent)
  if (!opponent) throw new Error('Add the opponent.')
  const fixtureType = assertValidMatchDayFixtureType(form.fixtureType)
  const matchDate = normalizeCoachCalendarFormDate(form.matchDate)
  if (!matchDate) throw new Error('Choose a valid match date.')
  if (matchDate < getDateInTimeZone()) throw new Error('Choose today or a future match date.')
  const kickoffTimeTbc = form.kickoffTimeTbc === true
  const kickoffTime = kickoffTimeTbc ? '' : normalize(form.kickoffTime)
  if (!kickoffTimeTbc && !/^([01]\d|2[0-3]):[0-5]\d$/.test(kickoffTime)) throw new Error('Choose a valid kick-off time.')
  const parentVisible = form.parentVisible === true
  const parentAudience = parentVisible ? normalize(form.parentAudience) : 'none'
  if (parentVisible && !['involved_players', 'all_team_parents'].includes(parentAudience)) throw new Error('Choose which team parents can see this fixture.')
  const selectedPlayerIds = [...new Set((form.selectedPlayerIds || []).map(normalize).filter(Boolean))]
  if (parentVisible && selectedPlayerIds.length === 0) throw new Error('Choose at least one Player to receive the fixture invitation.')
  const clockMode = assertValidMatchClockMode(form.clockMode)
  const matchDurationMinutes = assertValidMatchDurationMinutes(form.matchDurationMinutes)
  const arrivalTime = kickoffTimeTbc ? '' : normalize(form.arrivalTime)
  if (!kickoffTimeTbc && arrivalTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) throw new Error('Choose a valid arrival time.')
  const motmPollExpiryHours = form.enableMotmPoll === true
    ? expiryDurationToHours(form.motmPollExpiryDuration)
    : 2
  return Object.freeze({
    arrivalTime,
    autoSelectAvailablePlayers: form.autoSelectAvailablePlayers !== false,
    clockMode,
    conclusionRule: normalizeMatchDayConclusionRule(form.conclusionRule),
    enableMotmPoll: form.enableMotmPoll === true,
    extraTimeHalfMinutes: normalizeExtraTimeHalfMinutes(form.extraTimeHalfMinutes),
    extraTimePeriodCount: normalizeExtraTimePeriodCount(form.extraTimePeriodCount),
    fixtureType,
    homeAway: assertNewMatchHomeAway(form.homeAway),
    shirtChoice: assertMatchDayShirtChoice(form.shirtChoice),
    kickoffTime,
    kickoffTimeTbc,
    matchDate,
    matchDurationMinutes,
    motmNotifyResultsOnClose: form.enableMotmPoll === true && form.motmNotifyResultsOnClose === true,
    motmPollExpiryHours,
    notes: normalize(form.notes),
    notificationTeamName: normalize(form.notificationTeamName),
    rememberNotificationTeamName: form.rememberNotificationTeamName === true,
    opponent,
    parentAudience,
    parentVisible,
    requestLinesman: form.requestLinesman === true,
    requestReferee: form.requestReferee === true,
    requestScorer: form.requestScorer === true,
    selectedPlayerIds,
    venueAddress: normalize(form.venueAddress),
    venueName: normalize(form.venueName),
  })
}
