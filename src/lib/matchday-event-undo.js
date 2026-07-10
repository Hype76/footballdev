const MATCH_DAY_UNDO_NOTE_MAX_LENGTH = 240

const REASON_OPTIONS_BY_EVENT_TYPE = {
  goal: [
    { value: 'goal_disallowed', label: 'Goal disallowed' },
    { value: 'wrong_scorer', label: 'Wrong scorer' },
    { value: 'wrong_assist', label: 'Wrong assist' },
    { value: 'wrong_team', label: 'Wrong team' },
    { value: 'wrong_minute', label: 'Wrong minute' },
    { value: 'duplicate_goal', label: 'Duplicate goal' },
    { value: 'added_by_mistake', label: 'Added by mistake' },
    { value: 'other', label: 'Other' },
  ],
  yellow_card: [
    { value: 'wrong_player', label: 'Wrong player' },
    { value: 'wrong_card_type', label: 'Wrong card type' },
    { value: 'wrong_minute', label: 'Wrong minute' },
    { value: 'referee_decision_changed', label: 'Referee decision changed' },
    { value: 'duplicate_card', label: 'Duplicate card' },
    { value: 'added_by_mistake', label: 'Added by mistake' },
    { value: 'other', label: 'Other' },
  ],
  red_card: [
    { value: 'wrong_player', label: 'Wrong player' },
    { value: 'wrong_card_type', label: 'Wrong card type' },
    { value: 'wrong_minute', label: 'Wrong minute' },
    { value: 'referee_decision_changed', label: 'Referee decision changed' },
    { value: 'duplicate_card', label: 'Duplicate card' },
    { value: 'added_by_mistake', label: 'Added by mistake' },
    { value: 'other', label: 'Other' },
  ],
  substitution: [
    { value: 'wrong_player_off', label: 'Wrong player off' },
    { value: 'wrong_player_on', label: 'Wrong player on' },
    { value: 'wrong_minute', label: 'Wrong minute' },
    { value: 'duplicate_substitution', label: 'Duplicate substitution' },
    { value: 'added_by_mistake', label: 'Added by mistake' },
    { value: 'other', label: 'Other' },
  ],
  water_break: [
    { value: 'wrong_minute', label: 'Wrong minute' },
    { value: 'duplicate_event', label: 'Duplicate event' },
    { value: 'break_not_taken', label: 'Break not taken' },
    { value: 'added_by_mistake', label: 'Added by mistake' },
    { value: 'other', label: 'Other' },
  ],
}

export const MATCH_DAY_UNDO_SUPPORTED_EVENT_TYPES = new Set(Object.keys(REASON_OPTIONS_BY_EVENT_TYPE))

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEventType(eventOrType) {
  if (eventOrType && typeof eventOrType === 'object') {
    return normalizeText(eventOrType.eventType ?? eventOrType.event_type)
  }

  return normalizeText(eventOrType)
}

export function getMatchDayUndoReasonOptions(eventOrType) {
  const eventType = normalizeEventType(eventOrType)
  return REASON_OPTIONS_BY_EVENT_TYPE[eventType] ?? []
}

export function isMatchDayEventUndoSupported(event = {}) {
  const eventType = normalizeEventType(event)
  const eventStatus = normalizeText(event.eventStatus ?? event.event_status) || 'active'
  return MATCH_DAY_UNDO_SUPPORTED_EVENT_TYPES.has(eventType) && eventStatus !== 'voided'
}

export function validateMatchDayEventUndoInput({ eventType, note = '', reasonCode = '' } = {}) {
  const normalizedEventType = normalizeEventType(eventType)
  const normalizedReasonCode = normalizeText(reasonCode).toLowerCase()
  const normalizedNote = normalizeText(note)
  const options = getMatchDayUndoReasonOptions(normalizedEventType)
  const selectedReason = options.find((option) => option.value === normalizedReasonCode)

  if (!MATCH_DAY_UNDO_SUPPORTED_EVENT_TYPES.has(normalizedEventType)) {
    throw new Error('This timeline event cannot be voided.')
  }

  if (!selectedReason) {
    throw new Error('Choose a reason for undo before confirming.')
  }

  if (normalizedNote.length > MATCH_DAY_UNDO_NOTE_MAX_LENGTH) {
    throw new Error(`Keep the undo note to ${MATCH_DAY_UNDO_NOTE_MAX_LENGTH} characters or fewer.`)
  }

  if (normalizedReasonCode === 'other' && !normalizedNote) {
    throw new Error('Add a short note when Other is selected.')
  }

  return {
    eventType: normalizedEventType,
    note: normalizedNote,
    reasonCode: normalizedReasonCode,
    reasonLabel: selectedReason.label,
  }
}

export { MATCH_DAY_UNDO_NOTE_MAX_LENGTH }
