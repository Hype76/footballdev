import { supabase } from '../supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function getDevelopmentParentEmailRecipientCandidates({
  user,
  player,
  teamId,
} = {}) {
  const clubId = normalizeText(user?.clubId)
  const playerId = normalizeText(player?.id)
  const resolvedTeamId = normalizeText(teamId || player?.teamId)

  if (!clubId || !playerId || !resolvedTeamId || user?.role === 'super_admin') {
    return []
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''
  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'resolve_development_recipients',
      clubId,
      playerId,
      teamId: resolvedTeamId,
    }),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || 'Development parent recipients could not be loaded.')
  }

  return Array.isArray(result.recipients) ? result.recipients : []
}
