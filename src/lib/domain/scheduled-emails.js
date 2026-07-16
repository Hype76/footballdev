import { supabase } from '../supabase-client.js'

let lastQueueProcessAt = 0
let queueProcessPromise = null

function shouldSkipNetlifyFunctionRequest() {
  if (typeof window === 'undefined') {
    return false
  }

  const hostname = window.location.hostname
  const port = window.location.port
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'

  return isLoopback && port !== '8888'
}

async function postScheduledEmailAction(payload) {
  if (shouldSkipNetlifyFunctionRequest()) {
    const error = new Error('Email queue functions are not available in this local preview.')
    error.status = 404
    throw error
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData?.session?.access_token || ''
  const response = await fetch('/.netlify/functions/manage-scheduled-emails', {
    method: 'POST',
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const result = await response.json().catch(() => ({}))

  if (!response.ok || result.success === false) {
    const error = new Error(result.message || 'Email queue action failed.')
    error.status = response.status
    throw error
  }

  return result
}

export async function processCalendarNotificationDelivery({
  commandId,
  user,
} = {}) {
  const normalizedCommandId = String(commandId ?? '').trim()

  if (!normalizedCommandId) {
    throw new Error('A Calendar notification command is required before delivery can start.')
  }

  return postScheduledEmailAction({
    action: 'processCalendarNotification',
    clubId: user?.clubId,
    commandId: normalizedCommandId,
    teamId: user?.activeTeamId,
  })
}

export async function processDueScheduledEmails({ force = false } = {}) {
  if (shouldSkipNetlifyFunctionRequest()) {
    return null
  }

  const now = Date.now()

  if (!force && now - lastQueueProcessAt < 45000) {
    return null
  }

  if (queueProcessPromise) {
    return queueProcessPromise
  }

  lastQueueProcessAt = now
  queueProcessPromise = fetch('/.netlify/functions/process-scheduled-emails', {
    method: 'POST',
  })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}))

      if (response.status === 404) {
        return null
      }

      if (!response.ok || result.success === false) {
        const error = new Error(result.message || 'Scheduled emails could not be processed.')
        error.status = response.status
        throw error
      }

      if ((result.sent || result.duplicate || result.failed) > 0) {
        window.dispatchEvent(new Event('scheduled-email-queue-changed'))
      }

      return result
    })
    .finally(() => {
      queueProcessPromise = null
    })

  return queueProcessPromise
}

export async function getScheduledEmails({ silentUnavailable = false, user }) {
  let result

  try {
    result = await postScheduledEmailAction({
      action: 'list',
      clubId: user?.clubId,
    })
  } catch (error) {
    if (silentUnavailable && error?.status === 404) {
      return []
    }

    throw error
  }

  return result.queue ?? []
}

export async function createScheduledEmail({ user, item }) {
  const result = await postScheduledEmailAction({
    action: 'create',
    clubId: user?.clubId,
    teamId: item.teamId,
    toEmail: item.toEmail,
    subject: item.subject,
    html: item.html,
    scheduledAt: item.scheduledAt,
    displayName: item.displayName,
    teamName: item.teamName,
    clubName: item.clubName,
    playerName: item.playerName,
    parentName: item.parentName,
    communicationLog: item.communicationLog,
  })

  window.dispatchEvent(new Event('scheduled-email-queue-changed'))

  return result.item
}

export async function updateScheduledEmail({ user, item }) {
  const result = await postScheduledEmailAction({
    action: 'update',
    clubId: user?.clubId,
    id: item.id,
    toEmail: item.toEmail,
    subject: item.subject,
    html: item.html,
    scheduledAt: item.scheduledAt,
  })

  window.dispatchEvent(new Event('scheduled-email-queue-changed'))

  return result.item
}

export async function deleteScheduledEmail({ user, id }) {
  await postScheduledEmailAction({
    action: 'delete',
    clubId: user?.clubId,
    id,
  })
  window.dispatchEvent(new Event('scheduled-email-queue-changed'))
}

export async function sendScheduledEmailNow({ user, id }) {
  await postScheduledEmailAction({
    action: 'sendNow',
    clubId: user?.clubId,
    id,
  })
  window.dispatchEvent(new Event('scheduled-email-queue-changed'))
}
