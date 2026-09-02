import { getRequiredMatchDurationValidationError } from './matchday-model.js'

export const DEFAULT_TEAM_FIXTURE_PREFERENCES = Object.freeze({
  arrivalPreset: '30',
  arrivalTime: '',
  duration: 90,
  found: false,
})

const ARRIVAL_PRESETS = new Set(['15', '30', '45', '60', 'custom'])

function normalizeTime(value) {
  const match = String(value ?? '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)/)
  return match ? `${match[1]}:${match[2]}` : ''
}

function normalizeDuration(value) {
  const duration = Number(value)
  return !getRequiredMatchDurationValidationError(duration)
    ? duration
    : DEFAULT_TEAM_FIXTURE_PREFERENCES.duration
}

export function normalizeOwnTeamFixturePreferences(value = {}) {
  const arrivalPreset = ARRIVAL_PRESETS.has(String(value?.arrivalPreset ?? value?.arrival_preset))
    ? String(value.arrivalPreset ?? value.arrival_preset)
    : DEFAULT_TEAM_FIXTURE_PREFERENCES.arrivalPreset
  const arrivalTime = arrivalPreset === 'custom'
    ? normalizeTime(value?.arrivalTime ?? value?.arrival_time)
    : ''

  return Object.freeze({
    arrivalPreset: arrivalPreset === 'custom' && !arrivalTime
      ? DEFAULT_TEAM_FIXTURE_PREFERENCES.arrivalPreset
      : arrivalPreset,
    arrivalTime,
    duration: normalizeDuration(value?.duration ?? value?.durationMinutes ?? value?.duration_minutes),
    found: value?.found === true,
  })
}

export function buildOwnTeamFixturePreferenceUpdate(form = {}) {
  return Object.freeze({
    arrivalPreset: ARRIVAL_PRESETS.has(String(form.arrivalPreset))
      ? String(form.arrivalPreset)
      : DEFAULT_TEAM_FIXTURE_PREFERENCES.arrivalPreset,
    arrivalTime: normalizeTime(form.arrivalTime),
    duration: normalizeDuration(form.matchDurationMinutes ?? form.duration),
    saveArrival: form.saveArrivalAsDefault === true,
    saveDuration: form.saveDurationAsDefault === true,
  })
}
