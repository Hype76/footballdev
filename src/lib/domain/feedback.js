import { isDemoEmail } from '../demo.js'
import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'

const DEMO_MUTATION_ERROR_MESSAGE = 'Demo accounts cannot save changes.'

function getEntryUserName(user) {
  return String(user?.name ?? user?.displayName ?? user?.username ?? '').trim()
}

function getEntryUserEmail(user) {
  return String(user?.email ?? '').trim().toLowerCase()
}

function isDemoAccountValue(account) {
  return Boolean(account?.isDemoAccount || isDemoEmail(account?.email))
}

async function blockDemoMutation(account) {
  if (isDemoAccountValue(account)) {
    throw new Error(DEMO_MUTATION_ERROR_MESSAGE)
  }
}

function getEntryUserId(user) {
  return user?.id ?? null
}

function getEntryIdentity(user, prefix = 'created_by') {
  return {
    [`${prefix}_name`]: getEntryUserName(user),
    [`${prefix}_email`]: getEntryUserEmail(user),
  }
}

function normalizePlatformFeedbackRow(row) {
  const clubRow = Array.isArray(row.clubs) ? row.clubs[0] : row.clubs
  const userRow = Array.isArray(row.users) ? row.users[0] : row.users
  const votes = Array.isArray(row.platform_feedback_votes) ? row.platform_feedback_votes : []
  const commentRows = Array.isArray(row.platform_feedback_comments) ? row.platform_feedback_comments : []
  const comments = commentRows.map((comment) => {
    const commentUser = Array.isArray(comment.users) ? comment.users[0] : comment.users

    return {
      id: comment.id,
      feedbackId: comment.feedback_id ?? comment.feedbackId ?? '',
      createdBy: comment.created_by ?? comment.createdBy ?? '',
      createdByName: String(comment.created_by_name ?? comment.createdByName ?? '').trim(),
      createdByEmail: String(comment.created_by_email ?? comment.createdByEmail ?? commentUser?.email ?? '').trim(),
      message: String(comment.message ?? '').trim(),
      createdAt: comment.created_at ?? comment.createdAt ?? '',
    }
  })

  return {
    id: row.id,
    clubId: row.club_id ?? row.clubId ?? '',
    clubName: String(clubRow?.name ?? row.clubName ?? '').trim(),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: String(row.created_by_name ?? row.createdByName ?? '').trim(),
    createdByEmail: String(row.created_by_email ?? row.createdByEmail ?? userRow?.email ?? '').trim(),
    updatedBy: row.updated_by ?? row.updatedBy ?? '',
    updatedByName: String(row.updated_by_name ?? row.updatedByName ?? '').trim(),
    updatedByEmail: String(row.updated_by_email ?? row.updatedByEmail ?? '').trim(),
    message: String(row.message ?? '').trim(),
    status: String(row.status ?? 'open').trim() || 'open',
    adminNote: String(row.admin_note ?? row.adminNote ?? '').trim(),
    voteCount: Number(row.vote_count ?? row.voteCount ?? votes.length ?? 0),
    hasVoted: Boolean(row.has_voted ?? row.hasVoted ?? false),
    comments,
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
  }
}

export async function getPlatformFeedback(user) {
  if (!user?.id) {
    return []
  }

  const cacheKey = user.role === 'super_admin' ? 'platform-feedback:admin' : `platform-feedback:${user.id}:${user.clubId || 'platform'}`
  const selectFields =
    user.role === 'super_admin'
      ? 'id, club_id, created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, message, status, admin_note, created_at, updated_at, clubs:club_id (name), users:created_by (email), platform_feedback_votes (user_id), platform_feedback_comments (id, feedback_id, created_by, created_by_name, created_by_email, message, created_at, users:created_by (email))'
      : 'id, club_id, created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, message, status, admin_note, created_at, updated_at, clubs:club_id (name), platform_feedback_votes (user_id), platform_feedback_comments (id, feedback_id, created_by, created_by_name, created_by_email, message, created_at, users:created_by (email))'

  return getCachedResource(cacheKey, async () => {
    const { data, error } = await supabase
      .from('platform_feedback')
      .select(selectFields)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(error)
      throw error
    }

    return (data ?? []).map((row) => {
      const votes = Array.isArray(row.platform_feedback_votes) ? row.platform_feedback_votes : []

      return normalizePlatformFeedbackRow({
        ...row,
        vote_count: votes.length,
        has_voted: votes.some((vote) => String(vote.user_id) === String(user.id)),
      })
    })
  })
}

export async function getPlatformFeedbackReports({ accessToken, user }) {
  if (user?.role !== 'super_admin') {
    return []
  }

  const response = await fetch('/.netlify/functions/platform-feedback-reports', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken || ''}`,
    },
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    throw new Error(result.message || 'Feedback reports could not be loaded. Please contact support with reference FPO-V1-FEEDBACK-VISIBILITY-011.')
  }

  return Array.isArray(result.reports) ? result.reports : []
}

export async function createPlatformFeedback({ user, message }) {
  await blockDemoMutation(user)

  const normalizedMessage = String(message ?? '').trim()

  if (!user?.id || !user?.clubId) {
    throw new Error('A club user is required to submit feedback.')
  }

  if (!normalizedMessage) {
    throw new Error('Add feedback before submitting.')
  }

  const { data, error } = await supabase
    .from('platform_feedback')
    .insert({
      club_id: user.clubId,
      created_by: user.id,
      ...getEntryIdentity(user),
      updated_by: getEntryUserId(user),
      ...getEntryIdentity(user, 'updated_by'),
      message: normalizedMessage,
      status: 'open',
    })
    .select('id, club_id, created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, message, status, admin_note, created_at, updated_at, clubs:club_id (name), platform_feedback_votes (user_id)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
  await createAuditLog({
    user,
    action: 'platform_feedback_created',
    entityType: 'platform_feedback',
    entityId: data.id,
  })

  return normalizePlatformFeedbackRow(data)
}

export async function votePlatformFeedback({ user, feedbackId }) {
  await blockDemoMutation(user)

  if (!user?.id || !feedbackId) {
    throw new Error('Feedback and user are required.')
  }

  const { error } = await supabase.from('platform_feedback_votes').upsert(
    {
      feedback_id: feedbackId,
      user_id: user.id,
    },
    {
      onConflict: 'feedback_id,user_id',
    },
  )

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
}

export async function unvotePlatformFeedback({ user, feedbackId }) {
  await blockDemoMutation(user)

  if (!user?.id || !feedbackId) {
    throw new Error('Feedback and user are required.')
  }

  const { error } = await supabase
    .from('platform_feedback_votes')
    .delete()
    .eq('feedback_id', feedbackId)
    .eq('user_id', user.id)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
}

export async function updatePlatformFeedback({ user, feedbackId, data }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can update feedback.')
  }

  const payload = {}

  if (data.status !== undefined) {
    payload.status = String(data.status ?? 'open').trim() || 'open'
  }

  const adminComment = String(data.adminComment ?? data.adminNote ?? '').trim()

  payload.updated_at = new Date().toISOString()
  payload.updated_by = getEntryUserId(user)
  Object.assign(payload, getEntryIdentity(user, 'updated_by'))

  const { data: updatedRow, error } = await supabase
    .from('platform_feedback')
    .update(payload)
    .eq('id', feedbackId)
    .select('id, club_id, created_by, created_by_name, created_by_email, updated_by, updated_by_name, updated_by_email, message, status, admin_note, created_at, updated_at, clubs:club_id (name), users:created_by (email), platform_feedback_votes (user_id), platform_feedback_comments (id, feedback_id, created_by, created_by_name, created_by_email, message, created_at, users:created_by (email))')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  if (adminComment) {
    const { error: commentError } = await supabase.from('platform_feedback_comments').insert({
      feedback_id: feedbackId,
      created_by: user.id,
      ...getEntryIdentity(user),
      message: adminComment,
    })

    if (commentError) {
      console.error(commentError)
      throw commentError
    }
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
  return normalizePlatformFeedbackRow(updatedRow)
}

export async function deletePlatformFeedback({ user, feedbackId }) {
  await blockDemoMutation(user)

  if (user?.role !== 'super_admin') {
    throw new Error('Only platform admins can delete feedback.')
  }

  const { error } = await supabase.from('platform_feedback').delete().eq('id', feedbackId)

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix('platform-feedback:')
}
