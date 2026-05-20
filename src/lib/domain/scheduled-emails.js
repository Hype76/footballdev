import { supabase } from '../supabase-client.js'

let lastQueueProcessAt = 0
let queueProcessPromise = null

async function postScheduledEmailAction(payload) {
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
    throw new Error(result.message || 'Email queue action failed.')
  }

  return result
}

export async function processDueScheduledEmails({ force = false } = {}) {
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

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'Scheduled emails could not be processed.')
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

export async function getScheduledEmails({ user }) {
  await processDueScheduledEmails().catch((error) => {
    console.error(error)
  })

  const result = await postScheduledEmailAction({
    action: 'list',
    clubId: user?.clubId,
  })

  return result.queue ?? []
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
