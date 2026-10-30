import { collapseCoachInvitesByPlayer } from './coachPhase31ECore.js'

export const COACH_AVAILABILITY_CACHE_VERSION = 1

export function restoreCoachAvailabilitySnapshot(value) {
  if (!value || typeof value !== 'object') return value
  // Older snapshots were sliced across fixtures before duplicate requests were
  // combined. Their numeric totals cannot be recovered from those saved rows.
  return value.availabilityCacheVersion === COACH_AVAILABILITY_CACHE_VERSION
    ? value : { ...value, availabilityCacheVersion: 0 }
}

export function hasCompleteCoachAvailabilitySnapshot(value, kind = 'match') {
  return value?.availabilityCacheVersion !== 0
    || (kind === 'match' && value?.matchAvailabilityVerified === true)
}

export function compactCoachAvailabilitySnapshot(value, bounded, boundRow) {
  const match = collapseCoachInvitesByPlayer(value.match).map(boundRow)
  const trainingGroups = new Map()
  for (const row of value.training || []) {
    if (row.cancelled || row.stale) continue
    const key = JSON.stringify([row.eventId, row.occurrenceDate])
    if (!trainingGroups.has(key)) trainingGroups.set(key, [])
    trainingGroups.get(key).push(row)
  }
  const training = [...trainingGroups.values()].flatMap(collapseCoachInvitesByPlayer).map(boundRow)
  // Preserve complete rosters, rather than cutting through an event at row 180.
  // coachOfflineCore still enforces the unchanged encrypted document byte cap:
  // a snapshot that cannot fit fails atomically and retains the previous copy.
  return {
    ...bounded,
    availabilityCacheVersion: value.availabilityCacheVersion === 0 ? 0 : COACH_AVAILABILITY_CACHE_VERSION,
    match,
    training,
    trainingCoaches: (value.trainingCoaches || []).map(boundRow),
    all: [...match, ...training, ...(bounded.calendar || [])],
  }
}

export function compactCoachFixtureAvailabilitySnapshot(value, bounded, boundRow) {
  return { ...bounded, availabilityCacheVersion: COACH_AVAILABILITY_CACHE_VERSION,
    rows: collapseCoachInvitesByPlayer(value.rows).map(boundRow) }
}
