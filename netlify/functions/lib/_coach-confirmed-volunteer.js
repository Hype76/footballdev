function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function assertCoachConfirmedVolunteerSelection({ confirmedByCoach, parentLinkId, response }) {
  if (!confirmedByCoach) return
  if (!String(parentLinkId ?? '').trim()) {
    throw Object.assign(new Error('Choose a linked parent before confirming this assignment.'), { statusCode: 400 })
  }
  if (!['', 'no_response'].includes(normalize(response))) {
    throw Object.assign(new Error('A Parent response has already been recorded for this role.'), { statusCode: 409 })
  }
}
