import { supabase } from '../supabase-client.js'

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

export async function getScheduledEmails({ user }) {
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
