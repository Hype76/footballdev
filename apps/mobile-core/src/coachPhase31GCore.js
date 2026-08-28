import { collapseCoachInvitesByPlayer } from './coachPhase31ECore.js'

const normalize = (value) => String(value ?? '').trim()
const asArray = (value) => Array.isArray(value) ? value : []

function timestamp(value) {
  const parsed = new Date(normalize(value)).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function localDateTime(date, time = '23:59:59') {
  const normalizedDate = normalize(date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return null
  return timestamp(`${normalizedDate}T${normalize(time) || '23:59:59'}`)
}

function selectNext(rows, { dateTime, activeUntil = dateTime, excludedStatuses = [], now }) {
  const nowTime = now instanceof Date ? now.getTime() : timestamp(now) ?? Date.now()
  const excluded = new Set(excludedStatuses)
  return asArray(rows)
    .filter((item) => !excluded.has(normalize(item?.status).toLowerCase()))
    .map((item) => ({ item, time: dateTime(item), validUntil: activeUntil(item) }))
    .filter(({ time, validUntil }) => time !== null && (validUntil ?? time) >= nowTime)
    .sort((left, right) => left.time - right.time)[0]?.item || null
}

function getInvitePlayerKey(invite = {}) {
  const kind = normalize(invite?.kind).toLowerCase()
  const eventId = normalize(invite?.eventId)
  const playerId = normalize(invite?.playerId)
  const occurrenceDate = kind === 'training'
    ? normalize(invite?.occurrenceDate || invite?.eventDate || invite?.eventAt).slice(0, 10)
    : ''
  return kind && eventId && playerId ? `${kind}:${eventId}:${occurrenceDate}:${playerId}` : ''
}

function collapseCoachInvitesByRequest(rows = []) {
  const requestGroups = new Map()
  for (const invite of asArray(rows)) {
    const kind = normalize(invite?.kind).toLowerCase()
    const eventId = normalize(invite?.eventId)
    const occurrenceDate = kind === 'training'
      ? normalize(invite?.occurrenceDate || invite?.eventDate || invite?.eventAt).slice(0, 10)
      : ''
    const key = `${kind}:${eventId}:${occurrenceDate}`
    requestGroups.set(key, [...(requestGroups.get(key) || []), invite])
  }
  return [...requestGroups.values()].flatMap(collapseCoachInvitesByPlayer)
}

export function countPendingCoachAvailability(rows = [], now = new Date()) {
  const nowTime = now instanceof Date ? now.getTime() : timestamp(now) ?? Date.now()
  const invites = asArray(rows).filter((invite) => ['match', 'training'].includes(normalize(invite?.kind).toLowerCase()))
  const sentPlayerKeys = new Set(invites
    .filter((invite) => normalize(invite?.sentAt))
    .map(getInvitePlayerKey)
    .filter(Boolean))

  const collapsed = collapseCoachInvitesByRequest(invites)
  return collapsed.filter((invite) => {
    const expiresAt = timestamp(invite?.expiresAt)
    const eventAt = timestamp(invite?.eventAt) ?? localDateTime(invite?.eventDate)
    return ['awaiting', 'pending'].includes(normalize(invite?.status).toLowerCase())
      && sentPlayerKeys.has(getInvitePlayerKey(invite))
      && (expiresAt === null || expiresAt > nowTime)
      && (eventAt === null || eventAt >= nowTime)
  }).length
}

export function buildCoachHomeOperationalSnapshot(input = {}) {
  const matches = asArray(input.matches)
  const sessions = asArray(input.sessions)
  const calendar = asArray(input.calendar)
  const chatRooms = asArray(input.chatRooms)
  const polls = asArray(input.polls)
  const messages = asArray(input.messages)
  const inviteRows = asArray(input.invites?.all)
  const developmentRecords = asArray(input.development?.records)
  const now = input.now || new Date()
  const nowTime = now instanceof Date ? now.getTime() : timestamp(now) ?? Date.now()
  const pendingAvailability = countPendingCoachAvailability(inviteRows, now)
  const activePolls = polls.filter((poll) => {
    const closesAt = timestamp(poll?.closesAt ?? poll?.closes_at)
    return normalize(poll?.status).toLowerCase() === 'open'
      && (closesAt === null || closesAt > nowTime)
  }).length
  const unreadChat = chatRooms.reduce((total, room) => total + Math.max(0, Number(room?.unreadCount || 0)), 0)
  const unreadCommunication = 0
  const nextCalendar = selectNext(calendar, {
    activeUntil: (item) => timestamp(item?.endsAt || item?.startsAt),
    dateTime: (item) => timestamp(item?.startsAt || item?.endsAt),
    excludedStatuses: ['cancelled', 'completed'],
    now,
  })
  const nextMatch = selectNext(matches, {
    dateTime: (item) => localDateTime(item?.matchDate || item?.match_date, item?.kickoffTime || item?.kickoff_time),
    excludedStatuses: ['full_time', 'completed', 'cancelled'],
    now,
  })
  const nextAssessmentSession = selectNext(sessions, {
    activeUntil: (item) => localDateTime(item?.sessionDate || item?.session_date, item?.endTime || item?.end_time || item?.startTime || item?.start_time),
    dateTime: (item) => localDateTime(item?.sessionDate || item?.session_date, item?.startTime || item?.start_time),
    excludedStatuses: ['completed', 'cancelled'],
    now,
  })
  const nextTraining = selectNext(calendar.filter((item) => normalize(item?.eventType).toLowerCase() === 'training'), {
    activeUntil: (item) => timestamp(item?.endsAt || item?.startsAt),
    dateTime: (item) => timestamp(item?.startsAt || item?.endsAt),
    excludedStatuses: ['cancelled', 'completed'],
    now,
  })
  const nextSession = [nextTraining, nextAssessmentSession]
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = timestamp(left.startsAt) ?? localDateTime(left.sessionDate || left.session_date, left.startTime || left.start_time) ?? Number.MAX_SAFE_INTEGER
      const rightTime = timestamp(right.startsAt) ?? localDateTime(right.sessionDate || right.session_date, right.startTime || right.start_time) ?? Number.MAX_SAFE_INTEGER
      return leftTime - rightTime
    })[0] || null
  return Object.freeze({
    activePolls,
    calendar,
    chatRooms,
    developmentRecords: developmentRecords.length,
    errors: asArray(input.errors).map(normalize).filter(Boolean),
    matches,
    messages,
    nextCalendar,
    nextMatch,
    nextSession,
    partial: asArray(input.errors).length > 0,
    pendingAvailability,
    polls,
    sessions,
    summary: input.summary && typeof input.summary === 'object' ? input.summary : {},
    unreadChat,
    unreadCommunication,
  })
}

export function mergeCoachHomeOperationalSnapshots(primary, attention) {
  return Object.freeze({
    ...primary,
    activePolls: attention.activePolls,
    chatRooms: attention.chatRooms,
    developmentRecords: attention.developmentRecords,
    errors: Object.freeze([...(primary.errors || []), ...(attention.errors || [])]),
    messages: attention.messages,
    partial: Boolean(primary.partial || attention.partial),
    pendingAvailability: attention.pendingAvailability,
    polls: attention.polls,
    unreadChat: attention.unreadChat,
    unreadCommunication: attention.unreadCommunication,
  })
}

export const COACH_PHASE_31G_CROSS_DOMAIN_TRANSITIONS = Object.freeze([
  Object.freeze({ from: 'home', to: 'calendar', authority: 'active Coach context' }),
  Object.freeze({ from: 'home', to: 'matchday', authority: 'active Team context' }),
  Object.freeze({ from: 'calendar', to: 'sessions', authority: 'canonical assessment session source' }),
  Object.freeze({ from: 'calendar', to: 'matchday', authority: 'canonical fixture source' }),
  Object.freeze({ from: 'players', to: 'development', authority: 'same Team Player scope' }),
  Object.freeze({ from: 'players', to: 'resources', authority: 'same Team Player scope' }),
  Object.freeze({ from: 'sessions', to: 'players', authority: 'session roster identity' }),
  Object.freeze({ from: 'sessions', to: 'development', authority: 'assessment session identity' }),
  Object.freeze({ from: 'matchday', to: 'invites', authority: 'fixture availability identity' }),
  Object.freeze({ from: 'matchday', to: 'matchday', authority: 'scorer coordination workspace' }),
  Object.freeze({ from: 'chat', to: 'matchday', authority: 'authorised room context only' }),
  Object.freeze({ from: 'invites', to: 'calendar', authority: 'canonical event identity' }),
  Object.freeze({ from: 'notification', to: 'authorised-target', authority: 'fresh Coach context and target validation' }),
])

export const COACH_PHASE_31G_BACKEND_INVENTORY = Object.freeze([
  Object.freeze({ classification: 'A', dependency: 'Canonical Coaches domains', disposition: 'Already production-ready', scope: 'Calendar, Players, Sessions, Match Day, Development, Resources, Chat, Polls, invites, Team and Club reads and commands' }),
  Object.freeze({ classification: 'A', dependency: 'Plan access, role, archive, and membership authority', disposition: 'Already production-ready', scope: 'Existing RLS, RPC, Netlify, and workspace policy' }),
  Object.freeze({ classification: 'B', dependency: 'Mobile test environment wrappers', disposition: 'Production path exists and test wrapper is test-only', scope: 'Synthetic hostile fixtures and fail-closed response-shape adapters' }),
  Object.freeze({ classification: 'C', dependency: 'Coach v3 installation contract', disposition: 'Genuine production backend delta before promotion', scope: 'Private per-installation ownership, preference, token rotation, and context binding equivalent to the test source' }),
  Object.freeze({ classification: 'C', dependency: 'Fixture-linked Formation Board route', disposition: 'Product decision and canonical linkage required', scope: 'Only if full Formation Board editing is later required inside Match Day mobile' }),
  Object.freeze({ classification: 'C', dependency: 'FA submission integration', disposition: 'Product and transport decision required', scope: 'No approved canonical message or provider format exists' }),
  Object.freeze({ classification: 'C', dependency: 'Standalone Coach Messages inbox', disposition: 'Product decision required', scope: 'Current canonical product has Coach Chat, Parent Chat, and communication history, not a separate inbox model' }),
  Object.freeze({ classification: 'D', dependency: 'Dense governance and destructive administration', disposition: 'Intentionally web-only', scope: 'Platform Admin, data transfer, plan ownership, Player transfer/archive, template governance, large uploads, reports, and audit history' }),
])

export const COACH_PHASE_31G_HOSTILE_JOURNEYS = Object.freeze([
  'one_team_staff', 'multi_team_staff', 'club_and_team_staff', 'club_admin_with_team_authority', 'dual_staff_parent',
  'payment_required', 'team_archived', 'club_archived', 'staff_removed', 'role_changed', 'offline_reconnect',
  'notification_cold_start', 'notification_warm_app', 'notification_signed_out', 'notification_wrong_team',
  'notification_removed_staff', 'notification_archived_target', 'notification_stale_match',
])
