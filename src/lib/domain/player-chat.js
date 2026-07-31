import { supabase } from '../supabase-client.js'
import { blockDemoMutation } from './demo-guards.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeParticipants(value) {
  return (Array.isArray(value) ? value : []).map((participant) => ({
    id: normalizeText(participant?.id),
    kind: normalizeText(participant?.kind),
    name: normalizeText(participant?.name) || 'Participant',
  }))
}

function normalizeConversation(value) {
  return {
    id: normalizeText(value?.id),
    conversationType: normalizeText(value?.conversationType),
    label: normalizeText(value?.label),
    title: normalizeText(value?.title),
    status: normalizeText(value?.status) || 'active',
    teamId: normalizeText(value?.teamId),
    playerId: normalizeText(value?.playerId),
    participants: normalizeParticipants(value?.participants),
    lastMessageAt: normalizeText(value?.lastMessageAt),
    unreadCount: Number(value?.unreadCount ?? 0),
    canOpen: value?.canOpen === true,
  }
}

function assertPlayerChatResult(result, fallbackMessage) {
  if (result?.ok === true) {
    return result
  }

  const messages = {
    login_or_staff_context_required: 'Authorised staff access is required for player Chat.',
    no_active_parent_recipient: 'This player has no active Parent Portal recipient for a parent conversation.',
    player_scope_mismatch: 'This player is not available in the current club context.',
    team_authority_required: 'The current staff assignment cannot access this player conversation.',
    unsupported_conversation_type: 'This player conversation type is not supported.',
  }

  throw new Error(messages[result?.denialCategory] || fallbackMessage)
}

export async function getPlayerLinkedChatContext({ playerId } = {}) {
  const normalizedPlayerId = normalizeText(playerId)
  if (!normalizedPlayerId) {
    return {
      conversations: [],
      permissions: {
        canStartParent: false,
        canStartStaff: false,
        canViewParent: false,
        canViewStaff: false,
      },
    }
  }

  const { data, error } = await supabase.rpc('get_player_linked_chat_context', {
    player_id_value: normalizedPlayerId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  const result = assertPlayerChatResult(data, 'Player Chat history could not be loaded.')

  return {
    clubId: normalizeText(result.clubId),
    teamId: normalizeText(result.teamId),
    playerId: normalizeText(result.playerId),
    permissions: {
      canStartParent: result.permissions?.canStartParent === true,
      canStartStaff: result.permissions?.canStartStaff === true,
      canViewParent: result.permissions?.canViewParent === true,
      canViewStaff: result.permissions?.canViewStaff === true,
    },
    conversations: (Array.isArray(result.conversations) ? result.conversations : [])
      .map(normalizeConversation),
  }
}

export async function startOrReusePlayerChat({ conversationType, playerId, user } = {}) {
  await blockDemoMutation(user)

  const normalizedPlayerId = normalizeText(playerId)
  const normalizedConversationType = normalizeText(conversationType).toLowerCase()

  if (!normalizedPlayerId) {
    throw new Error('Open a resolved saved player before starting Chat.')
  }

  if (!['parent', 'staff'].includes(normalizedConversationType)) {
    throw new Error('Choose a supported player conversation type.')
  }

  const { data, error } = await supabase.rpc('start_or_reuse_player_chat', {
    conversation_type_value: normalizedConversationType,
    player_id_value: normalizedPlayerId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  return assertPlayerChatResult(data, 'The player conversation could not be opened.')
}
