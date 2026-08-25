export const COACH_PHASE_31E_DOMAINS = Object.freeze([
  'development',
  'resources',
  'chat',
  'messages',
  'polls',
  'invites',
])

export const COACH_PHASE_31E_COMMUNICATION_POLICY = Object.freeze({
  communications: 'disabled',
  schedules: 'disabled',
  realEmail: 0,
  realPush: 0,
  sms: 0,
  realCustomerChat: 0,
  syntheticMarker: 'FP TEST',
})

export const COACH_PHASE_31E_BACKEND_DELTAS = Object.freeze([
  Object.freeze({ category: 'A', capability: 'Development reads and private drafts', authority: 'evaluations, feedback_forms, form_fields, evaluation_drafts, RLS' }),
  Object.freeze({ category: 'A', capability: 'Development final records', authority: 'canonical evaluation payload, form snapshot, plan enforcement, RLS' }),
  Object.freeze({ category: 'A', capability: 'Resource reads, links, sharing, and signed access', authority: 'resource_library_items and Resource Library RPCs' }),
  Object.freeze({ category: 'A', capability: 'Coach Chat', authority: 'staff_chat tables, membership RLS, and Coach Chat RPCs' }),
  Object.freeze({ category: 'A', capability: 'Parent Chat Coach view', authority: 'get_parent_chat_* and send_parent_chat_message RPCs' }),
  Object.freeze({ category: 'A', capability: 'Poll management', authority: 'create_team_poll and set_team_poll_status RPCs' }),
  Object.freeze({ category: 'A', capability: 'Availability and invite reads', authority: 'Match Day, training availability, and Calendar invite read models' }),
  Object.freeze({ category: 'B', capability: 'Communication delivery proof', authority: 'test adapter must retain communications disabled and return intent only' }),
  Object.freeze({ category: 'C', capability: 'Standalone Coach Messages inbox', authority: 'current web product exposes communication history and domain-specific sends, not a separate Coach inbox model' }),
  Object.freeze({ category: 'D', capability: 'Large file upload and library governance', authority: 'web-only upload, archive, retention, and bulk library administration' }),
  Object.freeze({ category: 'D', capability: 'Development PDF and sharing administration', authority: 'server-owned report snapshot and governed web confirmation flow' }),
  Object.freeze({ category: 'E', capability: 'Generic offline mutation replay', authority: 'unnecessary and unsafe for communication, sharing, polls, invites, and finalisation' }),
])

const DEVELOPMENT_FIELD_TYPES = new Set([
  'text', 'textarea', 'number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10',
  'select', 'option', 'radio', 'boolean', 'checkbox',
])
const INVITE_STATUSES = new Set([
  'awaiting', 'pending', 'available', 'unavailable', 'maybe', 'selected', 'not_selected',
  'responded', 'cancelled', 'closed', 'expired', 'stale',
])
const AVAILABILITY_RESPONSE_STATUSES = new Set(['available', 'unavailable', 'maybe'])

function normalize(value) {
  return String(value ?? '').trim()
}

function relation(value) {
  return Array.isArray(value) ? value[0] : value
}

function normalizeOptions(value) {
  return (Array.isArray(value) ? value : [])
    .map((option, index) => {
      if (typeof option === 'string') return { id: `option-${index + 1}`, label: normalize(option), value: normalize(option) }
      const label = normalize(option?.label ?? option?.value)
      return label ? {
        id: normalize(option?.id) || `option-${index + 1}`,
        label,
        value: normalize(option?.value) || label,
      } : null
    })
    .filter(Boolean)
}

export function normalizeCoachDevelopmentField(field = {}, index = 0) {
  const rawType = normalize(field.type || field.field_type).toLowerCase().replaceAll('-', '_') || 'text'
  const type = DEVELOPMENT_FIELD_TYPES.has(rawType) ? rawType : 'text'
  return Object.freeze({
    id: normalize(field.id || field.key || field.field_key) || `field-${index + 1}`,
    label: normalize(field.label || field.name) || `Field ${index + 1}`,
    type,
    options: normalizeOptions(field.options),
    required: field.required === true,
    enabled: field.is_enabled !== false && field.enabled !== false,
    parentVisible: field.parent_visible === true || field.parentVisible === true || field.visibility === 'parent_shared',
    staffPrivate: field.staff_private === true || field.staffPrivate === true || field.visibility === 'staff_private',
    roleRank: Number(field.minimum_role_rank ?? field.minimumRoleRank ?? 20),
    orderIndex: Number(field.order_index ?? field.orderIndex ?? index),
  })
}

export function normalizeCoachDevelopmentForm(row = {}) {
  const fields = (Array.isArray(row.fields) ? row.fields : [])
    .map(normalizeCoachDevelopmentField)
    .filter((field) => field.enabled)
    .sort((left, right) => left.orderIndex - right.orderIndex)
  return Object.freeze({
    id: normalize(row.id),
    installedFormId: normalize(row.installed_form_id ?? row.installedFormId),
    isPlatformTemplate: row.is_platform_template === true || row.isPlatformTemplate === true,
    name: normalize(row.name || row.title) || 'Development form',
    templateKey: normalize(row.template_key ?? row.templateKey),
    teamId: normalize(row.team_id ?? row.teamId),
    ageGroup: normalize(row.age_group ?? row.ageGroup),
    status: normalize(row.status) || (row.archived_at ? 'archived' : 'active'),
    version: Number(row.version ?? 1),
    fields: Object.freeze(fields),
  })
}

export function resolveCoachDevelopmentForm(forms = [], requestedId = '') {
  const available = Array.isArray(forms) ? forms.filter((form) => normalize(form?.id)) : []
  const requested = normalize(requestedId)
  return available.find((form) => normalize(form.id) === requested) || available[0] || null
}

export function validateCoachDevelopmentValues(form, values = {}, roleRank = 20) {
  const errors = []
  const normalizedValues = {}
  for (const field of form?.fields || []) {
    if (Number(roleRank || 0) < field.roleRank) continue
    const rawValue = values[field.id]
    const isEmpty = rawValue === null || rawValue === undefined || rawValue === '' || (Array.isArray(rawValue) && rawValue.length === 0)
    if (field.required && isEmpty) errors.push(`${field.label} is required.`)
    if (isEmpty) {
      normalizedValues[field.id] = field.type === 'boolean' || field.type === 'checkbox' ? false : ''
      continue
    }
    if (['number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type)) {
      const value = Number(rawValue)
      if (!Number.isFinite(value)) errors.push(`${field.label} must be a number.`)
      const max = field.type === 'score_1_5' ? 5 : field.type === 'score_1_10' ? 10 : null
      if (max && (value < 0 || value > max)) errors.push(`${field.label} must be between 0 and ${max}.`)
      normalizedValues[field.id] = value
    } else if (['select', 'option', 'radio'].includes(field.type)) {
      const selected = normalize(rawValue)
      if (field.options.length && !field.options.some((option) => option.value === selected || option.id === selected)) {
        errors.push(`${field.label} has an unsupported option.`)
      }
      normalizedValues[field.id] = selected
    } else if (field.type === 'boolean' || field.type === 'checkbox') {
      normalizedValues[field.id] = rawValue === true || rawValue === 'true'
    } else {
      normalizedValues[field.id] = normalize(rawValue)
    }
  }
  return Object.freeze({ errors: Object.freeze(errors), valid: errors.length === 0, values: Object.freeze(normalizedValues) })
}

export function splitCoachDevelopmentVisibility(form, values = {}) {
  const parentShared = {}
  const staffPrivate = {}
  for (const field of form?.fields || []) {
    if (!(field.id in values)) continue
    if (field.parentVisible && !field.staffPrivate) parentShared[field.id] = values[field.id]
    else staffPrivate[field.id] = values[field.id]
  }
  return Object.freeze({ parentShared: Object.freeze(parentShared), staffPrivate: Object.freeze(staffPrivate) })
}

export function normalizeCoachDevelopmentRecord(row = {}) {
  return Object.freeze({
    id: normalize(row.id),
    playerId: normalize(row.player_id ?? row.playerId),
    playerName: normalize(row.player_name ?? row.playerName) || 'Player',
    teamId: normalize(row.team_id ?? row.teamId),
    sessionId: normalize(row.session_id ?? row.sessionId),
    formId: normalize(row.feedback_form_id ?? row.formId),
    formName: normalize(row.feedback_form_name ?? row.formName),
    status: normalize(row.status).toLowerCase() || 'submitted',
    date: normalize(row.date),
    averageScore: row.average_score ?? row.averageScore ?? null,
    formResponses: row.form_responses && typeof row.form_responses === 'object' ? row.form_responses : {},
    comments: row.comments && typeof row.comments === 'object' ? row.comments : {},
    parentShared: row.parent_shared === true || row.parentShared === true,
    createdByName: normalize(row.created_by_name ?? row.createdByName ?? row.coach),
    createdAt: normalize(row.created_at ?? row.createdAt),
  })
}

export function normalizeCoachResource(row = {}) {
  const team = relation(row.teams)
  const external = relation(row.resource_library_external_links)
  const links = (row.resource_library_links || row.links || []).filter((link) => !link.removed_at && !link.removedAt)
  const externalUrl = normalize(row.external_url ?? row.externalUrl ?? external?.external_url)
  const mimeType = normalize(row.mime_type ?? row.mimeType)
  const isFormationBoard = mimeType === 'application/vnd.footballplayer.formation-board+json'
    || externalUrl.includes('/resources/formation-boards')
  return Object.freeze({
    id: normalize(row.id),
    clubId: normalize(row.club_id ?? row.clubId),
    teamId: normalize(row.team_id ?? row.teamId),
    teamName: normalize(team?.name ?? row.teamName),
    title: normalize(row.title) || 'Resource',
    description: normalize(row.description),
    category: normalize(row.category) || 'general',
    type: normalize(row.resource_type ?? row.resourceType) || (externalUrl ? 'external_link' : 'file'),
    externalUrl,
    storageBucket: normalize(row.storage_bucket ?? row.storageBucket),
    storagePath: normalize(row.storage_path ?? row.storagePath),
    originalFilename: normalize(row.original_filename ?? row.originalFilename),
    mimeType,
    isFormationBoard,
    fileSizeBytes: Number(row.file_size_bytes ?? row.fileSizeBytes ?? 0),
    archivedAt: normalize(row.archived_at ?? row.archivedAt),
    expiresAt: normalize(row.expires_at ?? row.expiresAt),
    links: Object.freeze(links.map((link) => Object.freeze({
      id: normalize(link.id), linkedType: normalize(link.linked_type ?? link.linkedType), linkedId: normalize(link.linked_id ?? link.linkedId),
      parentVisible: link.parent_visible === true || link.parentVisible === true, shareDescription: normalize(link.share_description ?? link.shareDescription),
    }))),
    updatedAt: normalize(row.updated_at ?? row.updatedAt),
  })
}

export function getCoachResourceErrorMessage(error) {
  const message = normalize(error?.message || error)
  if (message.includes('formation_board_resource_assignment_forbidden')) {
    return 'Published Formation Boards are already Team Resources and cannot be assigned again.'
  }
  if (/network request failed/i.test(message)) return 'This Resource could not be opened. Check the connection and try again.'
  return message || 'This Resource could not be opened.'
}

export function validateCoachResourceUrl(value) {
  const url = normalize(value)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return Object.freeze({ safe: false, reason: 'Only HTTPS resource links are supported.' })
    if (parsed.username || parsed.password) return Object.freeze({ safe: false, reason: 'Resource links cannot contain credentials.' })
    return Object.freeze({ safe: true, url: parsed.href })
  } catch {
    return Object.freeze({ safe: false, reason: 'Add a valid HTTPS resource link.' })
  }
}

export function normalizeCoachChatRoom(row = {}, kind = 'staff') {
  return Object.freeze({
    id: normalize(row.id),
    kind,
    type: normalize(row.type ?? row.room_type),
    title: normalize(row.title) || (kind === 'staff' ? 'Coach Chat' : 'Parent Chat'),
    clubId: normalize(row.club_id ?? row.clubId),
    clubName: normalize(row.club_name ?? row.clubName),
    teamId: normalize(row.team_id ?? row.teamId),
    teamName: normalize(row.team_name ?? row.teamName),
    playerId: normalize(row.player_id ?? row.playerId),
    playerName: normalize(row.player_name ?? row.playerName),
    matchDayId: normalize(row.match_day_id ?? row.matchDayId),
    opponent: normalize(row.opponent),
    matchDate: normalize(row.match_date ?? row.matchDate),
    kickoffTime: normalize(row.kickoff_time ?? row.kickoffTime),
    kickoffTimeTbc: row.kickoff_time_tbc === true || row.kickoffTimeTbc === true,
    childNames: Object.freeze((Array.isArray(row.child_names ?? row.childNames) ? (row.child_names ?? row.childNames) : []).map(normalize).filter(Boolean)),
    status: normalize(row.status) || 'active',
    unreadCount: Number(row.unread_count ?? row.unreadCount ?? 0),
    latestMessage: normalize(row.latest_message ?? row.latestMessage),
    latestMessageAt: normalize(row.latest_message_at ?? row.latestMessageAt ?? row.last_message_at),
    canPost: row.can_post !== false && row.canPost !== false,
    members: Object.freeze((row.staff_chat_members || row.members || []).map((member) => Object.freeze({
      userId: normalize(member.user_id ?? member.userId), archivedAt: normalize(member.archived_at ?? member.archivedAt),
    }))),
  })
}

export function getCoachChatRoomDisplay(room = {}) {
  const kind = normalize(room.kind)
  const type = normalize(room.type)
  const teamName = normalize(room.teamName) || 'Team'
  const playerName = normalize(room.playerName) || normalize(room.childNames?.[0])
  const opponent = normalize(room.opponent)
  const matchDate = normalize(room.matchDate).slice(0, 10)
  const kickoff = room.kickoffTimeTbc ? 'Time TBC' : normalize(room.kickoffTime).slice(0, 5)
  let title = normalize(room.title) || (kind === 'staff' ? 'Coach Chat' : 'Parent Chat')
  let context = teamName

  if (kind === 'parent' && type === 'parent_staff' && playerName) {
    title = `${playerName} | Chat with Coaches`
    context = teamName
  } else if (kind === 'parent' && type === 'match_squad') {
    title = `${teamName} v ${opponent || 'Opponent'}`
    context = [matchDate, kickoff].filter(Boolean).join(' at ')
  } else if (kind === 'parent' && type === 'team') {
    context = `${teamName} | Parents and Team Coaches`
  } else if (kind === 'parent' && playerName) {
    title = `${playerName} | ${title}`
  }

  return Object.freeze({ context, title })
}

const COACH_CHAT_ROOM_SECTION_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'team', title: 'Team Chat' }),
  Object.freeze({ key: 'staff', title: 'Coaches' }),
  Object.freeze({ key: 'parents', title: 'Parents' }),
  Object.freeze({ key: 'match_day', title: 'Match Day' }),
  Object.freeze({ key: 'other', title: 'Other conversations' }),
])

export function getCoachChatRoomSectionKey(room = {}) {
  const kind = normalize(room.kind)
  const type = normalize(room.type)
  if (kind === 'parent' && type === 'team') return 'team'
  if (kind === 'staff') return 'staff'
  if (kind === 'parent' && type === 'parent_staff') return 'parents'
  if (kind === 'parent' && type === 'match_squad') return 'match_day'
  return 'other'
}

export function hasCoachChatRoomActivity(room = {}) {
  return Number(room.unreadCount || 0) > 0
    || Boolean(normalize(room.latestMessage))
    || Boolean(normalize(room.latestMessageAt))
}

function sortCoachChatRooms(rooms = []) {
  return [...rooms].sort((left, right) => {
    const leftUnread = Math.max(0, Number(left.unreadCount || 0))
    const rightUnread = Math.max(0, Number(right.unreadCount || 0))
    return Number(rightUnread > 0) - Number(leftUnread > 0)
      || rightUnread - leftUnread
      || normalize(right.latestMessageAt).localeCompare(normalize(left.latestMessageAt))
      || getCoachChatRoomDisplay(left).title.localeCompare(getCoachChatRoomDisplay(right).title)
  })
}

export function buildCoachChatRoomSections(rooms = []) {
  const availableRooms = Array.isArray(rooms) ? rooms : []
  return Object.freeze(COACH_CHAT_ROOM_SECTION_DEFINITIONS.map((definition) => {
    const sectionRooms = availableRooms.filter((room) => getCoachChatRoomSectionKey(room) === definition.key)
    const keepEmptyVisible = ['team', 'staff'].includes(definition.key)
    const activeRooms = sortCoachChatRooms(sectionRooms.filter((room) => keepEmptyVisible || hasCoachChatRoomActivity(room)))
    const emptyRooms = keepEmptyVisible ? [] : sortCoachChatRooms(sectionRooms.filter((room) => !hasCoachChatRoomActivity(room)))
    return Object.freeze({
      ...definition,
      activeRooms: Object.freeze(activeRooms),
      emptyRooms: Object.freeze(emptyRooms),
      total: sectionRooms.length,
    })
  }).filter((section) => section.total > 0))
}

export function normalizeCoachChatMessage(row = {}) {
  const user = relation(row.users)
  return Object.freeze({
    id: normalize(row.id), roomId: normalize(row.room_id ?? row.roomId ?? row.conversation_id),
    senderId: normalize(row.sender_id ?? row.senderId), senderName: normalize(row.sender_name ?? row.senderName ?? user?.name) || 'Chat participant',
    senderKind: normalize(row.sender_kind ?? row.senderKind), senderRole: normalize(row.sender_role ?? row.senderRole ?? user?.role_label),
    body: normalize(row.body), deletedAt: normalize(row.deleted_at ?? row.deletedAt), createdAt: normalize(row.created_at ?? row.createdAt),
  })
}

export function sanitizeCoachChatOfflineValue(value = {}) {
  const staff = Array.isArray(value?.staff) ? value.staff : []
  return Object.freeze({
    parent: Object.freeze([]),
    staff: Object.freeze(staff.map((room) => Object.freeze({
      ...room,
      latestMessage: '',
      unreadCount: 0,
    }))),
  })
}

export function hasUsableCoachPhase31ECache(domain, savedValue, cachedValue = savedValue) {
  if (!savedValue || typeof savedValue !== 'object') return false
  if (normalize(domain) !== 'chat') return true
  return Array.isArray(cachedValue?.staff) && cachedValue.staff.length > 0
}

export function isSyntheticCoachTarget(value) {
  return normalize(value).toUpperCase().includes(COACH_PHASE_31E_COMMUNICATION_POLICY.syntheticMarker)
}

export function assertSyntheticCoachCommunicationTarget(target) {
  if (!isSyntheticCoachTarget(target?.title) && !isSyntheticCoachTarget(target?.name) && !isSyntheticCoachTarget(target?.email)) {
    throw new Error('Only synthetic FP TEST communication targets are available in this test build.')
  }
}

export function normalizeCoachMessage(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  return Object.freeze({
    id: normalize(row.id), playerId: normalize(row.player_id ?? row.playerId), channel: normalize(row.channel),
    action: normalize(row.action), subject: normalize(metadata.subject || row.subject) || 'Communication update',
    body: normalize(metadata.body || row.body), status: normalize(row.status || metadata.status) || 'recorded',
    recipientName: normalize(metadata.recipientName || row.recipient_name), createdAt: normalize(row.created_at ?? row.createdAt),
    readAt: normalize(row.read_at ?? row.readAt), archivedAt: normalize(row.archived_at ?? row.archivedAt),
  })
}

export function normalizeCoachPoll(row = {}, currentUserId = '') {
  const team = relation(row.teams)
  const options = normalizeOptions(row.options)
  const votes = Array.isArray(row.poll_votes) ? row.poll_votes : Array.isArray(row.votes) ? row.votes : []
  const anonymous = row.anonymous === true || row.is_anonymous === true || row.hide_votes === true
  return Object.freeze({
    id: normalize(row.id), clubId: normalize(row.club_id ?? row.clubId), teamId: normalize(row.team_id ?? row.teamId), teamName: normalize(team?.name ?? row.teamName),
    title: normalize(row.title) || 'Poll', description: normalize(row.description), audience: normalize(row.audience) === 'staff' ? 'staff' : 'parents',
    pollType: ['text', 'time', 'awards'].includes(normalize(row.poll_type ?? row.pollType)) ? normalize(row.poll_type ?? row.pollType) : 'text',
    options: Object.freeze(options), status: normalize(row.status) === 'closed' ? 'closed' : 'open', closesAt: normalize(row.closes_at ?? row.closesAt),
    allowMultiple: row.allow_multiple === true || row.allowMultiple === true, maxChoices: row.max_choices ?? row.maxChoices ?? null,
    allowVoteChanges: row.allow_vote_changes !== false && row.allowVoteChanges !== false, anonymous,
    notifyResultsOnClose: row.notify_results_on_close === true || row.notifyResultsOnClose === true,
    resultsNotifiedAt: normalize(row.results_notified_at ?? row.resultsNotifiedAt),
    votes: Object.freeze(votes.map((vote) => Object.freeze({
      optionId: normalize(vote.option_id ?? vote.optionId), voterName: anonymous ? '' : normalize(vote.voter_name ?? vote.voterName),
      voterEmail: anonymous ? '' : normalize(vote.voter_email ?? vote.voterEmail),
    }))),
    currentOptionIds: Object.freeze(votes.filter((vote) => normalize(vote.auth_user_id ?? vote.authUserId) === normalize(currentUserId)).map((vote) => normalize(vote.option_id ?? vote.optionId)).filter(Boolean)),
    createdAt: normalize(row.created_at ?? row.createdAt),
  })
}

export function summarizeCoachPoll(poll) {
  const counts = Object.fromEntries((poll?.options || []).map((option) => [option.id, 0]))
  for (const vote of poll?.votes || []) if (vote.optionId in counts) counts[vote.optionId] += 1
  return Object.freeze((poll?.options || [])
    .map((option, index) => ({ ...option, count: counts[option.id] || 0, sourceIndex: index }))
    .sort((left, right) => right.count - left.count || left.sourceIndex - right.sourceIndex)
    .map((option, index) => {
      const rankedOption = { ...option, rank: index + 1 }
      delete rankedOption.sourceIndex
      return Object.freeze(rankedOption)
    }))
}

export function buildCoachPollClosesAt(dateValue, timeValue) {
  const dateMatch = normalize(dateValue).match(/^(\d{2})-(\d{2})-(\d{4})$/)
  const timeMatch = normalize(timeValue).match(/^(\d{2}):(\d{2})$/)
  if (!dateMatch && !timeMatch) return ''
  if (!dateMatch || !timeMatch) return null
  const date = new Date(
    Number(dateMatch[3]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[1]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0,
  )
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export function normalizeCoachInvite(row = {}, kind = 'calendar') {
  const rawStatus = normalize(row.status).toLowerCase().replaceAll(' ', '_')
  const responseStatus = normalize(row.response ?? row.response_state ?? row.availability_status).toLowerCase().replaceAll(' ', '_')
  const cancelled = Boolean(row.cancelled_at ?? row.cancelledAt) || rawStatus === 'cancelled'
  const deleted = Boolean(row.deleted_at ?? row.deletedAt)
  const resolvedStatus = AVAILABILITY_RESPONSE_STATUSES.has(responseStatus)
    ? responseStatus
    : rawStatus === 'responded'
      ? 'awaiting'
      : INVITE_STATUSES.has(rawStatus)
        ? rawStatus
        : INVITE_STATUSES.has(responseStatus)
          ? responseStatus
          : 'awaiting'
  const status = deleted ? 'stale' : cancelled ? 'cancelled' : resolvedStatus
  const eventId = kind === 'match'
    ? normalize(row.match_day_id ?? row.eventId ?? row.calendar_event_id)
    : normalize(row.calendar_event_id ?? row.eventId ?? row.session_id)
  return Object.freeze({
    id: normalize(row.id), kind, eventId,
    occurrenceDate: normalize(row.occurrence_date ?? row.occurrenceDate),
    eventAt: normalize(row.occurrence_starts_at ?? row.event_at ?? row.eventAt),
    eventDate: normalize(row.match_date ?? row.event_date ?? row.eventDate ?? row.occurrence_date ?? row.occurrenceDate),
    expiresAt: normalize(row.response_deadline_at ?? row.expires_at ?? row.expiresAt),
    teamId: normalize(row.team_id ?? row.teamId), playerId: normalize(row.player_id ?? row.playerId), playerName: normalize(row.player_name ?? row.playerName) || 'Player',
    title: normalize(row.title ?? row.event_title ?? row.session_title ?? row.opponent) || 'Invitation', status,
    response: normalize(row.response ?? row.response_state ?? row.availability_status), sentAt: normalize(row.sent_at ?? row.email_sent_at ?? row.invited_at ?? row.sentAt), respondedAt: normalize(row.responded_at ?? row.respondedAt),
    stale: deleted || status === 'stale', cancelled,
  })
}

export function getCoachInviteStatusLabel(status) {
  const normalized = normalize(status).toLowerCase().replaceAll(' ', '_')
  if (normalized === 'available') return 'Available'
  if (normalized === 'unavailable') return 'Not available'
  if (normalized === 'maybe') return 'Maybe'
  if (['awaiting', 'pending', 'responded'].includes(normalized)) return 'Awaiting'
  if (normalized === 'selected') return 'Selected'
  if (normalized === 'not_selected') return 'Not selected'
  if (normalized === 'cancelled') return 'Cancelled'
  if (normalized === 'stale') return 'No longer active'
  if (normalized === 'closed') return 'Closed'
  if (normalized === 'expired') return 'Expired'
  return 'Awaiting'
}

export function summarizeCoachInvites(rows = []) {
  const summary = { awaiting: 0, available: 0, unavailable: 0, maybe: 0, selected: 0, notSelected: 0, stale: 0, cancelled: 0 }
  for (const row of rows) {
    const status = normalize(row?.status)
    if (['awaiting', 'pending'].includes(status)) summary.awaiting += 1
    else if (status === 'not_selected') summary.notSelected += 1
    else if (status in summary) summary[status] += 1
  }
  return Object.freeze(summary)
}

function getCoachInviteStatusPriority(status) {
  const normalizedStatus = normalize(status).toLowerCase()
  if (['available', 'unavailable', 'maybe', 'selected', 'not_selected', 'responded'].includes(normalizedStatus)) return 3
  if (['awaiting', 'pending'].includes(normalizedStatus)) return 2
  return 1
}

function getCoachInviteSortTime(invite = {}) {
  const parsed = Date.parse(normalize(invite.respondedAt || invite.sentAt))
  return Number.isNaN(parsed) ? 0 : parsed
}

export function collapseCoachInvitesByPlayer(rows = []) {
  const invitesByPlayer = new Map()
  for (const invite of Array.isArray(rows) ? rows : []) {
    const eventId = normalize(invite?.eventId)
    const playerId = normalize(invite?.playerId)
    const key = eventId && playerId ? `${eventId}:${playerId}` : normalize(invite?.id)
    if (!key) continue
    const current = invitesByPlayer.get(key)
    if (!current) {
      invitesByPlayer.set(key, invite)
      continue
    }
    const priorityDifference = getCoachInviteStatusPriority(invite?.status) - getCoachInviteStatusPriority(current?.status)
    if (priorityDifference > 0 || (priorityDifference === 0 && getCoachInviteSortTime(invite) > getCoachInviteSortTime(current))) {
      invitesByPlayer.set(key, invite)
    }
  }
  return Object.freeze([...invitesByPlayer.values()])
}

export function getCoachPlayersWithoutAvailabilityRequest(players = [], invites = [], eventId = '') {
  const normalizedEventId = normalize(eventId)
  const requestedPlayerIds = new Set(
    collapseCoachInvitesByPlayer(invites)
      .filter((invite) => normalize(invite?.eventId) === normalizedEventId && !invite?.cancelled && !invite?.stale)
      .map((invite) => normalize(invite?.playerId))
      .filter(Boolean),
  )
  return Object.freeze((Array.isArray(players) ? players : []).filter((player) => !requestedPlayerIds.has(normalize(player?.id))))
}

export function isCoachMatchAvailabilityRequestCreationApplied(data, matchDayId, playerIds = []) {
  const expectedMatch = normalize(matchDayId)
  const expectedPlayers = new Set((playerIds || []).map(normalize).filter(Boolean))
  if (!expectedMatch || expectedPlayers.size === 0) return false
  for (const invite of data?.match || []) {
    if (normalize(invite.eventId) !== expectedMatch || invite.stale || invite.cancelled) continue
    expectedPlayers.delete(normalize(invite.playerId))
  }
  return expectedPlayers.size === 0
}

export function getCoachPhase31EOfflinePolicy(domain) {
  const key = normalize(domain)
  if (!COACH_PHASE_31E_DOMAINS.includes(key)) return Object.freeze({ cache: false, mutations: 'blocked' })
  return Object.freeze({
    cache: true,
    sensitiveFields: key === 'chat' || key === 'messages' ? 'minimal' : 'scoped',
    mutations: 'online_required',
    replay: 'disabled',
  })
}

export function getCoachPhase31EAccess({ domain, entity = null, mutation = false, stale = false, user } = {}) {
  const key = normalize(domain)
  const role = normalize(user?.role).toLowerCase()
  const roleRank = Number(user?.roleRank || 0)
  if (!COACH_PHASE_31E_DOMAINS.includes(key)) return Object.freeze({ allowed: false, reason: 'Unsupported Coach domain.' })
  if (!user?.id || !user?.clubId || roleRank < 20 || ['parent_portal', 'adult_player', 'super_admin'].includes(role)) {
    return Object.freeze({ allowed: false, reason: 'Active operational Coach membership is required.' })
  }
  if (['development', 'resources', 'chat', 'messages', 'polls', 'invites'].includes(key) && !user?.activeTeamId) {
    return Object.freeze({ allowed: false, reason: 'Choose an active Team context.' })
  }
  if (entity?.teamId && entity.teamId !== user.activeTeamId) return Object.freeze({ allowed: false, reason: 'Wrong Team context.' })
  if (user?.contextStatus && user.contextStatus !== 'active') return Object.freeze({ allowed: false, reason: 'Coach membership is inactive.' })
  if (user?.teamArchivedAt || user?.clubArchivedAt) return Object.freeze({ allowed: false, reason: 'Archived context is read-only.' })
  if (entity?.archivedAt || entity?.deletedAt || entity?.stale) return Object.freeze({ allowed: false, reason: 'This item is archived or unavailable.' })
  if (!mutation) return Object.freeze({ allowed: true, reason: '' })
  if (stale) return Object.freeze({ allowed: false, reason: 'Reconnect before making changes.' })
  if (user?.hasActivePlanAccess !== true) return Object.freeze({ allowed: false, reason: 'Operational changes are blocked while payment is required.' })
  if (['resources', 'polls', 'invites'].includes(key) && roleRank < 50) return Object.freeze({ allowed: false, reason: 'Manager authority is required.' })
  if (key === 'polls' && entity?.status === 'closed') return Object.freeze({ allowed: false, reason: 'Closed Polls are read-only.' })
  return Object.freeze({ allowed: true, reason: '' })
}
