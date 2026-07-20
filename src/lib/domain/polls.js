import { supabase } from '../supabase-client.js'
import { clearViewCaches, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { sendParentMobilePushNotification } from '../push-notifications.js'

export const POLL_AUDIENCE_OPTIONS = [
  { value: 'parents', label: 'Parent poll' },
  { value: 'staff', label: 'Team staff poll' },
]

export const POLL_TYPE_OPTIONS = [
  { value: 'text', label: 'Text poll' },
  { value: 'time', label: 'Time poll' },
  { value: 'awards', label: 'Awards poll' },
]

function normalizePollOption(option, index) {
  if (typeof option === 'string') {
    const label = String(option ?? '').trim()
    return label ? { id: `option-${index + 1}`, label } : null
  }

  const label = String(option?.label ?? '').trim()
  const id = String(option?.id ?? '').trim() || `option-${index + 1}`

  return label ? {
    id,
    label,
    value: String(option?.value ?? '').trim(),
    playerId: String(option?.playerId ?? '').trim(),
  } : null
}

function normalizePollVote(row) {
  return {
    id: row.id ?? '',
    pollId: row.poll_id ?? row.pollId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    authUserId: row.auth_user_id ?? row.authUserId ?? '',
    voterEmail: String(row.voter_email ?? row.voterEmail ?? '').trim().toLowerCase(),
    voterName: String(row.voter_name ?? row.voterName ?? '').trim(),
    optionId: String(row.option_id ?? row.optionId ?? '').trim(),
    parentLinkId: row.parent_link_id ?? row.parentLinkId ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

function normalizeVoteSummary(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((row) => ({
      optionId: String(row?.optionId ?? row?.option_id ?? '').trim(),
      count: Number(row?.count ?? 0),
    }))
    .filter((row) => row.optionId)
}

export function normalizePoll(row) {
  const team = Array.isArray(row.teams) ? row.teams[0] : row.teams
  const options = (Array.isArray(row.options) ? row.options : [])
    .map(normalizePollOption)
    .filter(Boolean)
  const votes = Array.isArray(row.poll_votes)
    ? row.poll_votes.map(normalizePollVote)
    : normalizeVoteSummary(row.votes)

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    teamName: String(team?.name ?? row.team_name ?? row.teamName ?? '').trim(),
    title: String(row.title ?? '').trim(),
    description: String(row.description ?? '').trim(),
    audience: String(row.audience ?? 'parents').trim() === 'staff' ? 'staff' : 'parents',
    pollType: ['text', 'time', 'awards'].includes(String(row.poll_type ?? row.pollType ?? '').trim())
      ? String(row.poll_type ?? row.pollType).trim()
      : 'text',
    options,
    status: String(row.status ?? 'open').trim() === 'closed' ? 'closed' : 'open',
    closesAt: row.closes_at ?? row.closesAt ?? '',
    allowMultiple: Boolean(row.allow_multiple ?? row.allowMultiple ?? false),
    maxChoices: row.max_choices ?? row.maxChoices ?? null,
    allowOwnChildVotes: Boolean(row.allow_own_child_votes ?? row.allowOwnChildVotes ?? true),
    allowVoteChanges: Boolean(row.allow_vote_changes ?? row.allowVoteChanges ?? true),
    hideVotes: Boolean(row.hide_votes ?? row.hideVotes ?? false),
    allowComments: Boolean(row.allow_comments ?? row.allowComments ?? false),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    currentOptionId: String(row.current_option_id ?? row.currentOptionId ?? '').trim(),
    currentOptionIds: Array.isArray(row.current_option_ids)
      ? row.current_option_ids.map((optionId) => String(optionId ?? '').trim()).filter(Boolean)
      : Array.isArray(row.currentOptionIds)
        ? row.currentOptionIds.map((optionId) => String(optionId ?? '').trim()).filter(Boolean)
        : String(row.current_option_id ?? row.currentOptionId ?? '').trim()
          ? [String(row.current_option_id ?? row.currentOptionId ?? '').trim()]
          : [],
    votes,
  }
}

function normalizeAudience(value) {
  return String(value ?? '').trim() === 'staff' ? 'staff' : 'parents'
}

function normalizeStatus(value) {
  return String(value ?? '').trim() === 'closed' ? 'closed' : 'open'
}

function normalizePollType(value) {
  const pollType = String(value ?? '').trim()
  return ['text', 'time', 'awards'].includes(pollType) ? pollType : 'text'
}

function normalizeOptions(options) {
  const normalizedOptions = (options ?? [])
    .map(normalizePollOption)
    .filter(Boolean)

  if (normalizedOptions.length < 2) {
    throw new Error('Add at least two poll options.')
  }

  return normalizedOptions.map((option, index) => ({
    id: option.id || `option-${index + 1}`,
    label: option.label,
    value: option.value || '',
    playerId: option.playerId || '',
  }))
}

function assertStaffPollAccess(user) {
  if (!user?.clubId || user.role === 'parent_portal' || user.role === 'super_admin') {
    throw new Error('Club staff access is required for polls.')
  }
}

export async function getPolls({ user, audience = '' } = {}) {
  assertStaffPollAccess(user)

  let query = supabase
    .from('polls')
    .select('*, teams:team_id (name), poll_votes (*)')
    .eq('club_id', user.clubId)
    .order('created_at', { ascending: false })

  if (audience) {
    query = query.eq('audience', normalizeAudience(audience))
  }

  if (user.activeTeamId) {
    query = query.or(`team_id.is.null,team_id.eq.${user.activeTeamId}`)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizePoll)
}

export async function createPoll({ user, poll }) {
  await blockDemoMutation(user)
  assertStaffPollAccess(user)

  const title = String(poll?.title ?? '').trim()
  const description = String(poll?.description ?? '').trim()
  const audience = normalizeAudience(poll?.audience)
  const pollType = normalizePollType(poll?.pollType)
  const teamId = String(poll?.teamId ?? '').trim() || null
  const options = normalizeOptions(poll?.options)
  const closesAt = String(poll?.closesAt ?? '').trim() || null
  const requestId = String(poll?.requestId ?? '').trim() || globalThis.crypto.randomUUID()

  if (!title) {
    throw new Error('Poll title is required.')
  }

  const { data, error } = await supabase
    .rpc('create_team_poll', {
      p_team_id: teamId,
      p_title: title,
      p_description: description,
      p_audience: audience,
      p_poll_type: pollType,
      p_options: options,
      p_closes_at: closesAt,
      p_allow_multiple: Boolean(poll?.allowMultiple),
      p_max_choices: poll?.allowMultiple && Number(poll?.maxChoices ?? 0) > 0 ? Number(poll.maxChoices) : null,
      p_allow_own_child_votes: audience === 'parents' ? Boolean(poll?.allowOwnChildVotes ?? true) : true,
      p_allow_vote_changes: Boolean(poll?.allowVoteChanges ?? true),
      p_hide_votes: Boolean(poll?.hideVotes),
      p_allow_comments: Boolean(poll?.allowComments),
      p_request_id: requestId,
    })

  if (error) {
    console.error(error)
    throw error
  }

  clearViewCaches()
  invalidateMemoryCacheByPrefix('polls:')
  if (audience === 'parents') {
    await sendParentMobilePushNotification({
      id: data.id,
      type: 'parent_poll',
    })
  }
  return normalizePoll(data)
}

export async function updatePollStatus({ user, pollId, status }) {
  await blockDemoMutation(user)
  assertStaffPollAccess(user)

  const { data, error } = await supabase
    .rpc('set_team_poll_status', {
      p_poll_id: pollId,
      p_status: normalizeStatus(status),
    })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('polls:')
  return normalizePoll(data)
}

export async function deletePoll({ user, pollId }) {
  await blockDemoMutation(user)
  assertStaffPollAccess(user)

  const { error } = await supabase
    .rpc('delete_team_poll', {
      p_poll_id: pollId,
    })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('polls:')
}

export async function submitStaffPollVote({ user, poll, optionId }) {
  await blockDemoMutation(user)
  assertStaffPollAccess(user)

  const normalizedOptionId = String(optionId ?? '').trim()
  if (!poll?.id || !normalizedOptionId) {
    throw new Error('Choose an option before voting.')
  }
  const { data, error } = await supabase
    .rpc('submit_staff_poll_vote', {
      p_poll_id: poll.id,
      p_option_id: normalizedOptionId,
    })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('polls:')
  return data
}

export async function getParentPortalPolls({ parentLinkId }) {
  const normalizedParentLinkId = String(parentLinkId ?? '').trim()

  if (!normalizedParentLinkId) {
    return []
  }

  const { data, error } = await supabase.rpc('get_parent_portal_polls', {
    parent_link_id_value: normalizedParentLinkId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizePoll)
}

export async function submitParentPortalPollVote({ parentLinkId, pollId, optionId }) {
  const { data, error } = await supabase.rpc('submit_parent_portal_poll_vote', {
    parent_link_id_value: parentLinkId,
    poll_id_value: pollId,
    option_id_value: optionId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return data
}
