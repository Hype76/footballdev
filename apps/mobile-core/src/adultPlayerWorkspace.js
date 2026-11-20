import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'
import { getSelectedParentLink } from './parentLinks'
import { supabase } from './supabase'

export function isAdultPlayerLink(link) {
  return link?.linkType === 'adult_player'
}

export async function requestAdultPlayerWorkspace(action, { userId, ...criteria } = {}) {
  const { apiBaseUrl } = getMobileRuntimeConfig('parent')
  const { data } = await supabase.auth.getSession()
  const session = data?.session
  if (!apiBaseUrl || !session?.access_token || (userId && userId !== session.user?.id)) {
    throw new Error('Sign in again to open your Player account.')
  }
  const { ok, response, result } = await fetchJsonWithTimeout(joinApiPath(apiBaseUrl, '/.netlify/functions/adult-player-workspace'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...criteria, action }),
  })
  if (!ok || result.success === false) {
    const error = new Error(result.message || 'Your Player information could not be loaded. Try again.')
    if (response.status === 401 || response.status === 403) error.status = response.status
    throw error
  }
  return result
}

export async function loadAdultPlayerWorkspace(user) {
  const link = getSelectedParentLink(user)
  if (!isAdultPlayerLink(link) || !user?.id) throw new Error('Choose your Player account first.')
  const result = await requestAdultPlayerWorkspace('workspace', { userId: user.id })
  const actual = result.link
  if (actual?.id !== link.id || actual.playerId !== link.playerId || actual.clubId !== link.clubId || actual.teamId !== link.teamId) {
    const error = new Error('Your Player team access changed. Open your account again.')
    error.status = 403
    throw error
  }
  return result
}

export async function readAdultPlayerWorkspaceSection(user, snapshot, key) {
  const workspace = await (snapshot || loadAdultPlayerWorkspace(user))
  if (workspace.errors?.[key]) throw new Error(workspace.errors[key])
  return Array.isArray(workspace[key]) ? workspace[key] : []
}

export function normalizeAdultCalendarDates(row) {
  const occurrence = String(row.id || '').match(/^(.+):(\d{4}-\d{2}-\d{2})$/)
  const date = row.date || occurrence?.[2]
  return {
    ...row,
    id: occurrence?.[1] || row.id,
    starts_at: row.starts_at || (date && row.time ? `${date}T${row.time}` : date),
    ends_at: row.ends_at || (date && row.end_time ? `${date}T${row.end_time}` : ''),
  }
}
