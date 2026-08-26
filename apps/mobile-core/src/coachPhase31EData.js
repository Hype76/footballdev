import * as Crypto from 'expo-crypto'
import { wakeChatMobileNotificationProcessor } from '../../../src/lib/chat-notification-wake'
import { CAPABILITIES, getPlanLimit } from '../../../src/lib/paywall-access.js'
import { getMobileRuntimeConfig } from './config'
import {
  assertCoachCapability,
  assertCoachOperationalMutation,
  assertCoachOperationalRead,
  getCoachEntryIdentity,
  recordCoachOperationalAudit,
} from './coachOperationalData'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { getAccessToken, supabase } from './supabase'
import { getCoachMatchDayList } from './coachMatchDayData'
import { getCoachPlayerList } from './coachPlayersData'
import {
  assertSyntheticCoachCommunicationTarget,
  normalizeCoachChatMessage,
  normalizeCoachChatRoom,
  normalizeCoachDevelopmentField,
  normalizeCoachDevelopmentForm,
  normalizeCoachDevelopmentRecord,
  normalizeCoachInvite,
  normalizeCoachMessage,
  normalizeCoachPoll,
  normalizeCoachResource,
  splitCoachDevelopmentVisibility,
  validateCoachDevelopmentValues,
  validateCoachResourceUrl,
} from './coachPhase31ECore'

const config = getMobileRuntimeConfig('coach')

function normalize(value) {
  return String(value ?? '').trim()
}

function requestId(prefix) {
  void prefix
  return Crypto.randomUUID()
}

function assertCanonicalMutation(user, options = {}) {
  assertCoachOperationalMutation(user, options)
  if (!config.isUsable || !['test', 'production'].includes(config.supabaseEnvironment)) {
    throw new Error('Coach mutation environment is not approved.')
  }
}

function assertSyntheticTargetInTest(target) {
  if (!config.isProduction) assertSyntheticCoachCommunicationTarget(target)
}

function assertTeamEntity(user, entity, label) {
  if (entity?.teamId && entity.teamId !== user?.activeTeamId) {
    throw new Error(`${label} is not available in the active Team context.`)
  }
}

function assertParentChatTeam(user, room) {
  if (room?.kind === 'parent' && (!room.teamId || room.teamId !== user?.activeTeamId)) {
    throw new Error('Parent Chat is not assigned to the active Team context.')
  }
}

function getStarterSelectionId(templateKey, version) {
  const key = normalize(templateKey)
  const parsedVersion = Number(version || 0)
  return key && Number.isInteger(parsedVersion) && parsedVersion > 0
    ? `platform-starter:${key}:${parsedVersion}`
    : ''
}

async function rpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters)
  if (error) throw error
  return data
}

function isTransientChatError(error) {
  const signal = normalize(`${error?.code || ''} ${error?.message || error}`).toLowerCase()
  return signal.includes('network')
    || signal.includes('failed to fetch')
    || signal.includes('timed out')
    || signal.includes('timeout')
}

async function sendChatWithSafeRetry(name, parameters) {
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await rpc(name, parameters)
    } catch (error) {
      lastError = error
      if (!isTransientChatError(error) || attempt === 1) break
    }
  }
  throw lastError
}

export async function getCoachDevelopmentWorkspace(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const [playersResult, evaluationsResult, formsResult, legacyFieldsResult, draftsResult, starterFormsResult, starterPreferencesResult, teamResult] = await Promise.all([
    supabase.from('players').select('id,player_name,section,status,team,team_id').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).neq('status', 'archived').order('player_name'),
    supabase.from('evaluations').select('*').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).order('date', { ascending: false }).order('created_at', { ascending: false }).limit(250),
    supabase.from('feedback_forms').select('*').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).is('archived_at', null).order('name'),
    supabase.from('form_fields').select('*').eq('club_id', user.clubId).or(`team_id.eq.${user.activeTeamId},team_id.is.null`).eq('is_enabled', true).order('order_index'),
    supabase.from('evaluation_drafts').select('*').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).eq('created_by_user_id', user.id).eq('status', 'draft').order('last_saved_at', { ascending: false }).limit(25),
    supabase.from('feedback_form_starter_templates').select('*').eq('is_current', true).order('age_min').order('name'),
    supabase.from('feedback_form_starter_preferences').select('template_key,hidden').eq('club_id', user.clubId).eq('team_id', user.activeTeamId),
    supabase.from('teams').select('age_group').eq('club_id', user.clubId).eq('id', user.activeTeamId).maybeSingle(),
  ])
  const hardError = playersResult.error || evaluationsResult.error
  if (hardError) throw hardError
  const legacyFields = legacyFieldsResult.error ? [] : (legacyFieldsResult.data || []).map(normalizeCoachDevelopmentField)
  const teamForms = formsResult.error ? [] : (formsResult.data || [])
  const hiddenStarterKeys = new Set((starterPreferencesResult.error ? [] : starterPreferencesResult.data || [])
    .filter((preference) => preference.hidden === true)
    .map((preference) => normalize(preference.template_key)))
  const installedStarterForms = new Map(teamForms
    .filter((form) => normalize(form.starter_template_key))
    .map((form) => [normalize(form.starter_template_key), form]))
  const teamAgeGroup = teamResult.error ? '' : normalize(teamResult.data?.age_group)
  const starterForms = (starterFormsResult.error ? [] : starterFormsResult.data || [])
    .filter((form) => !hiddenStarterKeys.has(normalize(form.template_key)))
    .map((form) => {
      const installed = installedStarterForms.get(normalize(form.template_key))
      return normalizeCoachDevelopmentForm({
        ...form,
        age_group: form.age_band || teamAgeGroup,
        id: getStarterSelectionId(form.template_key, form.version),
        installed_form_id: installed?.id || '',
        is_platform_template: true,
        team_id: user.activeTeamId,
      })
    })
  const customForms = teamForms
    .filter((form) => !normalize(form.starter_template_key))
    .map((form) => normalizeCoachDevelopmentForm({ ...form, fields: form.fields || legacyFields }))
  const forms = [...starterForms, ...customForms]
  if (forms.length === 0 && legacyFields.length > 0) {
    forms.push(normalizeCoachDevelopmentForm({ id: 'canonical-default', name: 'Development record', team_id: user.activeTeamId, fields: legacyFields }))
  }
  return Object.freeze({
    players: Object.freeze((playersResult.data || []).map((player) => Object.freeze({
      id: player.id, playerName: normalize(player.player_name), section: normalize(player.section), status: normalize(player.status), team: normalize(player.team), teamId: normalize(player.team_id),
    }))),
    records: Object.freeze((evaluationsResult.data || []).map(normalizeCoachDevelopmentRecord)),
    forms: Object.freeze(forms),
    drafts: Object.freeze(draftsResult.error ? [] : (draftsResult.data || []).map((draft) => Object.freeze({
      id: draft.id, playerId: normalize(draft.player_id), formId: normalize(draft.draft_data?.selectedFeedbackFormId || draft.draft_data?.draftContext?.formId),
      values: draft.draft_data?.responseValues || {}, clientSaveVersion: Number(draft.client_save_version || draft.draft_data?.draftMeta?.clientSaveVersion || 0),
      lastSavedAt: draft.last_saved_at || '', status: draft.status,
    }))),
  })
}

export async function saveCoachDevelopmentDraft(user, { draftId = '', form, player, values = {}, clientSaveVersion = 0 } = {}) {
  assertCanonicalMutation(user, { requiresTeam: true })
  assertCoachCapability(user, CAPABILITIES.assessments)
  assertTeamEntity(user, player, 'Player')
  if (!form?.id || !player?.id) throw new Error('Choose a Player and Development form before saving a draft.')
  const validation = validateCoachDevelopmentValues(form, values, user.roleRank)
  const nextVersion = Math.max(Number(clientSaveVersion || 0) + 1, 1)
  const now = new Date().toISOString()
  const contextKey = ['development_record', user.activeTeamId, player.id, form.id].join(':')
  const row = {
    club_id: user.clubId,
    team_id: user.activeTeamId,
    player_id: player.id,
    created_by_user_id: user.id,
    report_type: 'development_record',
    context_key: contextKey,
    draft_data: {
      draftContext: { clubId: user.clubId, createdByUserId: user.id, formId: form.id, formType: 'development_record', playerId: player.id, playerName: player.playerName, teamId: user.activeTeamId, teamName: user.activeTeamName },
      responseValues: validation.values,
      selectedFeedbackFormId: form.id,
      visibility: splitCoachDevelopmentVisibility(form, validation.values),
      draftMeta: { clientSaveVersion: nextVersion, clientSavedAt: now },
    },
    status: 'draft',
    client_save_version: nextVersion,
    last_saved_at: now,
    updated_at: now,
  }
  let query
  if (draftId) {
    query = supabase.from('evaluation_drafts').update(row).eq('id', draftId).eq('created_by_user_id', user.id).eq('status', 'draft').lt('client_save_version', nextVersion)
  } else {
    query = supabase.from('evaluation_drafts').insert({ ...row, created_at: now })
  }
  const { data, error } = await query.select('*').single()
  if (error) throw error
  return Object.freeze({ id: data.id, clientSaveVersion: Number(data.client_save_version || nextVersion), lastSavedAt: data.last_saved_at, values: data.draft_data?.responseValues || {} })
}

export async function finalizeCoachDevelopmentRecord(user, { draftId = '', form, player, sessionId = '', values = {}, notes = '', shareWithParent = false } = {}) {
  assertCanonicalMutation(user, { requiresTeam: true })
  assertCoachCapability(user, CAPABILITIES.assessments)
  assertTeamEntity(user, player, 'Player')
  if (!form?.id || !player?.id) throw new Error('Choose a Player and Development form before finalising.')
  const validation = validateCoachDevelopmentValues(form, values, user.roleRank)
  if (!validation.valid) throw new Error(validation.errors[0])
  let parentShareRequest = null
  let selectedParentLinkIds = []
  if (shareWithParent) {
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Sign in again before sharing this Development record.')
    const endpoint = joinApiPath(config.apiBaseUrl, '.netlify/functions/send-parent-email')
    parentShareRequest = async (body) => {
      const { ok, response, result } = await fetchJsonWithTimeout(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!ok || result?.success === false) {
        throw Object.assign(new Error(normalize(result?.message) || 'The Development record could not be shared with Parents.'), { status: response.status })
      }
      return result
    }
    const recipients = await parentShareRequest({ action: 'resolve_development_recipients', clubId: user.clubId, teamId: user.activeTeamId, playerId: player.id })
    selectedParentLinkIds = (recipients.recipients || []).map((recipient) => normalize(recipient.linkId)).filter(Boolean)
    if (selectedParentLinkIds.length === 0) throw new Error('No authorised Parent link is available for this Player.')
  }
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const { count: monthlyCount, error: countError } = await supabase
    .from('evaluations')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', user.clubId)
    .gte('created_at', monthStart.toISOString())
  if (countError) throw countError
  const monthlyLimit = getPlanLimit(user, 'monthlyEvaluations')
  if (monthlyLimit !== null && Number(monthlyCount || 0) >= monthlyLimit) {
    throw new Error('The monthly Development record limit has been reached for this plan.')
  }
  const scoreValues = form.fields
    .filter((field) => ['rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type))
    .map((field) => Number(validation.values[field.id]))
    .filter(Number.isFinite)
  const scores = Object.fromEntries(form.fields
    .filter((field) => ['rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type))
    .map((field) => [field.label, Number(validation.values[field.id])])
    .filter(([, value]) => Number.isFinite(value)))
  const now = new Date().toISOString()
  const evaluationId = requestId('coach-development')
  const { data, error } = await supabase.from('evaluations').insert({
    id: evaluationId,
    club_id: user.clubId,
    team_id: user.activeTeamId,
    player_id: player.id,
    player_name: player.playerName,
    section: player.section,
    team: player.team || user.activeTeamName,
    session: sessionId ? 'Linked Session' : 'Development record',
    assessment_session_id: sessionId || null,
    date: now.slice(0, 10),
    status: 'Submitted',
    coach: normalize(user.displayName || user.name || user.email),
    coach_id: user.id,
    average_score: scoreValues.length ? Number((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length).toFixed(1)) : null,
    scores,
    comments: { overall: normalize(notes), strengths: '', improvements: '', selectedStrengths: [] },
    form_responses: validation.values,
    feedback_form_id: form.installedFormId || (form.isPlatformTemplate ? null : form.id),
    feedback_form_name: form.name,
    feedback_form_version: form.version,
    feedback_form_snapshot: { id: form.id, name: form.name, version: form.version, fields: form.fields },
    ...getCoachEntryIdentity(user),
    updated_by: user.id,
    ...getCoachEntryIdentity(user, 'updated'),
  }).select('*').single()
  if (error) throw error
  if (draftId) {
    const { error: closeError } = await supabase.from('evaluation_drafts').update({ status: 'submitted', submitted_at: now, updated_at: now }).eq('id', draftId).eq('created_by_user_id', user.id).eq('status', 'draft')
    if (closeError) throw closeError
  }
  let sharedRecipientCount = 0
  if (shareWithParent) {
    const report = await parentShareRequest({
      action: 'finalize_development_parent_report',
      clubId: user.clubId,
      teamId: user.activeTeamId,
      playerId: player.id,
      evaluationId: data.id,
      selectedParentLinkIds,
      includeAttendance: false,
      includeProgression: true,
    })
    sharedRecipientCount = Number(report.eligibleRecipients?.length || selectedParentLinkIds.length)
  }
  await recordCoachOperationalAudit({ user, action: 'development_record_finalised', entityType: 'evaluation', entityId: data.id, metadata: { teamId: user.activeTeamId, playerId: player.id, formId: form.id, parentShared: shareWithParent, sharedRecipientCount, communicationDelivery: shareWithParent ? 'in_app' : 'disabled' } })
  return Object.freeze({ ...normalizeCoachDevelopmentRecord(data), sharedRecipientCount })
}

export async function getCoachResources(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await supabase
    .from('resource_library_items')
    .select('*,teams:team_id(id,name),resource_library_links(*),resource_library_external_links(external_url)')
    .eq('club_id', user.clubId)
    .eq('team_id', user.activeTeamId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data || [])
    .map(normalizeCoachResource)
    .filter((item) => item.teamId === user.activeTeamId)
    .filter((item) => !item.expiresAt || new Date(item.expiresAt).getTime() > Date.now())
}

export async function createCoachExternalResource(user, { title = '', description = '', category = 'general', externalUrl = '' } = {}) {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  const safeUrl = validateCoachResourceUrl(externalUrl)
  if (!normalize(title)) throw new Error('Add a resource title.')
  if (!safeUrl.safe) throw new Error(safeUrl.reason)
  const data = await rpc('create_external_resource_library_item', {
    target_club_id: user.clubId, target_team_id: user.activeTeamId, title_value: normalize(title), description_value: normalize(description), category_value: normalize(category) || 'general', external_url_value: safeUrl.url,
  })
  return normalizeCoachResource(Array.isArray(data) ? data[0] : data)
}

export async function setCoachResourceSharing(user, resource, targets = [], shareDescription = '') {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertTeamEntity(user, resource, 'Resource')
  const safeTargets = (targets || []).filter((target) => target?.linkedId && ['player', 'team'].includes(target.linkedType) && (!target.teamId || target.teamId === user.activeTeamId))
  if (!resource?.id || safeTargets.length === 0) throw new Error('Choose an in-scope Resource and sharing target.')
  const data = await rpc('assign_resource_library_item_with_parent_notifications', {
    target_resource_id: resource.id,
    target_club_id: user.clubId,
    target_team_id: user.activeTeamId,
    targets_value: safeTargets.map((target) => ({ linkedType: target.linkedType, linkedId: target.linkedId, parentVisible: target.linkedType === 'player' && target.parentVisible === true })),
    share_description_value: normalize(shareDescription).slice(0, 500),
  })
  return data || []
}

export async function removeCoachResourceSharing(user, resource, linkId) {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertTeamEntity(user, resource, 'Resource')
  await rpc('remove_resource_library_link', { target_link_id: linkId, target_club_id: user.clubId, target_team_id: user.activeTeamId })
}

export async function getCoachResourceAccessUrl(user, resource) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  assertTeamEntity(user, resource, 'Resource')
  if (resource.type === 'external_link') {
    const safe = validateCoachResourceUrl(resource.externalUrl)
    if (!safe.safe) throw new Error(safe.reason)
    return safe.url
  }
  if (!resource.storageBucket || !resource.storagePath) throw new Error('This Resource file is unavailable.')
  const { data, error } = await supabase.storage.from(resource.storageBucket).createSignedUrl(resource.storagePath, 60)
  if (error || !data?.signedUrl) throw error || new Error('This Resource file is unavailable.')
  return data.signedUrl
}

function canOpenStaffRoom(user, room) {
  const membership = room.members.find((member) => member.userId === user.id && !member.archivedAt)
  if (!membership) return false
  if (room.type === 'team_staff' || room.type === 'player_staff') return room.teamId === user.activeTeamId
  if (room.type === 'club_staff') return normalize(user.role).toLowerCase() === 'admin' && normalize(user.workspaceScope).toLowerCase() === 'club'
  return ['direct', 'group'].includes(room.type)
}

async function assertStaffRoomActiveContext(user, room) {
  if (!room?.id || !canOpenStaffRoom(user, room)) {
    throw new Error('Coach Chat is not available for this membership.')
  }
  const allowed = await rpc('staff_chat_conversation_in_active_context', {
    active_team_id_value: user.activeTeamId || null,
    target_conversation_id: room.id,
  })
  if (!allowed) throw new Error('Coach Chat is not available in the active Team context.')
}

export async function getCoachChatRooms(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const [scopedStaffRows, parentRows] = await Promise.all([
    rpc('get_staff_chat_conversation_ids', { active_team_id_value: user.activeTeamId }),
    rpc('get_parent_chat_rooms', { active_team_id_value: user.activeTeamId }),
  ])
  const scopedStaffIds = (scopedStaffRows || []).map((row) => normalize(row.id)).filter(Boolean)
  const staffResult = scopedStaffIds.length
    ? await supabase.from('staff_chat_conversations').select('*,staff_chat_members(*)').eq('club_id', user.clubId).in('id', scopedStaffIds).order('last_message_at', { ascending: false, nullsFirst: false })
    : { data: [], error: null }
  if (staffResult.error) throw staffResult.error
  const staff = (staffResult.data || []).map((row) => normalizeCoachChatRoom(row, 'staff')).filter((room) => canOpenStaffRoom(user, room))
  const parent = (parentRows || []).map((row) => normalizeCoachChatRoom(row, 'parent')).filter((room) => room.teamId === user.activeTeamId)
  return Object.freeze({ staff: Object.freeze(staff), parent: Object.freeze(parent) })
}

export async function getCoachChatMessages(user, room) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  assertTeamEntity(user, room, 'Chat')
  assertParentChatTeam(user, room)
  if (!room?.id) return []
  if (room.kind === 'parent') {
    const data = await rpc('get_parent_chat_messages', {
      active_team_id_value: user.activeTeamId,
      target_room_id: room.id,
    })
    const senderIds = [...new Set((data || []).map((row) => normalize(row.sender_id ?? row.senderId)).filter(Boolean))]
    let currentNames = []
    if (senderIds.length > 0) {
      const result = await supabase.from('users').select('id, display_name, name, username').in('id', senderIds)
      if (!result.error) currentNames = result.data || []
    }
    const nameBySenderId = new Map(currentNames.map((profile) => [normalize(profile.id), profile]))
    return (data || []).map((row) => normalizeCoachChatMessage({
      ...row,
      users: nameBySenderId.get(normalize(row.sender_id ?? row.senderId)) || null,
    }))
  }
  await assertStaffRoomActiveContext(user, room)
  const { data, error } = await supabase.from('staff_chat_messages').select('*,users:sender_id(id,display_name,name,username,role_label)').eq('conversation_id', room.id).eq('club_id', user.clubId).order('created_at')
  if (error) throw error
  return (data || []).map(normalizeCoachChatMessage)
}

export async function sendCoachChatMessage(user, room, body) {
  assertCanonicalMutation(user, { requiresTeam: true })
  assertTeamEntity(user, room, 'Chat')
  assertParentChatTeam(user, room)
  assertSyntheticTargetInTest(room)
  const message = normalize(body)
  if (!message || message.length > 2000) throw new Error('Add a Chat message of 2000 characters or fewer.')
  const chatRequestId = requestId('coach-chat')
  if (room.kind === 'parent') {
    await sendChatWithSafeRetry('send_parent_chat_message', {
      active_team_id_value: user.activeTeamId,
      target_room_id: room.id,
      body_value: message,
      request_id_value: chatRequestId,
    })
  } else {
    await assertStaffRoomActiveContext(user, room)
    await sendChatWithSafeRetry('send_staff_chat_message', {
      active_team_id_value: user.activeTeamId,
      conversation_id_value: room.id,
      body_value: message,
      request_id_value: chatRequestId,
    })
  }
  void getAccessToken()
    .then((accessToken) => wakeChatMobileNotificationProcessor({
      accessToken,
      baseUrl: config.apiBaseUrl,
    }))
    .catch(() => {})
  return getCoachChatMessages(user, room)
}

export async function markCoachChatRead(user, room) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  assertTeamEntity(user, room, 'Chat')
  assertParentChatTeam(user, room)
  if (room.kind === 'parent') return rpc('mark_parent_chat_room_read', {
    active_team_id_value: user.activeTeamId,
    target_room_id: room.id,
  })
  await assertStaffRoomActiveContext(user, room)
  return rpc('mark_staff_chat_conversation_read', {
    active_team_id_value: user.activeTeamId,
    conversation_id_value: room.id,
  })
}

export async function getCoachMessages(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await supabase
    .from('communication_logs')
    .select('*,players!inner(team_id)')
    .eq('club_id', user.clubId)
    .eq('players.team_id', user.activeTeamId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data || []).map(normalizeCoachMessage)
}

export async function getCoachPolls(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const { data, error } = await supabase.from('polls').select('*,teams:team_id(name),poll_votes(*)').eq('club_id', user.clubId).or(`team_id.is.null,team_id.eq.${user.activeTeamId}`).order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((poll) => normalizeCoachPoll(poll, user.id))
}

export async function createCoachPoll(user, poll) {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertSyntheticTargetInTest({ title: poll?.title })
  const options = (poll?.options || []).map((option, index) => ({ id: normalize(option.id) || `option-${index + 1}`, label: normalize(option.label || option), value: normalize(option.value), playerId: normalize(option.playerId) })).filter((option) => option.label)
  if (!normalize(poll?.title) || options.length < 2) throw new Error(`Add ${config.isProduction ? 'a title' : 'an FP TEST title'} and at least two Poll options.`)
  const data = await rpc('create_team_poll', {
    p_active_team_id: user.activeTeamId, p_team_id: user.activeTeamId, p_title: normalize(poll.title), p_description: normalize(poll.description), p_audience: poll.audience === 'staff' ? 'staff' : 'parents', p_poll_type: ['time', 'awards'].includes(poll.pollType) ? poll.pollType : 'text',
    p_options: options, p_closes_at: normalize(poll.closesAt) || null, p_allow_multiple: poll.allowMultiple === true, p_max_choices: poll.allowMultiple ? Number(poll.maxChoices || 0) || null : null,
    p_allow_own_child_votes: poll.allowOwnChildVotes !== false, p_allow_vote_changes: poll.allowVoteChanges !== false, p_hide_votes: poll.anonymous === true, p_allow_comments: poll.allowComments === true, p_request_id: requestId('coach-poll'),
  })
  if (poll.audience !== 'staff' && poll.notifyResultsOnClose === true) {
    const configured = await rpc('configure_poll_result_delivery', {
      p_notify_results: true,
      p_poll_id: data.id,
    })
    return normalizeCoachPoll(configured)
  }
  return normalizeCoachPoll(data)
}

export async function setCoachPollStatus(user, poll, status) {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertTeamEntity(user, poll, 'Poll')
  if (!poll?.id) throw new Error('Choose a Poll.')
  const data = await rpc('set_team_poll_status', { p_poll_id: poll.id, p_status: status === 'closed' ? 'closed' : 'open' })
  return normalizeCoachPoll(data)
}

export async function deleteCoachPoll(user, poll) {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertTeamEntity(user, poll, 'Poll')
  if (!poll?.id || poll.status !== 'closed') throw new Error('Archive this Poll before deleting it.')
  await rpc('delete_team_poll', { p_poll_id: poll.id })
  return true
}

export async function submitCoachPollVote(user, poll, optionId) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  assertTeamEntity(user, poll, 'Poll')
  if (!poll?.id || poll.audience !== 'staff' || poll.status !== 'open') throw new Error('Choose an open Coach Poll.')
  const normalizedOptionId = normalize(optionId)
  if (!poll.options.some((option) => option.id === normalizedOptionId)) throw new Error('Choose a Poll option.')
  await rpc('submit_staff_poll_vote', { p_option_id: normalizedOptionId, p_poll_id: poll.id })
  return true
}

export async function getCoachInvitesAndAvailability(user) {
  assertCoachOperationalRead(user, { requiresTeam: true })
  const [calendarResult, trainingResult, matchResult, matches, players] = await Promise.all([
    supabase.from('calendar_event_invites').select('*,calendar_events:calendar_event_id(title,team_id,cancelled_at)').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).order('created_at', { ascending: false }).limit(250),
    supabase.from('training_availability_request_players').select('*,training_availability_requests:request_id(*),training_availability_responses(*)').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).order('created_at', { ascending: false }).limit(250),
    supabase.from('match_day_availability_requests').select('*,match_days:match_day_id(opponent,team_id,status,deleted_at,match_date)').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).order('created_at', { ascending: false }).limit(250),
    getCoachMatchDayList(user),
    getCoachPlayerList(user),
  ])
  const hardError = calendarResult.error || trainingResult.error || matchResult.error
  if (hardError) throw hardError
  const trainingRows = trainingResult.data || []
  const trainingEventIds = [...new Set(trainingRows.map((row) => {
    const request = Array.isArray(row.training_availability_requests) ? row.training_availability_requests[0] : row.training_availability_requests
    return normalize(request?.calendar_event_id)
  }).filter(Boolean))]
  const trainingEventResult = trainingEventIds.length
    ? await supabase.from('calendar_events').select('id,title,team_id,cancelled_at').eq('club_id', user.clubId).eq('team_id', user.activeTeamId).in('id', trainingEventIds)
    : { data: [], error: null }
  if (trainingEventResult.error) throw trainingEventResult.error
  const trainingEvents = new Map((trainingEventResult.data || []).map((event) => [normalize(event.id), event]))
  const calendar = (calendarResult.data || []).map((row) => normalizeCoachInvite({ ...row, title: row.calendar_events?.title, cancelled_at: row.calendar_events?.cancelled_at }, 'calendar'))
  const training = trainingRows.map((row) => {
    const request = Array.isArray(row.training_availability_requests) ? row.training_availability_requests[0] : row.training_availability_requests
    const event = trainingEvents.get(normalize(request?.calendar_event_id))
    const response = Array.isArray(row.training_availability_responses) ? row.training_availability_responses[0] : row.training_availability_responses
    return normalizeCoachInvite({ ...row, ...response, calendar_event_id: request?.calendar_event_id, occurrence_date: request?.occurrence_date, occurrence_starts_at: request?.occurrence_starts_at, title: event?.title, cancelled_at: event?.cancelled_at }, 'training')
  })
  const match = (matchResult.data || []).map((row) => {
    const fixture = Array.isArray(row.match_days) ? row.match_days[0] : row.match_days
    return normalizeCoachInvite({ ...row, match_date: fixture?.match_date, title: fixture?.opponent, cancelled_at: fixture?.status === 'cancelled' ? new Date(0).toISOString() : '', deleted_at: fixture?.deleted_at }, 'match')
  })
  return Object.freeze({ calendar: Object.freeze(calendar), training: Object.freeze(training), match: Object.freeze(match), matches: Object.freeze(matches), players: Object.freeze(players), all: Object.freeze([...match, ...training, ...calendar]) })
}

export async function createCoachMatchAvailabilityRequests(user, match, playerIds = []) {
  assertCanonicalMutation(user, { minimumRank: 20, requiresTeam: true })
  assertTeamEntity(user, match, 'Match Day')
  const selectedPlayerIds = [...new Set((playerIds || []).map(normalize).filter(Boolean))]
  if (!normalize(match?.id) || match?.teamId !== user?.activeTeamId || !['scheduled', 'scorer_request'].includes(normalize(match?.status))) throw new Error('Choose an open Match Day fixture in the active Team.')
  if (selectedPlayerIds.length === 0) throw new Error('Select at least one Player.')
  if (!config.isProduction) assertSyntheticCoachCommunicationTarget({ title: `${match?.opponent || ''} ${match?.teamName || ''}` })
  const accessToken = await getAccessToken()
  if (!accessToken) throw new Error('Sign in again before creating Match availability requests.')
  const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/send-match-day-availability-requests'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchDayId: match.id, playerIds: selectedPlayerIds }),
  })
  if (!ok || result?.success === false) {
    throw Object.assign(new Error(normalize(result?.message) || 'Match availability requests could not be created.'), { status: response.status })
  }
  return Object.freeze({
    complete: result?.complete !== false,
    createdPlayerCount: Number(result?.createdPlayerCount ?? 0),
    duplicateCount: Number(result?.duplicateCount ?? result?.duplicateQueueCount ?? 0),
    existingPlayerCount: Number(result?.existingPlayerCount ?? 0),
    failedCount: Number(result?.failedCount ?? 0),
    missingContactCount: Number(result?.missingContactCount ?? 0),
    queuedCount: Number(result?.queuedCount ?? result?.sentCount ?? 0),
    requestCount: Number(result?.requestCount ?? 0),
    resolvedPlayerCount: Number(result?.resolvedPlayerCount ?? 0),
    selectedPlayerCount: Number(result?.selectedPlayerCount ?? selectedPlayerIds.length),
    success: true,
    unresolvedPlayerIds: Array.isArray(result?.unresolvedPlayerIds) ? result.unresolvedPlayerIds.map(normalize).filter(Boolean) : [],
  })
}

export async function recordCoachInviteIntent(user, invite, action) {
  assertCanonicalMutation(user, { minimumRank: 50, requiresTeam: true })
  assertTeamEntity(user, invite, 'Invitation')
  if (!['create', 'resend', 'cancel', 'close'].includes(action)) throw new Error('Choose a supported Invitation action.')
  if (invite?.stale || invite?.cancelled) throw new Error('This Invitation target is stale or cancelled.')

  if (config.isProduction) {
    if (action !== 'resend') throw new Error('Use the authoritative web workflow to close or cancel an Invitation.')
    const accessToken = await getAccessToken()
    if (!accessToken) throw new Error('Sign in again before resending an Invitation.')
    const sourceType = invite.kind === 'match' ? 'match-day' : 'calendar'
    const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(config.apiBaseUrl, '.netlify/functions/send-event-player-invitation'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'resend',
        eventId: invite.eventId,
        idempotencyKey: requestId('coach-invite-resend'),
        occurrenceDate: invite.occurrenceDate || '',
        playerId: invite.playerId,
        preview: false,
        sourceType,
      }),
    })
    if (!ok || result?.success === false) {
      throw Object.assign(new Error(normalize(result?.message) || 'The Invitation could not be resent.'), { status: response.status })
    }
    return Object.freeze({
      action: 'resend',
      communicationDelivery: 'canonical_production_queue',
      duplicate: result?.duplicate === true,
      recorded: true,
      recipientCount: Number(result?.recipientCount ?? result?.queuedCount ?? 0),
      requestId: normalize(result?.requestId),
    })
  }

  await recordCoachOperationalAudit({ user, action: `invite_${action}_intent`, entityType: `${invite.kind}_invite`, entityId: invite.id || invite.eventId, metadata: { teamId: user.activeTeamId, communicationDelivery: 'disabled', schedules: 'disabled', syntheticOnly: true } })
  return Object.freeze({ action, communicationDelivery: 'disabled', recorded: true, requestId: requestId('coach-invite-intent') })
}

function getCoachInviteRemovalRequest(invite) {
  const sourceType = invite?.kind === 'match' ? 'match-day' : 'calendar'
  const scope = invite?.kind === 'training' ? 'occurrence' : 'event'
  const occurrenceDate = scope === 'occurrence' ? normalize(invite?.occurrenceDate) : null
  if (!normalize(invite?.eventId) || !normalize(invite?.playerId)) throw new Error('Choose an active event and Player before removing participation.')
  if (scope === 'occurrence' && !/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) throw new Error('Choose the Training session date before removing participation.')
  return Object.freeze({ occurrenceDate, scope, sourceType })
}

function normalizeCoachInviteRemovalResult(result = {}) {
  return Object.freeze({
    ...result,
    affectedOccurrenceCount: Number(result?.affectedOccurrenceCount || 0),
    alreadyRemoved: result?.alreadyRemoved === true,
    communicationSent: result?.communicationSent === true,
    communicationWillBeSent: result?.communicationWillBeSent === true,
    historyPreserved: result?.historyPreserved === true,
    playerRecordPreserved: result?.playerRecordPreserved === true,
    requiresInProgressConfirmation: result?.requiresInProgressConfirmation === true,
    revokedTokenCount: Number(result?.revokedTokenCount || 0),
    suppressedInvitationCount: Number(result?.suppressedInvitationCount || 0),
    teamMembershipUnchanged: result?.teamMembershipUnchanged === true,
  })
}

export async function previewCoachInviteRemoval(user, invite) {
  assertCanonicalMutation(user, { minimumRank: 20, requiresTeam: true })
  assertTeamEntity(user, invite, 'Invitation')
  if (invite?.stale || invite?.cancelled) throw new Error('This Invitation target is stale or cancelled.')
  const request = getCoachInviteRemovalRequest(invite)
  const result = await rpc('preview_event_player_removal', {
    event_id_value: invite.eventId,
    occurrence_date_value: request.occurrenceDate,
    player_id_value: invite.playerId,
    scope_value: request.scope,
    source_type_value: request.sourceType,
  })
  return normalizeCoachInviteRemovalResult(result)
}

export async function removeCoachInviteFromEvent(user, invite, { confirmInProgress = false, requestToken = '' } = {}) {
  assertCanonicalMutation(user, { minimumRank: 20, requiresTeam: true })
  assertTeamEntity(user, invite, 'Invitation')
  if (invite?.stale || invite?.cancelled) throw new Error('This Invitation target is stale or cancelled.')
  const request = getCoachInviteRemovalRequest(invite)
  const result = await rpc('remove_player_from_event', {
    confirm_in_progress_value: confirmInProgress === true,
    event_id_value: invite.eventId,
    occurrence_date_value: request.occurrenceDate,
    player_id_value: invite.playerId,
    request_token_value: normalize(requestToken) || requestId('coach-invite-removal'),
    scope_value: request.scope,
    source_type_value: request.sourceType,
  })
  return normalizeCoachInviteRemovalResult(result)
}
