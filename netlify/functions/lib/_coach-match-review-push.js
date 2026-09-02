import { getMatchDayDisplayName } from '../../../src/lib/matchday-display.js'
import { resolveMatchDayNotificationTeamName } from '../../../src/lib/team-notification-display.js'

export function buildCoachMatchReviewPayload(match) {
  const teamName = resolveMatchDayNotificationTeamName(match)
  return {
    title: `${getMatchDayDisplayName({ ...match, teamName })}: review required`,
    body: 'The parent scorer has ended the match. Please review the report and conclude the game.',
    type: 'coach_update',
    data: {
      app: 'coach', route: 'matchday', targetId: match.id, matchDayId: match.id, teamId: match.team_id,
      contextId: `team:${match.team_id}`, teamName, type: 'match_review_required',
    },
  }
}
