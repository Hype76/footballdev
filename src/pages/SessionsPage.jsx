import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { CoachOptionsSection } from '../components/sessions/CoachOptionsSection.jsx'
import { CreateSessionSection } from '../components/sessions/CreateSessionSection.jsx'
import { FootballCalendar } from '../components/sessions/FootballCalendar.jsx'
import { OpenSessionsSection } from '../components/sessions/OpenSessionsSection.jsx'
import { SessionPlayersSection } from '../components/sessions/SessionPlayersSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { getPaginatedItems } from '../components/ui/pagination-utils.js'
import { useToast } from '../components/ui/toast-context.js'
import { canCreateEvaluation, canManageResourceLibrary, isClubAdmin, useAuth, verifyCurrentUserPassword } from '../lib/auth.js'
import { CAPABILITIES } from '../lib/paywall-access.js'
import { canUseUiFeature } from '../lib/paywall-ui.js'
import {
  AVAILABLE_PLAYER_PAGE_SIZE,
  SESSION_PLAYER_PAGE_SIZE,
  buildSessionAssessmentUrl,
  buildHistoricalSessionPlayers,
  buildHistoricalSessionsFromEvaluations,
  buildSessionCachePayload,
  createSessionFromHistoricalTarget,
  createInitialSessionForm,
  getAssessmentCountForSession,
  getCompletedPlayerNamesFromEvaluations,
  getFilteredSessionPlayers,
  getNextSelectedPlayerIds,
  getOpenSessionSearchParams,
  getRecorderOptions,
  getSessionProgressKey,
  getSessionsWithUpdatedSession,
  getUnassessedPlayerQueue,
  readCompletedPlayerNames,
  readStoredSessionWorkspace,
  updateSessionFormValue,
  writeStoredSessionWorkspace,
} from '../lib/session-page-utils.js'
import { buildFootballCalendarEvents } from '../lib/football-calendar-events.js'
import { openMatchDayFixtureSetup } from '../lib/matchday-workflow.js'
import { isRecoveryModuleVisible } from '../lib/recovery-phase.js'
import {
  addPlayersToAssessmentSession,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  cancelPendingTrainingAvailabilityRequests,
  createCalendarEvent,
  createAssessmentSession,
  createPlayerStaffNote,
  deleteCalendarEvent,
  deleteAssessmentSession,
  deletePlayerStaffNote,
  formatResourceLibraryFileSize,
  RESOURCE_LIBRARY_CATEGORIES,
  getEvaluations,
  getAssessmentReminderLogs,
  getCalendarEventResources,
  getCalendarEvents,
  getCalendarEventInvites,
  getDefaultTrainingAvailabilityForm,
  getTrainingAvailabilityChipState,
  getMatchDays,
  getPolls,
  getResourceLibraryItems,
  getTrainingAvailabilitySettingsForEvents,
  getTrainingAvailabilitySummaryForEvents,
  getTodayMatchDayDateValue,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getAvailableTeamsForUser,
  getSessionStaffNotes,
  getPlayers,
  readViewCache,
  readViewCacheValue,
  saveCalendarEventInvites,
  saveTrainingAvailabilitySettings,
  syncCalendarEventResourceLinks,
  updateCalendarEvent,
  updateAssessmentSession,
  updateMatchDay,
  isPastMatchDayDate,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'
import { createScheduledEmail } from '../lib/domain/scheduled-emails.js'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-14 items-center justify-center rounded-lg bg-[#047857] px-5 py-4 text-base font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const EVENT_TYPE_OPTIONS = [
  { value: 'training', label: 'Training session' },
  { value: 'match', label: 'Match or fixture' },
  { value: 'availability_deadline', label: 'Availability deadline' },
  { value: 'parent_cutoff', label: 'Parent response cut-off' },
  { value: 'general', label: 'General club or team event', clubOnlyLabel: 'Team event' },
]
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
]

function formatDateInput(value) {
  if (value instanceof Date) {
    return formatLocalDate(value)
  }

  const normalizedValue = String(value ?? '').trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    return normalizedValue
  }

  const parsedDate = new Date(normalizedValue)
  return Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString().slice(0, 10)
}

function formatLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimeInput(value) {
  const normalizedValue = String(value ?? '').trim()

  if (/^\d{2}:\d{2}/.test(normalizedValue)) {
    return normalizedValue.slice(0, 5)
  }

  const parsedDate = new Date(normalizedValue)

  if (Number.isNaN(parsedDate.getTime())) {
    return ''
  }

  return `${String(parsedDate.getHours()).padStart(2, '0')}:${String(parsedDate.getMinutes()).padStart(2, '0')}`
}

function buildDateTime(date, time) {
  const dateValue = formatDateInput(date)
  const timeValue = formatTimeInput(time) || '09:00'

  return dateValue ? `${dateValue}T${timeValue}:00` : ''
}

function addMinutesToTime(time, minutesToAdd) {
  const timeValue = formatTimeInput(time) || '09:00'
  const [hours, minutes] = timeValue.split(':').map(Number)
  const totalMinutes = (hours * 60 + minutes + minutesToAdd + 1440) % 1440
  const nextHours = Math.floor(totalMinutes / 60)
  const nextMinutes = totalMinutes % 60
  return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}`
}

function isTimeAfter(leftTime, rightTime) {
  const leftValue = formatTimeInput(leftTime)
  const rightValue = formatTimeInput(rightTime)

  if (!leftValue || !rightValue) {
    return false
  }

  return leftValue > rightValue
}

function getDefaultCalendarForm(date = '') {
  const eventDate = formatDateInput(date) || formatLocalDate(new Date())

  return {
    arrivalTime: '',
    date: eventDate,
    endTime: '10:00',
    eventType: 'training',
    invitedPlayerIds: [],
    inviteTrialPlayers: false,
    inviteWholeSquad: false,
    location: '',
    notes: '',
    notifyInvitedFamilies: false,
    opponent: '',
    parentAudience: 'involved_players',
    deleteRepeatScope: '',
    repeatUpdateScope: '',
    resourceIds: [],
    shareWithParents: false,
    recurrenceFrequency: 'none',
    recurrenceUntil: '',
    ...getDefaultTrainingAvailabilityForm('training'),
    startTime: '09:00',
    teamId: '',
    title: '',
  }
}

function addDays(date, days) {
  const nextDate = new Date(date)
  nextDate.setDate(date.getDate() + days)
  return nextDate
}

function addMonths(date, months) {
  const nextDate = new Date(date)
  nextDate.setMonth(date.getMonth() + months)
  return nextDate
}

function buildRecurrenceDates({ date, frequency, until }) {
  const normalizedFrequency = String(frequency ?? 'none').trim()
  const startDateValue = formatDateInput(date)

  if (!startDateValue || normalizedFrequency === 'none') {
    return startDateValue ? [startDateValue] : []
  }

  const untilDateValue = formatDateInput(until)

  if (!untilDateValue) {
    throw new Error('Add a repeat until date for recurring events.')
  }

  const startDate = new Date(`${startDateValue}T00:00:00`)
  const untilDate = new Date(`${untilDateValue}T23:59:59`)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(untilDate.getTime())) {
    throw new Error('Use a valid repeat until date.')
  }

  if (untilDate.getTime() < startDate.getTime()) {
    throw new Error('Repeat until must be after the first event date.')
  }

  const dates = []
  let cursor = new Date(startDate)

  while (dates.length < 52 && cursor.getTime() <= untilDate.getTime()) {
    dates.push(formatDateInput(cursor))

    if (normalizedFrequency === 'weekly') {
      cursor = addDays(cursor, 7)
    } else if (normalizedFrequency === 'fortnightly') {
      cursor = addDays(cursor, 14)
    } else if (normalizedFrequency === 'monthly') {
      cursor = addMonths(cursor, 1)
    } else {
      break
    }
  }

  if (cursor.getTime() <= untilDate.getTime()) {
    throw new Error('Recurring events are limited to 52 dates. Shorten the repeat range and try again.')
  }

  return dates
}

function canCreateClubCalendarEvent(user) {
  return isClubAdmin(user)
}

function getCalendarEventTypeOptions(user, { clubWideOnly = false } = {}) {
  if (clubWideOnly && canCreateClubCalendarEvent(user)) {
    return EVENT_TYPE_OPTIONS.filter((option) => !['training', 'match'].includes(option.value))
  }

  if (canCreateClubCalendarEvent(user)) {
    return EVENT_TYPE_OPTIONS
  }

  return EVENT_TYPE_OPTIONS.map((option) => {
    if (option.value !== 'general') {
      return option
    }

    return {
      ...option,
      label: option.clubOnlyLabel || 'Team event',
    }
  })
}

function getSafeCalendarTeamId(user, teamId) {
  const normalizedTeamId = String(teamId ?? '').trim()

  if (canCreateClubCalendarEvent(user)) {
    return normalizedTeamId
  }

  return normalizedTeamId || String(user?.activeTeamId ?? '').trim()
}

function isClubWideShareableCalendarEvent({ form, safeTeamId, user }) {
  const eventType = getTrimmedFormValue(form?.eventType)

  return canCreateClubCalendarEvent(user)
    && !safeTeamId
    && eventType !== 'training'
    && eventType !== 'match'
}

function isCalendarResourceEventType(eventType) {
  return ['general', 'availability_deadline', 'parent_cutoff', 'training', 'match'].includes(getTrimmedFormValue(eventType))
}

function isLegacyRecurringSessionEvent(event) {
  return event?.sourceType === 'session'
    && event?.data?.sessionType !== 'match'
    && Array.isArray(event?.data?.legacyRecurringSeries?.sessionIds)
    && event.data.legacyRecurringSeries.sessionIds.length > 1
}

function isRecurringCalendarEvent({ event, form } = {}) {
  return (event?.sourceType === 'calendar' || isLegacyRecurringSessionEvent(event))
    && getTrimmedFormValue(form?.recurrenceFrequency) !== 'none'
}

function getCalendarEventResourceIds(resources = []) {
  return (Array.isArray(resources) ? resources : [])
    .map((resource) => String(resource?.id ?? '').trim())
    .filter(Boolean)
}

function getResourceCategoryLabel(value) {
  return RESOURCE_LIBRARY_CATEGORIES.find((category) => category.value === value)?.label || 'General'
}

function formatResourceDate(value) {
  const timestamp = Date.parse(String(value ?? ''))
  return Number.isNaN(timestamp)
    ? ''
    : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(timestamp))
}

function hasRecurringCalendarDateTimeChange({ event, form } = {}) {
  if (!isRecurringCalendarEvent({ event, form })) {
    return false
  }

  const source = event?.data || {}
  const sourceDate = event?.sourceType === 'session'
    ? formatDateInput(source.sessionDate || event?.date)
    : formatDateInput(source.startsAt || event?.date)
  const sourceStartTime = event?.sourceType === 'session'
    ? formatTimeInput(source.startTime)
    : formatTimeInput(source.startsAt)
  const sourceEndTime = event?.sourceType === 'session'
    ? formatTimeInput(source.endTime) || addMinutesToTime(source.startTime, 60)
    : formatTimeInput(source.endsAt) || addMinutesToTime(source.startsAt, 60)

  return sourceDate !== formatDateInput(form?.date)
    || sourceStartTime !== formatTimeInput(form?.startTime)
    || sourceEndTime !== formatTimeInput(form?.endTime)
}

function getLegacyRecurringSessionSeries({ event, sessions = [] } = {}) {
  if (!isLegacyRecurringSessionEvent(event)) {
    return []
  }

  const seriesIds = new Set(event.data.legacyRecurringSeries.sessionIds.map(String))

  return sessions
    .filter((session) => seriesIds.has(String(session.id)))
    .sort((left, right) => formatDateInput(left.sessionDate).localeCompare(formatDateInput(right.sessionDate)))
}

function getDayShift(fromDate, toDate) {
  const from = new Date(`${formatDateInput(fromDate)}T00:00:00`)
  const to = new Date(`${formatDateInput(toDate)}T00:00:00`)

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 0
  }

  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

function shiftDateByDays(dateValue, dayShift) {
  const date = new Date(`${formatDateInput(dateValue)}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return formatDateInput(dateValue)
  }

  date.setDate(date.getDate() + dayShift)
  return formatDateInput(date)
}

function getCalendarEventSeriesDateTimeFields({ event, form } = {}) {
  if (event?.sourceType !== 'calendar' || getTrimmedFormValue(form?.recurrenceFrequency) === 'none') {
    return {
      endsAt: buildDateTime(form?.date, form?.endTime),
      startsAt: buildDateTime(form?.date, form?.startTime),
    }
  }

  const source = event?.data || {}
  const occurrenceDate = formatDateInput(event?.occurrenceDate || source.recurrenceOccurrenceDate || source.startsAt || event?.date || form?.date)
  const baseStartsAt = source.seriesStartsAt || source.startsAt
  const baseEndsAt = source.seriesEndsAt || source.endsAt || source.seriesStartsAt || source.startsAt
  const dayShift = getDayShift(occurrenceDate, form?.date)
  const nextStartDate = shiftDateByDays(baseStartsAt, dayShift)
  const nextEndDate = shiftDateByDays(baseEndsAt, dayShift)

  return {
    endsAt: buildDateTime(nextEndDate, form?.endTime),
    startsAt: buildDateTime(nextStartDate, form?.startTime),
  }
}

function getCalendarParentVisibility({ form, safeTeamId, user }) {
  const parentVisible = form?.shareWithParents === true

  if (!parentVisible) {
    return {
      parentAudience: 'none',
      parentVisible: false,
    }
  }

  return {
    parentAudience: isClubWideShareableCalendarEvent({ form, safeTeamId, user }) ? 'all_club_parents' : form.parentAudience,
    parentVisible: true,
  }
}

function getTrimmedFormValue(value) {
  return String(value ?? '').trim()
}

function escapeEventInviteHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatEventInviteDateTime(date, time) {
  const dateValue = formatDateInput(date)
  const timeValue = formatTimeInput(time)

  if (!dateValue && !timeValue) {
    return 'Time to be confirmed'
  }

  return `${dateValue || 'Date to be confirmed'}${timeValue ? ` at ${timeValue}` : ''}`
}

function buildCalendarEventInviteEmailHtml({
  clubName,
  eventTitle,
  eventType,
  location,
  notes,
  parentName,
  playerName,
  startsAtLabel,
  teamName,
}) {
  const resolvedParent = parentName || 'Parent or guardian'
  const resolvedPlayer = playerName || 'your child'
  const resolvedClub = clubName || 'Your club'
  const resolvedTeam = teamName || 'their team'
  const resolvedTitle = eventTitle || 'Club event'

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 720px; margin: 0 auto;">
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Event invite</p>
      <h1 style="margin: 0 0 14px; font-size: 24px; line-height: 1.2;">${escapeEventInviteHtml(resolvedTitle)}</h1>
      <p style="margin: 0 0 18px; font-size: 15px;">Hi ${escapeEventInviteHtml(resolvedParent)}, ${escapeEventInviteHtml(resolvedPlayer)} has been invited to this Football Player event.</p>
      <div style="border: 1px solid #e7ece3; border-radius: 12px; background: #fbfcf9; padding: 14px 16px; margin: 0 0 20px;">
        <p style="margin: 0 0 8px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">Details</p>
        <p style="margin: 0 0 6px; font-size: 14px;"><strong>When:</strong> ${escapeEventInviteHtml(startsAtLabel)}</p>
        <p style="margin: 0 0 6px; font-size: 14px;"><strong>Team:</strong> ${escapeEventInviteHtml(resolvedTeam)}</p>
        <p style="margin: 0 0 6px; font-size: 14px;"><strong>Type:</strong> ${escapeEventInviteHtml(eventType || 'Event')}</p>
        ${location ? `<p style="margin: 0 0 6px; font-size: 14px;"><strong>Location:</strong> ${escapeEventInviteHtml(location)}</p>` : ''}
        ${notes ? `<p style="margin: 0; font-size: 14px;"><strong>Notes:</strong> ${escapeEventInviteHtml(notes)}</p>` : ''}
      </div>
      <p style="margin: 0 0 18px; font-size: 14px;">You can also see this invite in the parent portal.</p>
      <p style="margin: 0; color: #5a6b5b; font-size: 13px;">${escapeEventInviteHtml(resolvedClub)} | ${escapeEventInviteHtml(resolvedTeam)}</p>
      <div style="border-top: 1px solid #e7ece3; margin-top: 20px; padding-top: 14px;">
        <p style="margin: 0; color: #7a8578; font-size: 11px; line-height: 1.45;">Powered by Football Player | footballplayer.online</p>
      </div>
    </div>
  `
}

function getEventInviteScheduledAt() {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString()
}

function validateCalendarForm({ form, safeTeamId, sourceType, user }) {
  const eventType = getTrimmedFormValue(form.eventType)
  const title = getTrimmedFormValue(form.title)
  const opponent = getTrimmedFormValue(form.opponent)
  const date = formatDateInput(form.date)
  const startTime = formatTimeInput(form.startTime)
  const isMatch = eventType === 'match'
  const isTraining = eventType === 'training'
  const requiresTeam = !canCreateClubCalendarEvent(user) || isMatch || isTraining || Boolean(safeTeamId)

  if (!eventType) {
    throw new Error('Choose an event type.')
  }

  if (!date) {
    throw new Error('Choose a date.')
  }

  if (requiresTeam && !safeTeamId) {
    throw new Error('Choose a team for this event.')
  }

  if (!startTime) {
    throw new Error(isMatch ? 'Kick-off time is required for a fixture.' : 'Choose a start time.')
  }

  if (isMatch) {
    if (isPastMatchDayDate(date)) {
      throw new Error('Match Day date must be today or in the future.')
    }

    if (!title && !opponent) {
      throw new Error('Add an opponent or event title for this fixture.')
    }

    if (form.arrivalTime && isTimeAfter(form.arrivalTime, form.startTime)) {
      throw new Error('Arrival time must be before kick-off time.')
    }

    return
  }

  if (sourceType === 'calendar' || (!isTraining && eventType !== 'match')) {
    if (!title) {
      throw new Error('Add an event title.')
    }
  }
}

function validateParentSharing({ form, safeTeamId, selectedPlayers, user }) {
  if (!form.shareWithParents) {
    return
  }

  if (isClubWideShareableCalendarEvent({ form, safeTeamId, user })) {
    return
  }

  if (form.parentAudience === 'involved_players' && selectedPlayers.length === 0) {
    throw new Error('You selected only parents of involved players, but no players are attached to this event. Add players or choose a wider parent audience.')
  }

  if (form.parentAudience === 'all_team_parents' && !safeTeamId) {
    throw new Error('Choose a team before sharing with all parents in the team.')
  }

  if (form.parentAudience === 'all_club_parents' && !canCreateClubCalendarEvent(user)) {
    throw new Error('Club parent sharing is only available to Club Admins.')
  }
}

function getInvitesForCalendarEvent(event, invites = []) {
  const sourceType = event?.sourceType || ''
  const sourceId = String(event?.sourceId ?? '').trim()

  if (!sourceId) {
    return []
  }

  return invites.filter((invite) => {
    if (sourceType === 'calendar') {
      return invite.calendarEventId === sourceId
    }

    if (sourceType === 'session') {
      return invite.assessmentSessionId === sourceId
    }

    return false
  })
}

function getFormInviteFields(event, invites = []) {
  const eventInvites = getInvitesForCalendarEvent(event, invites)

  return {
    invitedPlayerIds: eventInvites.map((invite) => invite.playerId).filter(Boolean),
    inviteTrialPlayers: false,
    inviteWholeSquad: false,
    notifyInvitedFamilies: eventInvites.some((invite) => invite.notifyRequested),
    parentAudience: eventInvites.length > 0 ? 'involved_players' : 'none',
    shareWithParents: eventInvites.length > 0,
  }
}

function getFormFromCalendarEvent(event, invites = []) {
  const source = event?.data || {}
  const sourceType = event?.sourceType || ''
  const inviteFields = getFormInviteFields(event, invites)

  if (sourceType === 'session') {
    return {
      ...getDefaultCalendarForm(source.sessionDate || event.date),
      arrivalTime: formatTimeInput(source.arrivalTime),
      date: formatDateInput(source.sessionDate || event.date),
      endTime: source.sessionType === 'match'
        ? addMinutesToTime(source.startTime, 120)
        : formatTimeInput(source.endTime) || addMinutesToTime(source.startTime, 60),
      eventType: source.sessionType === 'match' ? 'match' : 'training',
      location: source.location || '',
      notes: source.notes || '',
      opponent: source.opponent || '',
      recurrenceFrequency: source.legacyRecurringSeries?.recurrenceFrequency || source.recurrenceFrequency || 'none',
      recurrenceUntil: source.legacyRecurringSeries?.recurrenceUntil || source.recurrenceUntil || '',
      repeatUpdateScope: '',
      startTime: formatTimeInput(source.startTime) || '09:00',
      teamId: source.teamId || '',
      title: source.title || '',
      ...inviteFields,
    }
  }

  if (sourceType === 'match-day') {
    return {
      ...getDefaultCalendarForm(source.matchDate || event.date),
      arrivalTime: formatTimeInput(source.arrivalTime),
      date: formatDateInput(source.matchDate || event.date),
      endTime: addMinutesToTime(source.kickoffTime, 120),
      eventType: 'match',
      location: source.venueName || '',
      notes: source.notes || '',
      opponent: source.opponent || '',
      requestScorer: source.requestScorer === true,
      requestLinesman: source.requestLinesman === true,
      requestReferee: source.requestReferee === true,
      startTime: formatTimeInput(source.kickoffTime) || '10:00',
      teamId: source.teamId || '',
      title: source.title || (source.opponent ? `Match vs ${source.opponent}` : ''),
      ...inviteFields,
    }
  }

  if (sourceType === 'calendar') {
    const sourceParentAudience = source.parentAudience || inviteFields.parentAudience || 'none'

    return {
      ...getDefaultCalendarForm(source.startsAt || event.date),
      date: formatDateInput(source.startsAt || event.date),
      endTime: formatTimeInput(source.endsAt) || addMinutesToTime(source.startsAt, 60),
      eventType: source.eventType || 'general',
      location: source.location || '',
      notes: source.notes || '',
      repeatUpdateScope: '',
      resourceIds: [],
      recurrenceFrequency: source.recurrenceFrequency || 'none',
      recurrenceUntil: source.recurrenceUntil || '',
      startTime: formatTimeInput(source.startsAt) || '09:00',
      teamId: source.teamId || '',
      title: source.title || '',
      ...inviteFields,
      parentAudience: sourceParentAudience,
      shareWithParents: Boolean(source.parentVisible || inviteFields.shareWithParents),
    }
  }

  return getDefaultCalendarForm(event?.date)
}

function getCalendarInvitePlayers(players, teamId) {
  const normalizedTeamId = String(teamId ?? '').trim()

  if (!normalizedTeamId) {
    return []
  }

  return (players ?? [])
    .filter((player) => String(player.status ?? 'active') !== 'archived')
    .filter((player) => String(player.teamId ?? '').trim() === normalizedTeamId)
    .sort((left, right) =>
      String(left.section ?? '').localeCompare(String(right.section ?? '')) ||
      String(left.playerName ?? '').localeCompare(String(right.playerName ?? '')),
    )
}

function buildSelectedInvitePlayers(form, invitePlayers) {
  const selectedIds = new Set(Array.isArray(form.invitedPlayerIds) ? form.invitedPlayerIds.map(String) : [])
  const selectedPlayers = []
  const addPlayer = (player) => {
    if (!player?.id || selectedPlayers.some((selectedPlayer) => selectedPlayer.id === player.id)) {
      return
    }

    selectedPlayers.push(player)
  }

  invitePlayers.forEach((player) => {
    const section = String(player.section ?? '').trim().toLowerCase()

    if (form.inviteWholeSquad && section === 'squad') {
      addPlayer(player)
      return
    }

    if (form.inviteTrialPlayers && section === 'trial') {
      addPlayer(player)
      return
    }

    if (selectedIds.has(String(player.id))) {
      addPlayer(player)
    }
  })

  return selectedPlayers
}

function buildCalendarNotificationPlayers(form, invitePlayers, selectedPlayers) {
  if (!form.shareWithParents) {
    return []
  }

  if (form.parentAudience === 'involved_players') {
    return selectedPlayers
  }

  if (form.parentAudience === 'all_team_parents' && form.notifyInvitedFamilies) {
    return invitePlayers
  }

  return []
}

export function SessionsPage({ calendarOnly = false, setupOpen = false }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const isClubWideCalendar = calendarOnly && isClubAdmin(user)
  const activeTeamScope = isClubWideCalendar ? 'club-wide' : user?.activeTeamId || user?.activeTeamName || 'assigned'
  const cacheKey = user?.clubId ? `sessions:${user.clubId}:${user.id}:${user.roleRank}:${activeTeamScope}` : ''
  const workspaceStorageKey = user?.clubId ? `session-workspace:${user.clubId}:${user.id}:${activeTeamScope}` : ''
  const storedSessionWorkspace = useMemo(
    () => readStoredSessionWorkspace(workspaceStorageKey),
    [workspaceStorageKey],
  )
  const [sessions, setSessions] = useState(() => {
    const cachedSessions = readViewCacheValue(cacheKey, 'sessions', [])
    return Array.isArray(cachedSessions) ? cachedSessions : []
  })
  const [players, setPlayers] = useState(() => {
    const cachedPlayers = readViewCacheValue(cacheKey, 'players', [])
    return Array.isArray(cachedPlayers) ? cachedPlayers : []
  })
  const [teams, setTeams] = useState(() => {
    const cachedTeams = readViewCacheValue(cacheKey, 'teams', [])
    return Array.isArray(cachedTeams) ? cachedTeams : []
  })
  const [evaluations, setEvaluations] = useState(() => {
    const cachedEvaluations = readViewCacheValue(cacheKey, 'evaluations', [])
    return Array.isArray(cachedEvaluations) ? cachedEvaluations : []
  })
  const [assessmentReminders, setAssessmentReminders] = useState(() => {
    const cachedAssessmentReminders = readViewCacheValue(cacheKey, 'assessmentReminders', [])
    return Array.isArray(cachedAssessmentReminders) ? cachedAssessmentReminders : []
  })
  const [matchDays, setMatchDays] = useState(() => {
    const cachedMatchDays = readViewCacheValue(cacheKey, 'matchDays', [])
    return Array.isArray(cachedMatchDays) ? cachedMatchDays : []
  })
  const [polls, setPolls] = useState(() => {
    const cachedPolls = readViewCacheValue(cacheKey, 'polls', [])
    return Array.isArray(cachedPolls) ? cachedPolls : []
  })
  const [calendarItems, setCalendarItems] = useState(() => {
    const cachedCalendarItems = readViewCacheValue(cacheKey, 'calendarItems', [])
    return Array.isArray(cachedCalendarItems) ? cachedCalendarItems : []
  })
  const [calendarInvites, setCalendarInvites] = useState(() => {
    const cachedCalendarInvites = readViewCacheValue(cacheKey, 'calendarInvites', [])
    return Array.isArray(cachedCalendarInvites) ? cachedCalendarInvites : []
  })
  const [calendarView, setCalendarView] = useState('month')
  const [calendarCursor, setCalendarCursor] = useState(() => new Date())
  const [calendarModal, setCalendarModal] = useState(null)
  const [calendarForm, setCalendarForm] = useState(() => getDefaultCalendarForm())
  const [calendarEventResourcesById, setCalendarEventResourcesById] = useState({})
  const [calendarResourceOptions, setCalendarResourceOptions] = useState([])
  const [isCalendarResourcesLoading, setIsCalendarResourcesLoading] = useState(false)
  const [trainingAvailabilitySettingsByEventId, setTrainingAvailabilitySettingsByEventId] = useState({})
  const [trainingAvailabilitySummaryByEventId, setTrainingAvailabilitySummaryByEventId] = useState({})
  const [sessionPlayers, setSessionPlayers] = useState([])
  const [sessionVoiceNotes, setSessionVoiceNotes] = useState([])
  const [sessionForm, setSessionForm] = useState(createInitialSessionForm)
  const [selectedSessionId, setSelectedSessionId] = useState(() => String(storedSessionWorkspace.selectedSessionId ?? ''))
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(() =>
    Array.isArray(storedSessionWorkspace.selectedPlayerIds) ? storedSessionWorkspace.selectedPlayerIds : [],
  )
  const [availablePlayerPage, setAvailablePlayerPage] = useState(1)
  const [sessionPlayerPage, setSessionPlayerPage] = useState(1)
  const [clearSessionTarget, setClearSessionTarget] = useState(null)
  const [completeSessionTarget, setCompleteSessionTarget] = useState(null)
  const [deleteSessionTarget, setDeleteSessionTarget] = useState(null)
  const [voiceNoteDeleteTarget, setVoiceNoteDeleteTarget] = useState(null)
  const [isLoading, setIsLoading] = useState(() => sessions.length === 0 && players.length === 0 && teams.length === 0)
  const [isSessionPlayersLoading, setIsSessionPlayersLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [recordingTarget, setRecordingTarget] = useState(null)
  const [isSavingVoiceNote, setIsSavingVoiceNote] = useState(false)
  const [deletingVoiceNoteId, setDeletingVoiceNoteId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const mediaRecorderRef = useRef(null)
  const recordingChunksRef = useRef([])
  const recordingStartedAtRef = useRef(0)
  const currentSessionRef = useRef(null)
  const userScopeKey = user
    ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${user.activeTeamId || ''}:${user.activeTeamName || ''}`
    : ''
  const completedSessionId = String(searchParams.get('completedSessionId') ?? '').trim()
  const completedCount = Number(searchParams.get('completedCount') ?? 0)
  const requestedSessionId = String(searchParams.get('sessionId') ?? '').trim()

  const combinedSessions = useMemo(
    () => [...sessions, ...buildHistoricalSessionsFromEvaluations(evaluations, sessions)],
    [evaluations, sessions],
  )
  const requestedSessionMissing =
    Boolean(requestedSessionId) && !isLoading && !combinedSessions.some((session) => session.id === requestedSessionId)
  const selectedSession = combinedSessions.find((session) => session.id === selectedSessionId)
  const canCompleteSessions = Number(user?.roleRank ?? 0) >= 50
  const canDeleteSessions = Number(user?.roleRank ?? 0) >= 50
  const selectedSessionCompleted = selectedSession?.status === 'completed'
  const selectedSessionLocked = selectedSessionCompleted && !canCompleteSessions
  const activePlayerSection = selectedSession?.section || sessionForm.section
  const activePlayerTeam = selectedSession?.team || sessionForm.team
  const activePlayerTeamId = selectedSession?.teamId || sessionForm.teamId
  const selectedSessionAssessmentCount = useMemo(
    () => getAssessmentCountForSession(evaluations, selectedSession),
    [evaluations, selectedSession],
  )
  const canShowPollsInCalendar = isRecoveryModuleVisible('pollsAvailability', { user })
  const deleteSessionDisabledReason = selectedSession?.isHistorical
    ? 'This is a development history group. It cannot be deleted as a session.'
    : ''
  const completedPlayerNames = useMemo(() => {
    const dbCompletedPlayerNames = getCompletedPlayerNamesFromEvaluations(evaluations, selectedSession, sessionPlayers)
    const localCompletedPlayerNames = readCompletedPlayerNames(user, selectedSessionId)

    return [...new Set([...dbCompletedPlayerNames, ...localCompletedPlayerNames])]
  }, [evaluations, selectedSession, selectedSessionId, sessionPlayers, user])
  const unassessedPlayerQueue = useMemo(
    () => getUnassessedPlayerQueue({ completedPlayerNames, sessionPlayers }),
    [completedPlayerNames, sessionPlayers],
  )
  const assessedPlayerCount = Math.max(0, sessionPlayers.length - unassessedPlayerQueue.length)
  const previousSessions = useMemo(
    () => combinedSessions.filter((session) => session.id !== selectedSessionId),
    [combinedSessions, selectedSessionId],
  )
  const openSessionCount = combinedSessions.filter((session) => session.status !== 'completed').length
  const calendarEvents = useMemo(
    () => buildFootballCalendarEvents({
      assessmentReminders: isClubWideCalendar ? [] : assessmentReminders,
      calendarEvents: calendarItems,
      evaluations: isClubWideCalendar ? [] : evaluations,
      matchDays: isClubWideCalendar ? [] : matchDays,
      polls: isClubWideCalendar || !canShowPollsInCalendar ? [] : polls,
      sessions: isClubWideCalendar ? [] : combinedSessions,
    }),
    [assessmentReminders, calendarItems, canShowPollsInCalendar, combinedSessions, evaluations, isClubWideCalendar, matchDays, polls],
  )
  const calendarInvitePlayers = useMemo(
    () => getCalendarInvitePlayers(players, getSafeCalendarTeamId(user, calendarForm.teamId)),
    [calendarForm.teamId, players, user],
  )
  const selectedCalendarInvitePlayers = useMemo(
    () => buildSelectedInvitePlayers(calendarForm, calendarInvitePlayers),
    [calendarForm, calendarInvitePlayers],
  )
  const currentCalendarEventInvites = useMemo(
    () => getInvitesForCalendarEvent(calendarModal?.event, calendarInvites),
    [calendarInvites, calendarModal?.event],
  )
  const currentCalendarEventResources = useMemo(() => {
    const sourceId = String(calendarModal?.event?.sourceId ?? '').trim()
    return sourceId ? calendarEventResourcesById[sourceId] || [] : []
  }, [calendarEventResourcesById, calendarModal?.event?.sourceId])
  const currentTrainingAvailabilitySummary = useMemo(() => {
    const sourceId = String(calendarModal?.event?.sourceId ?? '').trim()
    return sourceId ? trainingAvailabilitySummaryByEventId[sourceId] || null : null
  }, [calendarModal?.event?.sourceId, trainingAvailabilitySummaryByEventId])
  const calendarResourceTeamId = useMemo(() => {
    if (!calendarModal || isClubWideCalendar) {
      return ''
    }

    return getSafeCalendarTeamId(user, calendarForm.teamId)
  }, [calendarForm.teamId, calendarModal, isClubWideCalendar, user])
  const canAttachCalendarResources = Boolean(
    calendarModal
      && calendarResourceTeamId
      && isCalendarResourceEventType(calendarForm.eventType)
      && canManageResourceLibrary(user),
  )

  useEffect(() => {
    let isMounted = true

    if (!canAttachCalendarResources) {
      setCalendarResourceOptions([])
      setIsCalendarResourcesLoading(false)
      return () => {
        isMounted = false
      }
    }

    setIsCalendarResourcesLoading(true)
    getResourceLibraryItems({ user, teamId: calendarResourceTeamId })
      .then((items) => {
        if (isMounted) {
          setCalendarResourceOptions(items)
        }
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
          setCalendarResourceOptions([])
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsCalendarResourcesLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [calendarResourceTeamId, canAttachCalendarResources, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const trainingEventIds = calendarItems
      .filter((item) => item.eventType === 'training' && item.teamId)
      .map((item) => item.id)
      .filter(Boolean)

    if (trainingEventIds.length === 0 || !user?.clubId || isClubWideCalendar) {
      setTrainingAvailabilitySettingsByEventId({})
      setTrainingAvailabilitySummaryByEventId({})
      return () => {
        isMounted = false
      }
    }

    Promise.allSettled([
      getTrainingAvailabilitySettingsForEvents({ user, eventIds: trainingEventIds }),
      getTrainingAvailabilitySummaryForEvents({ user, eventIds: trainingEventIds }),
    ])
      .then(([settingsResult, summaryResult]) => {
        if (!isMounted) {
          return
        }

        if (settingsResult.status === 'fulfilled') {
          setTrainingAvailabilitySettingsByEventId(settingsResult.value)
        } else {
          console.error(settingsResult.reason)
          setTrainingAvailabilitySettingsByEventId({})
        }

        if (summaryResult.status === 'fulfilled') {
          setTrainingAvailabilitySummaryByEventId(summaryResult.value)
        } else {
          console.error(summaryResult.reason)
          setTrainingAvailabilitySummaryByEventId({})
        }
      })

    return () => {
      isMounted = false
    }
  }, [calendarItems, isClubWideCalendar, user, userScopeKey])

  useEffect(() => {
    let isMounted = true
    const event = calendarModal?.event
    const eventId = String(event?.sourceId ?? '').trim()
    const eventTeamId = String(event?.data?.teamId ?? '').trim()

    if (event?.sourceType !== 'calendar' || !eventId || !eventTeamId || !isCalendarResourceEventType(event?.data?.eventType)) {
      return () => {
        isMounted = false
      }
    }

    getCalendarEventResources({ user, eventId, teamId: eventTeamId })
      .then((resources) => {
        if (!isMounted) {
          return
        }

        setCalendarEventResourcesById((current) => ({
          ...current,
          [eventId]: resources,
        }))
        setCalendarForm((current) => ({
          ...current,
          resourceIds: getCalendarEventResourceIds(resources),
        }))
      })
      .catch((error) => {
        console.error(error)
      })

    return () => {
      isMounted = false
    }
  }, [calendarModal?.event, user, userScopeKey])

  useEffect(() => {
    const requestedAction = String(searchParams.get('action') ?? '').trim()

    if (!['add-event', 'add-session', 'create-session'].includes(requestedAction)) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('action')
    setSearchParams(nextSearchParams, { replace: true })

    if (requestedAction === 'add-event') {
      handleCalendarDateClick(formatLocalDate(new Date()))
      return
    }

    handleOpenSessionCreateModal()
  // This reacts only to explicit route quick actions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, setSearchParams])

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadData = async () => {
      setErrorMessage('')

      try {
        if (isClubWideCalendar) {
          const [teamsResult, calendarItemsResult] = await Promise.allSettled([
            withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
            withRequestTimeout(() => getCalendarEvents({ user, clubWideOnly: true }), 'Could not load calendar events.'),
          ])

          if (!isMounted) {
            return
          }

          const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : cachedValue?.teams || []
          const nextCalendarItems =
            calendarItemsResult.status === 'fulfilled' ? calendarItemsResult.value : cachedValue?.calendarItems || []

          if (teamsResult.status === 'rejected') {
            console.error(teamsResult.reason)
          }

          if (calendarItemsResult.status === 'rejected') {
            console.error(calendarItemsResult.reason)
          }

          setSessions([])
          setPlayers([])
          setTeams(nextTeams)
          setEvaluations([])
          setMatchDays([])
          setPolls([])
          setCalendarItems(nextCalendarItems)
          setCalendarInvites([])
          setAssessmentReminders([])
          setSelectedSessionId('')
          setSessionForm((current) => ({
            ...current,
            teamId: '',
            team: '',
          }))
          writeViewCache(cacheKey, {
            sessions: [],
            players: [],
            teams: nextTeams,
            evaluations: [],
            matchDays: [],
            polls: [],
            calendarItems: nextCalendarItems,
            calendarInvites: [],
            assessmentReminders: [],
          })

          if (teamsResult.status === 'rejected' || calendarItemsResult.status === 'rejected') {
            setErrorMessage('Some calendar data could not be refreshed. Existing data is still available where possible.')
          }
          return
        }

        const [
          sessionsResult,
          playersResult,
          teamsResult,
          evaluationsResult,
          matchDaysResult,
          pollsResult,
          calendarItemsResult,
          calendarInvitesResult,
          assessmentRemindersResult,
        ] = await Promise.allSettled([
          withRequestTimeout(() => getAssessmentSessions({ user }), 'Could not load sessions.'),
          withRequestTimeout(() => getPlayers({ user }), 'Could not load players.'),
          withRequestTimeout(() => getAvailableTeamsForUser(user), 'Could not load teams.'),
          withRequestTimeout(() => getEvaluations({ user }), 'Could not load historical sessions.'),
          withRequestTimeout(() => getMatchDays({ user }), 'Could not load match days.'),
          canShowPollsInCalendar
            ? withRequestTimeout(() => getPolls({ user }), 'Could not load response cut offs.')
            : Promise.resolve([]),
          withRequestTimeout(() => getCalendarEvents({ user }), 'Could not load calendar events.'),
          withRequestTimeout(() => getCalendarEventInvites({ user }), 'Could not load calendar invites.'),
          withRequestTimeout(() => getAssessmentReminderLogs({ user }), 'Could not load assessment reminders.'),
        ])

        if (!isMounted) {
          return
        }

        const nextSessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : cachedValue?.sessions || []
        const nextPlayers = playersResult.status === 'fulfilled' ? playersResult.value : cachedValue?.players || []
        const nextTeams = teamsResult.status === 'fulfilled' ? teamsResult.value : cachedValue?.teams || []
        const nextEvaluations =
          evaluationsResult.status === 'fulfilled' ? evaluationsResult.value : cachedValue?.evaluations || []
        const nextMatchDays = matchDaysResult.status === 'fulfilled' ? matchDaysResult.value : cachedValue?.matchDays || []
        const nextPolls = pollsResult.status === 'fulfilled' ? pollsResult.value : cachedValue?.polls || []
        const nextCalendarItems =
          calendarItemsResult.status === 'fulfilled' ? calendarItemsResult.value : cachedValue?.calendarItems || []
        const nextCalendarInvites =
          calendarInvitesResult.status === 'fulfilled' ? calendarInvitesResult.value : cachedValue?.calendarInvites || []
        const nextAssessmentReminders =
          assessmentRemindersResult.status === 'fulfilled' ? assessmentRemindersResult.value : cachedValue?.assessmentReminders || []

        if (sessionsResult.status === 'rejected') {
          console.error(sessionsResult.reason)
        }

        if (playersResult.status === 'rejected') {
          console.error(playersResult.reason)
        }

        if (teamsResult.status === 'rejected') {
          console.error(teamsResult.reason)
        }

        if (evaluationsResult.status === 'rejected') {
          console.error(evaluationsResult.reason)
        }

        if (matchDaysResult.status === 'rejected') {
          console.error(matchDaysResult.reason)
        }

        if (pollsResult.status === 'rejected') {
          console.error(pollsResult.reason)
        }

        if (calendarItemsResult.status === 'rejected') {
          console.error(calendarItemsResult.reason)
        }

        if (calendarInvitesResult.status === 'rejected') {
          console.error(calendarInvitesResult.reason)
        }

        if (assessmentRemindersResult.status === 'rejected') {
          console.error(assessmentRemindersResult.reason)
        }

        setSessions(nextSessions)
        setPlayers(nextPlayers)
        setTeams(nextTeams)
        setEvaluations(nextEvaluations)
        setMatchDays(nextMatchDays)
        setPolls(nextPolls)
        setCalendarItems(nextCalendarItems)
        setCalendarInvites(nextCalendarInvites)
        setAssessmentReminders(nextAssessmentReminders)
        setSelectedSessionId((current) => {
          const nextCombinedSessions = [...nextSessions, ...buildHistoricalSessionsFromEvaluations(nextEvaluations, nextSessions)]

          if (requestedSessionId && nextSessions.some((session) => session.id === requestedSessionId)) {
            return requestedSessionId
          }

          if (requestedSessionId && nextCombinedSessions.some((session) => session.id === requestedSessionId)) {
            return requestedSessionId
          }

          if (completedSessionId && nextSessions.some((session) => session.id === completedSessionId)) {
            return completedSessionId
          }

          if (nextCombinedSessions.some((session) => session.id === current)) {
            return current
          }

          const storedSessionId = String(storedSessionWorkspace.selectedSessionId ?? '')
          return nextCombinedSessions.some((session) => session.id === storedSessionId)
            ? storedSessionId
            : nextCombinedSessions[0]?.id || ''
        })
        setSessionForm((current) => ({
          ...current,
          teamId: nextTeams.some((team) => team.id === current.teamId) ? current.teamId : nextTeams[0]?.id || '',
          team: nextTeams.some((team) => team.id === current.teamId) ? current.team : nextTeams[0]?.name || '',
        }))
        writeViewCache(cacheKey, {
          sessions: nextSessions,
          players: nextPlayers,
          teams: nextTeams,
          evaluations: nextEvaluations,
          matchDays: nextMatchDays,
          polls: canShowPollsInCalendar ? nextPolls : [],
          calendarItems: nextCalendarItems,
          calendarInvites: nextCalendarInvites,
          assessmentReminders: nextAssessmentReminders,
        })

        if (
          sessionsResult.status === 'rejected' ||
          playersResult.status === 'rejected' ||
          teamsResult.status === 'rejected' ||
          evaluationsResult.status === 'rejected'
        ) {
          setErrorMessage('Some session data could not be refreshed. Existing data is still available where possible.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    if (user) {
      void loadData()
    }

    return () => {
      isMounted = false
    }
  }, [cacheKey, canShowPollsInCalendar, completedSessionId, isClubWideCalendar, requestedSessionId, storedSessionWorkspace.selectedSessionId, user, userScopeKey])

  useEffect(() => {
    let isMounted = true

    const loadSessionPlayers = async () => {
      const selectedSession = combinedSessions.find((session) => session.id === selectedSessionId)

      if (!selectedSessionId) {
        setSessionPlayers([])
        return
      }

      if (!selectedSession) {
        if (!isLoading) {
          setSessionPlayers([])
        }
        return
      }

      if (selectedSession?.isHistorical) {
        const historicalPlayers = buildHistoricalSessionPlayers(evaluations, selectedSession)
        setSessionPlayers(historicalPlayers)
        return
      }

      setIsSessionPlayersLoading(true)

      try {
        const nextSessionPlayers = await withRequestTimeout(
          () => getAssessmentSessionPlayers({ user, sessionId: selectedSessionId }),
          'Could not load session players.',
        )

        if (!isMounted) {
          return
        }

        setSessionPlayers(nextSessionPlayers)
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage('Session players could not be loaded. Try again in a moment.')
        }
      } finally {
        if (isMounted) {
          setIsSessionPlayersLoading(false)
        }
      }
    }

    void loadSessionPlayers()

    return () => {
      isMounted = false
    }
  }, [combinedSessions, evaluations, isLoading, selectedSessionId, user])

  useEffect(() => {
    let isMounted = true

    const loadSessionVoiceNotes = async () => {
      const activeSession = combinedSessions.find((session) => session.id === selectedSessionId)

      if (!selectedSessionId || activeSession?.isHistorical) {
        setSessionVoiceNotes([])
        return
      }

      try {
        const nextSessionVoiceNotes = await withRequestTimeout(
          () => getSessionStaffNotes({ user, sessionId: selectedSessionId }),
          'Could not load voice notes.',
        )

        if (isMounted) {
          setSessionVoiceNotes(nextSessionVoiceNotes)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setSessionVoiceNotes([])
        }
      }
    }

    void loadSessionVoiceNotes()

    return () => {
      isMounted = false
    }
  }, [combinedSessions, selectedSessionId, user])

  useEffect(() => {
    if (!workspaceStorageKey) {
      return
    }

    const currentStoredWorkspace = readStoredSessionWorkspace(workspaceStorageKey)
    writeStoredSessionWorkspace(workspaceStorageKey, {
      ...currentStoredWorkspace,
      selectedSessionId,
      selectedPlayerIds,
    })
  }, [selectedPlayerIds, selectedSessionId, workspaceStorageKey])

  const filteredPlayers = useMemo(
    () => getFilteredSessionPlayers({
      activePlayerSection,
      activePlayerTeam,
      activePlayerTeamId,
      players,
    }),
    [activePlayerSection, activePlayerTeam, activePlayerTeamId, players],
  )
  const paginatedFilteredPlayers = useMemo(
    () => getPaginatedItems(filteredPlayers, availablePlayerPage, AVAILABLE_PLAYER_PAGE_SIZE),
    [availablePlayerPage, filteredPlayers],
  )
  const paginatedSessionPlayers = useMemo(
    () => getPaginatedItems(sessionPlayers, sessionPlayerPage, SESSION_PLAYER_PAGE_SIZE),
    [sessionPlayerPage, sessionPlayers],
  )

  useEffect(() => {
    if (!selectedSession) {
      return
    }

    setSessionPlayerPage(1)
    setAvailablePlayerPage(1)
    setSelectedPlayerIds([])
    setSessionForm((current) => ({
      ...current,
      teamId: selectedSession.teamId || current.teamId,
      team: selectedSession.team || current.team,
    }))
  }, [selectedSession])

  if (!canCreateEvaluation(user) && !(calendarOnly && isClubAdmin(user))) {
    return <Navigate to="/" replace />
  }

  const writeSessionCache = (nextState = {}) => {
    writeViewCache(cacheKey, buildSessionCachePayload({ evaluations, nextState, players, sessions, teams }))
  }

  const writeCalendarAwareCache = (nextState = {}) => {
    writeViewCache(cacheKey, {
      evaluations,
      matchDays,
      players,
      polls,
      sessions,
      teams,
      calendarItems,
      calendarInvites,
      ...nextState,
    })
  }

  const handleSessionFormChange = (event) => {
    const { name, value } = event.target
    setErrorMessage('')

    if (name === 'teamId' || name === 'section') {
      setAvailablePlayerPage(1)
    }

    setSessionForm((current) => updateSessionFormValue({
      currentForm: current,
      name,
      teams,
      value,
    }))
  }

  const handleCreateSession = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    if (!sessionForm.sessionType) {
      setErrorMessage('Select a session type before creating the session.')
      setIsSaving(false)
      return false
    }

    if (!sessionForm.sessionDate) {
      setErrorMessage('Select a session date before creating the session.')
      setIsSaving(false)
      return false
    }

    try {
      const createdSession = await createAssessmentSession({
        user,
        session: {
          ...sessionForm,
          opponent: sessionForm.sessionType === 'match' ? sessionForm.opponent : '',
        },
      })
      const nextSessions = [createdSession, ...sessions.filter((session) => session.id !== createdSession.id)]
      setSessions(nextSessions)
      setSelectedSessionId(createdSession.id)
      setSelectedPlayerIds([])
      setSessionForm(createInitialSessionForm())
      writeSessionCache({
        sessions: nextSessions,
      })
      writeStoredSessionWorkspace(workspaceStorageKey, {
        ...readStoredSessionWorkspace(workspaceStorageKey),
        selectedSessionId: createdSession.id,
        selectedPlayerIds: [],
      })
      showToast({ title: 'Session created', message: createdSession.title || 'Session added.' })
      return true
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not create session.')
      showToast({ title: 'Session not created', message: error.message || 'Could not create session.', tone: 'error' })
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSessionSetupFocus = () => {
    const setupSection = document.getElementById('session-setup')

    if (setupSection && 'open' in setupSection) {
      setupSection.open = true
    }

    window.requestAnimationFrame(() => {
      setupSection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const handlePlayerSelection = (playerId, checked) => {
    setSelectedPlayerIds((current) => getNextSelectedPlayerIds(current, playerId, checked))
  }

  const handleOpenSession = (sessionId) => {
    const nextSessionId = String(sessionId ?? '').trim()

    if (!nextSessionId) {
      return
    }

    setErrorMessage('')
    setSelectedSessionId(nextSessionId)
    setSelectedPlayerIds([])
    setSearchParams(getOpenSessionSearchParams(searchParams, nextSessionId), { replace: true })
  }

  const handleCurrentSessionFocus = () => {
    if (!selectedSessionId) {
      setErrorMessage('Select a saved session first.')
      return
    }

    currentSessionRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  const handleCalendarDateClick = (date) => {
    setErrorMessage('')
    const defaultForm = getDefaultCalendarForm(date)
    const eventType = (isClubWideCalendar || calendarOnly) ? 'general' : defaultForm.eventType
    setCalendarForm({
      ...defaultForm,
      eventType,
      requestTrainingAvailability: eventType === 'training',
      teamId: canCreateClubCalendarEvent(user) ? '' : String(user?.activeTeamId ?? '').trim(),
    })
    setCalendarModal({ mode: 'create', event: null })
  }

  const handleOpenSessionCreateModal = () => {
    setErrorMessage('')
    setCalendarForm({
      ...getDefaultCalendarForm(formatLocalDate(new Date())),
      eventType: 'training',
      teamId: canCreateClubCalendarEvent(user) ? '' : String(user?.activeTeamId ?? '').trim(),
    })
    setCalendarModal({ mode: 'create', event: null, variant: 'session' })
  }

  const handleCalendarEventOpen = (event) => {
    setErrorMessage('')
    const baseForm = getFormFromCalendarEvent(event, calendarInvites)
    const sourceEventType = event?.data?.eventType || baseForm.eventType
    const setting = event?.sourceType === 'calendar'
      ? trainingAvailabilitySettingsByEventId[event.sourceId]
      : null

    setCalendarForm({
      ...baseForm,
      requestTrainingAvailability: sourceEventType === 'training' ? setting?.enabled ?? true : false,
      trainingAvailabilitySendDaysBefore: setting?.sendDaysBefore ?? 2,
    })
    setCalendarModal({ mode: 'view', event })
  }

  const openCalendarMatchDayWorkflow = (form) => {
    const safeTeamId = getSafeCalendarTeamId(user, form.teamId)
    const trimmedTitle = getTrimmedFormValue(form.title)
    const trimmedOpponent = getTrimmedFormValue(form.opponent)

    openMatchDayFixtureSetup({
      arrivalTime: form.arrivalTime,
      kickoffTime: form.startTime,
      matchDate: form.date,
      notes: form.notes,
      opponent: trimmedOpponent || trimmedTitle,
      parentAudience: form.shareWithParents ? form.parentAudience : 'none',
      parentVisible: form.shareWithParents,
      teamId: safeTeamId,
      venueName: form.location,
    }, { navigate })
    setCalendarModal(null)
    showToast({ title: 'Opening Match Day', message: 'Create this fixture in the full Match Day workflow.' })
  }

  const handleCalendarFormChange = (event) => {
    const { checked, name, type, value } = event.target

    setErrorMessage('')

    if (name === 'eventType' && value === 'match' && calendarModal?.mode === 'create' && !calendarModal?.event) {
      openCalendarMatchDayWorkflow({
        ...calendarForm,
        eventType: 'match',
        endTime: addMinutesToTime(calendarForm.startTime, 120),
      })
      return
    }

    setCalendarForm((current) => {
      if (name === 'resourceIds') {
        const currentIds = Array.isArray(current.resourceIds) ? current.resourceIds : []
        const nextIds = checked
          ? [...new Set([...currentIds, value])]
          : currentIds.filter((id) => id !== value)

        return {
          ...current,
          resourceIds: nextIds,
        }
      }

      if (name === 'invitedPlayerIds') {
        const currentIds = Array.isArray(current.invitedPlayerIds) ? current.invitedPlayerIds : []
        const nextIds = checked
          ? [...new Set([...currentIds, value])]
          : currentIds.filter((id) => id !== value)

        return {
          ...current,
          invitedPlayerIds: nextIds,
        }
      }

      const nextForm = {
        ...current,
        [name]: type === 'checkbox' ? checked : value,
      }

      if (name === 'shareWithParents') {
        const currentSafeTeamId = isClubWideCalendar ? '' : getSafeCalendarTeamId(user, current.teamId)
        nextForm.parentAudience = checked
          ? isClubWideShareableCalendarEvent({ form: current, safeTeamId: currentSafeTeamId, user })
            ? 'all_club_parents'
            : (current.parentAudience === 'none' ? 'involved_players' : current.parentAudience)
          : 'none'
      }

      if (name === 'teamId') {
        const selectedTeam = teams.find((team) => team.id === value)
        nextForm.team = selectedTeam?.name || ''
        nextForm.invitedPlayerIds = []
        nextForm.inviteTrialPlayers = false
        nextForm.inviteWholeSquad = false
        nextForm.resourceIds = []
        if (!value && current.parentAudience === 'all_team_parents') {
          nextForm.parentAudience = 'all_club_parents'
        }
      }

      if (['date', 'startTime', 'endTime'].includes(name)) {
        nextForm.repeatUpdateScope = ''
      }

      if (name === 'eventType' && value === 'training' && !current.title) {
        nextForm.title = ''
      }

      if (name === 'eventType') {
        nextForm.requestTrainingAvailability = value === 'training'
      }

      if (name === 'eventType' && value === 'match') {
        nextForm.recurrenceFrequency = 'none'
        nextForm.recurrenceUntil = ''
        nextForm.endTime = addMinutesToTime(current.startTime, 120)
      }

      if (name === 'eventType' && !isCalendarResourceEventType(value)) {
        nextForm.resourceIds = []
      }

      if (name === 'startTime' && nextForm.eventType === 'match') {
        nextForm.endTime = addMinutesToTime(value, 120)
      }

      return nextForm
    })
  }

  const handleCalendarResourceIdsChange = (resourceIds) => {
    const nextResourceIds = [...new Set(
      (Array.isArray(resourceIds) ? resourceIds : [])
        .map((resourceId) => String(resourceId ?? '').trim())
        .filter(Boolean),
    )]

    setCalendarForm((current) => ({
      ...current,
      resourceIds: nextResourceIds,
    }))
  }

  const getCalendarTeamName = (teamId) => {
    const normalizedTeamId = String(teamId ?? '').trim()
    return teams.find((team) => team.id === normalizedTeamId)?.name || user?.activeTeamName || ''
  }

  const replaceInvitesForSource = (inviteState, source, savedInvites) => {
    const sourceColumn = source.calendarEventId ? 'calendarEventId' : 'assessmentSessionId'
    const sourceId = source.calendarEventId || source.assessmentSessionId

    return [
      ...inviteState.filter((invite) => invite[sourceColumn] !== sourceId),
      ...savedInvites,
    ]
  }

  const queueCalendarEventInviteEmails = async ({
    assessmentSessionId = '',
    calendarEventId = '',
    savedInvites = [],
    safeTeamId = '',
    sourceTitle = '',
    teamName = '',
  } = {}) => {
    if (!calendarForm.notifyInvitedFamilies || !canUseUiFeature(user, CAPABILITIES.parentEmails)) {
      return { queued: 0, failed: 0 }
    }

    const sourceColumn = calendarEventId ? 'calendarEventId' : 'assessmentSessionId'
    const sourceId = calendarEventId || assessmentSessionId
    const previousInvites = calendarInvites.filter((invite) => invite[sourceColumn] === sourceId)
    const previouslyRequestedPlayerIds = new Set(
      previousInvites
        .filter((invite) => invite.notifyRequested)
        .map((invite) => String(invite.playerId ?? '')),
    )
    const invitesToQueue = savedInvites
      .filter((invite) => invite.notifyRequested)
      .filter((invite) => !previouslyRequestedPlayerIds.has(String(invite.playerId ?? '')))
      .filter((invite) => String(invite.parentContactEmail ?? '').trim())

    if (invitesToQueue.length === 0) {
      return { queued: 0, failed: 0 }
    }

    const startsAtLabel = formatEventInviteDateTime(calendarForm.date, calendarForm.startTime)
    const scheduledAt = getEventInviteScheduledAt()
    const results = await Promise.allSettled(invitesToQueue.map((invite) => createScheduledEmail({
      user,
      item: {
        clubName: user?.clubName || 'Football Player',
        communicationLog: {
          clubId: user?.clubId,
          playerId: invite.playerId,
          userId: user?.id,
          userName: user?.displayName || user?.name || '',
          userEmail: user?.email || '',
          recipientEmail: invite.parentContactEmail,
          metadata: {
            source: 'calendar_event_invite',
            calendarEventId,
            assessmentSessionId,
            calendarEventInviteId: invite.id,
            eventTitle: sourceTitle,
            startsAt: buildDateTime(calendarForm.date, calendarForm.startTime),
          },
        },
        displayName: user?.displayName || user?.name || 'Football Player',
        html: buildCalendarEventInviteEmailHtml({
          clubName: user?.clubName || 'Football Player',
          eventTitle: sourceTitle,
          eventType: calendarForm.eventType,
          location: calendarForm.location,
          notes: calendarForm.notes,
          parentName: invite.parentContactName,
          playerName: invite.player?.playerName,
          startsAtLabel,
          teamName,
        }),
        parentName: invite.parentContactName,
        playerName: invite.player?.playerName,
        scheduledAt,
        subject: `Football Player: ${sourceTitle || 'Event invite'}`,
        teamId: safeTeamId,
        teamName,
        toEmail: invite.parentContactEmail,
      },
    })))

    return {
      queued: results.filter((result) => result.status === 'fulfilled').length,
      failed: results.filter((result) => result.status === 'rejected').length,
    }
  }

  const handleCalendarSave = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    const activeEvent = calendarModal?.event || null
    const sourceType = activeEvent?.sourceType || ''
    const safeTeamId = isClubWideCalendar ? '' : getSafeCalendarTeamId(user, calendarForm.teamId)
    const teamName = getCalendarTeamName(safeTeamId)
    const isTraining = calendarForm.eventType === 'training'
    const isMatch = calendarForm.eventType === 'match'
    const saveTrainingAsSession = isTraining && (calendarModal?.variant === 'session' || sourceType === 'session')
    const trimmedTitle = getTrimmedFormValue(calendarForm.title)
    const trimmedOpponent = getTrimmedFormValue(calendarForm.opponent)

    try {
      if (!canCreateClubCalendarEvent(user) && !safeTeamId) {
        throw new Error('Choose your assigned team before saving this calendar event.')
      }

      validateCalendarForm({ form: calendarForm, safeTeamId, sourceType, user })
      validateParentSharing({
        form: calendarForm,
        safeTeamId,
        selectedPlayers: selectedCalendarInvitePlayers,
        user,
      })

      if (isMatch && !sourceType) {
        openMatchDayFixtureSetup({
          arrivalTime: calendarForm.arrivalTime,
          kickoffTime: calendarForm.startTime,
          matchDate: calendarForm.date,
          notes: calendarForm.notes,
          opponent: trimmedOpponent || trimmedTitle,
          parentAudience: calendarForm.shareWithParents ? calendarForm.parentAudience : 'none',
          parentVisible: calendarForm.shareWithParents,
          teamId: safeTeamId,
          venueName: calendarForm.location,
        }, { navigate })
        setCalendarModal(null)
        showToast({ title: 'Opening Match Day', message: 'Create this fixture in the full Match Day workflow.' })
        return
      }

      const fixtureEndTime = isMatch ? addMinutesToTime(calendarForm.startTime, 120) : calendarForm.endTime
      const recurrenceDates = isMatch
        ? [formatDateInput(calendarForm.date)]
        : buildRecurrenceDates({
          date: calendarForm.date,
          frequency: calendarForm.recurrenceFrequency,
          until: calendarForm.recurrenceUntil,
        })
      let nextCalendarInvites = calendarInvites
      let queuedInviteEmails = 0
      let failedInviteEmails = 0
      const shouldSyncInvites = Boolean(safeTeamId)
      const syncInvites = async ({ calendarEventId = '', assessmentSessionId = '', sourceTitle = '' } = {}) => {
        if (!shouldSyncInvites) {
          return
        }

        const sharedInvolvedPlayers = calendarForm.shareWithParents && calendarForm.parentAudience === 'involved_players'
        const sharedAllTeamParents = calendarForm.shareWithParents && calendarForm.parentAudience === 'all_team_parents'
        const notificationPlayers = buildCalendarNotificationPlayers(calendarForm, calendarInvitePlayers, selectedCalendarInvitePlayers)
        const notifyRequested = calendarForm.notifyInvitedFamilies && (sharedInvolvedPlayers || sharedAllTeamParents)
        const savedInvites = await saveCalendarEventInvites({
          user,
          calendarEventId,
          assessmentSessionId,
          teamId: safeTeamId,
          players: notificationPlayers,
          notifyRequested,
        })
        if (notifyRequested) {
          const queueResult = await queueCalendarEventInviteEmails({
            assessmentSessionId,
            calendarEventId,
            safeTeamId,
            savedInvites,
            sourceTitle,
            teamName,
          })
          queuedInviteEmails += queueResult.queued
          failedInviteEmails += queueResult.failed
        }
        nextCalendarInvites = replaceInvitesForSource(nextCalendarInvites, { calendarEventId, assessmentSessionId }, savedInvites)
      }

      if (saveTrainingAsSession || (sourceType === 'session' && activeEvent?.data?.sessionType !== 'match')) {
        const payload = {
          endTime: calendarForm.endTime,
          location: calendarForm.location,
          notes: calendarForm.notes,
          opponent: '',
          sessionDate: calendarForm.date,
          sessionType: 'training',
          startTime: calendarForm.startTime,
          team: teamName,
          teamId: safeTeamId,
          title: trimmedTitle || 'Training session',
        }
        const savedSessions = []

        if (sourceType === 'session') {
          const legacySeriesSessions = getLegacyRecurringSessionSeries({ event: activeEvent, sessions })
          const isLegacyRecurringSession = legacySeriesSessions.length > 1 && calendarForm.recurrenceFrequency !== 'none'
          const requiresRepeatUpdateScope = hasRecurringCalendarDateTimeChange({ event: activeEvent, form: calendarForm })

          if (requiresRepeatUpdateScope && calendarForm.repeatUpdateScope !== 'entire_series') {
            throw new Error('Choose how to update this repeating event before saving.')
          }

          if (calendarForm.recurrenceFrequency !== 'none' && !isLegacyRecurringSession) {
            throw new Error('This legacy training session does not have a safe repeat series link, so it cannot be moved as a series yet.')
          }

          if (isLegacyRecurringSession) {
            const dayShift = getDayShift(activeEvent.data?.sessionDate || activeEvent.date, calendarForm.date)

            for (const seriesSession of legacySeriesSessions) {
              const savedSession = await updateAssessmentSession({
                user,
                sessionId: seriesSession.id,
                session: {
                  ...payload,
                  sessionDate: seriesSession.id === activeEvent.sourceId
                    ? calendarForm.date
                    : shiftDateByDays(seriesSession.sessionDate, dayShift),
                },
              })
              savedSessions.push(savedSession)
            }
          } else {
            const savedSession = await updateAssessmentSession({ user, sessionId: activeEvent.sourceId, session: payload })
            savedSessions.push(savedSession)
          }
        } else {
          for (const sessionDate of recurrenceDates) {
            const savedSession = await createAssessmentSession({
              user,
              session: {
                ...payload,
                sessionDate,
              },
            })
            savedSessions.push(savedSession)
          }
        }

        for (const savedSession of savedSessions) {
          await syncInvites({ assessmentSessionId: savedSession.id, sourceTitle: savedSession.title })
        }

        const savedSessionIds = savedSessions.map((session) => session.id)
        const nextSessions = [...savedSessions, ...sessions.filter((session) => !savedSessionIds.includes(session.id))]
        setSessions(nextSessions)
        setCalendarInvites(nextCalendarInvites)
        writeCalendarAwareCache({ sessions: nextSessions, calendarInvites: nextCalendarInvites })
        showToast({
          title: sourceType === 'session' ? 'Session updated' : savedSessions.length > 1 ? 'Sessions created' : 'Session created',
          message: sourceType === 'session' && savedSessions.length > 1
            ? `${savedSessions.length} training sessions in the repeat series were updated.`
            : savedSessions.length > 1 ? `${savedSessions.length} training sessions were added.` : savedSessions[0]?.title || 'Calendar updated.',
        })
      } else if (isMatch || sourceType === 'match-day' || (sourceType === 'session' && activeEvent?.data?.sessionType === 'match')) {
        const payload = {
          arrivalTime: calendarForm.arrivalTime,
          endTime: fixtureEndTime,
          location: calendarForm.location,
          notes: calendarForm.notes,
          opponent: trimmedOpponent,
          sessionDate: calendarForm.date,
          sessionType: 'match',
          startTime: calendarForm.startTime,
          team: teamName,
          teamId: safeTeamId,
          title: trimmedTitle || `Match vs ${trimmedOpponent}`,
        }

        if (sourceType === 'session') {
          const savedSession = await updateAssessmentSession({ user, sessionId: activeEvent.sourceId, session: payload })
          const nextSessions = [savedSession, ...sessions.filter((session) => session.id !== savedSession.id)]
          await syncInvites({ assessmentSessionId: savedSession.id, sourceTitle: savedSession.title })
          setSessions(nextSessions)
          setCalendarInvites(nextCalendarInvites)
          writeCalendarAwareCache({ sessions: nextSessions, calendarInvites: nextCalendarInvites })
          showToast({ title: 'Match session updated', message: savedSession.title || 'Calendar updated.' })
        } else if (sourceType === 'match-day') {
          const payload = {
            arrivalTime: calendarForm.arrivalTime,
            homeAway: 'home',
            kickoffTime: calendarForm.startTime,
            matchDate: calendarForm.date,
            notes: calendarForm.notes,
            opponent: trimmedOpponent,
            requestScorer: calendarForm.requestScorer,
            requestLinesman: calendarForm.requestLinesman,
            requestReferee: calendarForm.requestReferee,
            scorerRequestMessage: '',
            status: calendarForm.requestScorer ? 'scorer_request' : 'scheduled',
            teamId: safeTeamId,
            venueAddress: '',
            venueName: calendarForm.location,
          }
          const savedMatch = await updateMatchDay({ user, matchId: activeEvent.sourceId, updates: payload })
          const nextMatchDays = [savedMatch, ...matchDays.filter((match) => match.id !== savedMatch.id)]
          setMatchDays(nextMatchDays)
          writeCalendarAwareCache({ matchDays: nextMatchDays })
          showToast({ title: 'Fixture updated', message: savedMatch.opponent || 'Calendar updated.' })
        } else {
          const savedSession = await createAssessmentSession({ user, session: payload })
          await syncInvites({ assessmentSessionId: savedSession.id, sourceTitle: savedSession.title })
          const nextSessions = [savedSession, ...sessions.filter((session) => session.id !== savedSession.id)]
          setSessions(nextSessions)
          setCalendarInvites(nextCalendarInvites)
          writeCalendarAwareCache({ sessions: nextSessions, calendarInvites: nextCalendarInvites })
          showToast({ title: 'Fixture created', message: savedSession.title || 'Calendar updated.' })
        }
      } else {
        const requiresRepeatUpdateScope = hasRecurringCalendarDateTimeChange({ event: activeEvent, form: calendarForm })

        if (requiresRepeatUpdateScope && calendarForm.repeatUpdateScope !== 'entire_series') {
          throw new Error('Choose how to update this repeating event before saving.')
        }

        if (calendarForm.recurrenceFrequency !== 'none') {
          const seriesDateTimeFields = getCalendarEventSeriesDateTimeFields({ event: activeEvent, form: calendarForm })

          buildRecurrenceDates({
            date: sourceType === 'calendar' ? seriesDateTimeFields.startsAt : calendarForm.date,
            frequency: calendarForm.recurrenceFrequency,
            until: calendarForm.recurrenceUntil,
          })
        }

        const seriesDateTimeFields = getCalendarEventSeriesDateTimeFields({ event: activeEvent, form: calendarForm })
        const payload = {
          endsAt: seriesDateTimeFields.endsAt,
          eventType: calendarForm.eventType,
          location: calendarForm.location,
          notes: calendarForm.notes,
          ...getCalendarParentVisibility({ form: calendarForm, safeTeamId, user }),
          recurrenceFrequency: calendarForm.recurrenceFrequency,
          recurrenceUntil: calendarForm.recurrenceUntil,
          startsAt: seriesDateTimeFields.startsAt,
          teamId: safeTeamId,
          title: trimmedTitle,
        }
        const savedEvent = sourceType === 'calendar'
          ? await updateCalendarEvent({ user, eventId: activeEvent.sourceId, event: payload })
          : await createCalendarEvent({ user, event: payload })
        await syncInvites({ calendarEventId: savedEvent.id, sourceTitle: savedEvent.title })
        let savedTrainingAvailabilitySetting = null

        if (calendarForm.eventType === 'training' && safeTeamId) {
          savedTrainingAvailabilitySetting = await saveTrainingAvailabilitySettings({
            user,
            event: savedEvent,
            settings: {
              requestTrainingAvailability: calendarForm.requestTrainingAvailability,
              trainingAvailabilitySendDaysBefore: calendarForm.trainingAvailabilitySendDaysBefore,
            },
          })
        }

        if (isCalendarResourceEventType(calendarForm.eventType) && safeTeamId && (sourceType === 'calendar' || calendarForm.resourceIds?.length > 0)) {
          const attachedResources = await syncCalendarEventResourceLinks({
            user,
            eventId: savedEvent.id,
            teamId: safeTeamId,
            resourceIds: calendarForm.resourceIds,
          })
          setCalendarEventResourcesById((current) => ({
            ...current,
            [savedEvent.id]: attachedResources,
          }))
        }
        const nextCalendarItems = [savedEvent, ...calendarItems.filter((item) => item.id !== savedEvent.id)]
        setCalendarItems(nextCalendarItems)
        setCalendarInvites(nextCalendarInvites)
        if (savedTrainingAvailabilitySetting) {
          setTrainingAvailabilitySettingsByEventId((current) => ({
            ...current,
            [savedEvent.id]: savedTrainingAvailabilitySetting,
          }))
        }
        writeCalendarAwareCache({ calendarItems: nextCalendarItems, calendarInvites: nextCalendarInvites })
        showToast({ title: sourceType === 'calendar' ? 'Event updated' : 'Event created', message: savedEvent.title || 'Calendar updated.' })
      }

      if (queuedInviteEmails > 0) {
        showToast({
          title: 'Family emails queued',
          message: `${queuedInviteEmails} event invite email${queuedInviteEmails === 1 ? '' : 's'} added to the email queue.`,
        })
      }

      if (failedInviteEmails > 0) {
        showToast({
          title: 'Some emails were not queued',
          message: `${failedInviteEmails} event invite email${failedInviteEmails === 1 ? '' : 's'} could not be added to the queue. Parent portal invites were still saved.`,
          tone: 'error',
        })
      }

      setCalendarModal(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Calendar event could not be saved.')
      showToast({ title: 'Calendar not saved', message: error.message || 'Calendar event could not be saved.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCalendarDelete = async () => {
    const activeEvent = calendarModal?.event || null
    const requiresRepeatDeleteScope = isRecurringCalendarEvent({ event: activeEvent, form: calendarForm })

    if (!activeEvent?.sourceId) {
      setErrorMessage('This calendar item cannot be changed from here.')
      showToast({ title: 'Calendar item not changed', message: 'This calendar item cannot be changed from here.', tone: 'error' })
      return
    }

    if (requiresRepeatDeleteScope && calendarForm.deleteRepeatScope !== 'entire_series') {
      setErrorMessage('Choose how to delete this repeating event before continuing.')
      showToast({ title: 'Calendar not deleted', message: 'Choose how to delete this repeating event before continuing.', tone: 'error' })
      return
    }

    const deleteMessage = activeEvent.sourceType === 'match-day'
      ? 'Cancel this fixture? This keeps existing history and removes it from the active calendar.'
      : activeEvent.sourceType === 'session'
        ? 'Delete or remove this session from the calendar? Player records stay in history when a completed session is removed.'
        : requiresRepeatDeleteScope
          ? 'Delete this entire repeat series? This cannot be undone.'
        : 'Delete this calendar event? This cannot be undone.'

    if (!window.confirm(deleteMessage)) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      if (activeEvent.sourceType === 'calendar') {
        if (activeEvent.data?.eventType === 'training') {
          await cancelPendingTrainingAvailabilityRequests({ user, calendarEventId: activeEvent.sourceId })
        }
        await deleteCalendarEvent({ user, eventId: activeEvent.sourceId })
        const nextCalendarItems = calendarItems.filter((item) => item.id !== activeEvent.sourceId)
        const nextCalendarInvites = calendarInvites.filter((invite) => invite.calendarEventId !== activeEvent.sourceId)
        setCalendarItems(nextCalendarItems)
        setCalendarInvites(nextCalendarInvites)
        setTrainingAvailabilitySettingsByEventId((current) => {
          const nextSettings = { ...current }
          delete nextSettings[activeEvent.sourceId]
          return nextSettings
        })
        writeCalendarAwareCache({ calendarItems: nextCalendarItems, calendarInvites: nextCalendarInvites })
        showToast({ title: 'Event deleted', message: 'The calendar event was removed.' })
      } else if (activeEvent.sourceType === 'session') {
        const legacySeriesSessions = requiresRepeatDeleteScope
          ? getLegacyRecurringSessionSeries({ event: activeEvent, sessions })
          : []
        const sessionsToDelete = legacySeriesSessions.length > 1 ? legacySeriesSessions : [activeEvent.data]
        const assessmentCount = sessionsToDelete.reduce(
          (total, session) => total + getAssessmentCountForSession(evaluations, session),
          0,
        )

        if (assessmentCount > 0 && sessionsToDelete.length === 1) {
          setDeleteSessionTarget({
            session: activeEvent.data,
            assessmentCount,
            playerCount: 0,
            source: 'calendar',
          })
          setCalendarModal(null)
          return
        }

        const deleteResults = []

        for (const session of sessionsToDelete) {
          deleteResults.push(await deleteAssessmentSession({ user, sessionId: session.id }))
        }

        const deletedSessionIds = new Set(sessionsToDelete.map((session) => session.id))
        const hasCancelledSession = deleteResults.some((result) => result?.mode === 'cancelled')
        const nextSessions = sessions.filter((session) => !deletedSessionIds.has(session.id))
        const nextCalendarInvites = calendarInvites.filter((invite) => !deletedSessionIds.has(invite.assessmentSessionId))
        setSessions(nextSessions)
        setCalendarInvites(nextCalendarInvites)
        writeCalendarAwareCache({ sessions: nextSessions, calendarInvites: nextCalendarInvites })
        showToast({
          title: hasCancelledSession ? 'Session removed' : sessionsToDelete.length > 1 ? 'Repeat series deleted' : 'Session deleted',
          message: hasCancelledSession
            ? 'The session was removed from the calendar. Player records stay in history.'
            : sessionsToDelete.length > 1 ? `${sessionsToDelete.length} training sessions were removed.` : 'The session was removed.',
        })
      } else if (activeEvent.sourceType === 'match-day') {
        const cancelledMatch = await updateMatchDay({
          user,
          matchId: activeEvent.sourceId,
          updates: { status: 'cancelled' },
        })
        const nextMatchDays = matchDays.filter((match) => match.id !== cancelledMatch.id)
        setMatchDays(nextMatchDays)
        writeCalendarAwareCache({ matchDays: nextMatchDays })
        showToast({ title: 'Fixture cancelled', message: cancelledMatch.opponent || 'The fixture was cancelled.' })
      } else {
        throw new Error('This calendar item opens in its own area.')
      }

      setCalendarModal(null)
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Calendar event could not be deleted.')
      showToast({ title: 'Calendar not deleted', message: error.message || 'Calendar event could not be deleted.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCompleteSession = async () => {
    if (!selectedSessionId || !selectedSession) {
      setErrorMessage('Select a session before completing it.')
      return
    }

    if (!canCompleteSessions) {
      setErrorMessage('Only managers and team admins can complete sessions.')
      return
    }

    setCompleteSessionTarget(selectedSession)
  }

  const confirmCompleteSession = async () => {
    if (!completeSessionTarget || !selectedSessionId) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      let sessionToCompleteId = selectedSessionId

      if (completeSessionTarget.isHistorical) {
        const createdSession = await createAssessmentSession({
          user,
          session: createSessionFromHistoricalTarget({
            historicalSession: completeSessionTarget,
            teams,
          }),
        })
        sessionToCompleteId = createdSession.id
        setSelectedSessionId(createdSession.id)
      }

      const completedSession = await completeAssessmentSession({
        user,
        sessionId: sessionToCompleteId,
      })
      const nextSessions = getSessionsWithUpdatedSession(sessions, completedSession)
      setSessions(nextSessions)
      writeSessionCache({
        sessions: nextSessions,
      })
      showToast({ title: 'Session completed', message: completedSession.title || 'Session marked as completed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not complete this session.')
      showToast({ title: 'Session not completed', message: error.message || 'Could not complete session.', tone: 'error' })
    } finally {
      setIsSaving(false)
      setCompleteSessionTarget(null)
    }
  }

  const handleDeleteSession = () => {
    if (!selectedSessionId || selectedSession?.isHistorical) {
      setErrorMessage('Select a saved session before deleting it.')
      return
    }

    if (!canDeleteSessions) {
      setErrorMessage('Only managers and team admins can delete sessions.')
      return
    }

    setDeleteSessionTarget({
      session: selectedSession,
      assessmentCount: selectedSessionAssessmentCount,
      playerCount: sessionPlayers.length,
      source: 'session',
    })
  }

  const confirmDeleteSession = async (password) => {
    if (!deleteSessionTarget?.session?.id) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      if ((deleteSessionTarget.assessmentCount ?? 0) === 0) {
        await verifyCurrentUserPassword(user?.email, password)
      }

      const deleteResult = await deleteAssessmentSession({
        user,
        sessionId: deleteSessionTarget.session.id,
      })
      const nextSessions = sessions.filter((session) => session.id !== deleteSessionTarget.session.id)
      const nextCalendarInvites = calendarInvites.filter((invite) => invite.assessmentSessionId !== deleteSessionTarget.session.id)
      setSessions(nextSessions)
      setCalendarInvites(nextCalendarInvites)
      setSessionPlayers([])
      setSelectedPlayerIds([])
      setDeleteSessionTarget(null)
      setSelectedSessionId(nextSessions[0]?.id || '')
      writeSessionCache({
        sessions: nextSessions,
      })
      writeCalendarAwareCache({ sessions: nextSessions, calendarInvites: nextCalendarInvites })
      showToast({
        title: deleteResult?.mode === 'cancelled' ? 'Session removed' : 'Session deleted',
        message: deleteResult?.mode === 'cancelled'
          ? 'The session was removed from the calendar. Player records stay in history.'
          : 'The session was removed.',
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not delete this session.')
      showToast({ title: 'Session not deleted', message: error.message || 'Could not delete this session.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleImportPlayers = async (mode) => {
    if (!selectedSessionId) {
      setErrorMessage('Create or select a session first.')
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be edited.')
      return
    }

    if (selectedSession?.isHistorical) {
      setErrorMessage('Historical sessions are read only. Create or select a saved session to add players.')
      return
    }

    const playersToAdd =
      mode === 'all'
        ? filteredPlayers
        : filteredPlayers.filter((player) => selectedPlayerIds.includes(player.id))

    if (playersToAdd.length === 0) {
      setErrorMessage('Select at least one player to add to this session.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await addPlayersToAssessmentSession({
        user,
        sessionId: selectedSessionId,
        players: playersToAdd,
      })
      const nextSessionPlayers = await getAssessmentSessionPlayers({ user, sessionId: selectedSessionId })
      setSessionPlayers(nextSessionPlayers)
      setSelectedPlayerIds([])
      showToast({ title: 'Players added', message: `${playersToAdd.length} players added to the session.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not add players to this session.')
      showToast({ title: 'Players not added', message: error.message || 'Could not add players.', tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const handleClearSessionPlayers = async () => {
    if (!selectedSessionId) {
      setErrorMessage('Select a session first.')
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be edited.')
      return
    }

    setClearSessionTarget({
      session: selectedSession,
      playerCount: sessionPlayers.length,
    })
  }

  const confirmClearSessionPlayers = async (password) => {
    if (!clearSessionTarget || !selectedSessionId) {
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await verifyCurrentUserPassword(user.email, password)
      await clearAssessmentSessionPlayers({
        user,
        sessionId: selectedSessionId,
      })
      setSessionPlayers([])
      setSelectedPlayerIds([])
      const progressKey = getSessionProgressKey(user, selectedSessionId)

      if (progressKey) {
        localStorage.removeItem(progressKey)
      }
      showToast({ title: 'Session cleared', message: 'All players were removed from this session list.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not clear this session.')
      showToast({ title: 'Session not cleared', message: error.message || 'Could not clear this session.', tone: 'error' })
    } finally {
      setIsSaving(false)
      setClearSessionTarget(null)
    }
  }

  const handleAssessAll = () => {
    const queue = getUnassessedPlayerQueue({ completedPlayerNames, sessionPlayers })

    if (queue.length === 0) {
      setErrorMessage(
        sessionPlayers.length === 0
          ? 'Add players to the session before using Assess All.'
          : 'All players in this session already have development records.',
      )
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer start development records.')
      return
    }

    navigate(buildSessionAssessmentUrl({
      playerName: queue[0],
      queue,
      selectedSession,
      selectedSessionId,
      sessionForm,
      sessionPlayers,
    }))
  }

  const handleStartVoiceNote = async (target) => {
    if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Voice recording is not supported in this browser.')
      showToast({ title: 'Voice note not started', message: 'Voice recording is not supported in this browser.', tone: 'error' })
      return
    }

    if (selectedSessionLocked) {
      setErrorMessage('This session has been completed and can no longer be edited.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new globalThis.MediaRecorder(stream, getRecorderOptions())
      recordingChunksRef.current = []
      recordingStartedAtRef.current = Date.now()
      setRecordingTarget(target)

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) {
          recordingChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const chunks = recordingChunksRef.current
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
        stream.getTracks().forEach((track) => track.stop())
        mediaRecorderRef.current = null
        recordingChunksRef.current = []

        if (chunks.length === 0) {
          setRecordingTarget(null)
          setErrorMessage('No audio was captured. Try recording again.')
          return
        }

        const audioBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        setIsSavingVoiceNote(true)

        try {
          const savedNote = await createPlayerStaffNote({
            user,
            playerId: target.playerId || '',
            sessionId: target.sessionId || selectedSessionId,
            note: target.playerName
              ? `Voice note for ${target.playerName}`
              : `Team voice note for ${selectedSession?.title || selectedSession?.team || 'session'}`,
            audioBlob,
            audioDurationSeconds: durationSeconds,
          })

          if (!target.playerId) {
            setSessionVoiceNotes((currentNotes) => [savedNote, ...currentNotes])
          }

          showToast({
            title: 'Voice note saved',
            message: target.playerName ? `Saved for ${target.playerName}.` : 'Saved for this session.',
          })
        } catch (error) {
          console.error(error)
          setErrorMessage(error.message || 'Could not save the voice note.')
          showToast({ title: 'Voice note not saved', message: error.message || 'Could not save the voice note.', tone: 'error' })
        } finally {
          setIsSavingVoiceNote(false)
          setRecordingTarget(null)
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start()
    } catch (error) {
      console.error(error)
      setRecordingTarget(null)
      setErrorMessage('Microphone access was not allowed.')
      showToast({ title: 'Voice note not started', message: 'Microphone access was not allowed.', tone: 'error' })
    }
  }

  const handleStopVoiceNote = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }

  const confirmDeleteVoiceNote = async () => {
    if (!voiceNoteDeleteTarget?.id) {
      return
    }

    setDeletingVoiceNoteId(voiceNoteDeleteTarget.id)
    setErrorMessage('')

    try {
      await deletePlayerStaffNote({ noteId: voiceNoteDeleteTarget.id })
      setSessionVoiceNotes((currentNotes) => currentNotes.filter((note) => note.id !== voiceNoteDeleteTarget.id))
      showToast({ title: 'Voice note deleted', message: 'The voice note has been removed.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Voice note could not be deleted.')
      showToast({ title: 'Voice note not deleted', message: error.message || 'Voice note could not be deleted.', tone: 'error' })
    } finally {
      setDeletingVoiceNoteId('')
      setVoiceNoteDeleteTarget(null)
    }
  }

  const clearRequestedSession = () => {
    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('sessionId')
    setSearchParams(nextSearchParams)
  }

  const calendarTitle = (() => {
    const teamName = String(user?.activeTeamName || user?.emailTeamName || user?.teamName || user?.team_name || '').trim()

    if (teamName) {
      return `${teamName} Calendar`
    }

    return user?.clubId ? 'Club Calendar' : 'Team Calendar'
  })()

  if (calendarOnly) {
    return (
      <div className="space-y-5">
        <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#101828]/5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className={eyebrowClass}>Calendar</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">
                {isClubWideCalendar ? 'Club calendar' : calendarTitle}
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
                {isClubWideCalendar
                  ? 'Club-wide events shared across the club.'
                  : 'Plan training, fixtures, parent cut offs, and club events without opening the session tools.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleCalendarDateClick(formatLocalDate(new Date()))}
              className={primaryButtonClass}
            >
              Add event
            </button>
          </div>
        </section>

        {errorMessage ? <NoticeBanner title="Calendar needs attention" message={errorMessage} /> : null}

        <FootballCalendar
          cursor={calendarCursor}
          events={calendarEvents}
          isLoading={isLoading}
          onCursorChange={setCalendarCursor}
          onOpenEvent={handleCalendarEventOpen}
          onViewChange={setCalendarView}
          view={calendarView}
        />

        <CalendarEventModal
          attachedResources={currentCalendarEventResources}
          currentInvites={currentCalendarEventInvites}
          event={calendarModal?.event}
          form={calendarForm}
          invitePlayers={calendarInvitePlayers}
          isBusy={isSaving}
          isResourcesLoading={isCalendarResourcesLoading}
          isOpen={Boolean(calendarModal)}
          mode={calendarModal?.mode || 'create'}
          onCancel={() => setCalendarModal(null)}
          onChange={handleCalendarFormChange}
          onDelete={handleCalendarDelete}
          onEdit={() => {
            setCalendarModal((current) => ({ ...current, mode: 'edit' }))
          }}
          onOpenWorkflow={() => {
            const href = calendarModal?.event?.href
            setCalendarModal(null)
            navigate(href || '/sessions')
          }}
          onResourceIdsChange={handleCalendarResourceIdsChange}
          onSubmit={handleCalendarSave}
          resourceOptions={calendarResourceOptions}
          selectedInvitePlayers={selectedCalendarInvitePlayers}
          trainingAvailabilitySummary={currentTrainingAvailabilitySummary}
          clubWideOnly={isClubWideCalendar}
          teams={teams}
          user={user}
          variant={calendarModal?.variant || ''}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-[#d7e5dc] bg-white px-5 py-5 shadow-sm shadow-[#101828]/5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className={eyebrowClass}>Sessions</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-[#101828] sm:text-3xl">
              Training and match sessions
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#4b5f55]">
              Create a block, add players, then record coach notes against the right session.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[22rem]">
            <button
              type="button"
              onClick={handleOpenSessionCreateModal}
              className={primaryButtonClass}
            >
              Create session
            </button>
            <button
              type="button"
              onClick={handleCurrentSessionFocus}
              disabled={!selectedSession}
              className={secondaryButtonClass}
            >
              Open selected
            </button>
          </div>
        </div>
      </section>

      {errorMessage ? <NoticeBanner title="Session action not completed" message={errorMessage} /> : null}

      <FootballCalendar
        cursor={calendarCursor}
        events={calendarEvents}
        isLoading={isLoading}
        onCursorChange={setCalendarCursor}
        onOpenEvent={handleCalendarEventOpen}
        onViewChange={setCalendarView}
        view={calendarView}
      />

      <section className="grid gap-3 md:grid-cols-4">
        <SessionSummaryCard isLoading={isLoading} label="Sessions" value={combinedSessions.length} caption="Saved training and match blocks." />
        <SessionSummaryCard isLoading={isLoading} label="Open" value={openSessionCount} caption="Sessions still available to work." />
        <SessionSummaryCard isLoading={isSessionPlayersLoading} label="In queue" value={sessionPlayers.length} caption="Players attached to the selected session." />
        <SessionSummaryCard isLoading={isSessionPlayersLoading} label="Remaining" value={unassessedPlayerQueue.length} caption="Player records still to complete." />
      </section>

      {requestedSessionMissing ? (
        <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-4 text-sm text-[#101828] shadow-sm shadow-[#101828]/5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Session link could not be opened</p>
              <p className="mt-1 font-semibold leading-6 text-[#4b5f55]">
                The session in this link was not found, so the current available session is shown instead.
              </p>
            </div>
            <button
              type="button"
              onClick={clearRequestedSession}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#fedf89] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#fffaeb]"
            >
              Clear session link
            </button>
          </div>
        </div>
      ) : null}

      {completedSessionId ? (
        <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-4 text-sm text-[#101828] shadow-sm shadow-[#065f46]/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black">Session development records completed</p>
              <p className="mt-1 font-semibold text-[#4b5f55]">
                {completedCount > 0 ? `${completedCount} player development records were completed.` : 'All queued development records were completed.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSearchParams({})}
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bbf7d0] bg-white px-4 py-3 text-sm font-black text-[#101828] transition hover:bg-[#ecfdf5]"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <MatchdayFocus
        assessedPlayerCount={assessedPlayerCount}
        isLoading={isLoading || isSessionPlayersLoading}
        onAssessAll={handleAssessAll}
        onOpenCreateSession={handleOpenSessionCreateModal}
        onOpenSessionSetup={handleSessionSetupFocus}
        selectedSession={selectedSession}
        selectedSessionCompleted={selectedSessionCompleted}
        selectedSessionLocked={selectedSessionLocked}
        sessionPlayers={sessionPlayers}
        unassessedPlayerCount={unassessedPlayerQueue.length}
      />

      <div ref={currentSessionRef} id="current-session">
        <SessionPlayersSection
          canCompleteSessions={canCompleteSessions}
          completedPlayerNames={completedPlayerNames}
          isLoading={isSessionPlayersLoading}
          isSaving={isSaving}
          isSavingVoiceNote={isSavingVoiceNote}
          deletingVoiceNoteId={deletingVoiceNoteId}
          onAssessAll={handleAssessAll}
          onAssessPlayer={(player) =>
            navigate(buildSessionAssessmentUrl({
              playerName: player.playerName,
              selectedSession,
              selectedSessionId,
              sessionForm,
              sessionPlayers,
            }))
          }
          onClearSessionPlayers={handleClearSessionPlayers}
          onDeleteVoiceNote={setVoiceNoteDeleteTarget}
          onPageChange={setSessionPlayerPage}
          onStartVoiceNote={handleStartVoiceNote}
          onStopVoiceNote={handleStopVoiceNote}
          paginatedPlayers={paginatedSessionPlayers}
          page={sessionPlayerPage}
          recordingTarget={recordingTarget}
          selectedSession={selectedSession}
          selectedSessionCompleted={selectedSessionCompleted}
          selectedSessionId={selectedSessionId}
          selectedSessionLocked={selectedSessionLocked}
          sessionPlayers={sessionPlayers}
          sessionVoiceNotes={sessionVoiceNotes}
        />
      </div>

      <details
        id="session-setup"
        open={setupOpen || sessions.length === 0}
        className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#101828]/5 sm:p-4"
      >
        <summary className="flex min-h-12 cursor-pointer list-none flex-col justify-center gap-1 rounded-lg px-2 text-base font-black text-[#101828] sm:flex-row sm:items-center sm:justify-between">
          Session setup
          <span className="text-sm font-bold text-[#4b5f55]">Create sessions, switch context, add players</span>
        </summary>
        <div className="mt-4 space-y-4">
          <CreateSessionSection
            form={sessionForm}
            isLoading={isLoading}
            isSaving={isSaving}
            onChange={handleSessionFormChange}
            onSubmit={handleCreateSession}
            teams={teams}
          />

          <OpenSessionsSection
            canCompleteSessions={canCompleteSessions}
            canDeleteSessions={canDeleteSessions}
            combinedSessions={combinedSessions}
            deleteSessionDisabledReason={deleteSessionDisabledReason}
            isLoading={isLoading}
            isSaving={isSaving}
            onCompleteSession={handleCompleteSession}
            onCurrentSession={handleCurrentSessionFocus}
            onDeleteSession={handleDeleteSession}
            onOpenSession={handleOpenSession}
            previousSessions={previousSessions}
            selectedSession={selectedSession}
            selectedSessionCompleted={selectedSessionCompleted}
          />

          <CoachOptionsSection
            activePlayerSection={activePlayerSection}
            activePlayerTeam={activePlayerTeam}
            canDeleteSessions={canDeleteSessions}
            combinedSessions={combinedSessions}
            filteredPlayers={filteredPlayers}
            isSaving={isSaving}
            onImportPlayers={handleImportPlayers}
            onOpenSession={handleOpenSession}
            onPlayerPageChange={setAvailablePlayerPage}
            onPlayerSelection={handlePlayerSelection}
            onSectionChange={handleSessionFormChange}
            paginatedPlayers={paginatedFilteredPlayers}
            playerPage={availablePlayerPage}
            selectedPlayerIds={selectedPlayerIds}
            selectedSessionAssessmentCount={selectedSessionAssessmentCount}
            selectedSessionId={selectedSessionId}
            selectedSessionLocked={selectedSessionLocked}
            sessions={sessions}
          />
        </div>
      </details>

      <ConfirmModal
        isOpen={Boolean(voiceNoteDeleteTarget)}
        isBusy={Boolean(deletingVoiceNoteId)}
        title="Delete voice note"
        message="This removes the voice note and its audio file from this workspace."
        items={[
          `Voice note: ${voiceNoteDeleteTarget?.note || 'Selected voice note'}`,
          `Created by: ${voiceNoteDeleteTarget?.userName || voiceNoteDeleteTarget?.userEmail || 'Staff'}`,
        ]}
        confirmLabel="Delete voice note"
        onCancel={() => setVoiceNoteDeleteTarget(null)}
        onConfirm={() => void confirmDeleteVoiceNote()}
      />

      <ConfirmModal
        isOpen={Boolean(clearSessionTarget)}
        isBusy={isSaving}
        title="Clear session players"
        message="This keeps the session itself and removes all players from the session list."
        items={[
          `Session: ${clearSessionTarget?.session?.title || clearSessionTarget?.session?.team || 'Selected session'}`,
          `${clearSessionTarget?.playerCount ?? sessionPlayers.length} players from this session list`,
        ]}
        confirmLabel="Clear session"
        onCancel={() => setClearSessionTarget(null)}
        requirePassword
        onConfirm={(password) => void confirmClearSessionPlayers(password)}
      />

      <ConfirmModal
        isOpen={Boolean(deleteSessionTarget)}
        isBusy={isSaving}
        title={(deleteSessionTarget?.assessmentCount ?? 0) > 0 ? 'Remove this session from the calendar?' : 'Delete session'}
        message={
          (deleteSessionTarget?.assessmentCount ?? 0) > 0
            ? "This session has saved player records attached. The player records will stay in each player's history, but the session will no longer appear as an active calendar item."
            : 'This removes the session and the player list.'
        }
        items={[
          `Session: ${deleteSessionTarget?.session?.title || deleteSessionTarget?.session?.team || 'Selected session'}`,
          `Players in session: ${deleteSessionTarget?.playerCount ?? 0}`,
          `Development records linked: ${deleteSessionTarget?.assessmentCount ?? 0}`,
        ]}
        confirmLabel={(deleteSessionTarget?.assessmentCount ?? 0) > 0 ? 'Remove session' : 'Delete session'}
        onCancel={() => setDeleteSessionTarget(null)}
        requirePassword={(deleteSessionTarget?.assessmentCount ?? 0) === 0}
        onConfirm={(password) => void confirmDeleteSession(password)}
      />

      <ConfirmModal
        isOpen={Boolean(completeSessionTarget)}
        isBusy={isSaving}
        title="Complete session"
        message="Coaches will no longer be able to continue editing this session after it is completed."
        itemsTitle="This will change:"
        items={[
          `Session: ${completeSessionTarget?.title || completeSessionTarget?.team || 'Selected session'}`,
          'Session status will change to completed',
          'Managers can still review and correct it later',
        ]}
        confirmLabel="Complete session"
        onCancel={() => setCompleteSessionTarget(null)}
        onConfirm={() => void confirmCompleteSession()}
      />
      <CalendarEventModal
        attachedResources={currentCalendarEventResources}
        currentInvites={currentCalendarEventInvites}
        event={calendarModal?.event}
        form={calendarForm}
        invitePlayers={calendarInvitePlayers}
        isBusy={isSaving}
        isResourcesLoading={isCalendarResourcesLoading}
        isOpen={Boolean(calendarModal)}
        mode={calendarModal?.mode || 'create'}
        onCancel={() => setCalendarModal(null)}
        onChange={handleCalendarFormChange}
        onDelete={handleCalendarDelete}
        onEdit={() => {
          setCalendarModal((current) => ({ ...current, mode: 'edit' }))
        }}
        onOpenWorkflow={() => {
          const href = calendarModal?.event?.href
          setCalendarModal(null)
          navigate(href || '/sessions')
        }}
        onResourceIdsChange={handleCalendarResourceIdsChange}
        onSubmit={handleCalendarSave}
        resourceOptions={calendarResourceOptions}
        selectedInvitePlayers={selectedCalendarInvitePlayers}
        trainingAvailabilitySummary={currentTrainingAvailabilitySummary}
        teams={teams}
        user={user}
        variant={calendarModal?.variant || ''}
      />
    </div>
  )
}

function CalendarAttachedResourcesList({ resources = [] }) {
  if (!Array.isArray(resources) || resources.length === 0) {
    return null
  }

  return (
    <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Attached resources</p>
      <div className="mt-3 grid gap-2">
        {resources.map((resource) => (
          <div key={resource.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3">
            <p className="text-sm font-black text-[#101828]">{resource.title || resource.originalFilename || 'Team resource'}</p>
            <p className="mt-1 text-xs font-bold leading-5 text-[#4b5f55]">
              {getResourceCategoryLabel(resource.category)}
              {resource.originalFilename ? `, ${resource.originalFilename}` : ''}
              {resource.fileSizeBytes ? `, ${formatResourceLibraryFileSize(resource.fileSizeBytes)}` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function CalendarResourceSelector({
  isBusy,
  isLoading,
  onSelectionChange,
  resourceOptions = [],
  selectedResourceIds,
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [draftResourceIds, setDraftResourceIds] = useState(() => [...selectedResourceIds])
  const selectedResources = resourceOptions.filter((resource) => selectedResourceIds.has(String(resource.id)))
  const draftSelectedIds = new Set(draftResourceIds.map(String))
  const filteredResources = resourceOptions.filter((resource) => {
    const matchesCategory = !categoryFilter || resource.category === categoryFilter
    const normalizedSearchTerm = searchTerm.trim().toLowerCase()
    const matchesSearch = !normalizedSearchTerm || [
      resource.title,
      resource.originalFilename,
      resource.description,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedSearchTerm))

    return matchesCategory && matchesSearch
  })

  const openPicker = () => {
    setDraftResourceIds([...selectedResourceIds])
    setIsPickerOpen(true)
  }

  const toggleDraftResource = (resourceId, checked) => {
    setDraftResourceIds((current) => {
      const normalizedResourceId = String(resourceId ?? '').trim()

      if (!normalizedResourceId) {
        return current
      }

      return checked
        ? [...new Set([...current, normalizedResourceId])]
        : current.filter((id) => id !== normalizedResourceId)
    })
  }

  const applySelection = () => {
    onSelectionChange(draftResourceIds)
    setIsPickerOpen(false)
  }

  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-black text-[#101828]">Attached resources</p>
          <p className="mt-1 text-xs font-bold leading-5 text-[#4b5f55]">
            Team Resource Library files from this event team only.
          </p>
        </div>
        <span className="rounded-full border border-[#bbf7d0] bg-white px-3 py-1 text-xs font-black text-[#065f46]">
          {selectedResourceIds.size} selected
        </span>
      </div>

      {isLoading ? (
        <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-bold text-[#4b5f55]">
          Loading team resources.
        </p>
      ) : resourceOptions.length === 0 ? (
        <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-bold text-[#4b5f55]">
          No resources in this team's library yet. Add resources from Team Resources first.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {selectedResources.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedResources.map((resource) => (
                <span
                  key={resource.id}
                  className="inline-flex max-w-full items-center rounded-lg border border-[#bbf7d0] bg-white px-3 py-2 text-xs font-black text-[#065f46]"
                >
                  <span className="truncate">{resource.title || resource.originalFilename || 'Team resource'}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-bold text-[#4b5f55]">
              No resources selected.
            </p>
          )}
          <button
            type="button"
            onClick={openPicker}
            disabled={isBusy}
            className={secondaryButtonClass}
          >
            Choose from Team Resource Library
          </button>
        </div>
      )}

      {isPickerOpen ? (
        <div className="mt-4 rounded-lg border border-[#bbf7d0] bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="block flex-1">
              <span className="mb-2 block text-sm font-black text-[#101828]">Search resources</span>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search by title or filename"
                className={fieldClass}
              />
            </label>
            <label className="block lg:w-56">
              <span className="mb-2 block text-sm font-black text-[#101828]">Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={fieldClass}>
                <option value="">All categories</option>
                {RESOURCE_LIBRARY_CATEGORIES.map((category) => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-black text-[#101828]">{draftSelectedIds.size} selected</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => setIsPickerOpen(false)} disabled={isBusy} className={secondaryButtonClass}>
                Cancel
              </button>
              <button type="button" onClick={applySelection} disabled={isBusy} className={primaryButtonClass}>
                Apply
              </button>
            </div>
          </div>

          {filteredResources.length === 0 ? (
            <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-sm font-bold text-[#4b5f55]">
              No matching team resources.
            </p>
          ) : (
            <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white">
              {filteredResources.map((resource) => {
                const createdLabel = formatResourceDate(resource.createdAt)

                return (
                  <label
                    key={resource.id}
                    className="flex min-h-12 items-start gap-3 border-b border-[#d7e5dc] px-3 py-3 last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      value={resource.id}
                      checked={draftSelectedIds.has(String(resource.id))}
                      onChange={(event) => toggleDraftResource(resource.id, event.target.checked)}
                      disabled={isBusy}
                      className="mt-1 h-5 w-5 accent-[#047857]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-[#101828]">{resource.title || resource.originalFilename || 'Team resource'}</span>
                      <span className="block text-xs font-bold leading-5 text-[#4b5f55]">
                        {getResourceCategoryLabel(resource.category)}
                        {resource.originalFilename ? `, ${resource.originalFilename}` : ''}
                        {resource.fileSizeBytes ? `, ${formatResourceLibraryFileSize(resource.fileSizeBytes)}` : ''}
                        {createdLabel ? `, added ${createdLabel}` : ''}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function CalendarResourceUnavailableNotice() {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
      <p className="text-sm font-black text-[#101828]">Attached resources</p>
      <p className="mt-1 text-xs font-bold leading-5 text-[#4b5f55]">
        Select from Team Resource Library.
      </p>
      <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-bold text-[#4b5f55]">
        Team Resource Library attachments are available for team calendar events in V1. Training sessions and match fixtures stay in their own workflows.
      </p>
    </div>
  )
}

function CalendarRepeatDeleteScope({ isBusy, onChange, value }) {
  return (
    <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] p-4">
      <p className="text-sm font-black leading-6 text-[#101828]">
        This is a repeating event. What do you want to delete?
      </p>
      <label className="mt-3 block">
        <span className="mb-2 block text-sm font-black text-[#101828]">Delete repeat</span>
        <select
          name="deleteRepeatScope"
          value={value || ''}
          onChange={onChange}
          disabled={isBusy}
          className={fieldClass}
        >
          <option value="">Choose delete scope</option>
          <option value="this_event" disabled>This event only is not available in V1</option>
          <option value="this_and_future" disabled>This and future events is not available in V1</option>
          <option value="entire_series">Entire repeat series</option>
        </select>
      </label>
      <p className="mt-2 text-xs font-bold leading-5 text-[#92400e]">
        V1 stores this repeated calendar event as one series record, so deleting can only remove the full series safely.
      </p>
    </div>
  )
}

function getTrainingAvailabilityOccurrenceDate({ event, form } = {}) {
  return formatDateInput(
    event?.occurrenceDate
      || event?.data?.recurrenceOccurrenceDate
      || event?.date
      || form?.date,
  )
}

function getTrainingAvailabilityDetailsForOccurrence(summary, occurrenceDate) {
  const details = Array.isArray(summary?.details) ? summary.details : []
  const normalizedOccurrenceDate = formatDateInput(occurrenceDate)

  if (!normalizedOccurrenceDate) {
    return details
  }

  return details.filter((detail) => formatDateInput(detail.occurrenceDate || detail.occurrenceStartsAt) === normalizedOccurrenceDate)
}

function getTrainingAvailabilityDetailByPlayerId(details = []) {
  return details.reduce((map, detail) => {
    const playerId = String(detail.playerId ?? '').trim()

    if (playerId && !map.has(playerId)) {
      map.set(playerId, detail)
    }

    return map
  }, new Map())
}

function getTrainingAvailabilityChipClasses(tone) {
  if (tone === 'green') {
    return 'border-[#86efac] bg-[#dcfce7] text-[#166534]'
  }

  if (tone === 'red') {
    return 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
  }

  if (tone === 'orange') {
    return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  }

  return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
}

function TrainingAvailabilityPlayerChip({ detail, invite }) {
  const state = detail
    ? {
        label: detail.responseLabel,
        tone: detail.responseTone,
      }
    : getTrainingAvailabilityChipState('pending')
  const playerName = invite.player?.playerName || detail?.playerName || 'Player'
  const statusLabel = state.label || 'No response'
  const title = `${playerName}: ${statusLabel} for this session`

  return (
    <span
      className={`inline-flex max-w-full flex-col rounded-lg border px-3 py-1.5 text-xs font-black ${getTrainingAvailabilityChipClasses(state.tone)}`}
      title={title}
      aria-label={title}
    >
      <span className="truncate">{playerName}</span>
      <span className="mt-0.5 text-[0.62rem] font-black uppercase tracking-[0.12em] opacity-80">{statusLabel}</span>
    </span>
  )
}

function TrainingAvailabilitySummary({ summary }) {
  if (!summary) {
    return null
  }

  const responded = Number(summary.responded ?? 0)
  const sent = Number(summary.sent ?? 0)
  const pending = Number(summary.pending ?? 0)
  const failed = Number(summary.failed ?? 0)

  return (
    <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Assigned availability</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <div>
          <p className="text-lg font-black text-[#101828]">{responded}</p>
          <p className="text-xs font-bold text-[#4b5f55]">responded</p>
        </div>
        <div>
          <p className="text-lg font-black text-[#101828]">{sent}</p>
          <p className="text-xs font-bold text-[#4b5f55]">sent</p>
        </div>
        <div>
          <p className="text-lg font-black text-[#101828]">{pending}</p>
          <p className="text-xs font-bold text-[#4b5f55]">pending</p>
        </div>
        <div>
          <p className="text-lg font-black text-[#101828]">{failed}</p>
          <p className="text-xs font-bold text-[#4b5f55]">failed</p>
        </div>
      </div>
      {responded > 0 ? (
        <p className="mt-3 text-xs font-bold leading-5 text-[#4b5f55]">
          Available {summary.available || 0}, not available {summary.unavailable || 0}, maybe {summary.maybe || 0}.
        </p>
      ) : null}
    </div>
  )
}

function TrainingAvailabilityParentNotes({ details = [] }) {
  const notedDetails = details.filter((detail) => String(detail.note ?? '').trim())

  if (notedDetails.length === 0) {
    return null
  }

  return (
    <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Parent notes</p>
      <div className="mt-3 space-y-3">
        {notedDetails.map((detail) => (
          <div key={`${detail.requestPlayerId || detail.playerId}:${detail.respondedAt || detail.note}`} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <p className="text-sm font-black text-[#101828]">{detail.playerName || 'Player'}</p>
              <span className={`w-fit rounded-full border px-2 py-0.5 text-[0.62rem] font-black uppercase tracking-[0.12em] ${getTrainingAvailabilityChipClasses(detail.responseTone)}`}>
                {detail.responseLabel || 'No response'}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{detail.note}</p>
            {detail.respondedByName ? (
              <p className="mt-2 text-xs font-bold text-[#6d8076]">Submitted by {detail.respondedByName}</p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function TrainingAvailabilitySettings({ form, isBusy, onChange }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
      <div className="grid gap-4 md:grid-cols-[1fr_12rem]">
        <label className="flex min-h-12 items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
          <input
            type="checkbox"
            name="requestTrainingAvailability"
            checked={form.requestTrainingAvailability === true}
            onChange={onChange}
            disabled={isBusy}
            className="mt-1 h-5 w-5 accent-[#047857]"
          />
          <span>
            Request player availability from parents?
            <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
              Sends parent email requests for players in this team only.
            </span>
          </span>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-black text-[#101828]">Send days before</span>
          <input
            name="trainingAvailabilitySendDaysBefore"
            type="number"
            min="0"
            max="30"
            value={form.trainingAvailabilitySendDaysBefore ?? 2}
            onChange={onChange}
            disabled={isBusy || form.requestTrainingAvailability !== true}
            className={fieldClass}
          />
        </label>
      </div>
      <p className="mt-3 text-xs font-bold leading-5 text-[#4b5f55]">
        For repeating training, this applies separately to each occurrence.
      </p>
    </div>
  )
}

function CalendarEventModal({
  attachedResources = [],
  clubWideOnly = false,
  currentInvites = [],
  event,
  form,
  invitePlayers = [],
  isBusy,
  isResourcesLoading = false,
  isOpen,
  mode,
  onCancel,
  onChange,
  onDelete,
  onEdit,
  onOpenWorkflow,
  onResourceIdsChange,
  onSubmit,
  resourceOptions = [],
  selectedInvitePlayers = [],
  trainingAvailabilitySummary = null,
  teams,
  user,
  variant = '',
}) {
  if (!isOpen) {
    return null
  }

  const isEditing = mode !== 'view'
  const editableSource = !event || event.editable !== false
  const isInheritedClubEvent = Boolean(event?.isInheritedClubEvent || event?.data?.isInheritedClubEvent)
  const showOpponent = form.eventType === 'match'
  const isMatchFixture = form.eventType === 'match'
  const showRecurrence = form.eventType !== 'match'
  const isSessionCreate = mode === 'create' && variant === 'session'
  const title = isSessionCreate ? 'Create session' : mode === 'create' ? 'Add calendar event' : mode === 'edit' ? 'Edit calendar event' : 'Calendar event'
  const selectedSummary = isMatchFixture
    ? [form.date, form.startTime ? `Kick-off ${form.startTime}` : '', form.location].filter(Boolean).join(', ')
    : [form.date, form.startTime, form.location].filter(Boolean).join(', ')
  const canUseClubLevel = canCreateClubCalendarEvent(user)
  const safeFormTeamId = clubWideOnly ? '' : getSafeCalendarTeamId(user, form.teamId)
  const canShareClubWideWithParents = isClubWideShareableCalendarEvent({ form, safeTeamId: safeFormTeamId, user })
  const showInvites = !canShareClubWideWithParents && form.shareWithParents && form.parentAudience === 'involved_players'
  const canShowTeamResourceArea = Boolean(!isSessionCreate && !clubWideOnly && safeFormTeamId && canManageResourceLibrary(user))
  const canUseCalendarResourceLinks = Boolean((!event || event.sourceType === 'calendar') && isCalendarResourceEventType(form.eventType))
  const canAttachResources = canShowTeamResourceArea && canUseCalendarResourceLinks
  const canShowTrainingAvailability = Boolean(!isSessionCreate && !clubWideOnly && safeFormTeamId && form.eventType === 'training' && (!event || event.sourceType === 'calendar'))
  const selectedResourceIds = new Set(Array.isArray(form.resourceIds) ? form.resourceIds.map(String) : [])
  const isRecurringCalendarEdit = isRecurringCalendarEvent({ event, form })
  const repeatUpdateScopeRequired = hasRecurringCalendarDateTimeChange({ event, form })
  const showRepeatUpdateScope = isRecurringCalendarEdit
  const showRepeatDeleteScope = Boolean(event && editableSource && isRecurringCalendarEdit)
  const deleteButtonDisabled = isBusy || (showRepeatDeleteScope && form.deleteRepeatScope !== 'entire_series')
  const squadPlayers = invitePlayers.filter((player) => String(player.section ?? '').trim().toLowerCase() === 'squad')
  const trialPlayers = invitePlayers.filter((player) => String(player.section ?? '').trim().toLowerCase() === 'trial')
  const invitedPlayerIds = new Set(Array.isArray(form.invitedPlayerIds) ? form.invitedPlayerIds.map(String) : [])
  const inviteTeamId = canUseClubLevel ? form.teamId : form.teamId || user?.activeTeamId
  const hasInviteTeam = Boolean(String(inviteTeamId || '').trim())
  const availabilityOccurrenceDate = getTrainingAvailabilityOccurrenceDate({ event, form })
  const trainingAvailabilityDetails = getTrainingAvailabilityDetailsForOccurrence(trainingAvailabilitySummary, availabilityOccurrenceDate)
  const trainingAvailabilityDetailsByPlayerId = getTrainingAvailabilityDetailByPlayerId(trainingAvailabilityDetails)
  const eventTypeOptions = getCalendarEventTypeOptions(user, { clubWideOnly })
  const parentAudienceOptions = [
    { value: 'involved_players', label: 'Only parents of involved players' },
    ...(hasInviteTeam ? [{ value: 'all_team_parents', label: 'All parents in the team' }] : []),
    ...(canUseClubLevel ? [{ value: 'all_club_parents', label: 'All parents in the club' }] : []),
  ]

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center overflow-hidden bg-[#101828]/45 px-3 py-3 sm:items-center sm:px-4 sm:py-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[#d7e5dc] bg-white shadow-xl shadow-[#047857]/15 sm:max-h-[calc(100vh-2rem)]"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Close calendar event"
        >
          X
        </button>
        <div className="shrink-0 border-b border-[#d7e5dc] px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <p className={eyebrowClass}>Calendar</p>
          <h2 className="mt-3 pr-12 text-2xl font-black tracking-tight text-[#101828]">{title}</h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            {isSessionCreate
              ? 'Create a training or match session with time, location, notes, repeats, and player invites.'
              : 'Add, move, edit, or cancel football activity from one place.'}
          </p>
          {isInheritedClubEvent ? (
            <p className="mt-4 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black text-[#065f46]">
              This is a club-wide event managed by the Club Admin.
            </p>
          ) : null}
        </div>

        {!isEditing ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{event?.sourceType || 'event'}</p>
            <h3 className="mt-2 text-xl font-black text-[#101828]">{event?.title || form.title || 'Calendar event'}</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
              {selectedSummary || event?.description || 'Calendar activity'}
            </p>
            {form.notes ? <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{form.notes}</p> : null}
            {isMatchFixture ? (
              <div className="mt-4 grid gap-3 rounded-lg border border-[#d7e5dc] bg-white p-3 sm:grid-cols-2">
                {form.arrivalTime ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Arrival time</p>
                    <p className="mt-1 text-sm font-black text-[#101828]">{form.arrivalTime}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Kick-off time</p>
                  <p className="mt-1 text-sm font-black text-[#101828]">{form.startTime || 'Not set'}</p>
                </div>
                {form.opponent ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Opponent</p>
                    <p className="mt-1 text-sm font-black text-[#101828]">{form.opponent}</p>
                  </div>
                ) : null}
                {form.location ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Location</p>
                    <p className="mt-1 text-sm font-black text-[#101828]">{form.location}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {currentInvites.length > 0 ? (
              <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Invited players</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {currentInvites.map((invite) => {
                    const detail = trainingAvailabilityDetailsByPlayerId.get(String(invite.playerId ?? ''))

                    return (
                      <TrainingAvailabilityPlayerChip
                        key={invite.id}
                        detail={detail}
                        invite={invite}
                      />
                    )
                  })}
                </div>
              </div>
            ) : null}
            {form.eventType === 'training' ? <TrainingAvailabilitySummary summary={trainingAvailabilitySummary} /> : null}
            {form.eventType === 'training' ? <TrainingAvailabilityParentNotes details={trainingAvailabilityDetails} /> : null}
            <CalendarAttachedResourcesList resources={attachedResources} />
            {showRepeatDeleteScope ? (
              <div className="mt-4">
                <CalendarRepeatDeleteScope
                  isBusy={isBusy}
                  onChange={onChange}
                  value={form.deleteRepeatScope}
                />
              </div>
            ) : null}
          </div>
          </div>
        ) : null}

        {isEditing ? (
          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-32 px-5 py-5 sm:px-6">
            <div className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Type</span>
                <select
                  name="eventType"
                  value={form.eventType}
                  onChange={onChange}
                  disabled={isBusy || Boolean(event && event.sourceType !== 'calendar')}
                  className={fieldClass}
                >
                  {eventTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              {clubWideOnly ? (
                <div className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Scope</span>
                  <div className={`${fieldClass} flex items-center`}>Club level</div>
                  <span className="mt-2 block text-xs font-bold leading-5 text-[#4b5f55]">
                    Club Admin calendar events are shared across the club and are not tied to one team.
                  </span>
                </div>
              ) : (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Team</span>
                  <select name="teamId" value={form.teamId} onChange={onChange} disabled={isBusy} className={fieldClass}>
                    {canUseClubLevel ? <option value="">Club level</option> : null}
                    {!canUseClubLevel && !form.teamId ? <option value="">Choose team</option> : null}
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                  {!canUseClubLevel ? (
                    <span className="mt-2 block text-xs font-bold leading-5 text-[#4b5f55]">
                      Team staff can only save events against their assigned team.
                    </span>
                  ) : null}
                </label>
              )}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Title</span>
              <input
                name="title"
                value={form.title}
                onChange={onChange}
                placeholder={form.eventType === 'training' ? 'Example: U12 training' : 'Example: Parent response deadline'}
                className={fieldClass}
              />
            </label>

            {showOpponent ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Opponent</span>
                <input name="opponent" value={form.opponent} onChange={onChange} placeholder="Example: Riverside Juniors" className={fieldClass} />
              </label>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Date</span>
                <input name="date" type="date" min={isMatchFixture ? getTodayMatchDayDateValue() : undefined} value={form.date} onChange={onChange} required className={fieldClass} />
              </label>
              {isMatchFixture ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Arrival time</span>
                  <input name="arrivalTime" type="time" value={form.arrivalTime} onChange={onChange} className={fieldClass} />
                </label>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">{isMatchFixture ? 'Kick-off time' : 'Start time'}</span>
                <input name="startTime" type="time" value={form.startTime} onChange={onChange} required className={fieldClass} />
              </label>
              {!isMatchFixture ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">End time</span>
                  <input name="endTime" type="time" value={form.endTime} onChange={onChange} className={fieldClass} />
                </label>
              ) : null}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Location</span>
              <input name="location" value={form.location} onChange={onChange} placeholder="Pitch, venue, or meeting point" className={fieldClass} />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Notes</span>
              <textarea name="notes" value={form.notes} onChange={onChange} rows={4} className={fieldClass} />
            </label>

            {showRecurrence ? (
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Repeats</span>
                    <select name="recurrenceFrequency" value={form.recurrenceFrequency} onChange={onChange} className={fieldClass}>
                      {RECURRENCE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">Repeat until</span>
                    <input
                      name="recurrenceUntil"
                      type="date"
                      value={form.recurrenceUntil}
                      onChange={onChange}
                      disabled={form.recurrenceFrequency === 'none'}
                      required={form.recurrenceFrequency !== 'none'}
                      className={fieldClass}
                    />
                  </label>
                </div>
                <p className="mt-3 text-xs font-bold leading-5 text-[#4b5f55]">
                  {isSessionCreate
                    ? 'Recurring training creates separate session rows. Calendar events repeat on the calendar and are edited from this event.'
                    : 'Repeating calendar events are stored as one series record and are edited from this event.'}
                </p>
                {showRepeatUpdateScope ? (
                  <div className="mt-4 rounded-lg border border-[#fedf89] bg-white p-3">
                    <p className="mb-3 text-sm font-black leading-6 text-[#101828]">
                      This is a repeating event. How should this date/time change be applied?
                    </p>
                    <label className="block">
                      <span className="mb-2 block text-sm font-black text-[#101828]">Update repeat</span>
                      <select
                        name="repeatUpdateScope"
                        value={form.repeatUpdateScope || ''}
                        onChange={onChange}
                        required={repeatUpdateScopeRequired}
                        disabled={isBusy}
                        className={fieldClass}
                      >
                        <option value="">Choose update scope</option>
                        <option value="this_event" disabled>This event only is not available in V1</option>
                        <option value="this_and_future" disabled>This and future events is not available in V1</option>
                        <option value="entire_series">Entire repeat series</option>
                      </select>
                    </label>
                    <p className="mt-2 text-xs font-bold leading-5 text-[#92400e]">
                      V1 stores this repeated custom event as one series record, so date and time edits can only update the full series safely.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <p className="text-sm font-black text-[#101828]">Repeats</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
                  Recurring fixtures are not supported yet.
                </p>
              </div>
            )}

            {canShowTrainingAvailability ? (
              <TrainingAvailabilitySettings
                form={form}
                isBusy={isBusy}
                onChange={onChange}
              />
            ) : null}

            {canShowTeamResourceArea ? (
              canAttachResources ? (
                <CalendarResourceSelector
                  isBusy={isBusy}
                  isLoading={isResourcesLoading}
                  onSelectionChange={onResourceIdsChange}
                  resourceOptions={resourceOptions}
                  selectedResourceIds={selectedResourceIds}
                />
              ) : (
                <CalendarResourceUnavailableNotice />
              )
            ) : null}

            {showRepeatDeleteScope ? (
              <CalendarRepeatDeleteScope
                isBusy={isBusy}
                onChange={onChange}
                value={form.deleteRepeatScope}
              />
            ) : null}

            {canShareClubWideWithParents ? (
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="shareWithParents"
                    checked={form.shareWithParents}
                    onChange={onChange}
                    disabled={isBusy}
                    className="mt-1 h-5 w-5 accent-[#047857]"
                  />
                  <span>
                    <span className="block text-sm font-black text-[#101828]">Share with parents</span>
                    <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                      Parents will see this event in their Parent Portal calendar.
                    </span>
                  </span>
                </label>
              </div>
            ) : (
            <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Share with parents?</span>
                  <select
                    name="shareWithParents"
                    value={form.shareWithParents ? 'yes' : 'no'}
                    onChange={(event) => onChange({
                      target: {
                        checked: event.target.value === 'yes',
                        name: 'shareWithParents',
                        type: 'checkbox',
                        value: event.target.value,
                      },
                    })}
                    disabled={isBusy}
                    className={fieldClass}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Parent audience</span>
                  <select
                    name="parentAudience"
                    value={form.shareWithParents ? form.parentAudience : 'none'}
                    onChange={onChange}
                    disabled={isBusy || !form.shareWithParents}
                    className={fieldClass}
                  >
                    <option value="none">Not shared</option>
                    {parentAudienceOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
              {form.shareWithParents && form.parentAudience === 'involved_players' ? (
                <p className="mt-3 rounded-lg border border-[#fedf89] bg-white px-3 py-3 text-xs font-bold leading-5 text-[#92400e]">
                  Only involved players fails closed unless at least one player is attached below.
                </p>
              ) : null}
              {form.shareWithParents && form.parentAudience === 'all_team_parents' && hasInviteTeam ? (
                <label className="mt-4 flex min-h-12 items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                  <input
                    type="checkbox"
                    name="notifyInvitedFamilies"
                    checked={form.notifyInvitedFamilies}
                    onChange={onChange}
                    disabled={isBusy}
                    className="mt-1 h-5 w-5 accent-[#047857]"
                  />
                  <span>
                    Notify team families
                    <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                      Adds an event invite email to the holding queue for linked parents in this team.
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
            )}

            {showInvites ? (
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-black text-[#101828]">Involved players</p>
                    <p className="mt-1 text-xs font-bold leading-5 text-[#4b5f55]">
                      These player records define which parents can see the event when the audience is limited to involved players.
                    </p>
                  </div>
                  <span className="rounded-full border border-[#bbf7d0] bg-white px-3 py-1 text-xs font-black text-[#065f46]">
                    {selectedInvitePlayers.length} selected
                  </span>
                </div>

                {!hasInviteTeam ? (
                  <p className="mt-4 rounded-lg border border-[#fedf89] bg-[#fffaeb] px-3 py-3 text-sm font-bold text-[#92400e]">
                    Choose a team before inviting players. Club level events can be saved without invites.
                  </p>
                ) : invitePlayers.length === 0 ? (
                  <p className="mt-4 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-bold text-[#4b5f55]">
                    No active players are available for this team yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                        <input
                          type="checkbox"
                          name="inviteWholeSquad"
                          checked={form.inviteWholeSquad}
                          onChange={onChange}
                          disabled={isBusy || squadPlayers.length === 0}
                          className="h-5 w-5 accent-[#047857]"
                        />
                        Whole squad
                      </label>
                      <label className="flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                        <input
                          type="checkbox"
                          name="inviteTrialPlayers"
                          checked={form.inviteTrialPlayers}
                          onChange={onChange}
                          disabled={isBusy || trialPlayers.length === 0}
                          className="h-5 w-5 accent-[#047857]"
                        />
                        Include trial players
                      </label>
                    </div>

                    <div className="max-h-64 overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white">
                      {invitePlayers.map((player) => (
                        <label
                          key={player.id}
                          className="flex min-h-12 items-start gap-3 border-b border-[#d7e5dc] px-3 py-3 last:border-b-0"
                        >
                          <input
                            type="checkbox"
                            name="invitedPlayerIds"
                            value={player.id}
                            checked={invitedPlayerIds.has(String(player.id))}
                            onChange={onChange}
                            disabled={isBusy}
                            className="mt-1 h-5 w-5 accent-[#047857]"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-black text-[#101828]">{player.playerName}</span>
                            <span className="block text-xs font-bold text-[#4b5f55]">
                              {player.section || 'Player'}{player.parentEmail ? `, family email on file` : ', no family email on file'}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <label className="flex min-h-12 items-start gap-3 rounded-lg border border-[#d7e5dc] bg-white px-3 py-3 text-sm font-black text-[#101828]">
                      <input
                        type="checkbox"
                        name="notifyInvitedFamilies"
                        checked={form.notifyInvitedFamilies}
                        onChange={onChange}
                        disabled={isBusy}
                        className="mt-1 h-5 w-5 accent-[#047857]"
                      />
                      <span>
                        Notify invited families
                        <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                          Saves the invite and adds a parent email to the holding queue for review before send time.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            ) : null}
            </div>
            </div>

            <div className="shrink-0 flex flex-col-reverse gap-3 border-t border-[#d7e5dc] bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                {event?.href ? <button type="button" onClick={onOpenWorkflow} className={secondaryButtonClass}>Open item</button> : null}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                {event && editableSource ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleteButtonDisabled}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {event.sourceType === 'match-day' ? 'Cancel fixture' : 'Delete event'}
                  </button>
                ) : null}
                <button type="button" onClick={onCancel} disabled={isBusy} className={secondaryButtonClass}>Cancel</button>
                <button type="submit" disabled={isBusy} className={primaryButtonClass}>{isBusy ? 'Saving...' : 'Save changes'}</button>
              </div>
            </div>
          </form>
        ) : (
          <div className="shrink-0 flex flex-col-reverse gap-3 border-t border-[#d7e5dc] bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {event?.href ? <button type="button" onClick={onOpenWorkflow} className={secondaryButtonClass}>Open item</button> : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              {event && editableSource ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={deleteButtonDisabled}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {event.sourceType === 'match-day' ? 'Cancel fixture' : 'Delete event'}
                </button>
              ) : null}
              {editableSource ? <button type="button" onClick={onEdit} className={secondaryButtonClass}>Edit event</button> : null}
              {editableSource ? <button type="button" onClick={onEdit} className={primaryButtonClass}>Move or reschedule</button> : null}
              <button type="button" onClick={onCancel} className={secondaryButtonClass}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MatchdayFocus({
  assessedPlayerCount,
  isLoading,
  onAssessAll,
  onOpenCreateSession,
  onOpenSessionSetup,
  selectedSession,
  selectedSessionCompleted,
  selectedSessionLocked,
  sessionPlayers,
  unassessedPlayerCount,
}) {
  const hasSession = Boolean(selectedSession)
  const hasPlayers = sessionPlayers.length > 0
  const progressLabel = hasPlayers
    ? `${assessedPlayerCount} of ${sessionPlayers.length} recorded`
    : 'No players added yet'
  const nextActionLabel = !hasSession
    ? 'Set up session'
    : !hasPlayers
      ? 'Add players'
      : unassessedPlayerCount > 0
        ? assessedPlayerCount > 0 ? 'Continue records' : 'Start records'
        : 'Review completed session'

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#101828]/5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className={eyebrowClass}>
            Live session
          </p>
          <h3 className="mt-2 break-words text-3xl font-black tracking-tight text-[#101828] sm:text-4xl">
            {selectedSession?.title || selectedSession?.team || 'Get the next session ready'}
          </h3>
          <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-[#101828]">
              {progressLabel}
            </span>
            {selectedSessionCompleted ? (
              <span className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-1 text-[#065f46]">Completed</span>
            ) : (
              <span className="rounded-lg border border-[#bbf7d0] bg-[#dcfce7] px-3 py-1 text-[#166534]">Open</span>
            )}
          </div>
          <p className={`mt-3 max-w-2xl ${bodyTextClass}`}>
            Keep this screen open during training or a match. Add notes quickly, then work through the player queue without leaving the football context.
          </p>
        </div>

        <div className="grid gap-3 sm:min-w-56">
          {hasSession && hasPlayers && unassessedPlayerCount > 0 ? (
            <button
              type="button"
              onClick={onAssessAll}
              disabled={isLoading || selectedSessionLocked}
              title={
                isLoading
                  ? 'Please wait while the session loads.'
                  : selectedSessionLocked
                    ? 'This session is completed, so development records cannot be started from here.'
                    : undefined
              }
              className={primaryButtonClass}
            >
              {nextActionLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={hasSession ? onOpenSessionSetup : onOpenCreateSession}
              disabled={isLoading}
              title={isLoading ? 'Please wait while the session loads.' : undefined}
              className={primaryButtonClass}
            >
              {nextActionLabel}
            </button>
          )}
          {hasSession ? (
            <button
              type="button"
              onClick={onOpenSessionSetup}
              className={secondaryButtonClass}
            >
              Session setup
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function SessionMetric({ isLoading, label, value }) {
  return (
    <div className="rounded-lg border border-[#bbf7d0] bg-white px-3 py-3 shadow-sm shadow-[#065f46]/10">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#065f46]">{label}</p>
      <p className="mt-2 text-2xl font-black text-[#101828]">{isLoading ? '...' : value}</p>
    </div>
  )
}

function SessionSummaryCard({ caption, isLoading, label, value }) {
  return (
    <article className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#101828]/5">
      <p className={eyebrowClass}>{label}</p>
      <p className="mt-3 text-4xl font-black tracking-tight text-[#101828]">{isLoading ? '...' : value}</p>
      <p className={`mt-2 ${bodyTextClass}`}>{caption}</p>
    </article>
  )
}
