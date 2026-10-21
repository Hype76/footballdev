import { CAPABILITIES } from './paywall-access.js'

export function getCalendarEventCapability(eventType) {
  if (eventType === 'training') return CAPABILITIES.trainingEvents
  if (eventType === 'match') return CAPABILITIES.fixtures
  return CAPABILITIES.generalEvents
}
