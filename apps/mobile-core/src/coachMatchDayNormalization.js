import { normalizeExtraTimeHalfMinutes, normalizeExtraTimePeriodCount, normalizeMatchDayConclusionRule } from '../../../src/lib/matchday-extended-ops.js'
import { normalizeLegacyMatchHomeAway, normalizeMatchClockMode, normalizeMatchDayShirtChoice, normalizeMatchDurationMinutes } from '../../../src/lib/matchday-model.js'
import { normalizeTeamNotificationDisplayName } from '../../../src/lib/team-notification-display.js'
import { normalizeMatchDaySquadDecision } from '../../../src/lib/matchday-squad-selection.js'
function normalize(value) { return String(value ?? '').trim() }
function relation(value) { return Array.isArray(value) ? value[0] : value }
function integer(value) { const number = Number(value ?? 0); return Number.isFinite(number) ? Math.max(Math.floor(number), 0) : 0 }
function optionalInteger(value) { return value === null || value === undefined || value === '' ? null : integer(value) }

function normalizeEvent(row = {}) {
  const teamSide = normalize(row.team_side ?? row.teamSide)
  return {
    scorerPlayerId: normalize(row.scorer_player_id ?? row.scorerPlayerId), assistPlayerId: normalize(row.assist_player_id ?? row.assistPlayerId), participantIdentityVersion: row.participant_identity_version ?? row.participantIdentityVersion ?? null,
    id: row.id ?? '', matchDayId: row.match_day_id ?? row.matchDayId ?? '', eventType: normalize(row.event_type ?? row.eventType) || 'goal',
    teamSide: teamSide || 'club', teamSideRecorded: row.team_side_recorded === false || row.teamSideRecorded === false ? false : Boolean(teamSide),
    minute: row.minute ?? null, stoppageMinute: row.stoppage_minute ?? row.stoppageMinute ?? null, scorerName: normalize(row.scorer_name ?? row.scorerName), scorerShirtNumber: normalize(row.scorer_shirt_number ?? row.scorerShirtNumber),
    assistName: normalize(row.assist_name ?? row.assistName), assistShirtNumber: normalize(row.assist_shirt_number ?? row.assistShirtNumber),
    playerName: normalize(row.player_name ?? row.playerName ?? row.scorer_name ?? row.scorerName), playerShirtNumber: normalize(row.player_shirt_number ?? row.playerShirtNumber ?? row.scorer_shirt_number ?? row.scorerShirtNumber),
    playerOnName: normalize(row.player_on_name ?? row.playerOnName ?? row.assist_name ?? row.assistName), playerOnShirtNumber: normalize(row.player_on_shirt_number ?? row.playerOnShirtNumber ?? row.assist_shirt_number ?? row.assistShirtNumber),
    homeScore: integer(row.home_score ?? row.homeScore), awayScore: integer(row.away_score ?? row.awayScore), notes: normalize(row.notes),
    isPenaltyGoal: row.is_penalty_goal === true || row.isPenaltyGoal === true, isOwnGoal: row.is_own_goal === true || row.isOwnGoal === true, eventStatus: normalize(row.event_status ?? row.eventStatus) || 'active',
    correctionReason: normalize(row.correction_reason ?? row.correctionReason), correctionId: normalize(row.correction_metadata?.correctionId ?? row.correctionId), requestId: normalize(row.request_id ?? row.requestId), voidedAt: row.voided_at ?? row.voidedAt ?? '', createdByName: normalize(row.created_by_name ?? row.createdByName), createdAt: row.created_at ?? row.createdAt ?? '',
    eventTeamId: row.event_team_id ?? row.eventTeamId ?? '', eventTeamName: normalize(row.event_team_name ?? row.eventTeamName), matchPhase: normalize(row.match_phase ?? row.matchPhase), phaseOrder: row.phase_order ?? row.phaseOrder ?? null, eventSequence: row.event_sequence ?? row.eventSequence ?? null,
  }
}

function normalizeShootoutKick(row = {}) {
  return { id: row.id ?? '', matchDayId: row.match_day_id ?? row.matchDayId ?? '', teamSide: normalize(row.team_side ?? row.teamSide) === 'opponent' ? 'opponent' : 'club', outcome: normalize(row.outcome) === 'missed' ? 'missed' : 'scored', kickNumber: integer(row.kick_number ?? row.kickNumber), playerName: normalize(row.player_name ?? row.playerName), notes: normalize(row.notes), eventStatus: normalize(row.event_status ?? row.eventStatus) || 'active', voidReason: normalize(row.void_reason ?? row.voidReason), homeShootoutScore: integer(row.home_shootout_score ?? row.homeShootoutScore), awayShootoutScore: integer(row.away_shootout_score ?? row.awayShootoutScore), createdByName: normalize(row.created_by_name ?? row.createdByName), createdAt: row.created_at ?? row.createdAt ?? '' }
}

function normalizeSquadDecision(row = {}) {
  return { id: row.id ?? '', matchDayId: row.match_day_id ?? row.matchDayId ?? '', playerId: row.player_id ?? row.playerId ?? '', status: normalizeMatchDaySquadDecision(row.status), decidedByName: normalize(row.decided_by_name ?? row.decidedByName), decidedAt: row.decided_at ?? row.decidedAt ?? '', updatedAt: row.updated_at ?? row.updatedAt ?? '', decisionRevision: row.decision_revision ?? row.decisionRevision ?? '', notifiedAt: row.notified_at ?? row.notifiedAt ?? '' }
}

function normalizeAvailability(row = {}) {
  return { id: row.id ?? '', playerId: row.player_id ?? row.playerId ?? '', playerName: normalize(row.player_name ?? row.playerName), status: normalize(row.status) || 'pending', selectedAt: row.selected_at ?? row.selectedAt ?? '' }
}

function normalizeRequest(row = {}) {
  const player = relation(row.players) || relation(relation(row.parent_player_links)?.players)
  return {
    id: row.id ?? '', requestId: row.id ?? '', playerId: row.player_id ?? row.playerId ?? '', playerName: normalize(row.player_name ?? row.playerName ?? player?.player_name),
    recipientName: normalize(row.recipient_name ?? row.recipientName), recipientEmail: normalize(row.recipient_email ?? row.recipientEmail ?? relation(row.parent_player_links)?.email),
    status: normalize(row.status) || 'pending', scorerEligible: row.scorer_eligible === true || row.scorerEligible === true, scorerEligibilityReason: normalize(row.scorer_eligibility_reason ?? row.scorerEligibilityReason),
    volunteerScorerResponse: normalize(row.volunteer_scorer_response ?? row.volunteerScorerResponse) || 'no_response', volunteerLinesmanResponse: normalize(row.volunteer_linesman_response ?? row.volunteerLinesmanResponse) || 'no_response', volunteerRefereeResponse: normalize(row.volunteer_referee_response ?? row.volunteerRefereeResponse) || 'no_response',
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '', authUserId: row.auth_user_id ?? row.authUserId ?? '', sentAt: row.sent_at ?? row.sentAt ?? '', respondedAt: row.responded_at ?? row.respondedAt ?? '',
  }
}

function normalizeRoleAssignment(row = {}) {
  const parentLink = relation(row.parent_player_links)
  const player = relation(parentLink?.players)
  return { id: row.id ?? '', role: normalize(row.role), parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '', authUserId: row.auth_user_id ?? row.authUserId ?? parentLink?.auth_user_id ?? '', parentEmail: normalize(row.parent_email ?? row.parentEmail ?? parentLink?.email), playerName: normalize(row.player_name ?? row.playerName ?? player?.player_name), assignedByName: normalize(row.assigned_by_name ?? row.assignedByName), createdAt: row.created_at ?? row.createdAt ?? '' }
}

export function normalizeCoachMatchDay(row = {}) {
  const team = relation(row.teams)
  const finalReportRow = relation(row.match_day_final_reports) || row.finalReport
  const rawEvents = row.match_day_events ?? row.events ?? []
  const rawKicks = row.match_day_shootout_kicks ?? row.shootoutEvents ?? []
  const hasPresentationState = row.hasPresentationState === true
    || Object.hasOwn(row, 'is_today')
    || Object.hasOwn(row, 'server_local_date')
    || Boolean(normalize(row.serverLocalDate))
  return {
    pitchType: normalize(row.pitch_type ?? row.pitchType),
    clubName: normalize(row.club_name ?? row.clubName),
    carpoolEnabled: (row.carpool_enabled ?? row.carpoolEnabled) !== false,
    id: row.id ?? '', clubId: row.club_id ?? row.clubId ?? '', teamId: row.team_id ?? row.teamId ?? '', teamName: normalize(team?.name ?? row.team_name ?? row.teamName) || 'Our team', notificationTeamName: normalizeTeamNotificationDisplayName(row.notification_team_name ?? row.notificationTeamName), opponent: normalize(row.opponent) || 'Opponent',
    fixtureType: normalize(row.fixture_type ?? row.fixtureType) || 'league', conclusionRule: normalizeMatchDayConclusionRule(row.match_conclusion_rule ?? row.conclusionRule), currentMatchPhase: normalize(row.current_match_phase ?? row.currentMatchPhase) || 'pre_match', extraTimeHalfMinutes: normalizeExtraTimeHalfMinutes(row.extra_time_half_minutes ?? row.extraTimeHalfMinutes), extraTimePeriodCount: normalizeExtraTimePeriodCount(row.extra_time_period_count ?? row.extraTimePeriodCount),
    title: normalize(row.title), matchDate: row.match_date ?? row.matchDate ?? '', kickoffTime: row.kickoff_time ?? row.kickoffTime ?? '', kickoffTimeTbc: row.kickoff_time_tbc === true || row.kickoffTimeTbc === true, arrivalTime: row.arrival_time ?? row.arrivalTime ?? '', homeAway: normalizeLegacyMatchHomeAway(row.home_away ?? row.homeAway), shirtChoice: normalizeMatchDayShirtChoice(row.shirt_choice ?? row.shirtChoice), clockMode: normalizeMatchClockMode(row.match_clock_mode ?? row.clockMode), matchDurationMinutes: normalizeMatchDurationMinutes(row.match_duration_minutes ?? row.matchDurationMinutes), venueName: normalize(row.venue_name ?? row.venueName), venueAddress: normalize(row.venue_address ?? row.venueAddress), notes: normalize(row.notes),
    requestScorer: row.request_scorer === true || row.requestScorer === true || row.status === 'scorer_request', requestLinesman: row.request_linesman === true || row.requestLinesman === true, requestReferee: row.request_referee === true || row.requestReferee === true,
    cancellationReason: normalize(row.cancellation_reason ?? row.cancellationReason), status: normalize(row.status) || 'scheduled', homeScore: integer(row.home_score ?? row.homeScore), awayScore: integer(row.away_score ?? row.awayScore), normalTimeHomeScore: optionalInteger(row.normal_time_home_score ?? row.normalTimeHomeScore), normalTimeAwayScore: optionalInteger(row.normal_time_away_score ?? row.normalTimeAwayScore), extraTimeHomeScore: optionalInteger(row.extra_time_home_score ?? row.extraTimeHomeScore), extraTimeAwayScore: optionalInteger(row.extra_time_away_score ?? row.extraTimeAwayScore), homeShootoutScore: integer(row.home_shootout_score ?? row.homeShootoutScore), awayShootoutScore: integer(row.away_shootout_score ?? row.awayShootoutScore), shootoutWinner: normalize(row.shootout_winner ?? row.shootoutWinner),
    phaseStartedAt: row.phase_started_at ?? row.phaseStartedAt ?? '', timerStartedAt: row.timer_started_at ?? row.timerStartedAt ?? '', timerPausedAt: row.timer_paused_at ?? row.timerPausedAt ?? '', timerElapsedSeconds: integer(row.timer_elapsed_seconds ?? row.timerElapsedSeconds), timerStatus: normalize(row.timer_status ?? row.timerStatus) || 'not_started', fullTimeResumeStatus: normalize(row.full_time_resume_status ?? row.fullTimeResumeStatus), concludedAt: row.concluded_at ?? row.concludedAt ?? '', concludedBy: row.concluded_by ?? row.concludedBy ?? '',
    presentationPriority: Number(row.presentation_priority ?? row.presentationPriority ?? 99), scheduledKickoffAt: row.scheduled_kickoff_at ?? row.scheduledKickoffAt ?? '', isBeforeKickoff: row.is_before_kickoff === true || row.isBeforeKickoff === true, isToday: row.is_today === true || row.isToday === true, hasPresentationState, serverLocalDate: row.server_local_date ?? row.serverLocalDate ?? '', serverLocalTime: row.server_local_time ?? row.serverLocalTime ?? '',
    playerAvailability: (row.match_day_player_availability ?? row.playerAvailability ?? []).map(normalizeAvailability), squadDecisions: (row.match_day_player_squad_decisions ?? row.squadDecisions ?? []).map(normalizeSquadDecision), availabilityRequests: (row.match_day_availability_requests ?? row.availabilityRequests ?? []).map(normalizeRequest), roleAssignments: (row.match_day_role_assignments ?? row.roleAssignments ?? []).map(normalizeRoleAssignment),
    eligibleParents: (row.eligibleParents ?? []).map((parent) => ({ parentLinkId: parent.parentLinkId ?? '', authUserId: parent.authUserId ?? '', recipientName: normalize(parent.parentName ?? parent.recipientName), recipientEmail: normalize(parent.email ?? parent.recipientEmail), playerName: normalize(parent.playerName) })),
    squadNotificationContacts: (row.squad_notification_contacts ?? row.squadNotificationContacts ?? []).map((contact) => ({ playerId: contact.player_id ?? contact.playerId, canNotify: contact.can_notify === true || contact.canNotify === true, hasContact: contact.has_contact === true || contact.hasContact === true, appRecipientCount: integer(contact.app_recipient_count ?? contact.appRecipientCount), emailRecipientCount: integer(contact.email_recipient_count ?? contact.emailRecipientCount) })),
    ...(Array.isArray(row.eventParticipants) ? { eventParticipants: row.eventParticipants } : {}),
    ...(Array.isArray(row.substitutionParticipants) ? { substitutionParticipants: row.substitutionParticipants } : {}),
    events: rawEvents.map(normalizeEvent).sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0)), shootoutEvents: rawKicks.map(normalizeShootoutKick),
    finalReport: finalReportRow ? { matchDayId: finalReportRow.match_day_id ?? finalReportRow.matchDayId ?? '', staffNotes: normalize(finalReportRow.staff_notes ?? finalReportRow.staffNotes), createdByName: normalize(finalReportRow.created_by_name ?? finalReportRow.createdByName), updatedByName: normalize(finalReportRow.updated_by_name ?? finalReportRow.updatedByName), updatedAt: finalReportRow.updated_at ?? finalReportRow.updatedAt ?? '' } : null,
    previousHiddenAt: row.previous_hidden_at ?? row.previousHiddenAt ?? '', deletedAt: row.deleted_at ?? row.deletedAt ?? '', updatedAt: row.updated_at ?? row.updatedAt ?? '', isHydrated: Array.isArray(row.match_day_events),
  }
}
