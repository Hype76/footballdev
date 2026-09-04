export const CALENDAR_VOLUNTEER_ROLE_CONFIGS = Object.freeze([
  Object.freeze({
    formKey: 'requestScorer',
    sourceKeys: ['requestScorer', 'request_scorer'],
    value: 'scorer',
  }),
  Object.freeze({
    formKey: 'requestLinesman',
    sourceKeys: ['requestLinesman', 'request_linesman'],
    value: 'linesman',
  }),
  Object.freeze({
    formKey: 'requestReferee',
    sourceKeys: ['requestReferee', 'request_referee'],
    value: 'referee',
  }),
])

function sourceRoleWasEnabled(source, keys) {
  return keys.some((key) => source?.[key] === true)
}

export function getNewlyEnabledCalendarVolunteerRoles({ event, form } = {}) {
  if (event?.sourceType !== 'match-day') {
    return []
  }

  const source = event?.data || {}

  return CALENDAR_VOLUNTEER_ROLE_CONFIGS
    .filter(({ formKey, sourceKeys }) => (
      form?.[formKey] === true && !sourceRoleWasEnabled(source, sourceKeys)
    ))
    .map(({ value }) => value)
}
