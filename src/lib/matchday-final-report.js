export const MATCH_DAY_FINAL_REPORT_NOTES_MAX_LENGTH = 5000

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEventStatus(event) {
  return normalizeText(event?.eventStatus ?? event?.event_status) || 'active'
}

function normalizeEventType(event) {
  return normalizeText(event?.eventType ?? event?.event_type)
}

export function isFinalMatchReportAvailable(match) {
  return normalizeText(match?.status) === 'full_time'
}

export function buildFinalMatchReportSummary(match = {}) {
  const events = Array.isArray(match.events) ? match.events : []
  const activeEvents = events.filter((event) => normalizeEventStatus(event) !== 'voided')
  const voidedEvents = events.filter((event) => normalizeEventStatus(event) === 'voided')

  return {
    activeEvents,
    activeGoals: activeEvents.filter((event) => normalizeEventType(event) === 'goal'),
    activeCards: activeEvents.filter((event) => ['yellow_card', 'red_card'].includes(normalizeEventType(event))),
    activeSubstitutions: activeEvents.filter((event) => normalizeEventType(event) === 'substitution'),
    activeWaterBreaks: activeEvents.filter((event) => normalizeEventType(event) === 'water_break'),
    voidedEvents,
  }
}

export function validateFinalMatchReportNotes(value) {
  const staffNotes = normalizeText(value)

  if (staffNotes.length > MATCH_DAY_FINAL_REPORT_NOTES_MAX_LENGTH) {
    throw new Error(`Staff notes must be ${MATCH_DAY_FINAL_REPORT_NOTES_MAX_LENGTH} characters or fewer.`)
  }

  return staffNotes
}
