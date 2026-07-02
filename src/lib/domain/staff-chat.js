import { canUseStaffChat } from '../auth-permissions.js'
import { supabase } from '../supabase-client.js'
import { createAuditLog } from './audit.js'
import { clearViewCaches, getCachedResource, invalidateMemoryCacheByPrefix } from './cache-store.js'
import { blockDemoMutation } from './demo-guards.js'
import { getAvailableTeamsForUser } from './team-actions.js'
import { getVisibleClubUsers } from './role-queries.js'

export const STAFF_CHAT_CONVERSATION_TYPES = ['club_staff', 'team_staff', 'group', 'direct']

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeConversationType(value) {
  const normalizedValue = normalizeText(value)
  return STAFF_CHAT_CONVERSATION_TYPES.includes(normalizedValue) ? normalizedValue : 'group'
}

function normalizeProfile(row) {
  return {
    id: row.id ?? '',
    email: normalizeText(row.email).toLowerCase(),
    name: normalizeText(row.name) || normalizeText(row.email),
    role: normalizeText(row.role),
    roleLabel: normalizeText(row.role_label ?? row.roleLabel ?? row.role),
    roleRank: Number(row.role_rank ?? row.roleRank ?? 0),
    clubId: row.club_id ?? row.clubId ?? '',
  }
}

function normalizeMember(row) {
  const profile = Array.isArray(row.users) ? row.users[0] : row.users

  return {
    id: row.id ?? '',
    conversationId: row.conversation_id ?? row.conversationId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    userId: row.user_id ?? row.userId ?? '',
    addedBy: row.added_by ?? row.addedBy ?? '',
    lastReadAt: row.last_read_at ?? row.lastReadAt ?? '',
    archivedAt: row.archived_at ?? row.archivedAt ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    user: profile ? normalizeProfile(profile) : null,
  }
}

export function normalizeStaffChatMessage(row) {
  const sender = Array.isArray(row.users) ? row.users[0] : row.users

  return {
    id: row.id ?? '',
    conversationId: row.conversation_id ?? row.conversationId ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    senderId: row.sender_id ?? row.senderId ?? '',
    body: normalizeText(row.body),
    deletedAt: row.deleted_at ?? row.deletedAt ?? '',
    deletedBy: row.deleted_by ?? row.deletedBy ?? '',
    createdAt: row.created_at ?? row.createdAt ?? '',
    updatedAt: row.updated_at ?? row.updatedAt ?? '',
    sender: sender ? normalizeProfile(sender) : null,
  }
}

export function normalizeStaffChatConversation(row) {
  const members = (row.staff_chat_members ?? row.members ?? []).map(normalizeMember)
  const messages = (row.staff_chat_messages ?? row.messages ?? []).map(normalizeStaffChatMessage)
  const currentMember = row.currentMember ?? members.find((member) => member.userId === row.currentUserId) ?? null
  const lastMessageAt = normalizeText(row.last_message_at ?? row.lastMessageAt)
  const updatedAt = normalizeText(row.updated_at ?? row.updatedAt)
  const createdAt = normalizeText(row.created_at ?? row.createdAt)

  return {
    id: row.id ?? '',
    clubId: row.club_id ?? row.clubId ?? '',
    teamId: row.team_id ?? row.teamId ?? '',
    type: normalizeConversationType(row.type),
    title: normalizeText(row.title),
    createdBy: row.created_by ?? row.createdBy ?? '',
    createdByName: normalizeText(row.created_by_name ?? row.createdByName),
    createdByEmail: normalizeText(row.created_by_email ?? row.createdByEmail),
    createdAt,
    updatedAt,
    lastMessageAt,
    members,
    messages,
    currentMember,
    archivedAt: currentMember?.archivedAt || '',
    unreadCount: Number(row.unreadCount ?? 0),
  }
}

function assertStaffChatAccess(user) {
  if (!canUseStaffChat(user)) {
    throw new Error('Staff Chat is only available to authorised club and team staff.')
  }
}

function getStaffChatCacheKey(user) {
  return `staff-chat:${user.clubId}:${user.id}:${user.activeTeamId || 'club'}`
}

export async function getStaffChatConversations({ user } = {}) {
  if (!canUseStaffChat(user)) {
    return []
  }

  return getCachedResource(getStaffChatCacheKey(user), async () => {
    const { data, error } = await supabase
      .from('staff_chat_conversations')
      .select('*, staff_chat_members(*, users:user_id(id, email, name, role, role_label, role_rank, club_id))')
      .eq('club_id', user.clubId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })

    if (error) {
      console.error(error)
      throw error
    }

    const conversations = (data ?? []).map((row) => normalizeStaffChatConversation({
      ...row,
      currentUserId: user.id,
    }))

    if (conversations.length === 0) {
      return []
    }

    const conversationIds = conversations.map((conversation) => conversation.id)
    const { data: latestMessages, error: latestMessagesError } = await supabase
      .from('staff_chat_messages')
      .select('*, users:sender_id(id, email, name, role, role_label, role_rank, club_id)')
      .in('conversation_id', conversationIds)
      .eq('club_id', user.clubId)
      .order('created_at', { ascending: false })

    if (latestMessagesError) {
      console.error(latestMessagesError)
      throw latestMessagesError
    }

    const messagesByConversation = new Map()
    for (const message of latestMessages ?? []) {
      const conversationId = message.conversation_id
      if (!messagesByConversation.has(conversationId)) {
        messagesByConversation.set(conversationId, [])
      }
      const bucket = messagesByConversation.get(conversationId)
      if (bucket.length < 1) {
        bucket.push(normalizeStaffChatMessage(message))
      }
    }

    return conversations
      .map((conversation) => {
        const currentMember = conversation.members.find((member) => member.userId === user.id) ?? null
        const lastReadTime = currentMember?.lastReadAt ? new Date(currentMember.lastReadAt).getTime() : 0
        const unreadCount = (latestMessages ?? []).filter((message) => (
          message.conversation_id === conversation.id
          && message.sender_id !== user.id
          && !message.deleted_at
          && new Date(message.created_at).getTime() > lastReadTime
        )).length

        return normalizeStaffChatConversation({
          ...conversation,
          currentMember,
          messages: messagesByConversation.get(conversation.id) ?? [],
          unreadCount,
        })
      })
      .filter((conversation) => !conversation.archivedAt)
  })
}

export async function getStaffChatMessages({ conversationId, user } = {}) {
  assertStaffChatAccess(user)

  const normalizedConversationId = normalizeText(conversationId)
  if (!normalizedConversationId) {
    return []
  }

  const { data, error } = await supabase
    .from('staff_chat_messages')
    .select('*, users:sender_id(id, email, name, role, role_label, role_rank, club_id)')
    .eq('conversation_id', normalizedConversationId)
    .eq('club_id', user.clubId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(error)
    throw error
  }

  return (data ?? []).map(normalizeStaffChatMessage)
}

export async function getStaffChatStaffDirectory({ user } = {}) {
  if (!canUseStaffChat(user)) {
    return []
  }

  const profiles = await getVisibleClubUsers(user)

  return profiles
    .filter((profile) => canUseStaffChat({ ...profile, clubId: profile.clubId || user.clubId, planKey: user.planKey, planStatus: user.planStatus }))
    .map((profile) => ({
      id: profile.id,
      email: normalizeText(profile.email).toLowerCase(),
      name: normalizeText(profile.name) || normalizeText(profile.email),
      roleLabel: normalizeText(profile.roleLabel || profile.role),
      roleRank: Number(profile.roleRank ?? 0),
    }))
}

export async function getStaffChatTeams({ user } = {}) {
  if (!canUseStaffChat(user)) {
    return []
  }

  return getAvailableTeamsForUser(user)
}

export async function createStaffChatConversation({ memberIds = [], teamId = '', title = '', type, user } = {}) {
  await blockDemoMutation(user)
  assertStaffChatAccess(user)

  const conversationType = normalizeConversationType(type)
  const { data, error } = await supabase.rpc('create_staff_chat_conversation', {
    conversation_type: conversationType,
    title_value: normalizeText(title),
    team_id_value: normalizeText(teamId) || null,
    member_ids: [...new Set(memberIds.map((id) => normalizeText(id)).filter(Boolean))],
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`staff-chat:${user.clubId}:`)
  clearViewCaches()
  await createAuditLog({
    user,
    action: 'staff_chat_conversation_created',
    entityType: 'staff_chat_conversation',
    entityId: data,
    metadata: {
      type: conversationType,
      teamId: normalizeText(teamId),
    },
  })

  return data
}

export async function sendStaffChatMessage({ body, conversationId, user } = {}) {
  await blockDemoMutation(user)
  assertStaffChatAccess(user)

  const normalizedBody = normalizeText(body)
  if (!normalizedBody) {
    throw new Error('Add a message before sending.')
  }

  const { data, error } = await supabase
    .from('staff_chat_messages')
    .insert({
      conversation_id: normalizeText(conversationId),
      club_id: user.clubId,
      sender_id: user.id,
      body: normalizedBody,
    })
    .select('*, users:sender_id(id, email, name, role, role_label, role_rank, club_id)')
    .single()

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`staff-chat:${user.clubId}:`)
  await markStaffChatConversationRead({ conversationId, user })
  return normalizeStaffChatMessage(data)
}

export async function markStaffChatConversationRead({ conversationId, user } = {}) {
  if (!canUseStaffChat(user)) {
    return
  }

  const normalizedConversationId = normalizeText(conversationId)
  if (!normalizedConversationId) {
    return
  }

  const { error } = await supabase.rpc('mark_staff_chat_conversation_read', {
    conversation_id_value: normalizedConversationId,
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`staff-chat:${user.clubId}:`)
}

export async function archiveStaffChatConversation({ conversationId, user } = {}) {
  await blockDemoMutation(user)
  assertStaffChatAccess(user)

  const { error } = await supabase.rpc('archive_staff_chat_conversation', {
    conversation_id_value: normalizeText(conversationId),
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`staff-chat:${user.clubId}:`)
  clearViewCaches()
}

export async function deleteStaffChatMessage({ messageId, user } = {}) {
  await blockDemoMutation(user)
  assertStaffChatAccess(user)

  const { error } = await supabase.rpc('delete_staff_chat_message', {
    message_id_value: normalizeText(messageId),
  })

  if (error) {
    console.error(error)
    throw error
  }

  invalidateMemoryCacheByPrefix(`staff-chat:${user.clubId}:`)
}
