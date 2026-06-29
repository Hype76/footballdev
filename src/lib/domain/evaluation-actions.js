import {
  EVALUATION_SECTIONS,
  supabase,
} from '../supabase-client.js'
import {
  clearViewCaches,
  invalidateMemoryCacheByPrefix,
} from './cache-store.js'
import { createAuditLog } from './audit.js'
import {
  normalizeParentContacts,
  normalizePlayerContactType,
} from './contact-utils.js'
import {
  getEntryIdentity,
  getEntryUserId,
  normalizeWords,
} from './core-normalizers.js'
import {
  mapEvaluationToRow,
  normalizeEvaluationRow,
} from './evaluation-normalizers.js'
import {
  buildFeedbackFormSnapshot,
  getActiveFeedbackFormForSubmission,
} from './feedback-forms.js'
import {
  CAPABILITIES,
} from '../paywall-access.js'
import {
  assertClubFeature,
  assertClubLimitAvailable,
  assertPlayerLimitForUpsert,
  findExistingPlayer,
  getMonthlyEvaluationCount,
} from './plan-gates.js'
import {
  blockDemoMutation,
} from './demo-guards.js'

export async function createEvaluation(data) {
  const evaluationUser = {
    id: data.coachId,
    clubId: data.clubId,
    email: data.createdByEmail,
    name: data.createdByName ?? data.coach,
    role: data.createdByRole,
    roleRank: data.createdByRoleRank,
    planKey: data.planKey,
    planStatus: data.planStatus,
    isPlanComped: data.isPlanComped,
    isDemoAccount: data.isDemoAccount,
  }

  await blockDemoMutation(evaluationUser)

  let linkedPlayerId = data.playerId || ''
  let linkedTeamId = data.teamId || ''

  if (data.clubId) {
    const monthlyEvaluationCount = await getMonthlyEvaluationCount(data.clubId)
    await assertClubLimitAvailable({
      user: evaluationUser,
      clubId: data.clubId,
      limitName: 'monthlyEvaluations',
      label: 'Monthly development records',
      currentCount: monthlyEvaluationCount,
    })
  }

  if (data.clubId && data.team) {
    const { data: teamRow, error: teamError } = await supabase
      .from('teams')
      .select('id')
      .eq('club_id', data.clubId)
      .eq('name', String(data.team ?? '').trim())
      .maybeSingle()

    if (teamError) {
      console.error(teamError)
    } else {
      linkedTeamId = data.teamId || teamRow?.id || linkedTeamId
    }
  }

  await assertClubFeature({
    user: {
      ...evaluationUser,
      activeTeamId: linkedTeamId || data.teamId,
      teamId: linkedTeamId || data.teamId,
    },
    clubId: data.clubId,
    featureName: CAPABILITIES.assessments,
  })

  let feedbackFormPayload = {}
  if (data.feedbackFormId) {
    const selectedForm = await getActiveFeedbackFormForSubmission({
      formId: data.feedbackFormId,
      user: {
        ...evaluationUser,
        activeTeamId: linkedTeamId || data.teamId,
        teamId: linkedTeamId || data.teamId,
      },
    })
    const feedbackFormSnapshot = buildFeedbackFormSnapshot({
      form: selectedForm,
      formResponses: data.formResponses,
    })

    feedbackFormPayload = {
      feedbackFormId: selectedForm.id,
      feedbackFormName: selectedForm.name,
      feedbackFormVersion: selectedForm.version,
      feedbackFormSnapshot,
    }
  }

  if (data.clubId && data.playerName && data.section) {
    await assertPlayerLimitForUpsert({
      user: evaluationUser,
      clubId: data.clubId,
      section: EVALUATION_SECTIONS.includes(data.section) ? data.section : 'Trial',
      playerName: data.playerName,
      team: data.team,
      teamId: linkedTeamId || data.teamId,
    })

    const existingPlayer = await findExistingPlayer({
      clubId: data.clubId,
      section: data.section,
      playerName: data.playerName,
      team: data.team,
      teamId: linkedTeamId || data.teamId,
    })
    const playerPayload = {
      club_id: data.clubId,
      team_id: linkedTeamId || data.teamId || null,
      player_name: normalizeWords(data.playerName),
      section: EVALUATION_SECTIONS.includes(data.section) ? data.section : 'Trial',
      team: String(data.team ?? '').trim(),
      parent_name: String(data.parentName ?? '').trim(),
      parent_email: String(data.parentEmail ?? '').trim(),
      parent_contacts: normalizeParentContacts(data.parentContacts, {
        parentName: data.parentName,
        parentEmail: data.parentEmail,
      }),
      contact_type: normalizePlayerContactType(data.contactType ?? data.contact_type ?? (data.isAdult || data.is_adult ? 'self' : 'parent')),
      ...(existingPlayer?.id
        ? {}
        : {
            created_by: data.coachId || null,
            created_by_name: String(data.createdByName ?? data.coach ?? '').trim(),
            created_by_email: String(data.createdByEmail ?? '').trim().toLowerCase(),
          }),
      updated_by: data.updatedBy || data.coachId || null,
      updated_by_name: String(data.updatedByName ?? data.createdByName ?? data.coach ?? '').trim(),
      updated_by_email: String(data.updatedByEmail ?? data.createdByEmail ?? '').trim().toLowerCase(),
    }
    const playerQuery = existingPlayer?.id
      ? supabase.from('players').update(playerPayload).eq('id', existingPlayer.id)
      : supabase.from('players').insert(playerPayload)
    const { data: playerRow, error: playerError } = await playerQuery.select('id').single()

    if (playerError) {
      console.error(playerError)
    } else {
      linkedPlayerId = playerRow?.id || linkedPlayerId
    }
  }

  const payload = mapEvaluationToRow({
    ...data,
    ...feedbackFormPayload,
    playerId: linkedPlayerId,
    teamId: linkedTeamId,
    updatedBy: data.updatedBy || data.coachId,
    updatedByName: data.updatedByName ?? data.createdByName ?? data.coach,
    updatedByEmail: data.updatedByEmail ?? data.createdByEmail,
  })
  const { data: createdRow, error } = await supabase
    .from('evaluations')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${data.clubId}:`)
  invalidateMemoryCacheByPrefix(`evaluations:${data.clubId}:`)
  invalidateMemoryCacheByPrefix(`assessment-sessions:${data.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user: {
      id: data.coachId,
      clubId: data.clubId,
      name: data.createdByName ?? data.coach,
      email: data.createdByEmail,
    },
    action: 'evaluation_submitted',
    entityType: 'evaluation',
    entityId: createdRow.id,
    metadata: {
      playerName: data.playerName,
      section: data.section,
      team: data.team,
      feedbackFormId: feedbackFormPayload.feedbackFormId || null,
      feedbackFormName: feedbackFormPayload.feedbackFormName || '',
    },
  })

  return normalizeEvaluationRow(createdRow)
}

export async function updateEvaluation(id, data, clubId) {
  const mutationUser = {
    id: data.updatedBy || data.coachId,
    clubId,
    email: data.updatedByEmail || data.createdByEmail,
    name: data.updatedByName ?? data.createdByName ?? data.coach,
    role: data.updatedByRole ?? data.createdByRole,
    roleRank: data.updatedByRoleRank ?? data.createdByRoleRank,
    planKey: data.planKey,
    planStatus: data.planStatus,
    isPlanComped: data.isPlanComped,
    activeTeamId: data.teamId,
    teamId: data.teamId,
    isDemoAccount: data.isDemoAccount,
  }

  await blockDemoMutation(mutationUser)
  await assertClubFeature({
    user: mutationUser,
    clubId,
    featureName: CAPABILITIES.assessments,
  })

  const payload = mapEvaluationToRow(data)
  delete payload.created_by_name
  delete payload.created_by_email
  delete payload.created_at
  let query = supabase.from('evaluations').update(payload).eq('id', id)

  if (clubId) {
    query = query.eq('club_id', clubId)
  }

  const { data: updatedRow, error } = await query.select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`players:${clubId}:`)
  invalidateMemoryCacheByPrefix(`evaluations:${clubId}:`)
  invalidateMemoryCacheByPrefix(`assessment-sessions:${clubId}:`)
  clearViewCaches()

  return normalizeEvaluationRow(updatedRow)
}

export async function deleteEvaluation({ user, evaluationId }) {
  await blockDemoMutation(user)

  if (!user?.id || user.role !== 'super_admin' && Number(user.roleRank ?? 0) < 50) {
    throw new Error('Only managers and above can delete development records.')
  }

  let query = supabase.from('evaluations').delete().eq('id', evaluationId)

  if (user.role !== 'super_admin') {
    query = query.eq('club_id', user.clubId)
  }

  const { data: deletedRows, error } = await query.select('*')

  if (error) {
    console.error(error)
    throw error
  }

  const deletedEvaluation = deletedRows?.[0] ? normalizeEvaluationRow(deletedRows[0]) : null

  if (!deletedEvaluation) {
    throw new Error('No development record was deleted. Check permissions or refresh the page.')
  }

  if (user?.clubId) {
    invalidateMemoryCacheByPrefix(`evaluations:${user.clubId}:`)
    clearViewCaches()
  }

  await createAuditLog({
    user,
    action: 'evaluation_deleted',
    entityType: 'evaluation',
    entityId: evaluationId,
    metadata: {
      playerName: deletedEvaluation.playerName,
      section: deletedEvaluation.section,
      team: deletedEvaluation.team,
      date: deletedEvaluation.date,
      session: deletedEvaluation.session,
    },
  })

  return deletedEvaluation
}

export async function updateEvaluationStatus(id, status, clubId, options = {}) {
  await blockDemoMutation(options.user)

  const payload = {
    status,
    rejection_reason: status === 'Rejected' ? String(options.rejectionReason ?? '').trim() : null,
    reviewed_by: options.user?.id || null,
    reviewed_at: new Date().toISOString(),
    updated_by: getEntryUserId(options.user),
    ...getEntryIdentity(options.user, 'updated_by'),
  }
  let query = supabase.from('evaluations').update(payload).eq('id', id)

  if (clubId) {
    query = query.eq('club_id', clubId)
  }

  const { data: updatedRow, error } = await query.select('*').single()

  if (error) {
    console.error(error)
    throw error
  }

  await createAuditLog({
    user: options.user,
    action: status === 'Approved' ? 'evaluation_approved' : 'evaluation_rejected',
    entityType: 'evaluation',
    entityId: id,
    metadata: {
      status,
      rejectionReason: payload.rejection_reason,
    },
  })

  return normalizeEvaluationRow(updatedRow)
}
