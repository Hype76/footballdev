import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../components/ui/ConfirmModal.jsx'
import { CoachOptionsSection } from '../components/sessions/CoachOptionsSection.jsx'
import { CreateSessionSection } from '../components/sessions/CreateSessionSection.jsx'
import {
  EventResponseManagerDialog,
  EventResponseSummary,
} from '../components/sessions/EventResponseManager.jsx'
import { FootballCalendar } from '../components/sessions/FootballCalendar.jsx'
import { OpenSessionsSection } from '../components/sessions/OpenSessionsSection.jsx'
import { PreviousSessionsWorkspace } from '../components/sessions/PreviousSessionsWorkspace.jsx'
import { SessionPlayersSection } from '../components/sessions/SessionPlayersSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { MobileActionDock } from '../components/ui/MobileActionDock.jsx'
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
import {
  commitCalendarChangeNotification,
  prepareCalendarChangeNotification,
} from '../lib/calendar-change-notifications.js'
import { getMatchDayDisplayName } from '../lib/matchday-display.js'
import { buildEventResponsePlayerNavigation } from '../lib/domain/player-profile-navigation.js'
import { getManageableEventPlayerIds } from '../lib/domain/event-player-selection.js'
import {
  assertValidMatchDayFixtureType,
  MATCH_DAY_FIXTURE_TYPE_OPTIONS,
} from '../lib/matchday-fixture-type.js'
import { openMatchDayFixtureSetup } from '../lib/matchday-workflow.js'
import { isRecoveryModuleVisible } from '../lib/recovery-phase.js'
import {
  addPlayersToAssessmentSession,
  acceptEventPlayerAvailabilityOnBehalf,
  markEventPlayerUnavailableOnBehalf,
  clearAssessmentSessionPlayers,
  completeAssessmentSession,
  cancelPendingTrainingAvailabilityRequests,
  createCalendarEvent,
  createAssessmentReminderOnce,
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
  getEventResponseEvidenceForEvent,
  getDefaultTrainingAvailabilityForm,
  getMatchDay,
  getMatchDays,
  getPolls,
  getResourceLibraryDownloadUrl,
  getResourceLibraryItems,
  getTrainingAvailabilitySettingsForEvents,
  getTrainingAvailabilitySummaryForEvents,
  getTodayMatchDayDateValue,
  MATCH_DAY_HOME_AWAY_OPTIONS,
  MATCH_DAY_SHIRT_CHOICE_OPTIONS,
  getAssessmentSessionPlayers,
  getAssessmentSessions,
  getAvailableTeamsForUser,
  getEventPlayerCommunicationMissingIds,
  getEventPlayerCommunicationRecipientCount,
  getEventPlayerManagementLabel,
  getSessionStaffNotes,
  getPlayers,
  notifyCalendarEventParents,
  previewEventPlayerChanges,
  readViewCache,
  readViewCacheValue,
  applyEventPlayerChanges,
  EVENT_PLAYER_COMMUNICATION_MODES,
  EVENT_PLAYER_REMOVAL_SCOPES,
  previewEventPlayerRemoval,
  removePlayerFromEvent,
  saveCalendarEventInvites,
  saveTrainingAvailabilitySettings,
  sendEventPlayerInvitationAction,
  setMatchDayPlayerSquadDecision,
  syncCalendarEventResourceLinks,
  syncCalendarEventParentScope,
  updateCalendarEvent,
  updateAssessmentSession,
  updateMatchDay,
  updateTeamNotificationDisplayName,
  isPastMatchDayDate,
  withRequestTimeout,
  writeViewCache,
  buildEventResponseReadModel,
} from '../lib/supabase.js'
import {
  deriveTeamNotificationDisplayName,
  resolveTeamNotificationDisplayName,
} from '../lib/team-notification-display.js'
import { createScheduledEmail } from '../lib/domain/scheduled-emails.js'
import {
  applyTrialPlayerSelection,
  applyWholeSquadSelection,
  getSelectedInvitePlayers,
  getWholeSquadSelectionState,
} from '../lib/domain/calendar-invite-scope.js'
import { getCalendarNotificationToast } from '../lib/domain/calendar-notification-status.js'
import { buildCalendarNotificationHtml } from '../lib/calendar-notification-email.js'
import {
  addMinutesToRequiredTime,
  buildRequiredLocalDateTime,
  validateFixtureDateTime,
  validateOrdinaryEventDateTime,
} from '../lib/calendar-datetime-integrity.js'

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#065f46]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#4b5f55]'
const primaryButtonClass = 'inline-flex min-h-14 items-center justify-center rounded-lg bg-[#047857] px-5 py-4 text-base font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const compactPrimaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-2.5 text-sm font-black text-white shadow-sm shadow-[#047857]/20 transition hover:bg-[#065f46] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-60'
const compactSecondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-2.5 text-sm font-black text-[#101828] shadow-sm shadow-[#101828]/5 transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-60'
const calendarModalViewportBaseStyle = {
  '--calendar-modal-viewport-height': '100dvh',
  '--calendar-modal-viewport-top': '0px',
}
const EVENT_TYPE_OPTIONS = [
  { value: 'training', label: 'Training session' },
  { value: 'match', label: 'Match or fixture' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'social', label: 'Social event' },
  { value: 'general', label: 'General club or team event', clubOnlyLabel: 'Team event' },
  { value: 'other', label: 'Other event' },
]
const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
]

function useCalendarModalPageScrollLock(isLocked) {
  useEffect(() => {
    if (!isLocked || typeof document === 'undefined' || typeof window === 'undefined') {
      return undefined
    }

    const scrollY = window.scrollY || 0
    const { body, documentElement } = document
    const previousBodyStyle = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    }
    const previousOverscrollBehavior = documentElement.style.overscrollBehavior

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    documentElement.style.overscrollBehavior = 'none'

    return () => {
      body.style.overflow = previousBodyStyle.overflow
      body.style.position = previousBodyStyle.position
      body.style.top = previousBodyStyle.top
      body.style.width = previousBodyStyle.width
      documentElement.style.overscrollBehavior = previousOverscrollBehavior
      window.scrollTo(0, scrollY)
    }
  }, [isLocked])
}

function useCalendarModalViewportStyle(isOpen) {
  const [viewportStyle, setViewportStyle] = useState(calendarModalViewportBaseStyle)

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return undefined
    }

    const updateViewportStyle = () => {
      const visualViewport = window.visualViewport
      const viewportHeight = Math.max(320, Math.round(visualViewport?.height || window.innerHeight || 0))
      const viewportTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0))

      setViewportStyle({
        '--calendar-modal-viewport-height': `${viewportHeight}px`,
        '--calendar-modal-viewport-top': `${viewportTop}px`,
      })
    }

    updateViewportStyle()
    window.addEventListener('resize', updateViewportStyle)
    window.visualViewport?.addEventListener('resize', updateViewportStyle)
    window.visualViewport?.addEventListener('scroll', updateViewportStyle)

    return () => {
      window.removeEventListener('resize', updateViewportStyle)
      window.visualViewport?.removeEventListener('resize', updateViewportStyle)
      window.visualViewport?.removeEventListener('scroll', updateViewportStyle)
    }
  }, [isOpen])

  return viewportStyle
}

function getModalFocusableElements(root) {
  if (!root) {
    return []
  }

  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true')
}

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

function getCalendarResourceOccurrenceDate(event, form) {
  return formatDateInput(event?.occurrenceDate || event?.data?.recurrenceOccurrenceDate || event?.startsAt || form?.date)
}

function getCalendarResourceOccurrenceKey(eventId, occurrenceDate) {
  const normalizedEventId = String(eventId ?? '').trim()
  const normalizedOccurrenceDate = formatDateInput(occurrenceDate)
  return normalizedEventId && normalizedOccurrenceDate ? `${normalizedEventId}:${normalizedOccurrenceDate}` : ''
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
  return buildRequiredLocalDateTime(formatDateInput(date), formatTimeInput(time))
}

function addMinutesToTime(time, minutesToAdd) {
  return addMinutesToRequiredTime(formatTimeInput(time), minutesToAdd)
}

function isTimeAfter(leftTime, rightTime) {
  const leftValue = formatTimeInput(leftTime)
  const rightValue = formatTimeInput(rightTime)

  if (!leftValue || !rightValue) {
    return false
  }

  return leftValue > rightValue
}

function createNotificationRequestToken() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }

  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    return ''
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

function getDefaultCalendarForm(date = '') {
  const eventDate = formatDateInput(date)

  return {
    arrivalTime: '',
    autoSelectAvailablePlayers: true,
    date: eventDate,
    endTime: '',
    eventType: 'training',
    fixtureType: '',
    homeAway: 'home',
    invitedPlayerIds: [],
    inviteTrialPlayers: false,
    inviteWholeSquad: false,
    location: '',
    notes: '',
    notifyInvitedFamilies: false,
    notificationRequestToken: '',
    notificationTeamName: '',
    opponent: '',
    kickoffTimeTbc: false,
    shirtChoice: 'home',
    parentAudience: 'involved_players',
    deleteRepeatScope: '',
    repeatUpdateScope: '',
    resourceIds: [],
    shareWithParents: false,
    recurrenceFrequency: 'none',
    recurrenceUntil: '',
    ...getDefaultTrainingAvailabilityForm('training'),
    startTime: '',
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
    throw calendarValidationError('recurrenceUntil', 'Add a repeat until date for recurring events.')
  }

  const startDate = new Date(`${startDateValue}T00:00:00`)
  const untilDate = new Date(`${untilDateValue}T23:59:59`)

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(untilDate.getTime())) {
    throw calendarValidationError('recurrenceUntil', 'Use a valid repeat until date.')
  }

  if (untilDate.getTime() < startDate.getTime()) {
    throw calendarValidationError('recurrenceUntil', 'Repeat until must be after the first event date.')
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
    throw calendarValidationError('recurrenceUntil', 'Recurring events are limited to 52 dates. Shorten the repeat range and try again.')
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
  return ['general', 'training', 'match', 'meeting', 'tournament', 'social', 'other'].includes(getTrimmedFormValue(eventType))
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

function hasCalendarDateTimeChange({ event, form } = {}) {
  if (!event?.sourceId) return false
  if (event.sourceType === 'assessment-reminder') {
    return formatDateInput(event?.data?.reminder?.metadata?.dueDate || event.date) !== formatDateInput(form?.date)
  }
  const source = event.data || {}
  const sourceDate = event.sourceType === 'match-day'
    ? formatDateInput(source.matchDate || event.date)
    : event.sourceType === 'session'
      ? formatDateInput(source.sessionDate || event.date)
      : formatDateInput(source.startsAt || event.date)
  const sourceStartTime = event.sourceType === 'match-day'
    ? formatTimeInput(source.kickoffTime)
    : event.sourceType === 'session'
      ? formatTimeInput(source.startTime)
      : formatTimeInput(source.startsAt)
  const sourceEndTime = event.sourceType === 'session'
    ? formatTimeInput(source.endTime)
    : event.sourceType === 'calendar'
      ? formatTimeInput(source.endsAt)
      : formatTimeInput(form?.endTime)
  return sourceDate !== formatDateInput(form?.date)
    || sourceStartTime !== formatTimeInput(form?.startTime)
    || (event.sourceType !== 'match-day' && sourceEndTime !== formatTimeInput(form?.endTime))
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
  if (form?.eventType === 'training' && form?.requestTrainingAvailability === true) {
    return {
      parentAudience: 'involved_players',
      parentVisible: true,
    }
  }

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

function calendarValidationError(fieldName, message) {
  return Object.assign(new Error(message), { fieldName })
}

function buildCalendarEventInviteEmailHtml({
  clubLogoUrl,
  clubName,
  eventTitle,
  eventType,
  location,
  notes,
  parentName,
  playerName,
  startsAtLabel,
  teamName,
  themeAccent,
}) {
  return buildCalendarNotificationHtml({
    clubLogoUrl,
    clubName,
    eventTitle,
    eventType,
    location,
    notes,
    parentName,
    playerName,
    startsAt: startsAtLabel,
    teamName,
    themeAccent,
  })
}

function getEventInviteScheduledAt() {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString()
}

function validateCalendarForm({ form, safeTeamId, sourceType, user }) {
  const eventType = getTrimmedFormValue(form.eventType)
  const title = getTrimmedFormValue(form.title)
  const opponent = getTrimmedFormValue(form.opponent)
  const date = formatDateInput(form.date)
  const isMatch = eventType === 'match'
  const isTraining = eventType === 'training'
  const requiresTeam = !canCreateClubCalendarEvent(user) || isMatch || isTraining || Boolean(safeTeamId)

  if (!eventType) {
    throw calendarValidationError('eventType', 'Choose an event type.')
  }

  if (!date) {
    throw calendarValidationError('date', isMatch ? 'Enter a match date.' : 'Enter an event date.')
  }

  if (requiresTeam && !safeTeamId) {
    throw calendarValidationError('teamId', 'Choose a team for this event.')
  }

  if (isMatch) {
    try {
      assertValidMatchDayFixtureType(form.fixtureType)
    } catch (error) {
      throw calendarValidationError('fixtureType', error.message)
    }

    try {
      validateFixtureDateTime({
        kickoffTime: form.startTime,
        kickoffTimeTbc: form.kickoffTimeTbc,
        matchDate: form.date,
      })
    } catch (error) {
      throw calendarValidationError(error.message.includes('date') ? 'date' : 'startTime', error.message)
    }

    if (isPastMatchDayDate(date)) {
      throw calendarValidationError('date', 'Match Day date must be today or in the future.')
    }

    if (!title && !opponent) {
      throw calendarValidationError('opponent', 'Add an opponent or event title for this fixture.')
    }

    if (!form.kickoffTimeTbc && form.arrivalTime && isTimeAfter(form.arrivalTime, form.startTime)) {
      throw calendarValidationError('arrivalTime', 'Arrival time must be before kick-off time.')
    }

    return
  }

  try {
    validateOrdinaryEventDateTime({
      date: form.date,
      endTime: form.endTime,
      startTime: form.startTime,
    })
  } catch (error) {
    const fieldName = error.message.includes('date')
      ? 'date'
      : error.message.includes('start')
        ? 'startTime'
        : 'endTime'
    throw calendarValidationError(fieldName, error.message)
  }

  if (sourceType === 'calendar' || (!isTraining && eventType !== 'match')) {
    if (!title) {
      throw calendarValidationError('title', 'Add an event title.')
    }
  }
}

function validateTrainingAvailabilityForm({ form, selectedPlayers }) {
  if (form.eventType !== 'training' || form.requestTrainingAvailability !== true) {
    return
  }

  if (selectedPlayers.length === 0) {
    throw calendarValidationError('invitedPlayerIds', 'Select at least one involved player before requesting availability.')
  }

  const sendDaysBefore = Number(form.trainingAvailabilitySendDaysBefore)

  if (!Number.isInteger(sendDaysBefore) || sendDaysBefore < 0 || sendDaysBefore > 30) {
    throw calendarValidationError('trainingAvailabilitySendDaysBefore', 'Send days before must be a whole number from 0 to 30.')
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
    throw calendarValidationError('invitedPlayerIds', 'You selected only parents of involved players, but no players are attached to this event. Add players or choose a wider parent audience.')
  }

  if (form.parentAudience === 'all_team_parents' && !safeTeamId) {
    throw calendarValidationError('teamId', 'Choose a team before sharing with all parents in the team.')
  }

  if (form.parentAudience === 'all_club_parents' && !canCreateClubCalendarEvent(user)) {
    throw calendarValidationError('parentAudience', 'Club parent sharing is only available to Club Admins.')
  }
}

function getInvitesForCalendarEvent(event, invites = [], {
  auditEvents = [],
  deliveryEvents = [],
  occurrenceDate = '',
  participationRemovals = [],
  sessionParticipants = [],
  trainingAvailabilitySummary = null,
} = {}) {
  return buildEventResponseReadModel({
    auditEvents,
    calendarInvites: invites,
    deliveryEvents,
    event,
    occurrenceDate,
    participationRemovals,
    sessionParticipants,
    trainingAvailabilitySummary,
  }).participants
}

function getFormInviteFields(event, invites = []) {
  const eventInvites = getInvitesForCalendarEvent(event, invites)

  return {
    invitedPlayerIds: eventInvites.map((invite) => invite.playerId).filter(Boolean),
    inviteTrialPlayers: eventInvites.some((invite) => String(invite.player?.section ?? invite.playerStatusAtInvite ?? '').trim().toLowerCase() === 'trial'),
    inviteWholeSquad: false,
    notificationRequestToken: '',
    notifyInvitedFamilies: false,
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
    const sourceParentAudience = source.parentAudience || inviteFields.parentAudience || 'none'

    return {
      ...getDefaultCalendarForm(source.matchDate || event.date),
      arrivalTime: source.kickoffTimeTbc ? '' : formatTimeInput(source.arrivalTime),
      autoSelectAvailablePlayers: source.autoSelectAvailablePlayers === true,
      date: formatDateInput(source.matchDate || event.date),
      endTime: source.kickoffTimeTbc ? '' : addMinutesToTime(source.kickoffTime, 120),
      eventType: 'match',
      fixtureType: source.fixtureType || '',
      homeAway: source.homeAway || 'home',
      kickoffTimeTbc: source.kickoffTimeTbc === true,
      shirtChoice: source.shirtChoice || 'home',
      location: source.venueName || '',
      notes: source.notes || '',
      opponent: source.opponent || '',
      requestScorer: source.requestScorer === true,
      requestLinesman: source.requestLinesman === true,
      requestReferee: source.requestReferee === true,
      startTime: source.kickoffTimeTbc ? '' : formatTimeInput(source.kickoffTime),
      teamId: source.teamId || '',
      title: source.title || (source.opponent ? `Match vs ${source.opponent}` : ''),
      ...inviteFields,
      parentAudience: sourceParentAudience,
      shareWithParents: Boolean(source.parentVisible || inviteFields.shareWithParents),
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

  if (sourceType === 'assessment-reminder') {
    const evaluation = source.evaluation || {}
    const reminder = source.reminder || {}

    return {
      ...getDefaultCalendarForm(reminder.metadata?.dueDate || event.date),
      date: formatDateInput(reminder.metadata?.dueDate || event.date),
      endTime: '10:00',
      eventType: 'general',
      startTime: '09:00',
      teamId: evaluation.teamId || '',
      title: event.title || 'Development review reminder',
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
  return getSelectedInvitePlayers(invitePlayers, form.invitedPlayerIds)
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

export function SessionsPage({ calendarOnly = false, historyOnly = false, liveOnly = false, setupOpen = false }) {
  const { session, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { showToast } = useToast()
  const isClubWideCalendar = calendarOnly && isClubAdmin(user) && !user?.activeTeamId
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
  const [calendarValidation, setCalendarValidation] = useState(null)
  const [calendarChangePrompt, setCalendarChangePrompt] = useState(null)
  const [calendarPlayerCommunicationMode, setCalendarPlayerCommunicationMode] = useState(EVENT_PLAYER_COMMUNICATION_MODES.none)
  const [calendarPlayerReview, setCalendarPlayerReview] = useState(null)
  const [calendarPlayerActionError, setCalendarPlayerActionError] = useState('')
  const [calendarEventResourcesById, setCalendarEventResourcesById] = useState({})
  const [calendarResourceOptions, setCalendarResourceOptions] = useState([])
  const [isCalendarResourcesLoading, setIsCalendarResourcesLoading] = useState(false)
  const [trainingAvailabilitySettingsByEventId, setTrainingAvailabilitySettingsByEventId] = useState({})
  const [trainingAvailabilitySummaryByEventId, setTrainingAvailabilitySummaryByEventId] = useState({})
  const [eventResponseEvidence, setEventResponseEvidence] = useState({
    auditEvents: [],
    calendarInvites: [],
    deliveryEvents: [],
    loaded: false,
    sessionParticipants: [],
    sourceId: '',
    sourceType: '',
  })
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
  const calendarDeepLinkRequestRef = useRef('')
  const calendarChangeDecisionRef = useRef(null)
  const userScopeKey = user
    ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}:${user.activeTeamId || ''}:${user.activeTeamName || ''}`
    : ''
  const completedSessionId = String(searchParams.get('completedSessionId') ?? '').trim()
  const completedCount = Number(searchParams.get('completedCount') ?? 0)
  const requestedSessionId = String(searchParams.get('sessionId') ?? '').trim()
  const requestedQueuePlayerId = String(searchParams.get('queuePlayerId') ?? '').trim()

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
  const focusedQueuePlayer = sessionPlayers.find((player) => player.id === requestedQueuePlayerId) || sessionPlayers[0] || null
  const selectedSessionWorkspaceHref = selectedSessionId
    ? `/sessions/start?${getOpenSessionSearchParams(searchParams, selectedSessionId).toString()}`
    : '/sessions/start'
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
  const currentCalendarEventResources = useMemo(() => {
    const sourceId = String(calendarModal?.event?.sourceId ?? '').trim()
    const occurrenceDate = getCalendarResourceOccurrenceDate(calendarModal?.event, calendarForm)
    const occurrenceKey = getCalendarResourceOccurrenceKey(sourceId, occurrenceDate)
    return occurrenceKey ? calendarEventResourcesById[occurrenceKey] || [] : []
  }, [calendarEventResourcesById, calendarForm, calendarModal?.event])
  const currentTrainingAvailabilitySummary = useMemo(() => {
    const sourceId = String(calendarModal?.event?.sourceId ?? '').trim()
    return sourceId ? trainingAvailabilitySummaryByEventId[sourceId] || null : null
  }, [calendarModal?.event?.sourceId, trainingAvailabilitySummaryByEventId])
  const currentEventResponseModel = useMemo(() => {
    const sourceId = String(calendarModal?.event?.sourceId ?? '').trim()
    const sourceType = String(calendarModal?.event?.sourceType ?? '').trim()
    const evidenceMatches = (
      eventResponseEvidence.loaded === true
      && eventResponseEvidence.sourceId === sourceId
      && eventResponseEvidence.sourceType === sourceType
    )

    return buildEventResponseReadModel({
      auditEvents: evidenceMatches ? eventResponseEvidence.auditEvents : [],
      calendarInvites: evidenceMatches ? eventResponseEvidence.calendarInvites : calendarInvites,
      deliveryEvents: evidenceMatches ? eventResponseEvidence.deliveryEvents : [],
      event: calendarModal?.event,
      occurrenceDate: calendarForm.date,
      participationRemovals: evidenceMatches ? eventResponseEvidence.participationRemovals : [],
      sessionParticipants: evidenceMatches ? eventResponseEvidence.sessionParticipants : [],
      trainingAvailabilitySummary: currentTrainingAvailabilitySummary,
    })
  }, [
    calendarForm.date,
    calendarInvites,
    calendarModal?.event,
    currentTrainingAvailabilitySummary,
    eventResponseEvidence,
  ])
  const currentCalendarEventInvites = currentEventResponseModel.participants
  const manageableCurrentCalendarEventInvites = useMemo(() => {
    const manageablePlayerIds = new Set(getManageableEventPlayerIds({
      currentParticipants: currentCalendarEventInvites,
      rosterPlayers: calendarInvitePlayers,
    }))

    return currentCalendarEventInvites.filter((participant) => (
      manageablePlayerIds.has(String(participant?.playerId ?? '').trim())
    ))
  }, [calendarInvitePlayers, currentCalendarEventInvites])
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
    const sourceId = String(event?.sourceId ?? '').trim()
    const sourceType = String(event?.sourceType ?? '').trim()

    if (!sourceId || !['calendar', 'match-day', 'session'].includes(sourceType)) {
      setEventResponseEvidence({
        auditEvents: [],
        calendarInvites: [],
        deliveryEvents: [],
        loaded: false,
        sessionParticipants: [],
        sourceId: '',
        sourceType: '',
      })
      return () => {
        isMounted = false
      }
    }

    getEventResponseEvidenceForEvent({ event, user })
      .then((evidence) => {
        if (isMounted) {
          setEventResponseEvidence({
            ...evidence,
            loaded: true,
            sourceId,
            sourceType,
          })
        }
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
          setEventResponseEvidence({
            auditEvents: [],
            calendarInvites: [],
            deliveryEvents: [],
            loaded: false,
            sessionParticipants: [],
            sourceId: '',
            sourceType: '',
          })
        }
      })

    return () => {
      isMounted = false
    }
  }, [
    calendarModal?.event,
    calendarModal?.event?.sourceId,
    calendarModal?.event?.sourceType,
    user,
    userScopeKey,
  ])

  useEffect(() => {
    let isMounted = true
    let refreshInFlight = false
    const sourceId = String(calendarModal?.event?.sourceId ?? '').trim()
    const sourceType = String(calendarModal?.event?.sourceType ?? '').trim()
    const eventType = String(calendarModal?.event?.data?.eventType ?? calendarForm.eventType ?? '').trim()

    if (!sourceId || !['match-day', 'calendar'].includes(sourceType)) {
      return () => {
        isMounted = false
      }
    }

    const refreshAvailability = async () => {
      if (refreshInFlight || document.visibilityState === 'hidden') {
        return
      }

      refreshInFlight = true

      try {
        if (sourceType === 'match-day') {
          const matchDay = await getMatchDay({ user, matchDayId: sourceId })

          if (!isMounted) {
            return
          }

          setCalendarModal((current) => {
            if (String(current?.event?.sourceId ?? '').trim() !== sourceId) {
              return current
            }

            return {
              ...current,
              event: {
                ...current.event,
                data: matchDay,
              },
            }
          })
          setMatchDays((current) => current.map((match) => match.id === matchDay.id ? matchDay : match))
        } else if (eventType === 'training') {
          const summaries = await getTrainingAvailabilitySummaryForEvents({ user, eventIds: [sourceId] })

          if (isMounted) {
            setTrainingAvailabilitySummaryByEventId((current) => ({
              ...current,
              [sourceId]: summaries[sourceId] || null,
            }))
          }
        }

        const evidence = await getEventResponseEvidenceForEvent({
          event: {
            sourceId,
            sourceType,
          },
          user,
        })

        if (isMounted) {
          setEventResponseEvidence({
            ...evidence,
            loaded: true,
            sourceId,
            sourceType,
          })
        }
      } catch (error) {
        console.error(error)
      } finally {
        refreshInFlight = false
      }
    }

    const handleVisibleRefresh = () => {
      if (document.visibilityState === 'visible') {
        void refreshAvailability()
      }
    }
    const intervalId = window.setInterval(() => {
      void refreshAvailability()
    }, 10000)

    void refreshAvailability()
    window.addEventListener('focus', handleVisibleRefresh)
    document.addEventListener('visibilitychange', handleVisibleRefresh)

    return () => {
      isMounted = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleVisibleRefresh)
      document.removeEventListener('visibilitychange', handleVisibleRefresh)
    }
  }, [
    calendarForm.eventType,
    calendarModal?.event?.data?.eventType,
    calendarModal?.event?.sourceId,
    calendarModal?.event?.sourceType,
    user,
    userScopeKey,
  ])

  useEffect(() => {
    let isMounted = true
    const event = calendarModal?.event
    const eventId = String(event?.sourceId ?? '').trim()
    const eventTeamId = String(event?.data?.teamId ?? '').trim()
    const occurrenceDate = getCalendarResourceOccurrenceDate(event, { date: calendarForm.date })
    const occurrenceKey = getCalendarResourceOccurrenceKey(eventId, occurrenceDate)

    if (event?.sourceType !== 'calendar' || !eventId || !eventTeamId || !isCalendarResourceEventType(event?.data?.eventType)) {
      return () => {
        isMounted = false
      }
    }

    getCalendarEventResources({ user, eventId, occurrenceDate, teamId: eventTeamId })
      .then((resources) => {
        if (!isMounted) {
          return
        }

        setCalendarEventResourcesById((current) => ({
          ...current,
          [occurrenceKey]: resources,
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
  }, [calendarForm.date, calendarModal?.event, user, userScopeKey])

  useEffect(() => {
    const requestedAction = String(searchParams.get('action') ?? '').trim()
    const requestedType = String(searchParams.get('type') ?? '').trim()

    if (!['add-event', 'add-session', 'create-session'].includes(requestedAction)) {
      return
    }

    if (requestedAction === 'add-event') {
      handleOpenCalendarCreate('', requestedType)
    } else {
      handleOpenSessionCreateModal()
    }

  // Function declarations keep the direct-route effect safe before any loading return.
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
    const requestedAction = String(searchParams.get('action') ?? '').trim()
    const requestedEventId = String(searchParams.get('eventId') ?? '').trim()
    const requestedSource = String(searchParams.get('source') ?? '').trim()
    const requestKey = `${requestedAction}:${requestedSource}:${requestedEventId}`

    if (
      !['manage-players', 'view-responses', 'view'].includes(requestedAction)
      || !requestedEventId
      || isLoading
      || calendarDeepLinkRequestRef.current === requestKey
    ) {
      return
    }

    const requestedEvent = calendarEvents.find((event) => (
      String(event.sourceId ?? '') === requestedEventId
      && (!requestedSource || event.sourceType === requestedSource)
    ))

    const canResolveAuthoritativeMatchDay = requestedSource === 'match-day'

    if (!requestedEvent && !canResolveAuthoritativeMatchDay) {
      setErrorMessage('The requested event could not be opened in the saved event context.')
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('action')
      nextSearchParams.delete('eventId')
      nextSearchParams.delete('source')
      setSearchParams(nextSearchParams, { replace: true })
      return
    }

    calendarDeepLinkRequestRef.current = requestKey

    const openAuthoritativePlayerManagement = async () => {
      try {
        let event = requestedEvent

        if (canResolveAuthoritativeMatchDay) {
          const matchDay = await getMatchDay({
            matchDayId: requestedEventId,
            user,
          })
          event = buildFootballCalendarEvents({ matchDays: [matchDay] })[0] || null
        }

        if (!event) {
          throw new Error('The requested event could not be opened in the saved event context.')
        }

        const evidence = await getEventResponseEvidenceForEvent({ event, user })
        const trainingSummary = event?.data?.eventType === 'training'
          ? (
              await getTrainingAvailabilitySummaryForEvents({
                eventIds: [event.sourceId],
                user,
              })
            )[event.sourceId] || null
          : trainingAvailabilitySummaryByEventId[event.sourceId] || null
        const requestedEventResponseRows = buildEventResponseReadModel({
          ...evidence,
          event,
          occurrenceDate: event.date,
          trainingAvailabilitySummary: trainingSummary,
        }).participants
        const nextForm = getFormFromCalendarEvent(event, requestedEventResponseRows)

        setEventResponseEvidence({
          ...evidence,
          loaded: true,
          sourceId: event.sourceId,
          sourceType: event.sourceType,
        })
        setCalendarForm({
          ...nextForm,
          notificationRequestToken: createNotificationRequestToken(),
          notifyInvitedFamilies: false,
        })
        setCalendarPlayerCommunicationMode(EVENT_PLAYER_COMMUNICATION_MODES.none)
        setCalendarPlayerReview(null)
        setCalendarModal({
          mode: requestedAction === 'manage-players' ? 'manage-players' : 'view',
          event,
          openResponseManager: requestedAction === 'view-responses',
          responseManagerRequestId: requestedAction === 'view-responses'
            ? createNotificationRequestToken()
            : '',
        })
      } catch (error) {
        console.error(error)
        setErrorMessage(
          error.message
          || 'The requested event could not be loaded for authoritative player management.',
        )
      } finally {
        calendarDeepLinkRequestRef.current = ''
        const nextSearchParams = new URLSearchParams(searchParams)
        nextSearchParams.delete('action')
        nextSearchParams.delete('eventId')
        nextSearchParams.delete('source')
        setSearchParams(nextSearchParams, { replace: true })
      }
    }

    void openAuthoritativePlayerManagement()
  }, [
    calendarEvents,
    isLoading,
    searchParams,
    setSearchParams,
    trainingAvailabilitySummaryByEventId,
    user,
  ])

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
    setSearchParams(getOpenSessionSearchParams(searchParams, nextSessionId), { replace: !historyOnly })
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

  const handleQueuePlayerFocus = (playerId) => {
    const nextPlayerId = String(playerId ?? '').trim()

    if (!nextPlayerId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.set('queuePlayerId', nextPlayerId)
    setSearchParams(nextSearchParams)
  }

  function handleOpenCalendarCreate(date = '', requestedEventType = '') {
    setErrorMessage('')
    setCalendarValidation(null)
    const defaultForm = getDefaultCalendarForm(date)
    const eventType = (isClubWideCalendar || calendarOnly) ? 'general' : defaultForm.eventType

    if (requestedEventType === 'match') {
      openCalendarMatchDayWorkflow({
        ...defaultForm,
        eventType: 'match',
      })
      return
    }

    const teamId = canCreateClubCalendarEvent(user) ? '' : String(user?.activeTeamId ?? '').trim()
    const selectedTeam = teams.find((team) => String(team.id) === teamId)
    setCalendarForm({
      ...defaultForm,
      eventType,
      notificationTeamName: teamId
        ? resolveTeamNotificationDisplayName(selectedTeam || {}, user?.activeTeamName || '')
        : '',
      requestTrainingAvailability: false,
      teamId,
    })
    setCalendarModal({ mode: 'create', event: null })
  }

  const handleCalendarModalClose = () => {
    setCalendarValidation(null)
    setCalendarModal(null)
    setCalendarForm(getDefaultCalendarForm())
    setCalendarPlayerCommunicationMode(EVENT_PLAYER_COMMUNICATION_MODES.none)
    setCalendarPlayerReview(null)
    setCalendarPlayerActionError('')
    setEventResponseEvidence({
      auditEvents: [],
      calendarInvites: [],
      deliveryEvents: [],
      loaded: false,
      sessionParticipants: [],
      sourceId: '',
      sourceType: '',
    })
    setErrorMessage('')

    if (searchParams.has('action') || searchParams.has('type')) {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('action')
      nextSearchParams.delete('type')
      setSearchParams(nextSearchParams, { replace: true })
    }
  }

  function handleOpenSessionCreateModal() {
    setErrorMessage('')
    setCalendarValidation(null)
    const teamId = canCreateClubCalendarEvent(user) ? '' : String(user?.activeTeamId ?? '').trim()
    const selectedTeam = teams.find((team) => String(team.id) === teamId)
    setCalendarForm({
      ...getDefaultCalendarForm(),
      eventType: 'training',
      notificationTeamName: teamId
        ? resolveTeamNotificationDisplayName(selectedTeam || {}, user?.activeTeamName || '')
        : '',
      teamId,
    })
    setCalendarModal({ mode: 'create', event: null, variant: 'session' })
  }

  const handleCalendarEventOpen = (event) => {
    setErrorMessage('')
    setCalendarValidation(null)
    const eventResponseRows = buildEventResponseReadModel({
      calendarInvites,
      event,
      occurrenceDate: event.date,
      trainingAvailabilitySummary: trainingAvailabilitySummaryByEventId[event.sourceId] || null,
    }).participants
    const baseForm = getFormFromCalendarEvent(event, eventResponseRows)
    const sourceEventType = event?.data?.eventType || baseForm.eventType
    const setting = event?.sourceType === 'calendar'
      ? trainingAvailabilitySettingsByEventId[event.sourceId]
      : null

    setCalendarForm({
      ...baseForm,
      notificationTeamName: baseForm.teamId
        ? resolveTeamNotificationDisplayName(
          teams.find((team) => String(team.id) === String(baseForm.teamId)) || {},
          getCalendarTeamName(baseForm.teamId),
        )
        : '',
      requestTrainingAvailability: sourceEventType === 'training' ? setting?.enabled ?? false : false,
      shareWithParents: sourceEventType === 'training' && setting?.enabled ? true : baseForm.shareWithParents,
      parentAudience: sourceEventType === 'training' && setting?.enabled ? 'involved_players' : baseForm.parentAudience,
      notifyInvitedFamilies: sourceEventType === 'training' && setting?.enabled ? true : baseForm.notifyInvitedFamilies,
      trainingAvailabilitySendDaysBefore: setting?.sendDaysBefore ?? 2,
    })
    setCalendarModal({ mode: 'view', event })
  }

  const handleOpenEventResponsePlayer = (row) => {
    const event = calendarModal?.event

    try {
      const navigation = buildEventResponsePlayerNavigation({
        currentSearch: searchParams.toString(),
        event,
        players,
        row,
        user,
      })
      const returnUrl = `${window.location.pathname}${navigation.returnSearch ? `?${navigation.returnSearch}` : ''}`

      window.history.replaceState(window.history.state, '', returnUrl)
      setCalendarModal(null)
      navigate(navigation.profilePath)
    } catch (error) {
      setErrorMessage(error.message || 'The selected response could not open a player profile.')
    }
  }

  const handleOpenCalendarPlayerManagement = () => {
    const event = calendarModal?.event

    if (!event?.sourceId || !['calendar', 'match-day', 'session'].includes(event.sourceType)) {
      setErrorMessage('This calendar item does not support player management here.')
      return
    }

    setCalendarPlayerCommunicationMode(EVENT_PLAYER_COMMUNICATION_MODES.none)
    setCalendarPlayerReview(null)
    setCalendarPlayerActionError('')
    setCalendarForm((current) => ({
      ...current,
      invitedPlayerIds: manageableCurrentCalendarEventInvites.map((participant) => participant.playerId),
      notificationRequestToken: createNotificationRequestToken(),
      notifyInvitedFamilies: false,
    }))
    setCalendarModal((current) => ({ ...current, mode: 'manage-players' }))
  }

  const handleCalendarEdit = () => {
    setCalendarForm((current) => ({
      ...current,
      invitedPlayerIds: currentCalendarEventInvites.map((invite) => invite.playerId).filter(Boolean),
    }))
    setCalendarModal((current) => ({ ...current, mode: 'edit' }))
  }

  const handleReviewCalendarPlayerChanges = async () => {
    const event = calendarModal?.event

    if (!event?.sourceId) {
      setErrorMessage('Choose a saved event before reviewing player changes.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setCalendarPlayerActionError('')

    try {
      const review = await previewEventPlayerChanges({
        eventId: event.sourceId,
        selectedPlayerIds: calendarForm.invitedPlayerIds,
        sourceType: event.sourceType,
        user,
      })
      setCalendarPlayerReview(review)
    } catch (error) {
      console.error(error)
      const message = error.message || 'We could not review the invited Players. Please try again. Reference: CAL-PLAYER-REVIEW.'
      setCalendarPlayerActionError(message)
      showToast({
        title: 'Review unavailable',
        message,
        tone: 'error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleApplyCalendarPlayerChanges = async ({
    confirmResendAll = false,
    confirmSelectedRemovals = false,
  } = {}) => {
    const event = calendarModal?.event

    if (!event?.sourceId || !calendarPlayerReview) {
      setErrorMessage('Review the player changes before saving.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')
    setCalendarPlayerActionError('')

    try {
      const result = await applyEventPlayerChanges({
        communicationMode: calendarPlayerCommunicationMode,
        confirmResendAll,
        confirmSelectedRemovals,
        eventId: event.sourceId,
        requestToken: calendarForm.notificationRequestToken,
        selectedPlayerIds: calendarForm.invitedPlayerIds,
        sourceType: event.sourceType,
        user,
      })
      const refreshedInvites = await getCalendarEventInvites({ user })
      setCalendarInvites(refreshedInvites)
      writeCalendarAwareCache({ calendarInvites: refreshedInvites })

      if (event.sourceType === 'match-day') {
        const refreshedMatch = await getMatchDay({ user, matchDayId: event.sourceId })
        setMatchDays((current) => current.map((match) => match.id === refreshedMatch.id ? refreshedMatch : match))
        setCalendarModal((current) => ({
          ...current,
          event: {
            ...current.event,
            data: refreshedMatch,
          },
        }))
      }

      if (result.communicationFailure) {
        setCalendarPlayerActionError(result.communicationFailure.message)
        showToast({
          title: 'Players updated, invitations not queued',
          message: result.communicationFailure.message,
          tone: 'warning',
        })
        return
      }

      setCalendarModal((current) => ({ ...current, mode: 'view' }))
      setCalendarPlayerReview(null)
      setCalendarPlayerCommunicationMode(EVENT_PLAYER_COMMUNICATION_MODES.none)
      setCalendarPlayerActionError('')
      setCalendarForm((current) => ({
        ...current,
        invitedPlayerIds: result.selectedPlayerIds,
        notificationRequestToken: '',
        notifyInvitedFamilies: false,
      }))
      showToast({
        title: 'Event players updated',
        message: result.queuedCount > 0
          ? `${result.addedPlayerIds.length} added, ${result.removedPlayerIds.length} removed, and ${result.queuedCount} notification${result.queuedCount === 1 ? '' : 's'} queued.`
          : `${result.addedPlayerIds.length} added and ${result.removedPlayerIds.length} removed. No notifications were queued.`,
        tone: result.failedCount > 0 ? 'warning' : undefined,
      })
    } catch (error) {
      console.error(error)
      const message = error.message || 'We could not update the invited Players. Your selection has been kept. Please try again. Reference: CAL-PLAYER-APPLY.'
      setCalendarPlayerActionError(message)
      showToast({
        title: 'Players not updated',
        message,
        tone: 'error',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleEventPlayerRemovalAction = async ({
    confirmInProgress = false,
    playerId,
    preview = false,
    requestToken,
    scope,
  } = {}) => {
    const event = calendarModal?.event
    const sourceId = String(event?.sourceId ?? '').trim()
    const normalizedPlayerId = String(playerId ?? '').trim()
    const occurrenceDate = event?.sourceType === 'calendar'
      ? formatDateInput(event?.occurrenceDate || event?.data?.recurrenceOccurrenceDate || calendarForm.date)
      : null

    if (!sourceId || !normalizedPlayerId || !['calendar', 'match-day'].includes(event?.sourceType)) {
      throw new Error('Choose one supported saved event and Player before removing participation.')
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const values = {
        eventId: sourceId,
        occurrenceDate,
        playerId: normalizedPlayerId,
        scope,
        sourceType: event.sourceType,
        user,
      }
      const result = preview
        ? await previewEventPlayerRemoval(values)
        : await removePlayerFromEvent({
            ...values,
            confirmInProgress,
            requestToken,
          })

      if (preview) {
        return result
      }

      let refreshedEvent = event

      if (event.sourceType === 'match-day') {
        const refreshedMatch = await getMatchDay({ user, matchDayId: sourceId })
        refreshedEvent = { ...event, data: refreshedMatch }
        setMatchDays((current) => current.map((match) => match.id === refreshedMatch.id ? refreshedMatch : match))
        setCalendarModal((current) => (
          String(current?.event?.sourceId ?? '').trim() === sourceId
            ? { ...current, event: { ...current.event, data: refreshedMatch } }
            : current
        ))
      } else if (calendarForm.eventType === 'training') {
        const summaries = await getTrainingAvailabilitySummaryForEvents({ user, eventIds: [sourceId] })
        setTrainingAvailabilitySummaryByEventId((current) => ({
          ...current,
          [sourceId]: summaries[sourceId] || null,
        }))
      }

      const [refreshedInvites, refreshedEvidence] = await Promise.all([
        getCalendarEventInvites({ user }),
        getEventResponseEvidenceForEvent({ event: refreshedEvent, user }),
      ])
      setCalendarInvites(refreshedInvites)
      writeCalendarAwareCache({ calendarInvites: refreshedInvites })
      setEventResponseEvidence({
        ...refreshedEvidence,
        loaded: true,
        sourceId,
        sourceType: event.sourceType,
      })

      showToast({
        title: result.duplicate ? 'Event removal already completed' : 'Player removed from event',
        message: `${result.affectedOccurrenceCount} occurrence${result.affectedOccurrenceCount === 1 ? '' : 's'} removed. ${result.suppressedInvitationCount} unsent invitation${result.suppressedInvitationCount === 1 ? '' : 's'} suppressed. Team membership is unchanged.`,
      })
      return result
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The Player could not be removed from the event.')
      showToast({
        title: preview ? 'Removal impact unavailable' : 'Player not removed',
        message: error.message || 'The Player could not be removed from the event.',
        tone: 'error',
      })
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const handleAcceptEventAvailabilityOnBehalf = async ({ invite, occurrenceDate, status }) => {
    const event = calendarModal?.event
    const sourceId = String(event?.sourceId ?? '').trim()
    const isMatchFixture = event?.sourceType === 'match-day'
    const eventType = isMatchFixture ? 'match' : calendarForm.eventType
    const playerId = String(invite?.playerId ?? '').trim()

    if (!sourceId || !playerId || !['match', 'training'].includes(eventType)) {
      throw new Error('This invitation is not available for Coach acceptance.')
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      let automaticSelectionFailed = false
      let refreshedEvent = event
      const result = await acceptEventPlayerAvailabilityOnBehalf({
        eventId: sourceId,
        eventType,
        occurrenceDate,
        playerId,
        user,
      })

      if (isMatchFixture) {
        const refreshedMatch = await getMatchDay({ user, matchDayId: sourceId })
        refreshedEvent = {
          ...event,
          data: refreshedMatch,
        }
        const latestAutomaticSelection = (refreshedMatch.eventLog || [])
          .filter((entry) => (
            String(entry.playerId || '') === playerId
            && entry.metadata?.source === 'availability_auto_selection'
          ))
          .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0]
        automaticSelectionFailed = (
          refreshedMatch.autoSelectAvailablePlayers === true
          && latestAutomaticSelection?.metadata?.automaticSelectionSucceeded === false
        )
        setMatchDays((current) => current.map((match) => match.id === refreshedMatch.id ? refreshedMatch : match))
        setCalendarModal((current) => {
          if (String(current?.event?.sourceId ?? '').trim() !== sourceId) {
            return current
          }

          return {
            ...current,
            event: {
              ...current.event,
              data: refreshedMatch,
            },
          }
        })
      } else {
        const summaries = await getTrainingAvailabilitySummaryForEvents({ user, eventIds: [sourceId] })
        setTrainingAvailabilitySummaryByEventId((current) => ({
          ...current,
          [sourceId]: summaries[sourceId] || null,
        }))
      }

      const refreshedEvidence = await getEventResponseEvidenceForEvent({
        event: refreshedEvent,
        user,
      })
      setEventResponseEvidence({
        ...refreshedEvidence,
        loaded: true,
        sourceId,
        sourceType: event.sourceType,
      })

      showToast({
        title: automaticSelectionFailed ? 'Player available, selection needs attention' : result.changed ? 'Player accepted' : 'Already accepted',
        message: automaticSelectionFailed
          ? 'Player marked Available but could not be added to the match selection.'
          : result.changed
            ? `${invite.player?.playerName || 'Player'} is now Available. The response is recorded as Coaches acting on behalf.`
            : `${invite.player?.playerName || 'Player'} is already ${status?.availabilityLabel || 'Available'}.`,
        tone: automaticSelectionFailed ? 'warning' : undefined,
      })
    } catch (error) {
      console.error(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const handleMarkEventUnavailableOnBehalf = async ({ invite, occurrenceDate }) => {
    const event = calendarModal?.event
    const sourceId = String(event?.sourceId ?? '').trim()
    const isMatchFixture = event?.sourceType === 'match-day'
    const eventType = isMatchFixture ? 'match' : calendarForm.eventType
    const playerId = String(invite?.playerId ?? '').trim()

    if (!sourceId || !playerId || !['match', 'training'].includes(eventType)) {
      throw new Error('This invitation is not available for a Coach response.')
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      let refreshedEvent = event
      const result = await markEventPlayerUnavailableOnBehalf({
        eventId: sourceId,
        eventType,
        occurrenceDate,
        playerId,
        user,
      })

      if (isMatchFixture) {
        const refreshedMatch = await getMatchDay({ user, matchDayId: sourceId })
        refreshedEvent = { ...event, data: refreshedMatch }
        setMatchDays((current) => current.map((match) => match.id === refreshedMatch.id ? refreshedMatch : match))
        setCalendarModal((current) => (
          String(current?.event?.sourceId ?? '').trim() === sourceId
            ? { ...current, event: { ...current.event, data: refreshedMatch } }
            : current
        ))
      } else {
        const summaries = await getTrainingAvailabilitySummaryForEvents({ user, eventIds: [sourceId] })
        setTrainingAvailabilitySummaryByEventId((current) => ({
          ...current,
          [sourceId]: summaries[sourceId] || null,
        }))
      }

      const refreshedEvidence = await getEventResponseEvidenceForEvent({
        event: refreshedEvent,
        user,
      })
      setEventResponseEvidence({
        ...refreshedEvidence,
        loaded: true,
        sourceId,
        sourceType: event.sourceType,
      })

      showToast({
        title: result.changed ? 'Player marked unavailable' : 'Already unavailable',
        message: result.changed
          ? `${invite.player?.playerName || 'Player'} is now Unavailable. The response is recorded as Coaches acting on behalf.`
          : `${invite.player?.playerName || 'Player'} is already Unavailable.`,
      })
    } catch (error) {
      console.error(error)
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const handleSelectEventPlayerForSquad = async ({ invite }) => {
    const event = calendarModal?.event
    const sourceId = String(event?.sourceId ?? '').trim()
    const playerId = String(invite?.playerId ?? '').trim()

    if (event?.sourceType !== 'match-day' || !sourceId || !playerId) {
      throw new Error('Squad selection is available for saved Match Day fixtures only.')
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      await setMatchDayPlayerSquadDecision({
        decision: 'selected',
        matchDayId: sourceId,
        playerId,
      })
      const refreshedMatch = await getMatchDay({ user, matchDayId: sourceId })
      const refreshedEvent = { ...event, data: refreshedMatch }
      setMatchDays((current) => current.map((match) => match.id === refreshedMatch.id ? refreshedMatch : match))
      setCalendarModal((current) => (
        String(current?.event?.sourceId ?? '').trim() === sourceId
          ? { ...current, event: { ...current.event, data: refreshedMatch } }
          : current
      ))
      const refreshedEvidence = await getEventResponseEvidenceForEvent({
        event: refreshedEvent,
        user,
      })
      setEventResponseEvidence({
        ...refreshedEvidence,
        loaded: true,
        sourceId,
        sourceType: event.sourceType,
      })
      showToast({
        title: 'Player selected',
        message: `${invite.player?.playerName || 'Player'} is selected for the match squad. Their availability response was not changed.`,
      })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The player could not be selected for the squad.')
      showToast({
        title: 'Squad selection not updated',
        message: error.message || 'The player could not be selected for the squad.',
        tone: 'error',
      })
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const handleEventPlayerInvitationAction = async ({
    action,
    invite,
    occurrenceDate,
    preview = false,
    requestToken,
  }) => {
    const event = calendarModal?.event
    const sourceId = String(event?.sourceId ?? '').trim()
    const playerId = String(invite?.playerId ?? '').trim()

    if (!sourceId || !playerId) {
      throw new Error('Choose one saved event and player before sending an invitation.')
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const result = await sendEventPlayerInvitationAction({
        accessToken: session?.access_token,
        action,
        eventId: sourceId,
        idempotencyKey: requestToken,
        occurrenceDate,
        playerId,
        preview,
        sourceType: event.sourceType,
        user,
      })

      if (preview) {
        return result
      }

      let refreshedEvent = event

      if (event.sourceType === 'match-day') {
        const refreshedMatch = await getMatchDay({ user, matchDayId: sourceId })
        refreshedEvent = { ...event, data: refreshedMatch }
        setMatchDays((current) => current.map((match) => match.id === refreshedMatch.id ? refreshedMatch : match))
        setCalendarModal((current) => (
          String(current?.event?.sourceId ?? '').trim() === sourceId
            ? { ...current, event: { ...current.event, data: refreshedMatch } }
            : current
        ))
      } else if (calendarForm.eventType === 'training') {
        const summaries = await getTrainingAvailabilitySummaryForEvents({ user, eventIds: [sourceId] })
        setTrainingAvailabilitySummaryByEventId((current) => ({
          ...current,
          [sourceId]: summaries[sourceId] || null,
        }))
      }

      const refreshedEvidence = await getEventResponseEvidenceForEvent({
        event: refreshedEvent,
        user,
      })
      setEventResponseEvidence({
        ...refreshedEvidence,
        loaded: true,
        sourceId,
        sourceType: event.sourceType,
      })
      const actionLabel = action === 'send' ? 'sent' : action === 'retry' ? 'retried' : 'resent'
      const successfulRecipientCount = Math.max(0, result.recipientCount - result.failedCount)
      showToast({
        title: result.duplicate ? 'Invitation action already completed' : `Invitation ${actionLabel}`,
        message: result.duplicate
          ? 'This exact invitation action was already completed safely.'
          : result.failedCount > 0
            ? `${successfulRecipientCount} recipient delivery attempt${successfulRecipientCount === 1 ? '' : 's'} succeeded and ${result.failedCount} failed. Failed delivery remains visible for Retry.`
            : event.sourceType === 'match-day'
              ? `${invite.player?.playerName || 'Player'} invitation queued for ${result.recipientCount} server-resolved recipient${result.recipientCount === 1 ? '' : 's'}.`
              : `${invite.player?.playerName || 'Player'} invitation sent to ${result.recipientCount} server-resolved recipient${result.recipientCount === 1 ? '' : 's'}.`,
        tone: result.failedCount > 0 ? 'warning' : undefined,
      })
      return result
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The invitation action could not be completed.')
      showToast({
        title: preview ? 'Recipient preview unavailable' : 'Invitation not sent',
        message: error.message || 'The invitation action could not be completed.',
        tone: 'error',
      })
      throw error
    } finally {
      setIsSaving(false)
    }
  }

  const openCalendarMatchDayWorkflow = (form) => {
    const safeTeamId = getSafeCalendarTeamId(user, form.teamId)
    const trimmedTitle = getTrimmedFormValue(form.title)
    const trimmedOpponent = getTrimmedFormValue(form.opponent)

    openMatchDayFixtureSetup({
      arrivalTime: form.arrivalTime,
      autoSelectAvailablePlayers: form.autoSelectAvailablePlayers !== false,
      fixtureType: form.fixtureType,
      homeAway: form.homeAway,
      kickoffTime: form.startTime,
      kickoffTimeTbc: form.kickoffTimeTbc === true,
      matchDate: form.date,
      notes: form.notes,
      opponent: trimmedOpponent || trimmedTitle,
      parentAudience: form.shareWithParents ? form.parentAudience : 'none',
      parentVisible: form.shareWithParents,
      shirtChoice: form.shirtChoice,
      teamId: safeTeamId,
      venueName: form.location,
    }, { navigate })
    setCalendarModal(null)
    showToast({ title: 'Opening Match Day', message: 'Create this fixture in the full Match Day workflow.' })
  }

  const handleCalendarFormChange = (event) => {
    const { checked, name, type, value } = event.target

    setErrorMessage('')
    setCalendarValidation(null)
    if (['invitedPlayerIds', 'inviteWholeSquad', 'inviteTrialPlayers'].includes(name)) {
      setCalendarPlayerReview(null)
      setCalendarPlayerActionError('')
    }

    if (name === 'eventType' && value === 'match' && calendarModal?.mode === 'create' && !calendarModal?.event) {
      openCalendarMatchDayWorkflow({
        ...calendarForm,
        eventType: 'match',
        endTime: addMinutesToTime(calendarForm.startTime, 120),
      })
      return
    }

    setCalendarForm((current) => {
      if (name === 'requestTrainingAvailability') {
        return {
          ...current,
          requestTrainingAvailability: checked,
          shareWithParents: true,
          parentAudience: 'involved_players',
          notifyInvitedFamilies: checked,
          notificationRequestToken: checked
            ? current.notificationRequestToken || createNotificationRequestToken()
            : '',
        }
      }

      if (name === 'kickoffTimeMode') {
        const kickoffTimeTbc = value === 'tbc'
        return {
          ...current,
          arrivalTime: kickoffTimeTbc ? '' : current.arrivalTime,
          endTime: kickoffTimeTbc ? '' : addMinutesToTime(current.startTime, 120),
          kickoffTimeTbc,
          startTime: kickoffTimeTbc ? '' : current.startTime,
        }
      }

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

        const selectionState = getWholeSquadSelectionState({
          includeTrialPlayers: current.inviteTrialPlayers,
          invitePlayers: calendarInvitePlayers,
          selectedPlayerIds: nextIds,
        })

        return {
          ...current,
          invitedPlayerIds: nextIds,
          inviteWholeSquad: selectionState.checked,
        }
      }

      if (name === 'inviteWholeSquad') {
        return {
          ...current,
          invitedPlayerIds: applyWholeSquadSelection({
            checked,
            includeTrialPlayers: current.inviteTrialPlayers,
            invitePlayers: calendarInvitePlayers,
          }),
          inviteWholeSquad: checked,
        }
      }

      if (name === 'inviteTrialPlayers') {
        const currentWholeSquadState = getWholeSquadSelectionState({
          includeTrialPlayers: current.inviteTrialPlayers,
          invitePlayers: calendarInvitePlayers,
          selectedPlayerIds: current.invitedPlayerIds,
        })
        const nextIds = applyTrialPlayerSelection({
          checked,
          invitePlayers: calendarInvitePlayers,
          selectedPlayerIds: current.invitedPlayerIds,
          wholeSquadSelected: currentWholeSquadState.checked,
        })
        const nextWholeSquadState = getWholeSquadSelectionState({
          includeTrialPlayers: checked,
          invitePlayers: calendarInvitePlayers,
          selectedPlayerIds: nextIds,
        })

        return {
          ...current,
          invitedPlayerIds: nextIds,
          inviteTrialPlayers: checked,
          inviteWholeSquad: nextWholeSquadState.checked,
        }
      }

      const nextForm = {
        ...current,
        [name]: type === 'checkbox' ? checked : value,
      }

      if (name === 'notifyInvitedFamilies') {
        nextForm.notificationRequestToken = checked
          ? current.notificationRequestToken || createNotificationRequestToken()
          : ''
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
        nextForm.notificationTeamName = value
          ? resolveTeamNotificationDisplayName(selectedTeam || {}, selectedTeam?.name || '')
          : ''
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
        nextForm.requestTrainingAvailability = false
      }

      if (name === 'eventType' && value === 'match') {
        nextForm.recurrenceFrequency = 'none'
        nextForm.recurrenceUntil = ''
        nextForm.endTime = current.kickoffTimeTbc ? '' : addMinutesToTime(current.startTime, 120)
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

    const startsAtLabel = buildDateTime(calendarForm.date, calendarForm.startTime)
    const scheduledAt = getEventInviteScheduledAt()
    const results = await Promise.allSettled(invitesToQueue.map((invite) => createScheduledEmail({
      user,
      item: {
        clubName: user?.clubName || 'Your club',
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
        displayName: user?.clubName || 'Your club',
        html: buildCalendarEventInviteEmailHtml({
          clubLogoUrl: user?.clubLogoUrl || '',
          clubName: user?.clubName || 'Your club',
          eventTitle: sourceTitle,
          eventType: calendarForm.eventType,
          location: calendarForm.location,
          notes: calendarForm.notes,
          parentName: invite.parentContactName,
          playerName: invite.player?.playerName,
          startsAtLabel,
          teamName,
          themeAccent: user?.themeAccent || '',
        }),
        parentName: invite.parentContactName,
        playerName: invite.player?.playerName,
        scheduledAt,
        subject: `${user?.clubName || 'Your club'}: ${sourceTitle || 'Event invite'}`,
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

  const resumeCalendarChange = (notifyEveryone) => {
    const prompt = calendarChangePrompt
    if (!prompt) return
    calendarChangeDecisionRef.current = { key: prompt.key, notifyEveryone: notifyEveryone === true }
    setCalendarChangePrompt(null)
    if (prompt.operation === 'save') {
      void handleCalendarSave({ preventDefault() {} })
    } else if (prompt.operation === 'delete') {
      void handleCalendarDelete()
    } else if (prompt.operation === 'delete-session') {
      setDeleteSessionTarget({ ...prompt.deleteTarget, notifyEveryone: notifyEveryone === true })
    }
  }

  const finishCalendarChangeNotification = async (preparationId, updateLabel) => {
    if (!preparationId) return false
    try {
      const delivery = await commitCalendarChangeNotification(preparationId)
      showToast({
        title: 'People notified',
        message: `${delivery.recipientCount || 0} involved contact${delivery.recipientCount === 1 ? '' : 's'} received the ${updateLabel} update.`,
      })
      return true
    } catch (notificationError) {
      console.error(notificationError)
      showToast({
        title: 'Change saved, notification incomplete',
        message: notificationError.message || 'The change was saved, but notifications could not be completed.',
        tone: 'error',
      })
      return false
    }
  }

  const handleCalendarSave = async (event) => {
    event.preventDefault()
    const activeEvent = calendarModal?.event || null
    const sourceType = activeEvent?.sourceType || ''
    const isRescheduled = hasCalendarDateTimeChange({ event: activeEvent, form: calendarForm })
    const changeKey = activeEvent?.sourceId ? `save:${activeEvent.sourceType}:${activeEvent.sourceId}:rescheduled` : ''
    const decision = calendarChangeDecisionRef.current?.key === changeKey ? calendarChangeDecisionRef.current : null
    if (isRescheduled && !decision) {
      setCalendarChangePrompt({
        action: 'rescheduled',
        key: changeKey,
        operation: 'save',
        title: activeEvent.title || calendarForm.title || 'Calendar item',
      })
      return
    }
    calendarChangeDecisionRef.current = null
    setIsSaving(true)
    setErrorMessage('')
    setCalendarValidation(null)
    const safeTeamId = isClubWideCalendar ? '' : getSafeCalendarTeamId(user, calendarForm.teamId)
    const teamName = getCalendarTeamName(safeTeamId)
    const notificationTeamName = safeTeamId
      ? String(calendarForm.notificationTeamName || deriveTeamNotificationDisplayName(teamName)).trim()
      : ''
    const isTraining = calendarForm.eventType === 'training'
    const isMatch = calendarForm.eventType === 'match'
    const saveTrainingAsSession = isTraining && sourceType === 'session'
    const trimmedTitle = getTrimmedFormValue(calendarForm.title)
    const trimmedOpponent = getTrimmedFormValue(calendarForm.opponent)
    let coreSavedEvent = null
    let coreSavedCalendarItems = null
    let coreSavedMatchDays = null
    let changeNotificationPreparation = null

    try {
      if (isRescheduled && decision?.notifyEveryone) {
        changeNotificationPreparation = await prepareCalendarChangeNotification({
          changeAction: 'rescheduled',
          requestToken: crypto.randomUUID(),
          sourceId: activeEvent.sourceId,
          sourceType: activeEvent.sourceType,
        })
      }
      if (sourceType === 'assessment-reminder') {
        const dueDate = formatDateInput(calendarForm.date)
        const evaluation = activeEvent?.data?.evaluation || {}
        const previousReminder = activeEvent?.data?.reminder || {}

        if (!dueDate) {
          throw calendarValidationError('date', 'Choose a new Development review date.')
        }

        if (dueDate < getTodayMatchDayDateValue()) {
          throw calendarValidationError('date', 'The new Development review date must be today or in the future.')
        }

        if (!evaluation.id || !evaluation.playerId) {
          throw new Error('This Development reminder is no longer linked to an available Player record.')
        }

        await createAssessmentReminderOnce({
          user,
          dueDate,
          evaluationId: evaluation.id,
          metadata: {
            ...(previousReminder.metadata || {}),
            rescheduledAt: new Date().toISOString(),
            rescheduledFromReminderId: previousReminder.id || activeEvent.sourceId,
          },
          playerId: evaluation.playerId,
        })
        const nextAssessmentReminders = await getAssessmentReminderLogs({ user })
        setAssessmentReminders(nextAssessmentReminders)
        writeCalendarAwareCache({ assessmentReminders: nextAssessmentReminders })
        setCalendarModal(null)
        setCalendarForm(getDefaultCalendarForm())
        setCalendarValidation(null)
        setErrorMessage('')
        await finishCalendarChangeNotification(changeNotificationPreparation?.preparationId, 'reschedule')
        showToast({
          title: 'Development review rescheduled',
          message: `${activeEvent.title || 'Development review'} moved to ${dueDate}.`,
        })
        return
      }

      if (!canCreateClubCalendarEvent(user) && !safeTeamId) {
        throw new Error('Choose your assigned team before saving this calendar event.')
      }

      validateCalendarForm({ form: calendarForm, safeTeamId, sourceType, user })
      validateTrainingAvailabilityForm({
        form: calendarForm,
        selectedPlayers: selectedCalendarInvitePlayers,
      })
      validateParentSharing({
        form: calendarForm,
        safeTeamId,
        selectedPlayers: selectedCalendarInvitePlayers,
        user,
      })

      if (isMatch && !sourceType) {
        openMatchDayFixtureSetup({
          arrivalTime: calendarForm.arrivalTime,
          autoSelectAvailablePlayers: calendarForm.autoSelectAvailablePlayers !== false,
          fixtureType: calendarForm.fixtureType,
          kickoffTime: calendarForm.startTime,
          kickoffTimeTbc: calendarForm.kickoffTimeTbc === true,
          matchDate: calendarForm.date,
          notes: calendarForm.notes,
          opponent: trimmedOpponent || trimmedTitle,
          parentAudience: calendarForm.shareWithParents ? calendarForm.parentAudience : 'none',
          parentVisible: calendarForm.shareWithParents,
          notificationTeamName,
          teamId: safeTeamId,
          venueName: calendarForm.location,
        }, { navigate })
        setCalendarModal(null)
        showToast({ title: 'Opening Match Day', message: 'Create this fixture in the full Match Day workflow.' })
        return
      }

      if (safeTeamId) {
        await updateTeamNotificationDisplayName({
          notificationDisplayName: notificationTeamName,
          teamId: safeTeamId,
          user,
        })
      }

      const fixtureEndTime = isMatch
        ? calendarForm.kickoffTimeTbc ? '' : addMinutesToTime(calendarForm.startTime, 120)
        : calendarForm.endTime
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
      let calendarNotificationResult = null
      let refreshedMatchDaysAfterNotification = null
      const syncInvites = async ({ calendarEventId = '', matchDayId = '', assessmentSessionId = '', sourceTitle = '' } = {}) => {
        if (!safeTeamId && !calendarEventId) {
          return
        }

        const sharedInvolvedPlayers = calendarForm.shareWithParents && calendarForm.parentAudience === 'involved_players'
        const sharedAllTeamParents = calendarForm.shareWithParents && calendarForm.parentAudience === 'all_team_parents'
        const sharedAllClubParents = calendarForm.shareWithParents && calendarForm.parentAudience === 'all_club_parents'
        const notificationPlayers = buildCalendarNotificationPlayers(calendarForm, calendarInvitePlayers, selectedCalendarInvitePlayers)
        const notifyRequested = calendarForm.notifyInvitedFamilies
          && !isRescheduled
          && (sharedInvolvedPlayers || sharedAllTeamParents || sharedAllClubParents)

        if (calendarEventId || matchDayId) {
          const eventId = calendarEventId || matchDayId
          const eventSource = matchDayId ? 'match-day' : 'calendar'
          const parentScopeResult = safeTeamId
            ? await syncCalendarEventParentScope({
                user,
                eventId,
                eventSource,
                includeTrialPlayers: calendarForm.inviteTrialPlayers,
                playerIds: sharedInvolvedPlayers ? notificationPlayers.map((player) => player.id) : [],
                selectionMode: sharedAllTeamParents ? 'whole_squad' : 'manual',
              })
            : {
                portalRecordCount: 0,
                responseRequirement: 'informational',
              }
          if (safeTeamId) {
            nextCalendarInvites = await getCalendarEventInvites({ user })
          }

          const shouldQueueCalendarNotification = notifyRequested
            && !(isTraining && calendarForm.requestTrainingAvailability)

          if (shouldQueueCalendarNotification) {
            try {
              calendarNotificationResult = await notifyCalendarEventParents({
                user,
                eventId,
                eventSource,
                eventAction: sourceType === 'calendar' || sourceType === 'match-day' ? 'update' : 'creation',
                requestToken: calendarForm.notificationRequestToken,
              })
              queuedInviteEmails += calendarNotificationResult.queuedCount
              failedInviteEmails += calendarNotificationResult.failedCount
              if (safeTeamId) {
                nextCalendarInvites = await getCalendarEventInvites({ user })
              }
              if (matchDayId && calendarNotificationResult.actionReconciliationState === 'ready') {
                try {
                  refreshedMatchDaysAfterNotification = await getMatchDays({ user })
                  setMatchDays(refreshedMatchDaysAfterNotification)
                } catch (refreshError) {
                  console.error(refreshError)
                }
              }
            } catch (notificationError) {
              console.error(notificationError)
              calendarNotificationResult = {
                ...parentScopeResult,
                actionReconciliationState: matchDayId ? 'failed' : '',
                eventActionType: matchDayId ? 'match_day_action_required' : 'informational',
                responseRequirement: matchDayId ? 'response_required' : 'informational',
                eligibleRecipientCount: 0,
                queuedCount: 0,
                failedCount: 0,
                duplicateCount: 0,
                finalState: 'portal_ready_email_command_failed',
                notificationError: notificationError?.message || 'Email notification command failed.',
              }
            }
          }
          return
        }

        const savedInvites = await saveCalendarEventInvites({
          user,
          calendarEventId,
          assessmentSessionId,
          teamId: safeTeamId,
          players: notificationPlayers,
          notifyRequested,
        })
        if (notifyRequested && assessmentSessionId) {
          const queueResult = await queueCalendarEventInviteEmails({
            assessmentSessionId,
            calendarEventId,
            safeTeamId,
            savedInvites,
            sourceTitle,
            teamName: notificationTeamName,
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
            autoSelectAvailablePlayers: calendarForm.autoSelectAvailablePlayers === true,
            fixtureType: calendarForm.fixtureType,
            homeAway: calendarForm.homeAway,
            kickoffTime: calendarForm.startTime,
            kickoffTimeTbc: calendarForm.kickoffTimeTbc === true,
            matchDate: calendarForm.date,
            notes: calendarForm.notes,
            shirtChoice: calendarForm.shirtChoice,
            ...getCalendarParentVisibility({ form: calendarForm, safeTeamId, user }),
            opponent: trimmedOpponent,
            requestScorer: calendarForm.requestScorer,
            requestLinesman: calendarForm.requestLinesman,
            requestReferee: calendarForm.requestReferee,
            status: calendarForm.requestScorer ? 'scorer_request' : 'scheduled',
            teamId: safeTeamId,
            venueAddress: '',
            venueName: calendarForm.location,
          }
          const savedMatch = await updateMatchDay({ user, matchId: activeEvent.sourceId, updates: payload })
          coreSavedEvent = savedMatch
          let nextMatchDays = [savedMatch, ...matchDays.filter((match) => match.id !== savedMatch.id)]
          coreSavedMatchDays = nextMatchDays
          setMatchDays(nextMatchDays)
          writeCalendarAwareCache({ matchDays: nextMatchDays })
          await syncInvites({ matchDayId: savedMatch.id, sourceTitle: getMatchDayDisplayName(savedMatch) })
          if (refreshedMatchDaysAfterNotification) {
            nextMatchDays = refreshedMatchDaysAfterNotification
            coreSavedMatchDays = nextMatchDays
          }
          setCalendarInvites(nextCalendarInvites)
          writeCalendarAwareCache({ matchDays: nextMatchDays, calendarInvites: nextCalendarInvites })
          if (!calendarNotificationResult) {
            showToast({ title: 'Fixture updated', message: savedMatch.opponent || 'Calendar updated.' })
          } else {
            showToast(getCalendarNotificationToast(calendarNotificationResult, {
              action: 'updated',
              entity: 'Fixture',
            }))
          }
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
          date: calendarForm.date,
          endTime: calendarForm.endTime,
          endsAt: seriesDateTimeFields.endsAt,
          eventType: calendarForm.eventType,
          location: calendarForm.location,
          notes: calendarForm.notes,
          ...getCalendarParentVisibility({ form: calendarForm, safeTeamId, user }),
          recurrenceFrequency: calendarForm.recurrenceFrequency,
          recurrenceUntil: calendarForm.recurrenceUntil,
          startTime: calendarForm.startTime,
          startsAt: seriesDateTimeFields.startsAt,
          teamId: safeTeamId,
          title: trimmedTitle,
        }
        const savedEvent = sourceType === 'calendar'
          ? await updateCalendarEvent({ user, eventId: activeEvent.sourceId, event: payload })
          : await createCalendarEvent({ user, event: payload })
        coreSavedEvent = savedEvent
        coreSavedCalendarItems = [savedEvent, ...calendarItems.filter((item) => item.id !== savedEvent.id)]
        let savedTrainingAvailabilitySetting = null

        if (calendarForm.eventType === 'training' && safeTeamId && !calendarForm.requestTrainingAvailability) {
          savedTrainingAvailabilitySetting = await saveTrainingAvailabilitySettings({
            user,
            event: savedEvent,
            settings: {
              requestTrainingAvailability: calendarForm.requestTrainingAvailability,
              notifyInvitedFamilies: calendarForm.notifyInvitedFamilies,
              trainingAvailabilitySendDaysBefore: calendarForm.trainingAvailabilitySendDaysBefore,
            },
          })
          nextCalendarInvites = await getCalendarEventInvites({ user })
        }

        await syncInvites({ calendarEventId: savedEvent.id, sourceTitle: savedEvent.title })

        if (calendarForm.eventType === 'training' && safeTeamId && calendarForm.requestTrainingAvailability) {
          savedTrainingAvailabilitySetting = await saveTrainingAvailabilitySettings({
            user,
            event: savedEvent,
            settings: {
              requestTrainingAvailability: true,
              notifyInvitedFamilies: calendarForm.notifyInvitedFamilies,
              trainingAvailabilitySendDaysBefore: calendarForm.trainingAvailabilitySendDaysBefore,
            },
          })
          nextCalendarInvites = await getCalendarEventInvites({ user })
        }

        if (isCalendarResourceEventType(calendarForm.eventType) && safeTeamId && (sourceType === 'calendar' || calendarForm.resourceIds?.length > 0)) {
          const resourceOccurrenceDate = getCalendarResourceOccurrenceDate(activeEvent, calendarForm)
          const resourceOccurrenceKey = getCalendarResourceOccurrenceKey(savedEvent.id, resourceOccurrenceDate)
          const attachedResources = await syncCalendarEventResourceLinks({
            user,
            eventId: savedEvent.id,
            occurrenceDate: resourceOccurrenceDate,
            replaceAllOccurrences: calendarForm.recurrenceFrequency === 'none',
            teamId: safeTeamId,
            resourceIds: calendarForm.resourceIds,
          })
          setCalendarEventResourcesById((current) => ({
            ...current,
            [resourceOccurrenceKey]: attachedResources,
          }))
        }
        const nextCalendarItems = coreSavedCalendarItems
        setCalendarItems(nextCalendarItems)
        setCalendarInvites(nextCalendarInvites)
        if (savedTrainingAvailabilitySetting) {
          setTrainingAvailabilitySettingsByEventId((current) => ({
            ...current,
            [savedEvent.id]: savedTrainingAvailabilitySetting,
          }))
        }
        writeCalendarAwareCache({ calendarItems: nextCalendarItems, calendarInvites: nextCalendarInvites })
        if (!calendarNotificationResult) {
          showToast({ title: sourceType === 'calendar' ? 'Event updated' : 'Event created', message: savedEvent.title || 'Calendar updated.' })
        } else {
          showToast(getCalendarNotificationToast(calendarNotificationResult, {
            action: sourceType === 'calendar' ? 'updated' : 'created',
            entity: 'Event',
          }))
        }
      }

      if (!calendarNotificationResult && queuedInviteEmails > 0) {
        showToast({
          title: 'Family emails queued',
          message: `${queuedInviteEmails} event invite email${queuedInviteEmails === 1 ? '' : 's'} added to the email queue.`,
        })
      }

      if (!calendarNotificationResult && failedInviteEmails > 0) {
        showToast({
          title: 'Some emails were not queued',
          message: `${failedInviteEmails} event invite email${failedInviteEmails === 1 ? '' : 's'} could not be added to the queue. Parent portal invites were still saved.`,
          tone: 'error',
        })
      }

      await finishCalendarChangeNotification(changeNotificationPreparation?.preparationId, 'reschedule')

      setCalendarModal(null)
      setCalendarForm(getDefaultCalendarForm())
      setCalendarValidation(null)
      setErrorMessage('')
    } catch (error) {
      console.error(error)

      if (coreSavedEvent) {
        if (coreSavedMatchDays) {
          setMatchDays(coreSavedMatchDays)
          writeCalendarAwareCache({ matchDays: coreSavedMatchDays, calendarInvites })
        } else {
          setCalendarItems(coreSavedCalendarItems)
          writeCalendarAwareCache({ calendarItems: coreSavedCalendarItems, calendarInvites })
        }
        setCalendarModal(null)
        setCalendarForm(getDefaultCalendarForm())
        setCalendarValidation(null)
        setErrorMessage('')
        showToast({
          title: 'Event saved, parent notification incomplete',
          message: 'The event was saved, but it could not be added to the Parent Portal. Parents have not been notified. Open the saved event and try again.',
          tone: 'error',
        })
        return
      }

      setCalendarValidation({
        fieldName: error.fieldName || '',
        message: error.message || 'Calendar event could not be saved.',
      })
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

    const activeSessionAssessmentCount = activeEvent.sourceType === 'session'
      ? getAssessmentCountForSession(evaluations, activeEvent.data)
      : 0
    const changeAction = activeEvent.sourceType === 'match-day' || activeSessionAssessmentCount > 0 ? 'cancelled' : 'deleted'
    const changeKey = `delete:${activeEvent.sourceType}:${activeEvent.sourceId}:${changeAction}`
    const decision = calendarChangeDecisionRef.current?.key === changeKey ? calendarChangeDecisionRef.current : null
    if (!decision) {
      setCalendarChangePrompt({
        action: changeAction,
        key: changeKey,
        operation: 'delete',
        title: activeEvent.title || 'Calendar item',
      })
      return
    }
    calendarChangeDecisionRef.current = null

    setIsSaving(true)
    setErrorMessage('')
    let changeNotificationPreparation = null

    try {
      if (decision.notifyEveryone) {
        changeNotificationPreparation = await prepareCalendarChangeNotification({
          changeAction,
          requestToken: crypto.randomUUID(),
          sourceId: activeEvent.sourceId,
          sourceType: activeEvent.sourceType,
        })
      }
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
            notificationPreparationId: changeNotificationPreparation?.preparationId || '',
            notifyEveryone: decision.notifyEveryone,
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

      await finishCalendarChangeNotification(
        changeNotificationPreparation?.preparationId,
        changeAction === 'cancelled' ? 'cancellation' : 'removal',
      )

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

    const deleteTarget = {
      session: selectedSession,
      assessmentCount: selectedSessionAssessmentCount,
      playerCount: sessionPlayers.length,
      source: 'session',
    }
    setCalendarChangePrompt({
      action: selectedSessionAssessmentCount > 0 ? 'cancelled' : 'deleted',
      deleteTarget,
      key: `delete-session:${selectedSession.id}:${selectedSessionAssessmentCount > 0 ? 'cancelled' : 'deleted'}`,
      operation: 'delete-session',
      title: selectedSession.title || selectedSession.team || 'Session',
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

      let notificationPreparationId = deleteSessionTarget.notificationPreparationId || ''
      if (deleteSessionTarget.notifyEveryone && !notificationPreparationId) {
        const preparation = await prepareCalendarChangeNotification({
          changeAction: (deleteSessionTarget.assessmentCount ?? 0) > 0 ? 'cancelled' : 'deleted',
          requestToken: crypto.randomUUID(),
          sourceId: deleteSessionTarget.session.id,
          sourceType: 'session',
        })
        notificationPreparationId = preparation.preparationId
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
      await finishCalendarChangeNotification(
        notificationPreparationId,
        deleteResult?.mode === 'cancelled' ? 'cancellation' : 'removal',
      )
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
              onClick={() => handleOpenCalendarCreate()}
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
          key={calendarModal?.responseManagerRequestId || `${calendarModal?.event?.sourceType || 'new'}:${calendarModal?.event?.sourceId || 'new'}`}
          attachedResources={currentCalendarEventResources}
          currentInvites={manageableCurrentCalendarEventInvites}
          event={calendarModal?.event}
          eventResponseManager={currentEventResponseModel.responseManager}
          form={calendarForm}
          validationError={calendarValidation}
          invitePlayers={calendarInvitePlayers}
          isBusy={isSaving}
          isResourcesLoading={isCalendarResourcesLoading}
          isOpen={Boolean(calendarModal)}
          mode={calendarModal?.mode || 'create'}
          openResponseManagerOnMount={calendarModal?.openResponseManager === true}
          playerActionError={calendarPlayerActionError}
          playerCommunicationMode={calendarPlayerCommunicationMode}
          playerReview={calendarPlayerReview}
          onCancel={handleCalendarModalClose}
          onChange={handleCalendarFormChange}
          onDelete={handleCalendarDelete}
          onEdit={handleCalendarEdit}
          onOpenWorkflow={() => {
            const href = calendarModal?.event?.href
            setCalendarModal(null)
            navigate(href || '/sessions')
          }}
          onBuildFormation={() => {
            const matchDayId = calendarModal?.event?.sourceId
            setCalendarModal(null)
            navigate(`/resources/formation-boards?action=create&match=${encodeURIComponent(matchDayId)}&autofill=attending`)
          }}
          onManagePlayers={handleOpenCalendarPlayerManagement}
          onOpenPlayerProfile={handleOpenEventResponsePlayer}
          onRemovePlayerFromEvent={handleEventPlayerRemovalAction}
          onPlayerCommunicationModeChange={(mode) => {
            setCalendarPlayerCommunicationMode(mode)
            setCalendarPlayerActionError('')
          }}
          onPlayerReviewBack={() => {
            setCalendarPlayerReview(null)
            setCalendarPlayerActionError('')
            setCalendarForm((current) => ({
              ...current,
              notificationRequestToken: createNotificationRequestToken(),
            }))
          }}
          onReviewPlayerChanges={handleReviewCalendarPlayerChanges}
          onApplyPlayerChanges={handleApplyCalendarPlayerChanges}
          onResourceIdsChange={handleCalendarResourceIdsChange}
          onAcceptOnBehalf={handleAcceptEventAvailabilityOnBehalf}
          onInvitationAction={handleEventPlayerInvitationAction}
          onMarkUnavailable={handleMarkEventUnavailableOnBehalf}
          onSelectForSquad={handleSelectEventPlayerForSquad}
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

  if (historyOnly) {
    return (
      <PreviousSessionsWorkspace
        assessmentCount={selectedSessionAssessmentCount}
        isLoading={isLoading || isSessionPlayersLoading}
        onOpenSession={handleOpenSession}
        selectedPlayerCount={sessionPlayers.length}
        selectedSession={selectedSession}
        sessions={combinedSessions}
        workspaceHref={selectedSessionWorkspaceHref}
      />
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

      {liveOnly ? (
        <LiveSessionPlanningCard
          onOpenCalendar={() => navigate('/calendar')}
          onOpenHistory={() => navigate('/sessions/previous')}
        />
      ) : (
        <FootballCalendar
          cursor={calendarCursor}
          events={calendarEvents}
          isLoading={isLoading}
          onCursorChange={setCalendarCursor}
          onOpenEvent={handleCalendarEventOpen}
          onViewChange={setCalendarView}
          view={calendarView}
        />
      )}

      {liveOnly ? (
        <section aria-label="Live session summary" className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
          <SessionMetric isLoading={isLoading} label="Sessions" value={combinedSessions.length} />
          <SessionMetric isLoading={isLoading} label="Open" value={openSessionCount} />
          <SessionMetric isLoading={isSessionPlayersLoading} label="In queue" value={sessionPlayers.length} />
          <SessionMetric isLoading={isSessionPlayersLoading} label="Remaining" value={unassessedPlayerQueue.length} />
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-4">
          <SessionSummaryCard isLoading={isLoading} label="Sessions" value={combinedSessions.length} caption="Saved training and match blocks." />
          <SessionSummaryCard isLoading={isLoading} label="Open" value={openSessionCount} caption="Sessions still available to work." />
          <SessionSummaryCard isLoading={isSessionPlayersLoading} label="In queue" value={sessionPlayers.length} caption="Players attached to the selected session." />
          <SessionSummaryCard isLoading={isSessionPlayersLoading} label="Remaining" value={unassessedPlayerQueue.length} caption="Player records still to complete." />
        </section>
      )}

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
        compact={liveOnly}
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
          compactMode={liveOnly}
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
          onFocusedPlayerChange={handleQueuePlayerFocus}
          onPageChange={setSessionPlayerPage}
          onStartVoiceNote={handleStartVoiceNote}
          onStopVoiceNote={handleStopVoiceNote}
          paginatedPlayers={paginatedSessionPlayers}
          page={sessionPlayerPage}
          recordingTarget={recordingTarget}
          focusedPlayer={focusedQueuePlayer}
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
          `Created by: ${voiceNoteDeleteTarget?.userName || voiceNoteDeleteTarget?.userEmail || 'Coach'}`,
        ]}
        confirmLabel="Delete voice note"
        onCancel={() => setVoiceNoteDeleteTarget(null)}
        onConfirm={() => void confirmDeleteVoiceNote()}
      />

      <ConfirmModal
        isOpen={Boolean(calendarChangePrompt)}
        isBusy={isSaving}
        title={`Notify everyone about this ${calendarChangePrompt?.action || 'change'}?`}
        message={calendarChangePrompt?.action === 'cancelled'
          ? 'Cancel this fixture? This keeps existing history and removes it from the active calendar. Choose whether everyone involved should receive an app notification and email.'
          : calendarChangePrompt?.action === 'deleted'
            ? `Delete ${calendarChangePrompt?.title || 'this Calendar item'}? If this is a repeat series, the entire series will be deleted. This cannot be undone. Choose whether everyone involved should receive an app notification and email.`
          : `${calendarChangePrompt?.title || 'This Calendar item'} will be ${calendarChangePrompt?.action || 'changed'}. Choose whether everyone involved should receive an app notification and email.`}
        itemsTitle="Your choices"
        items={[
          'Notify everyone: Send the update after the change is confirmed',
          'Do not notify: Save the change without contacting anyone',
          'Go back: Make no change yet',
        ]}
        cancelLabel="Go back"
        secondaryActionLabel="Do not notify"
        confirmLabel="Notify everyone"
        onCancel={() => setCalendarChangePrompt(null)}
        onSecondaryAction={() => resumeCalendarChange(false)}
        onConfirm={() => resumeCalendarChange(true)}
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
        key={calendarModal?.responseManagerRequestId || `${calendarModal?.event?.sourceType || 'new'}:${calendarModal?.event?.sourceId || 'new'}`}
        attachedResources={currentCalendarEventResources}
        currentInvites={manageableCurrentCalendarEventInvites}
        event={calendarModal?.event}
        eventResponseManager={currentEventResponseModel.responseManager}
        form={calendarForm}
        validationError={calendarValidation}
        invitePlayers={calendarInvitePlayers}
        isBusy={isSaving}
        isResourcesLoading={isCalendarResourcesLoading}
        isOpen={Boolean(calendarModal)}
        mode={calendarModal?.mode || 'create'}
        openResponseManagerOnMount={calendarModal?.openResponseManager === true}
        playerActionError={calendarPlayerActionError}
        playerCommunicationMode={calendarPlayerCommunicationMode}
        playerReview={calendarPlayerReview}
        onCancel={handleCalendarModalClose}
        onChange={handleCalendarFormChange}
        onDelete={handleCalendarDelete}
        onEdit={handleCalendarEdit}
        onOpenWorkflow={() => {
          const href = calendarModal?.event?.href
          setCalendarModal(null)
          navigate(href || '/sessions')
        }}
        onBuildFormation={() => {
          const matchDayId = calendarModal?.event?.sourceId
          setCalendarModal(null)
          navigate(`/resources/formation-boards?action=create&match=${encodeURIComponent(matchDayId)}&autofill=attending`)
        }}
        onManagePlayers={handleOpenCalendarPlayerManagement}
        onOpenPlayerProfile={handleOpenEventResponsePlayer}
        onRemovePlayerFromEvent={handleEventPlayerRemovalAction}
        onPlayerCommunicationModeChange={(mode) => {
          setCalendarPlayerCommunicationMode(mode)
          setCalendarPlayerActionError('')
        }}
        onPlayerReviewBack={() => {
          setCalendarPlayerReview(null)
          setCalendarPlayerActionError('')
          setCalendarForm((current) => ({
            ...current,
            notificationRequestToken: createNotificationRequestToken(),
          }))
        }}
        onReviewPlayerChanges={handleReviewCalendarPlayerChanges}
        onApplyPlayerChanges={handleApplyCalendarPlayerChanges}
        onResourceIdsChange={handleCalendarResourceIdsChange}
        onAcceptOnBehalf={handleAcceptEventAvailabilityOnBehalf}
        onInvitationAction={handleEventPlayerInvitationAction}
        onMarkUnavailable={handleMarkEventUnavailableOnBehalf}
        onSelectForSquad={handleSelectEventPlayerForSquad}
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

function CalendarAttachedResourcesList({ activeResourceId = '', error = '', onOpenResource, resources = [] }) {
  if (!Array.isArray(resources) || resources.length === 0) {
    return null
  }

  return (
    <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-3">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Attached resources</p>
      {error ? <p role="alert" className="mt-3 text-sm font-black text-[#b42318]">{error}</p> : null}
      <div className="mt-3 grid gap-2">
        {resources.map((resource) => (
          <button
            type="button"
            key={resource.id}
            onClick={() => onOpenResource?.(resource)}
            disabled={Boolean(activeResourceId)}
            className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-3 text-left transition hover:border-[#047857] hover:bg-[#ecfdf5] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-wait disabled:opacity-60"
          >
            <span className="block text-sm font-black text-[#101828]">{resource.title || resource.originalFilename || 'Team resource'}</span>
            <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
              {getResourceCategoryLabel(resource.category)}
              {resource.originalFilename ? `, ${resource.originalFilename}` : ''}
              {resource.fileSizeBytes ? `, ${formatResourceLibraryFileSize(resource.fileSizeBytes)}` : ''}
            </span>
            <span className="mt-2 block text-xs font-black text-[#047857]">
              {activeResourceId === resource.id ? 'Opening...' : resource.resourceType === 'external_link' ? 'Open link' : 'Open attachment'}
            </span>
          </button>
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

function getTrainingAvailabilityChipClasses(tone) {
  if (tone === 'purple') {
    return 'border-[#d8b4fe] bg-[#f3e8ff] text-[#6b21a8] dark:border-[#a855f7] dark:bg-[#3b0764] dark:text-[#f3e8ff]'
  }

  if (tone === 'green') {
    return 'border-[#86efac] bg-[#dcfce7] text-[#166534] dark:border-[#22c55e] dark:bg-[#052e16] dark:text-[#dcfce7]'
  }

  if (tone === 'red') {
    return 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b] dark:border-[#ef4444] dark:bg-[#450a0a] dark:text-[#fee2e2]'
  }

  if (tone === 'orange') {
    return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412] dark:border-[#f97316] dark:bg-[#431407] dark:text-[#ffedd5]'
  }

  return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] dark:border-[#3b82f6] dark:bg-[#172554] dark:text-[#dbeafe]'
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

function TrainingAvailabilitySettings({ form, isBusy, onChange, validationError }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
      <div className={`grid gap-4 ${form.requestTrainingAvailability === true ? 'md:grid-cols-[1fr_12rem]' : ''}`}>
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
            Request player availability?
            <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
              Sends secure response requests only to eligible parent or adult-player contacts for the attached players.
            </span>
          </span>
        </label>
        {form.requestTrainingAvailability === true ? (
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#101828]">Send days before</span>
            <input
              name="trainingAvailabilitySendDaysBefore"
              type="number"
              min="0"
              max="30"
              value={form.trainingAvailabilitySendDaysBefore ?? 2}
              onChange={onChange}
              disabled={isBusy}
              aria-invalid={validationError?.fieldName === 'trainingAvailabilitySendDaysBefore' || undefined}
              aria-describedby={validationError?.fieldName === 'trainingAvailabilitySendDaysBefore' ? 'calendar-trainingAvailabilitySendDaysBefore-error' : undefined}
              className={fieldClass}
            />
            {validationError?.fieldName === 'trainingAvailabilitySendDaysBefore' ? (
              <span id="calendar-trainingAvailabilitySendDaysBefore-error" className="mt-2 block text-xs font-black text-[#b42318]">
                {validationError.message}
              </span>
            ) : null}
          </label>
        ) : null}
      </div>
      <p className="mt-3 text-xs font-bold leading-5 text-[#4b5f55]">
        For repeating training, this applies separately to each occurrence.
      </p>
    </div>
  )
}

function EventPlayerManagementPanel({
  actionError = '',
  communicationMode,
  currentInvites = [],
  event,
  form,
  invitePlayers = [],
  isBusy,
  matchInviteStatesByPlayerId = {},
  onApply,
  onBack,
  onChange,
  onCommunicationModeChange,
  onReview,
  review,
}) {
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false)
  const errorSummaryRef = useRef(null)
  const currentInviteByPlayerId = new Map(
    currentInvites.map((invite) => [String(invite.playerId ?? ''), invite]),
  )
  const currentPlayerIds = new Set(currentInviteByPlayerId.keys())
  const selectedPlayerIds = new Set((form.invitedPlayerIds ?? []).map(String))
  const selectedRemovalIds = new Set(review?.selectedRemovalPlayerIds ?? [])
  const playersById = new Map(invitePlayers.map((player) => [String(player.id), player]))
  const getPlayerName = (playerId) => (
    playersById.get(String(playerId))?.playerName
    || currentInviteByPlayerId.get(String(playerId))?.player?.playerName
    || 'Player'
  )
  const recipientCount = getEventPlayerCommunicationRecipientCount(review, communicationMode)
  const missingContactNames = getEventPlayerCommunicationMissingIds(review, communicationMode).map(getPlayerName)
  const communicationPlayerCount = communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded
    ? review?.addedPlayerIds?.length ?? 0
    : communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.notifyRemoved
      ? review?.removedPlayerIds?.length ?? 0
      : communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll
        ? review?.selectedPlayerIds?.length ?? 0
        : 0
  const hasChanges = Boolean((review?.addedPlayerIds?.length ?? 0) + (review?.removedPlayerIds?.length ?? 0))
  const canApply = Boolean(
    review
    && (
      hasChanges
      || communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll
    )
  )
  const primaryLabel = (() => {
    const addedCount = review?.addedPlayerIds?.length ?? 0
    const removedCount = review?.removedPlayerIds?.length ?? 0

    if (communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded) {
      return `Add ${addedCount} player${addedCount === 1 ? '' : 's'} and notify ${recipientCount} eligible recipient${recipientCount === 1 ? '' : 's'}`
    }

    if (communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.notifyRemoved) {
      return `Remove ${removedCount} player${removedCount === 1 ? '' : 's'} and notify ${recipientCount} eligible recipient${recipientCount === 1 ? '' : 's'}`
    }

    if (communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll) {
      return `Resend invitations to ${recipientCount} eligible recipient${recipientCount === 1 ? '' : 's'}`
    }

    if (addedCount > 0 && removedCount > 0) {
      return `Save ${addedCount} addition${addedCount === 1 ? '' : 's'} and ${removedCount} removal${removedCount === 1 ? '' : 's'} without notifications`
    }

    if (addedCount > 0) {
      return `Add ${addedCount} player${addedCount === 1 ? '' : 's'} without notifications`
    }

    return `Remove ${removedCount} player${removedCount === 1 ? '' : 's'} without notification`
  })()
  const confirmationItems = [
    `${review?.addedPlayerIds?.length ?? 0} added`,
    `${review?.removedPlayerIds?.length ?? 0} removed`,
    `${review?.unchangedPlayerIds?.length ?? 0} unchanged`,
    communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.none
      ? 'No notifications will be queued'
      : `${communicationPlayerCount} player${communicationPlayerCount === 1 ? '' : 's'} are in scope and ${recipientCount} eligible recipient${recipientCount === 1 ? '' : 's'} will be queued`,
    ...(selectedRemovalIds.size > 0
      ? [`${selectedRemovalIds.size} selected match player${selectedRemovalIds.size === 1 ? '' : 's'} will be changed to Not selected`]
      : []),
  ]

  useEffect(() => {
    if (!actionError) {
      return undefined
    }

    const focusFrame = window.requestAnimationFrame(() => errorSummaryRef.current?.focus())
    return () => window.cancelAnimationFrame(focusFrame)
  }, [actionError])

  return (
    <>
      <div data-testid="event-player-management" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
          {actionError ? (
            <div
              ref={errorSummaryRef}
              id="event-player-management-error"
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              className="mb-4 rounded-lg border border-[#fda29b] bg-[#fff1f0] px-4 py-3 text-[#b42318] focus:outline-none focus:ring-2 focus:ring-[#fda29b]"
            >
              <p className="text-sm font-black">Player changes need attention</p>
              <p className="mt-1 text-sm font-semibold leading-6">{actionError}</p>
            </div>
          ) : null}
          {!review ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3">
                <p className="text-sm font-black text-[#065f46]">Player changes and communications are separate</p>
                <p className="mt-1 text-xs font-bold leading-5 text-[#4b5f55]">
                  Review the player delta first. The safe default saves additions and removals without sending email, push, SMS, or invitation resends.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-[#101828]">{getEventPlayerManagementLabel(form.eventType)}</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-[#4b5f55]">
                    {selectedPlayerIds.size} selected for {event?.title || 'this event'}
                  </p>
                </div>
                <span className="rounded-full border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#101828]">
                  {currentPlayerIds.size} current
                </span>
              </div>

              <div className="max-h-[min(28rem,55vh)] overflow-y-auto rounded-lg border border-[#d7e5dc] bg-white">
                {invitePlayers.map((player) => {
                  const playerId = String(player.id)
                  const isCurrent = currentPlayerIds.has(playerId)
                  const isSelected = selectedPlayerIds.has(playerId)
                  const invite = currentInviteByPlayerId.get(playerId)
                  const eventState = invite?.display || matchInviteStatesByPlayerId[playerId]
                  const changeLabel = isCurrent && !isSelected
                    ? 'Marked for removal'
                    : !isCurrent && isSelected
                      ? 'Newly added'
                      : isCurrent
                        ? 'Current'
                        : 'Available'
                  const changeTone = isCurrent && !isSelected
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : !isCurrent && isSelected
                      ? 'border-[#bbf7d0] bg-[#ecfdf5] text-[#065f46]'
                      : 'border-[#d7e5dc] bg-[#f7faf8] text-[#4b5f55]'
                  const deliveryLabel = eventState?.accessibleLabel
                    || (invite?.notifyRequested ? 'Notification requested' : isCurrent ? 'Added, not notified' : 'Invitation not sent')

                  return (
                    <label
                      key={player.id}
                      className="flex min-h-16 items-start gap-3 border-b border-[#d7e5dc] px-3 py-3 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        name="invitedPlayerIds"
                        value={player.id}
                        checked={isSelected}
                        onChange={onChange}
                        disabled={isBusy}
                        className="mt-1 h-5 w-5 shrink-0 accent-[#047857]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-[#101828]">{player.playerName}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${changeTone}`}>
                            {changeLabel}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs font-bold text-[#4b5f55]">
                          {player.section || 'Player'} · {deliveryLabel}
                        </span>
                        {eventState?.matchSelectionLabel ? (
                          <span className="mt-1 block text-xs font-black text-[#047857]">
                            Match selection: {eventState.matchSelectionLabel}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <PlayerChangeMetric label="Added" value={review.addedPlayerIds.length} />
                <PlayerChangeMetric label="Removed" value={review.removedPlayerIds.length} tone="red" />
                <PlayerChangeMetric label="Unchanged" value={review.unchangedPlayerIds.length} />
              </div>

              <PlayerChangeReviewList
                getPlayerName={getPlayerName}
                groups={[
                  { ids: review.addedPlayerIds, label: 'Players added' },
                  { ids: review.removedPlayerIds, label: 'Players removed' },
                  { ids: review.unchangedPlayerIds, label: 'Players unchanged' },
                ]}
              />

              {selectedRemovalIds.size > 0 ? (
                <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3">
                  <p className="text-sm font-black text-[#92400e]">Selected-player confirmation required</p>
                  <p className="mt-1 text-xs font-bold leading-5 text-[#92400e]">
                    {selectedRemovalIds.size} removed match player{selectedRemovalIds.size === 1 ? ' is' : 's are'} currently selected. Saving will preserve the history and change the current squad decision to Not selected.
                  </p>
                </div>
              ) : null}

              <fieldset className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <legend className="px-1 text-sm font-black text-[#101828]">Communication choice</legend>
                <div className="mt-2 grid gap-3">
                  <PlayerCommunicationChoice
                    checked={communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.none}
                    description="Save player changes only. No email, push, SMS, or invitation resend will occur."
                    label="Save player changes without notifications"
                    mode={EVENT_PLAYER_COMMUNICATION_MODES.none}
                    onChange={onCommunicationModeChange}
                  />
                  <PlayerCommunicationChoice
                    checked={communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded}
                    description={`${review.addedPlayerIds.length} newly added player${review.addedPlayerIds.length === 1 ? '' : 's'}. ${review.addedRecipientCount} eligible authorised recipient${review.addedRecipientCount === 1 ? '' : 's'} can be notified.`}
                    disabled={review.addedPlayerIds.length === 0}
                    label="Notify newly added players only"
                    mode={EVENT_PLAYER_COMMUNICATION_MODES.notifyAdded}
                    onChange={onCommunicationModeChange}
                  />
                  <PlayerCommunicationChoice
                    checked={communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.notifyRemoved}
                    description={`${review.removedPlayerIds.length} removed player${review.removedPlayerIds.length === 1 ? '' : 's'}. ${review.removedRecipientCount} eligible authorised recipient${review.removedRecipientCount === 1 ? '' : 's'} can be notified.`}
                    disabled={review.removedPlayerIds.length === 0}
                    label="Notify removed players only"
                    mode={EVENT_PLAYER_COMMUNICATION_MODES.notifyRemoved}
                    onChange={onCommunicationModeChange}
                  />
                </div>
              </fieldset>

              <fieldset className="rounded-lg border border-[#fedf89] bg-[#fffaeb] p-4">
                <legend className="px-1 text-sm font-black text-[#92400e]">Separate resend action</legend>
                <PlayerCommunicationChoice
                  checked={communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll}
                  description={`${review.selectedPlayerIds.length} current player${review.selectedPlayerIds.length === 1 ? '' : 's'}. All ${review.currentRecipientCount} eligible authorised recipient${review.currentRecipientCount === 1 ? '' : 's'} will be contacted. Retries use the same idempotent command.`}
                  disabled={review.selectedPlayerIds.length === 0}
                  label="Resend invitations to everyone"
                  mode={EVENT_PLAYER_COMMUNICATION_MODES.resendAll}
                  onChange={onCommunicationModeChange}
                />
              </fieldset>

              <div className="rounded-lg border border-[#d7e5dc] bg-white p-4">
                <p className="text-sm font-black text-[#101828]">Communication review</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                  {communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.none
                    ? 'No notifications will be sent.'
                    : `${communicationPlayerCount} player${communicationPlayerCount === 1 ? '' : 's'} are in this action. ${recipientCount} eligible authorised recipient${recipientCount === 1 ? '' : 's'} can be queued.`}
                </p>
                {missingContactNames.length > 0 ? (
                  <p className="mt-2 text-xs font-bold leading-5 text-[#92400e]">
                    No active authorised Parent or adult-player contact: {missingContactNames.join(', ')}. Their player changes will still be saved, but no invitation can be sent for them.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#d7e5dc] bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {review ? (
              <button type="button" onClick={onBack} disabled={isBusy} className={secondaryButtonClass}>
                Back to players
              </button>
            ) : null}
            <button
              type="button"
              onClick={review ? () => setIsConfirmationOpen(true) : onReview}
              disabled={isBusy || (review ? !canApply : false)}
              className={primaryButtonClass}
            >
              {isBusy ? 'Working...' : review ? primaryLabel : 'Review player changes'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={isConfirmationOpen}
        isBusy={isBusy}
        title={communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll
          ? 'Confirm resend to all current contacts'
          : 'Confirm player changes'}
        message={communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.none
          ? 'Player changes will be saved without notifications.'
          : 'Only the reviewed recipient scope will be queued. Unchanged recipients are not contacted unless resend all was selected.'}
        items={confirmationItems}
        itemsTitle="This command will:"
        confirmLabel={primaryLabel}
        onCancel={() => setIsConfirmationOpen(false)}
        onConfirm={async () => {
          await onApply({
            confirmResendAll: communicationMode === EVENT_PLAYER_COMMUNICATION_MODES.resendAll,
            confirmSelectedRemovals: selectedRemovalIds.size > 0,
          })
          setIsConfirmationOpen(false)
        }}
      />
    </>
  )
}

function PlayerChangeMetric({ label, tone = 'green', value }) {
  const toneClass = tone === 'red'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-[#bbf7d0] bg-[#ecfdf5] text-[#065f46]'

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  )
}

function PlayerChangeReviewList({ getPlayerName, groups = [] }) {
  return (
    <div className="rounded-lg border border-[#d7e5dc] bg-white p-4">
      <p className="text-sm font-black text-[#101828]">Player delta</p>
      <div className="mt-3 grid gap-3">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">{group.label}</p>
            <p className="mt-1 text-sm font-semibold leading-6 text-[#4b5f55]">
              {group.ids.length > 0 ? group.ids.map(getPlayerName).join(', ') : 'None'}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlayerCommunicationChoice({
  checked,
  description,
  disabled = false,
  label,
  mode,
  onChange,
}) {
  return (
    <label className={`flex min-h-12 items-start gap-3 rounded-lg border px-3 py-3 ${checked ? 'border-[#047857] bg-[#ecfdf5]' : 'border-[#d7e5dc] bg-white'} ${disabled ? 'opacity-55' : ''}`}>
      <input
        type="radio"
        name="eventPlayerCommunicationMode"
        value={mode}
        checked={checked}
        onChange={() => onChange(mode)}
        disabled={disabled}
        className="mt-1 h-5 w-5 shrink-0 accent-[#047857]"
      />
      <span>
        <span className="block text-sm font-black text-[#101828]">{label}</span>
        <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">{description}</span>
      </span>
    </label>
  )
}

function EventPlayerRemovalModal({
  action,
  isBusy,
  onCancel,
  onConfirm,
  onScopeChange,
}) {
  const [confirmInProgress, setConfirmInProgress] = useState(false)

  if (!action) {
    return null
  }

  const preview = action.preview || {}
  const recurring = preview.recurring === true
  const requiresInProgressConfirmation = preview.requiresInProgressConfirmation === true
  const canConfirm = !isBusy && (!requiresInProgressConfirmation || confirmInProgress)

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-[#101828]/55 p-0 sm:items-center sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-player-removal-title"
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="event-player-removal-title" className="text-xl font-black text-[#101828]">Remove from event</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
          Remove {action.playerName || 'this Player'} from this event participation. The Player remains on the Team and the Player record stays intact.
        </p>

        {recurring ? (
          <fieldset className="mt-5 grid gap-3">
            <legend className="text-sm font-black text-[#101828]">Removal scope</legend>
            <label className={`flex items-start gap-3 rounded-lg border p-4 ${action.scope === EVENT_PLAYER_REMOVAL_SCOPES.occurrence ? 'border-[#047857] bg-[#ecfdf5]' : 'border-[#d7e5dc] bg-white'}`}>
              <input
                type="radio"
                name="eventPlayerRemovalScope"
                checked={action.scope === EVENT_PLAYER_REMOVAL_SCOPES.occurrence}
                disabled={isBusy}
                onChange={() => onScopeChange(EVENT_PLAYER_REMOVAL_SCOPES.occurrence)}
                className="mt-1 h-5 w-5 accent-[#047857]"
              />
              <span>
                <span className="block text-sm font-black text-[#101828]">Remove from this occurrence</span>
                <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">Earlier and later occurrences remain unchanged.</span>
              </span>
            </label>
            <label className={`flex items-start gap-3 rounded-lg border p-4 ${action.scope === EVENT_PLAYER_REMOVAL_SCOPES.thisAndFuture ? 'border-[#047857] bg-[#ecfdf5]' : 'border-[#d7e5dc] bg-white'}`}>
              <input
                type="radio"
                name="eventPlayerRemovalScope"
                checked={action.scope === EVENT_PLAYER_REMOVAL_SCOPES.thisAndFuture}
                disabled={isBusy}
                onChange={() => onScopeChange(EVENT_PLAYER_REMOVAL_SCOPES.thisAndFuture)}
                className="mt-1 h-5 w-5 accent-[#047857]"
              />
              <span>
                <span className="block text-sm font-black text-[#101828]">Remove from this and future occurrences</span>
                <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">Earlier occurrences and another recurring series remain unchanged.</span>
              </span>
            </label>
          </fieldset>
        ) : null}

        <div className="mt-5 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
          <p className="text-sm font-black text-[#101828]">Server-calculated impact</p>
          <ul className="mt-2 grid gap-2 text-sm font-semibold text-[#4b5f55]">
            <li>Effective occurrences: {preview.affectedOccurrenceCount ?? 0}</li>
            <li>Unsent invitations and reminders suppressed: {preview.suppressedInvitationCount ?? 0}</li>
            <li>Active response links revoked: {preview.revokedTokenCount ?? 0}</li>
            <li>Team membership unchanged</li>
            <li>Previous responses and delivered communication evidence preserved</li>
            <li>No removal notification will be sent</li>
          </ul>
        </div>

        {requiresInProgressConfirmation ? (
          <label className="mt-4 flex items-start gap-3 rounded-lg border border-[#fdb022] bg-[#fffaeb] p-4 text-sm font-bold text-[#7a2e0e]">
            <input
              type="checkbox"
              checked={confirmInProgress}
              disabled={isBusy}
              onChange={(changeEvent) => setConfirmInProgress(changeEvent.currentTarget.checked)}
              className="mt-1 h-5 w-5 accent-[#b54708]"
            />
            <span>This event is currently in progress. I understand that recorded Match or attendance history will be preserved.</span>
          </label>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" disabled={isBusy} onClick={onCancel} className={secondaryButtonClass}>Cancel</button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm({ confirmInProgress })}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove from event
          </button>
        </div>
      </section>
    </div>
  )
}

function CalendarEventModal({
  attachedResources = [],
  clubWideOnly = false,
  currentInvites = [],
  event,
  eventResponseManager = null,
  form,
  validationError = null,
  invitePlayers = [],
  isBusy,
  isResourcesLoading = false,
  isOpen,
  mode,
  openResponseManagerOnMount = false,
  playerActionError = '',
  playerCommunicationMode = EVENT_PLAYER_COMMUNICATION_MODES.none,
  playerReview = null,
  onCancel,
  onChange,
  onDelete,
  onEdit,
  onAcceptOnBehalf,
  onInvitationAction,
  onMarkUnavailable,
  onSelectForSquad,
  onApplyPlayerChanges,
  onBuildFormation,
  onManagePlayers,
  onOpenPlayerProfile,
  onOpenWorkflow,
  onRemovePlayerFromEvent,
  onPlayerCommunicationModeChange,
  onPlayerReviewBack,
  onResourceIdsChange,
  onReviewPlayerChanges,
  onSubmit,
  resourceOptions = [],
  selectedInvitePlayers = [],
  trainingAvailabilitySummary = null,
  teams,
  user,
  variant = '',
}) {
  const [availabilityAction, setAvailabilityAction] = useState(null)
  const [playerRemovalAction, setPlayerRemovalAction] = useState(null)
  const [playerRemovalResult, setPlayerRemovalResult] = useState(null)
  const [openingAttachedResourceId, setOpeningAttachedResourceId] = useState('')
  const [attachedResourceError, setAttachedResourceError] = useState('')
  const [isMobileActionMenuOpen, setIsMobileActionMenuOpen] = useState(false)
  const [isResponseManagerOpen, setIsResponseManagerOpen] = useState(
    () => openResponseManagerOnMount && eventResponseManager?.counts?.total > 0,
  )
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const mobileActionMenuButtonRef = useRef(null)
  const mobileActionMenuRef = useRef(null)
  const responseManagerButtonRef = useRef(null)
  const responseManagerDialogRef = useRef(null)
  const returnFocusRef = useRef(null)
  const editingIdentityRef = useRef('')
  const [editingBaseline, setEditingBaseline] = useState('')
  const calendarModalViewportStyle = useCalendarModalViewportStyle(isOpen)
  const isEditingMode = mode !== 'view' && mode !== 'manage-players'

  useEffect(() => {
    if (!isOpen || !isEditingMode) {
      editingIdentityRef.current = ''
      const resetFrame = window.requestAnimationFrame(() => setEditingBaseline(''))
      return () => window.cancelAnimationFrame(resetFrame)
    }

    const identity = `${variant}:${mode}:${event?.sourceType || 'new'}:${event?.sourceId || event?.id || 'new'}`
    if (editingIdentityRef.current !== identity) {
      editingIdentityRef.current = identity
      const baselineFrame = window.requestAnimationFrame(() => setEditingBaseline(JSON.stringify(form)))
      return () => window.cancelAnimationFrame(baselineFrame)
    }
    return undefined
  }, [event?.id, event?.sourceId, event?.sourceType, form, isEditingMode, isOpen, mode, variant])

  useCalendarModalPageScrollLock(isOpen)

  const handleModalCancel = useCallback(() => {
    setAvailabilityAction(null)
    setPlayerRemovalAction(null)
    setIsMobileActionMenuOpen(false)
    setIsResponseManagerOpen(false)
    onCancel()
  }, [onCancel, setAvailabilityAction, setIsMobileActionMenuOpen, setIsResponseManagerOpen])

  const handleModalSubmit = (submitEvent) => {
    setIsMobileActionMenuOpen(false)
    onSubmit(submitEvent)
  }

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    returnFocusRef.current = document.activeElement
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    return () => {
      window.cancelAnimationFrame(focusFrame)
      const returnTarget = returnFocusRef.current

      if (returnTarget && document.contains(returnTarget) && typeof returnTarget.focus === 'function') {
        window.requestAnimationFrame(() => returnTarget.focus())
      }
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()

        if (playerRemovalAction) {
          setPlayerRemovalAction(null)
          return
        }

        if (availabilityAction) {
          setAvailabilityAction(null)
          return
        }

        if (isResponseManagerOpen) {
          setIsResponseManagerOpen(false)
          window.requestAnimationFrame(() => responseManagerButtonRef.current?.focus())
          return
        }

        if (isMobileActionMenuOpen) {
          setIsMobileActionMenuOpen(false)
          window.requestAnimationFrame(() => mobileActionMenuButtonRef.current?.focus())
          return
        }

        if (!isBusy) {
          handleModalCancel()
        }
        return
      }

      if (event.key !== 'Tab') {
        return
      }

      const confirmationDialogs = availabilityAction || playerRemovalAction
        ? [...document.querySelectorAll('[role="dialog"]')]
        : []
      const activeRoot = availabilityAction || playerRemovalAction
        ? confirmationDialogs.at(-1)
        : isResponseManagerOpen
          ? responseManagerDialogRef.current
          : isMobileActionMenuOpen
            ? mobileActionMenuRef.current
            : dialogRef.current
      const focusableElements = getModalFocusableElements(activeRoot)

      if (focusableElements.length === 0) {
        event.preventDefault()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements.at(-1)

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    availabilityAction,
    handleModalCancel,
    isBusy,
    isMobileActionMenuOpen,
    isOpen,
    isResponseManagerOpen,
    playerRemovalAction,
  ])

  useEffect(() => {
    if (!isOpen || (!availabilityAction && !playerRemovalAction)) {
      return undefined
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      getModalFocusableElements(dialogs.at(-1))[0]?.focus()
    })

    return () => window.cancelAnimationFrame(focusFrame)
  }, [availabilityAction, isOpen, playerRemovalAction])

  useEffect(() => {
    if (!isOpen || !isMobileActionMenuOpen) {
      return undefined
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const menu = mobileActionMenuRef.current
      const firstAction = menu?.querySelector('[role="menuitem"]:not([disabled])')
      const firstFocusable = getModalFocusableElements(menu)[0]
      const focusTarget = firstAction || firstFocusable
      focusTarget?.focus()
    })

    return () => window.cancelAnimationFrame(focusFrame)
  }, [isMobileActionMenuOpen, isOpen])

  useEffect(() => {
    if (!isOpen || !validationError) {
      return undefined
    }

    const focusFrame = window.requestAnimationFrame(() => {
      const fieldName = String(validationError.fieldName || '').trim()
      const field = fieldName
        ? dialogRef.current?.querySelector(`[name="${fieldName}"]`)
          || dialogRef.current?.querySelector(`[data-calendar-field="${fieldName}"]`)
        : null
      const target = field || dialogRef.current?.querySelector('#calendar-modal-validation-summary')

      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(focusFrame)
  }, [isOpen, validationError])

  if (!isOpen) {
    return null
  }

  const isManagingPlayers = mode === 'manage-players'
  const isEditing = isEditingMode
  const hasUnsavedEditorChanges = Boolean(
    isEditing
      && editingBaseline
      && JSON.stringify(form) !== editingBaseline,
  )
  const editableSource = !event || event.editable !== false
  const isAssessmentReminder = event?.sourceType === 'assessment-reminder'
  const canManageEventPlayers = editableSource && ['calendar', 'match-day', 'session'].includes(event?.sourceType)
  const canDeleteEvent = Boolean(event && editableSource && !isAssessmentReminder)
  const isInheritedClubEvent = Boolean(event?.isInheritedClubEvent || event?.data?.isInheritedClubEvent)
  const showOpponent = form.eventType === 'match'
  const isMatchFixture = form.eventType === 'match'
  const showRecurrence = form.eventType !== 'match'
  const isSessionCreate = mode === 'create' && variant === 'session'
  const title = isManagingPlayers
    ? getEventPlayerManagementLabel(form.eventType)
    : isSessionCreate
      ? 'Create session'
      : mode === 'create'
        ? 'Add calendar event'
        : mode === 'edit'
          ? isAssessmentReminder ? 'Reschedule Development review' : 'Edit calendar event'
          : 'Calendar event'
  const selectedSummary = isMatchFixture
    ? [
      form.date,
      form.kickoffTimeTbc ? 'Time TBC' : form.startTime ? `Kick-off ${form.startTime}` : '',
      MATCH_DAY_SHIRT_CHOICE_OPTIONS.find((option) => option.value === form.shirtChoice)?.label || 'Home shirts',
      form.location,
    ].filter(Boolean).join(', ')
    : [form.date, form.startTime, form.location].filter(Boolean).join(', ')
  const canUseClubLevel = canCreateClubCalendarEvent(user)
  const safeFormTeamId = clubWideOnly ? '' : getSafeCalendarTeamId(user, form.teamId)
  const canShareClubWideWithParents = isClubWideShareableCalendarEvent({ form, safeTeamId: safeFormTeamId, user })
  const canShowTeamResourceArea = Boolean(!clubWideOnly && safeFormTeamId && canManageResourceLibrary(user))
  const canUseCalendarResourceLinks = Boolean((!event || event.sourceType === 'calendar') && isCalendarResourceEventType(form.eventType))
  const canAttachResources = canShowTeamResourceArea && canUseCalendarResourceLinks
  const canShowTrainingAvailability = Boolean(!clubWideOnly && safeFormTeamId && form.eventType === 'training' && (!event || event.sourceType === 'calendar'))
  const isTrainingRsvpMode = canShowTrainingAvailability && form.requestTrainingAvailability === true
  const showInvites = !canShareClubWideWithParents && (
    isTrainingRsvpMode || (form.shareWithParents && form.parentAudience === 'involved_players')
  )
  const selectedResourceIds = new Set(Array.isArray(form.resourceIds) ? form.resourceIds.map(String) : [])
  const isRecurringCalendarEdit = isRecurringCalendarEvent({ event, form })
  const repeatUpdateScopeRequired = hasRecurringCalendarDateTimeChange({ event, form })
  const showRepeatUpdateScope = isRecurringCalendarEdit
  const showRepeatDeleteScope = Boolean(event && editableSource && isRecurringCalendarEdit)
  const deleteButtonDisabled = isBusy || (showRepeatDeleteScope && form.deleteRepeatScope !== 'entire_series')
  const hasMobileSecondaryActions = Boolean(event && editableSource && (!isEditing || canDeleteEvent))
  const canBuildFormation = Boolean(event?.sourceType === 'match-day' && event?.sourceId && onBuildFormation)
  const squadPlayers = invitePlayers.filter((player) => String(player.section ?? '').trim().toLowerCase() === 'squad')
  const trialPlayers = invitePlayers.filter((player) => String(player.section ?? '').trim().toLowerCase() === 'trial')
  const invitedPlayerIds = new Set(Array.isArray(form.invitedPlayerIds) ? form.invitedPlayerIds.map(String) : [])
  const wholeSquadSelectionState = getWholeSquadSelectionState({
    includeTrialPlayers: form.inviteTrialPlayers,
    invitePlayers,
    selectedPlayerIds: form.invitedPlayerIds,
  })
  const inviteTeamId = canUseClubLevel ? form.teamId : form.teamId || user?.activeTeamId
  const hasInviteTeam = Boolean(String(inviteTeamId || '').trim())
  const availabilityOccurrenceDate = getTrainingAvailabilityOccurrenceDate({ event, form })
  const trainingAvailabilityDetails = getTrainingAvailabilityDetailsForOccurrence(trainingAvailabilitySummary, availabilityOccurrenceDate)
  const eventTypeOptions = getCalendarEventTypeOptions(user, { clubWideOnly })
  const parentAudienceOptions = [
    { value: 'involved_players', label: 'Only parents of involved players' },
    ...(hasInviteTeam ? [{ value: 'all_team_parents', label: 'All parents in the team' }] : []),
    ...(canUseClubLevel ? [{ value: 'all_club_parents', label: 'All parents in the club' }] : []),
  ]
  const matchInviteStatesByPlayerId = event?.sourceType === 'match-day'
    ? Object.fromEntries(
        currentInvites.map((invite) => [
          String(invite.playerId ?? ''),
          invite.display,
        ]),
      )
    : {}
  const validationProps = (fieldName) => validationError?.fieldName === fieldName
    ? {
        'aria-describedby': `calendar-${fieldName}-error`,
        'aria-invalid': true,
      }
    : {}
  const validationMessage = (fieldName) => validationError?.fieldName === fieldName ? (
    <span id={`calendar-${fieldName}-error`} className="mt-2 block text-xs font-black text-[#b42318]">
      {validationError.message}
    </span>
  ) : null

  const handleOpenAttachedResource = async (resource) => {
    if (!resource?.id || openingAttachedResourceId) return

    const pendingWindow = window.open('', '_blank')
    if (pendingWindow) pendingWindow.opener = null
    setOpeningAttachedResourceId(resource.id)
    setAttachedResourceError('')

    try {
      const accessUrl = await getResourceLibraryDownloadUrl({
        resourceId: resource.id,
        teamId: safeFormTeamId,
        user,
      })

      if (!accessUrl) throw new Error('Attachment link could not be prepared.')
      if (pendingWindow) pendingWindow.location.replace(accessUrl)
      else window.location.assign(accessUrl)
    } catch (error) {
      pendingWindow?.close()
      console.error(error)
      setAttachedResourceError(error.message || 'This attachment could not be opened.')
    } finally {
      setOpeningAttachedResourceId('')
    }
  }

  return (
    <>
      <div
        className="fixed inset-x-0 top-[var(--calendar-modal-viewport-top)] z-[80] flex h-[var(--calendar-modal-viewport-height)] items-stretch justify-center overflow-hidden bg-[#101828]/45 sm:inset-x-0 sm:items-center sm:px-4 sm:py-6"
        style={calendarModalViewportStyle}
      >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-modal-title"
        aria-hidden={availabilityAction || isResponseManagerOpen ? 'true' : undefined}
        data-testid="calendar-event-modal"
        className="relative flex h-screen min-h-0 w-full max-w-3xl flex-col overflow-hidden border border-[#d7e5dc] bg-white shadow-xl shadow-[#047857]/15 sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:rounded-lg"
        style={{
          height: 'var(--calendar-modal-viewport-height)',
          maxHeight: 'var(--calendar-modal-viewport-height)',
        }}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={handleModalCancel}
          disabled={isBusy}
          className="absolute right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-10 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#ecfdf5] text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#bbf7d0] disabled:cursor-not-allowed disabled:opacity-60 sm:right-4 sm:top-4"
          aria-label="Close calendar event"
        >
          X
        </button>
        <div className="shrink-0 border-b border-[#d7e5dc] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pb-4 sm:pt-6">
          <p className={eyebrowClass}>Calendar</p>
          <h2 id="calendar-event-modal-title" className="mt-1.5 pr-14 text-xl font-black tracking-tight text-[#101828] sm:mt-3 sm:text-2xl">{title}</h2>
          <p className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-[#4b5f55] sm:mt-2 sm:text-sm sm:leading-6">
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
          isManagingPlayers ? (
            <EventPlayerManagementPanel
              actionError={playerActionError}
              communicationMode={playerCommunicationMode}
              currentInvites={currentInvites}
              event={event}
              form={form}
              invitePlayers={invitePlayers}
              isBusy={isBusy}
              matchInviteStatesByPlayerId={matchInviteStatesByPlayerId}
              onApply={onApplyPlayerChanges}
              onBack={onPlayerReviewBack}
              onChange={onChange}
              onCommunicationModeChange={onPlayerCommunicationModeChange}
              onReview={onReviewPlayerChanges}
              review={playerReview}
            />
          ) : (
          <div data-testid="calendar-event-modal-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
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
                  <p className="mt-1 text-sm font-black text-[#101828]">{form.kickoffTimeTbc ? 'Time TBC' : form.startTime || 'Not set'}</p>
                </div>
                {form.opponent ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Opponent</p>
                    <p className="mt-1 text-sm font-black text-[#101828]">{form.opponent}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Home or away</p>
                  <p className="mt-1 text-sm font-black text-[#101828]">{MATCH_DAY_HOME_AWAY_OPTIONS.find((option) => option.value === form.homeAway)?.label || 'Home'}</p>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Shirts</p>
                  <p className="mt-1 text-sm font-black text-[#101828]">{MATCH_DAY_SHIRT_CHOICE_OPTIONS.find((option) => option.value === form.shirtChoice)?.label || 'Home shirts'}</p>
                </div>
                {form.location ? (
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">Location</p>
                    <p className="mt-1 text-sm font-black text-[#101828]">{form.location}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {playerRemovalResult ? (
              <div role="status" className="mt-4 rounded-lg border border-[#86efac] bg-[#ecfdf5] p-4 text-sm font-semibold text-[#065f46]">
                <p className="font-black">Player removed</p>
                <p className="mt-1">
                  Scope: {playerRemovalResult.scope === EVENT_PLAYER_REMOVAL_SCOPES.thisAndFuture
                    ? 'This and future occurrences'
                    : playerRemovalResult.scope === EVENT_PLAYER_REMOVAL_SCOPES.occurrence
                      ? 'This occurrence'
                      : 'This event'}
                </p>
                <p className="mt-1">Effective occurrences: {playerRemovalResult.affectedOccurrenceCount ?? 0}</p>
                <p className="mt-1">Communication suppressed: {playerRemovalResult.suppressedInvitationCount ?? 0}</p>
                <p className="mt-1">Team membership unchanged. Previous responses and delivered evidence are preserved.</p>
              </div>
            ) : null}
            {eventResponseManager?.counts?.total > 0 ? (
              <EventResponseSummary
                buttonRef={responseManagerButtonRef}
                manager={eventResponseManager}
                onViewResponses={() => {
                  setIsResponseManagerOpen(true)
                }}
              />
            ) : (
              <div className="mt-4 rounded-lg border border-[#d7e5dc] bg-white p-4">
                <p className="text-sm font-black text-[#101828]">No players have been added to this event.</p>
              </div>
            )}
            {form.eventType === 'training' ? <TrainingAvailabilityParentNotes details={trainingAvailabilityDetails} /> : null}
            <CalendarAttachedResourcesList
              activeResourceId={openingAttachedResourceId}
              error={attachedResourceError}
              onOpenResource={handleOpenAttachedResource}
              resources={attachedResources}
            />
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
          )
        ) : null}

        {isEditing ? (
          <form noValidate onSubmit={handleModalSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div data-testid="calendar-event-modal-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-pb-24 px-4 py-4 [-webkit-overflow-scrolling:touch] sm:scroll-pb-32 sm:px-6 sm:py-5">
            <div className="grid gap-4">
              {validationError ? (
                <div
                  id="calendar-modal-validation-summary"
                  role="alert"
                  aria-live="assertive"
                  tabIndex={-1}
                  className="rounded-lg border border-[#fda29b] bg-[#fff1f0] px-4 py-3 text-sm font-black text-[#b42318]"
                >
                  {validationError.message}
                </div>
              ) : null}
              {isAssessmentReminder ? (
                <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
                  <p className="text-sm font-black text-[#101828]">{event.title || 'Development review reminder'}</p>
                  <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
                    Choose a new date for this missed Development review. The original reminder remains in the audit history.
                  </p>
                  <label className="mt-4 block">
                    <span className="mb-2 block text-sm font-black text-[#101828]">New review date</span>
                    <input
                      name="date"
                      {...validationProps('date')}
                      type="date"
                      min={getTodayMatchDayDateValue()}
                      value={form.date}
                      onChange={onChange}
                      required
                      className={fieldClass}
                    />
                    {validationMessage('date')}
                  </label>
                </div>
              ) : (
              <>
              <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Type</span>
                <select
                  name="eventType"
                  {...validationProps('eventType')}
                  value={form.eventType}
                  onChange={onChange}
                  disabled={isBusy || Boolean(event && event.sourceType !== 'calendar')}
                  className={fieldClass}
                >
                  {eventTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {validationMessage('eventType')}
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
                  <select name="teamId" {...validationProps('teamId')} value={form.teamId} onChange={onChange} disabled={isBusy} className={fieldClass}>
                    {canUseClubLevel ? <option value="">Club level</option> : null}
                    {!canUseClubLevel && !form.teamId ? <option value="">Choose team</option> : null}
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                  {validationMessage('teamId')}
                  {!canUseClubLevel ? (
                    <span className="mt-2 block text-xs font-bold leading-5 text-[#4b5f55]">
                      Team Coaches can only save events against their assigned team.
                    </span>
                  ) : null}
                </label>
              )}
            </div>

            {!clubWideOnly && form.teamId ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Notification Team name</span>
                <input
                  name="notificationTeamName"
                  value={form.notificationTeamName}
                  onChange={onChange}
                  maxLength={40}
                  placeholder="Example: U14 JPL"
                  disabled={isBusy}
                  className={fieldClass}
                />
                <span className="mt-2 block text-xs font-bold leading-5 text-[#4b5f55]">
                  Used only in notifications and remembered for this Team. The official Team name stays unchanged.
                </span>
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Title</span>
              <input
                name="title"
                {...validationProps('title')}
                value={form.title}
                onChange={onChange}
                placeholder={form.eventType === 'training' ? 'Example: U12 training' : 'Example: Parent response deadline'}
                className={fieldClass}
              />
              {validationMessage('title')}
            </label>

            {showOpponent ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Opponent</span>
                <input name="opponent" {...validationProps('opponent')} value={form.opponent} onChange={onChange} placeholder="Example: Riverside Juniors" className={fieldClass} />
                {validationMessage('opponent')}
              </label>
            ) : null}

            {isMatchFixture ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Fixture type</span>
                <select name="fixtureType" {...validationProps('fixtureType')} value={form.fixtureType} onChange={onChange} disabled={isBusy} required className={fieldClass}>
                  <option value="">Choose fixture type</option>
                  {MATCH_DAY_FIXTURE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {validationMessage('fixtureType')}
              </label>
            ) : null}

            {isMatchFixture && event?.sourceType !== 'session' ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Home or away</span>
                  <select name="homeAway" value={form.homeAway} onChange={onChange} disabled={isBusy} className={fieldClass}>
                    {MATCH_DAY_HOME_AWAY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Shirts</span>
                  <select name="shirtChoice" value={form.shirtChoice} onChange={onChange} disabled={isBusy} className={fieldClass}>
                    {MATCH_DAY_SHIRT_CHOICE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            ) : null}

            {isMatchFixture && event?.sourceType !== 'session' ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Kickoff time</span>
                <select
                  name="kickoffTimeMode"
                  value={form.kickoffTimeTbc ? 'tbc' : 'confirmed'}
                  onChange={onChange}
                  disabled={isBusy}
                  className={fieldClass}
                  aria-describedby="calendar-kickoff-time-help"
                >
                  <option value="confirmed">Confirmed time</option>
                  <option value="tbc">Time TBC</option>
                </select>
                <span id="calendar-kickoff-time-help" className="mt-2 block text-xs font-bold leading-5 text-[#4b5f55]">
                  Time TBC keeps the match date but stores no kickoff or arrival time.
                </span>
              </label>
            ) : null}

            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Date</span>
                <input name="date" {...validationProps('date')} type="date" min={isMatchFixture ? getTodayMatchDayDateValue() : undefined} value={form.date} onChange={onChange} required className={fieldClass} />
                {validationMessage('date')}
              </label>
              {isMatchFixture ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">Arrival time</span>
                  <input name="arrivalTime" {...validationProps('arrivalTime')} type="time" value={form.arrivalTime} onChange={onChange} disabled={form.kickoffTimeTbc} className={fieldClass} />
                  {validationMessage('arrivalTime')}
                </label>
              ) : null}
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">{isMatchFixture ? 'Kick-off time' : 'Start time'}</span>
                <input name="startTime" {...validationProps('startTime')} type="time" value={form.startTime} onChange={onChange} required={!isMatchFixture || !form.kickoffTimeTbc} disabled={isMatchFixture && form.kickoffTimeTbc} className={fieldClass} />
                {validationMessage('startTime')}
              </label>
              {!isMatchFixture ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-[#101828]">End time</span>
                  <input name="endTime" {...validationProps('endTime')} type="time" value={form.endTime} onChange={onChange} required className={fieldClass} />
                  {validationMessage('endTime')}
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
                      {...validationProps('recurrenceUntil')}
                      type="date"
                      value={form.recurrenceUntil}
                      onChange={onChange}
                      disabled={form.recurrenceFrequency === 'none'}
                      required={form.recurrenceFrequency !== 'none'}
                      className={fieldClass}
                    />
                    {validationMessage('recurrenceUntil')}
                  </label>
                </div>
                <p className="mt-3 text-xs font-bold leading-5 text-[#4b5f55]">
                  Repeating calendar events are stored as one series record and are edited from this event.
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
                validationError={validationError}
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

            {isTrainingRsvpMode ? (
              <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 text-sm font-black leading-6 text-[#065f46]">
                Availability requests will be sent to eligible Parents or adult Players for the selected Players, and the event will appear in their Family Portal.
              </div>
            ) : canShareClubWideWithParents ? (
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
                {form.shareWithParents ? (
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
                      {event ? 'Send updated invitations to club families' : 'Notify club families'}
                      <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                        Sends one club-branded event invitation to each eligible active family contact.
                      </span>
                    </span>
                  </label>
                ) : null}
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
                    {event ? 'Send updated invitations to team families' : 'Notify team families'}
                    <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                      {isMatchFixture
                        ? 'Sends secure availability and configured volunteer response links for this Match Day fixture.'
                        : 'Parents will see the event in their Parent Portal and receive an email notification.'}
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
            )}

            {isMatchFixture ? (
              <label className="flex min-h-12 items-start gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
                <input
                  type="checkbox"
                  name="autoSelectAvailablePlayers"
                  checked={form.autoSelectAvailablePlayers === true}
                  onChange={onChange}
                  disabled={isBusy}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[#047857]"
                />
                <span>
                  <span className="block text-sm font-black text-[#101828]">Automatically select players who respond Available</span>
                  <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                    When enabled, invited players who respond Available will be added to the match selection automatically.
                  </span>
                </span>
              </label>
            ) : null}

            {showInvites ? (
              <div
                data-calendar-field="invitedPlayerIds"
                tabIndex={validationError?.fieldName === 'invitedPlayerIds' ? -1 : undefined}
                aria-invalid={validationError?.fieldName === 'invitedPlayerIds' || undefined}
                aria-describedby={validationError?.fieldName === 'invitedPlayerIds' ? 'calendar-invitedPlayerIds-error' : undefined}
                className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4"
              >
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
                          checked={wholeSquadSelectionState.checked}
                          aria-checked={wholeSquadSelectionState.indeterminate ? 'mixed' : wholeSquadSelectionState.checked}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = wholeSquadSelectionState.indeterminate
                            }
                          }}
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
                            {event?.sourceType === 'match-day' ? (
                              <span className="mt-1 block text-xs font-black text-[#047857]">
                                {matchInviteStatesByPlayerId[String(player.id)]?.accessibleLabel || 'Not invited'}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>

                    {!isTrainingRsvpMode ? (
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
                        {event ? 'Send updated invitations to parents' : 'Notify invited families'}
                        <span className="mt-1 block text-xs font-bold leading-5 text-[#4b5f55]">
                          {isMatchFixture
                            ? 'Sends secure availability and configured volunteer response links for this Match Day fixture.'
                            : 'Parents will see the event in their Parent Portal and receive an email notification.'}
                        </span>
                      </span>
                    </label>
                    ) : null}
                  </div>
                )}
                {validationMessage('invitedPlayerIds')}
              </div>
            ) : null}
            </>
            )}
            </div>
            </div>

            <MobileActionDock
              actionsClassName={`grid gap-2 ${hasMobileSecondaryActions ? 'grid-cols-3' : 'grid-cols-2'}`}
              attentionKey={validationError?.message || ''}
              breakpoint="sm"
              hasError={Boolean(validationError)}
              hasUnsavedChanges={hasUnsavedEditorChanges}
              label="Calendar editor actions"
              mode="contained"
              renderDesktop={false}
              testId="calendar-mobile-action-bar"
            >
                <button type="button" onClick={handleModalCancel} disabled={isBusy} className={compactSecondaryButtonClass}>Cancel</button>
                <button type="submit" disabled={isBusy} className={compactPrimaryButtonClass}>{isBusy ? 'Saving...' : isAssessmentReminder ? 'Save new date' : 'Save'}</button>
                {hasMobileSecondaryActions ? (
                  <button
                    ref={mobileActionMenuButtonRef}
                    type="button"
                    aria-controls="calendar-mobile-actions"
                    aria-expanded={isMobileActionMenuOpen}
                    onClick={() => setIsMobileActionMenuOpen(true)}
                    className={compactSecondaryButtonClass}
                  >
                    More
                  </button>
                ) : null}
            </MobileActionDock>
            <div className="hidden shrink-0 items-center justify-between gap-3 border-t border-[#d7e5dc] bg-white px-6 py-4 sm:flex">
              <div>
                {event?.href ? <button type="button" onClick={onOpenWorkflow} className={secondaryButtonClass}>Open item</button> : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={handleModalCancel} disabled={isBusy} className={secondaryButtonClass}>Cancel</button>
                <button type="submit" disabled={isBusy} className={primaryButtonClass}>{isBusy ? 'Saving...' : isAssessmentReminder ? 'Save new date' : 'Save changes'}</button>
                {canDeleteEvent ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleteButtonDisabled}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {event.sourceType === 'match-day' ? 'Cancel fixture' : 'Delete event'}
                  </button>
                ) : null}
              </div>
            </div>
          </form>
        ) : !isManagingPlayers ? (
          <>
            {(event?.href || hasMobileSecondaryActions) ? (
              <MobileActionDock
                actionsClassName={`grid gap-2 ${event?.href && hasMobileSecondaryActions ? 'grid-cols-2' : 'grid-cols-1'}`}
                breakpoint="sm"
                label="Calendar event actions"
                mode="contained"
                renderDesktop={false}
                testId="calendar-mobile-action-bar"
              >
                  {event?.href ? (
                    <button type="button" onClick={onOpenWorkflow} className={compactPrimaryButtonClass}>Open item</button>
                  ) : null}
                  {hasMobileSecondaryActions ? (
                    <button
                      ref={mobileActionMenuButtonRef}
                      type="button"
                      aria-controls="calendar-mobile-actions"
                      aria-expanded={isMobileActionMenuOpen}
                      onClick={() => setIsMobileActionMenuOpen(true)}
                      className={compactSecondaryButtonClass}
                    >
                      More actions
                    </button>
                  ) : null}
              </MobileActionDock>
            ) : null}
            <div data-testid="calendar-desktop-action-bar" className="hidden shrink-0 items-center justify-between gap-3 border-t border-[#d7e5dc] bg-white px-6 py-4 sm:flex">
              <div className="flex flex-wrap items-center gap-3">
                {event?.href ? <button type="button" onClick={onOpenWorkflow} className={secondaryButtonClass}>Open item</button> : null}
                {canBuildFormation ? <button type="button" onClick={onBuildFormation} className={primaryButtonClass}>Build Formation Board with attending players</button> : null}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <button type="button" onClick={handleModalCancel} className={secondaryButtonClass}>Close</button>
                {canManageEventPlayers ? (
                  <button type="button" onClick={onManagePlayers} className={secondaryButtonClass}>
                    {getEventPlayerManagementLabel(form.eventType)}
                  </button>
                ) : null}
                {editableSource && !isAssessmentReminder ? <button type="button" onClick={onEdit} className={secondaryButtonClass}>Edit event</button> : null}
                {editableSource ? <button type="button" onClick={onEdit} className={primaryButtonClass}>Move or reschedule</button> : null}
                {canDeleteEvent ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleteButtonDisabled}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-3 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {event.sourceType === 'match-day' ? 'Cancel fixture' : 'Delete event'}
                  </button>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
        {isMobileActionMenuOpen ? (
          <div className="absolute inset-0 z-20 flex items-end bg-[#101828]/40 sm:hidden">
            <button
              type="button"
              aria-label="Close more actions"
              className="absolute inset-0 cursor-default"
              onClick={() => {
                setIsMobileActionMenuOpen(false)
                window.requestAnimationFrame(() => mobileActionMenuButtonRef.current?.focus())
              }}
            />
            <div
              ref={mobileActionMenuRef}
              id="calendar-mobile-actions"
              role="menu"
              aria-labelledby="calendar-mobile-actions-title"
              data-testid="calendar-mobile-actions"
              className="relative z-10 w-full rounded-t-2xl border border-[#d7e5dc] bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-4">
                <h3 id="calendar-mobile-actions-title" className="text-base font-black text-[#101828]">More actions</h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileActionMenuOpen(false)
                    window.requestAnimationFrame(() => mobileActionMenuButtonRef.current?.focus())
                  }}
                  aria-label="Close more actions"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-[#f7faf8] text-sm font-black text-[#101828] focus:outline-none focus:ring-2 focus:ring-[#bbf7d0]"
                >
                  X
                </button>
              </div>
              <div className="mt-3 grid gap-2">
                {canBuildFormation ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMobileActionMenuOpen(false)
                      onBuildFormation()
                    }}
                    className={compactPrimaryButtonClass}
                  >
                    Build Formation Board with attending players
                  </button>
                ) : null}
                {!isEditing && !isManagingPlayers && canManageEventPlayers ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMobileActionMenuOpen(false)
                      onManagePlayers()
                    }}
                    className={compactSecondaryButtonClass}
                  >
                    {getEventPlayerManagementLabel(form.eventType)}
                  </button>
                ) : null}
                {!isEditing && editableSource && !isAssessmentReminder ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMobileActionMenuOpen(false)
                      onEdit()
                    }}
                    className={compactSecondaryButtonClass}
                  >
                    Edit event
                  </button>
                ) : null}
                {!isEditing && editableSource ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMobileActionMenuOpen(false)
                      onEdit()
                    }}
                    className={compactSecondaryButtonClass}
                  >
                    Move or reschedule
                  </button>
                ) : null}
                {canDeleteEvent ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsMobileActionMenuOpen(false)
                      onDelete()
                    }}
                    disabled={deleteButtonDisabled}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {event.sourceType === 'match-day' ? 'Cancel fixture' : 'Delete event'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      </div>
      {isResponseManagerOpen && eventResponseManager ? (
        <EventResponseManagerDialog
          ariaHidden={Boolean(availabilityAction || playerRemovalAction)}
          dialogRef={responseManagerDialogRef}
          eventContext={selectedSummary}
          eventTitle={event?.title || form.title || 'Event responses'}
          isBusy={isBusy}
          manager={eventResponseManager}
          onAcceptOnBehalf={(row) => {
            setAvailabilityAction({
              action: 'available',
              invite: row.sourceRow,
              status: row.sourceRow.display,
            })
          }}
          onInvitationAction={async (row, action) => {
            const requestToken = crypto.randomUUID()

            try {
              const recipientPreview = await onInvitationAction({
                action,
                invite: row.sourceRow,
                occurrenceDate: availabilityOccurrenceDate,
                preview: true,
                requestToken,
              })
              setAvailabilityAction({
                action,
                invite: row.sourceRow,
                recipientPreview,
                requestToken,
                status: row.sourceRow.display,
              })
            } catch {
              setAvailabilityAction(null)
            }
          }}
          onMarkUnavailable={(row) => {
            setAvailabilityAction({
              action: 'unavailable',
              invite: row.sourceRow,
              status: row.sourceRow.display,
            })
          }}
          onOpenPlayerProfile={onOpenPlayerProfile}
          onRemoveFromEvent={onRemovePlayerFromEvent && ['calendar', 'match-day'].includes(event?.sourceType)
            ? async (row) => {
                const requestToken = crypto.randomUUID()
                const scope = event.sourceType === 'calendar' && isRecurringCalendarEdit
                  ? EVENT_PLAYER_REMOVAL_SCOPES.occurrence
                  : EVENT_PLAYER_REMOVAL_SCOPES.event

                try {
                  const preview = await onRemovePlayerFromEvent({
                    playerId: row.playerId,
                    preview: true,
                    scope,
                  })
                  setPlayerRemovalAction({
                    playerId: row.playerId,
                    playerName: row?.player?.playerName || 'Player',
                    preview,
                    requestToken,
                    scope,
                  })
                } catch {
                  setPlayerRemovalAction(null)
                }
              }
            : undefined}
          onSelectForSquad={(row) => {
            setAvailabilityAction({
              action: 'select',
              invite: row.sourceRow,
              status: row.sourceRow.display,
            })
          }}
          onClose={() => {
            setIsResponseManagerOpen(false)
            window.requestAnimationFrame(() => responseManagerButtonRef.current?.focus())
          }}
        />
      ) : null}
      <EventPlayerRemovalModal
        key={playerRemovalAction?.requestToken || 'event-player-removal'}
        action={playerRemovalAction}
        isBusy={isBusy}
        onCancel={() => setPlayerRemovalAction(null)}
        onScopeChange={async (scope) => {
          const current = playerRemovalAction

          if (!current) {
            return
          }

          try {
            const preview = await onRemovePlayerFromEvent({
              playerId: current.playerId,
              preview: true,
              scope,
            })
            setPlayerRemovalAction((value) => value ? { ...value, preview, scope } : null)
          } catch {
            setPlayerRemovalAction(current)
          }
        }}
        onConfirm={async ({ confirmInProgress }) => {
          const current = playerRemovalAction

          if (!current) {
            return
          }

          const result = await onRemovePlayerFromEvent({
            confirmInProgress,
            playerId: current.playerId,
            requestToken: current.requestToken,
            scope: current.scope,
          })
          setPlayerRemovalResult({ ...result, scope: current.scope })
          setPlayerRemovalAction(null)
          setIsResponseManagerOpen(false)
        }}
      />
      <ConfirmModal
        isOpen={Boolean(availabilityAction)}
        isBusy={isBusy}
        overlayZIndexClassName="z-[100]"
        title={availabilityAction?.invite?.player?.playerName || 'Invited player'}
        message={{
          available: form.eventType === 'training'
            ? 'This records an Attending response by you as an authorised Coach. It does not sign in as, or impersonate, the parent or player.'
            : 'This records an Available response by you as an authorised Coach. It does not sign in as, or impersonate, the parent or player.',
          unavailable: 'This records an Unavailable response by you as an authorised Coach. It does not sign in as, or impersonate, the parent or player.',
          select: 'This selects only this available player for the saved match squad. It does not change their availability response.',
          send: 'This sends an invitation to server-resolved eligible contacts for this player only.',
          resend: 'This rotates the response token and deliberately resends an invitation to server-resolved eligible contacts for this player only.',
          retry: 'This rotates the response token and retries the failed invitation for this player only.',
        }[availabilityAction?.action] || ''}
        items={[
          `Current availability: ${availabilityAction?.status?.availabilityLabel || 'Awaiting response'}`,
          ...(availabilityAction?.status?.matchSelectionLabel
            ? [`Match selection: ${availabilityAction.status.matchSelectionLabel}`]
            : []),
          ...(availabilityAction?.action && ['send', 'resend', 'retry'].includes(availabilityAction.action)
            ? [`Invitation action: ${availabilityAction.action}`]
            : []),
          ...(availabilityAction?.recipientPreview?.recipients ?? []).map((recipient) =>
            `${recipient.type || 'Recipient'}: ${recipient.address}`),
        ]}
        itemsTitle="Invitation status"
        confirmLabel={{
          available: form.eventType === 'training' ? 'Mark attending on behalf' : 'Accept on behalf of player',
          unavailable: 'Mark Unavailable',
          select: 'Select for squad',
          send: 'Send invitation',
          resend: 'Resend invitation',
          retry: 'Retry invitation',
        }[availabilityAction?.action] || 'Confirm'}
        confirmDisabled={
          availabilityAction?.action === 'available'
            ? availabilityAction?.status?.canAcceptOnBehalf === false
            : false
        }
        onCancel={() => setAvailabilityAction(null)}
        onConfirm={async () => {
          if (availabilityAction.action === 'available') {
            await onAcceptOnBehalf({
              invite: availabilityAction.invite,
              occurrenceDate: availabilityOccurrenceDate,
              status: availabilityAction.status,
            })
          } else if (availabilityAction.action === 'unavailable') {
            await onMarkUnavailable({
              invite: availabilityAction.invite,
              occurrenceDate: availabilityOccurrenceDate,
              status: availabilityAction.status,
            })
          } else if (availabilityAction.action === 'select') {
            await onSelectForSquad({
              invite: availabilityAction.invite,
              status: availabilityAction.status,
            })
          } else {
            await onInvitationAction({
              action: availabilityAction.action,
              invite: availabilityAction.invite,
              occurrenceDate: availabilityOccurrenceDate,
              preview: false,
              requestToken: availabilityAction.requestToken,
              status: availabilityAction.status,
            })
          }
          setAvailabilityAction(null)
        }}
      />
    </>
  )
}

function MatchdayFocus({
  assessedPlayerCount,
  compact = false,
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
    <section className={`rounded-lg border border-[#d7e5dc] bg-white shadow-sm shadow-[#101828]/5 ${compact ? 'p-4 sm:p-5' : 'p-5 sm:p-6'}`}>
      <div className={`grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${compact ? 'gap-3' : 'gap-4'}`}>
        <div className="min-w-0">
          <p className={eyebrowClass}>
            Live session
          </p>
          <h3 className={`mt-2 break-words font-black tracking-tight text-[#101828] ${compact ? 'text-2xl sm:text-3xl' : 'text-3xl sm:text-4xl'}`}>
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
          {compact ? null : (
            <p className={`mt-3 max-w-2xl ${bodyTextClass}`}>
              Keep this screen open during training or a match. Add notes quickly, then work through the player queue without leaving the football context.
            </p>
          )}
        </div>

        <div className={`grid sm:min-w-56 ${compact ? 'grid-cols-2 gap-2' : 'gap-3'}`}>
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

function LiveSessionPlanningCard({ onOpenCalendar, onOpenHistory }) {
  return (
    <section aria-label="Session planning shortcuts" className="rounded-lg border border-[#d7e5dc] bg-white p-3 shadow-sm shadow-[#101828]/5 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <p className="text-sm font-bold leading-5 text-[#4b5f55]">
          Planning stays in the calendar. Saved blocks stay in session history.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:min-w-[22rem]">
          <button type="button" onClick={onOpenCalendar} className={secondaryButtonClass}>
            Open calendar
          </button>
          <button type="button" onClick={onOpenHistory} className={secondaryButtonClass}>
            Session history
          </button>
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
