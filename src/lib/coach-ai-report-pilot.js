export const COACH_AI_PILOT_CLUB_ID = 'f747d2cc-a5e5-4960-8ad3-dcfe85b49279'

export function canUseCoachAiReportUi(match, userId) {
  return match?.clubId === COACH_AI_PILOT_CLUB_ID
    && match?.status === 'full_time'
    && Boolean(match?.concludedAt)
    && match?.concludedBy === userId
}
