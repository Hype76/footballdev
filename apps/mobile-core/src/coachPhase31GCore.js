import { collapseCoachInvitesByPlayer } from './coachPhase31ECore.js'

const normalize = (value) => String(value ?? '').trim()
const asArray = (value) => Array.isArray(value) ? value : []

function getInvitePlayerKey(invite = {}) {
  const kind = normalize(invite?.kind).toLowerCase()
  const eventId = normalize(invite?.eventId)
  const playerId = normalize(invite?.playerId)
  return kind && eventId && playerId ? `${kind}:${eventId}:${playerId}` : ''
}

export function countPendingCoachAvailability(rows = []) {
  const invites = asArray(rows).filter((invite) => ['match', 'training'].includes(normalize(invite?.kind).toLowerCase()))
  const sentPlayerKeys = new Set(invites
    .filter((invite) => normalize(invite?.sentAt))
    .map(getInvitePlayerKey)
    .filter(Boolean))

  const collapsed = ['match', 'training'].flatMap((kind) => collapseCoachInvitesByPlayer(
    invites.filter((invite) => normalize(invite?.kind).toLowerCase() === kind),
  ))
  return collapsed.filter((invite) => ['awaiting', 'pending'].includes(normalize(invite?.status).toLowerCase())
    && sentPlayerKeys.has(getInvitePlayerKey(invite))).length
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
  const pendingAvailability = countPendingCoachAvailability(inviteRows)
  const activePolls = polls.filter((poll) => normalize(poll?.status).toLowerCase() === 'open').length
  const unreadChat = chatRooms.reduce((total, room) => total + Math.max(0, Number(room?.unreadCount || 0)), 0)
  const unreadCommunication = 0
  const nextCalendar = calendar.find((item) => !['cancelled', 'completed'].includes(normalize(item?.status).toLowerCase())) || calendar[0] || null
  const nextMatch = matches.find((item) => !['full_time', 'completed', 'cancelled'].includes(normalize(item?.status).toLowerCase())) || matches[0] || null
  const nextSession = sessions.find((item) => !['completed', 'cancelled'].includes(normalize(item?.status).toLowerCase())) || sessions[0] || null
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
