import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { sendExpoPushMessages } from './lib/_expo-push.js'
import { getParentCommunicationChannels, normalizeParentCommunicationChannel } from './lib/_parent-communication-preferences.js'
import { authorizeNativeScheduledRequest } from './lib/_processor-auth.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { writeParentNotificationInbox } from './lib/_parent-notification-inbox.js'

export const config = {
  schedule: '* * * * *',
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeOptions(value) {
  return (Array.isArray(value) ? value : [])
    .map((option, index) => ({
      id: normalizeText(option?.id) || `option-${index + 1}`,
      label: normalizeText(option?.label || option) || `Option ${index + 1}`,
    }))
    .filter((option) => option.id)
}

function rankPollResults(poll, votes) {
  const counts = new Map()
  for (const vote of votes) {
    const optionId = normalizeText(vote.option_id)
    if (optionId) counts.set(optionId, (counts.get(optionId) || 0) + 1)
  }

  return normalizeOptions(poll.options)
    .map((option) => ({ ...option, count: counts.get(option.id) || 0 }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

function getResultCopy(poll, ranked) {
  const topCount = ranked[0]?.count || 0
  const leaders = ranked.filter((option) => option.count === topCount && topCount > 0)
  const result = leaders.length === 0
    ? 'The Poll closed without any recorded replies.'
    : leaders.length === 1
      ? `${leaders[0].label} finished first with ${topCount} vote${topCount === 1 ? '' : 's'}.`
      : `${leaders.map((option) => option.label).join(', ')} finished level with ${topCount} vote${topCount === 1 ? '' : 's'} each.`

  return {
    body: result,
    subject: `Poll result: ${normalizeText(poll.title) || 'Parent Poll'}`,
  }
}

async function getEligibleParentLinks(poll) {
  let query = supabaseAdmin
    .from('parent_player_links')
    .select('id, auth_user_id, email, team_id')
    .eq('club_id', poll.club_id)
    .eq('status', 'active')
    .not('auth_user_id', 'is', null)

  if (poll.team_id) query = query.eq('team_id', poll.team_id)

  const { data, error } = await query
  if (error) throw error

  const byAuthUser = new Map()
  for (const link of data || []) {
    const authUserId = normalizeText(link.auth_user_id)
    if (authUserId && !byAuthUser.has(authUserId)) byAuthUser.set(authUserId, link)
  }
  return [...byAuthUser.values()]
}

async function getPushDevices(authUserId) {
  const { data, error } = await supabaseAdmin
    .from('parent_mobile_push_installations')
    .select('installation_id, auth_user_id, expo_push_token, parent_link_id, detail_level')
    .eq('auth_user_id', authUserId)
    .eq('status', 'active')
    .eq('enabled', true)
    .neq('detail_level', 'off')
  if (error) throw error
  return data || []
}

async function deliverPollResult({ poll, ranked, votes }) {
  const parentLinks = await getEligibleParentLinks(poll)
  const channels = await getParentCommunicationChannels(
    supabaseAdmin,
    parentLinks.map((link) => link.auth_user_id),
  )
  const copy = getResultCopy(poll, ranked)
  let emailSent = 0
  let pushSent = 0
  let failed = 0

  for (const link of parentLinks) {
    const authUserId = normalizeText(link.auth_user_id)
    const channel = normalizeParentCommunicationChannel(channels.get(authUserId) || 'both')
    const wantsEmail = channel === 'email' || channel === 'both'
    const wantsPush = channel === 'app' || channel === 'both'
    const { data: existing } = await supabaseAdmin
      .from('poll_result_notification_deliveries')
      .select('*')
      .eq('poll_id', poll.id)
      .eq('auth_user_id', authUserId)
      .maybeSingle()

    let emailStatus = wantsEmail ? 'pending' : 'not_requested'
    let pushStatus = wantsPush ? 'pending' : 'not_requested'
    let providerMessageId = existing?.email_provider_id || null
    const errors = []

    if (wantsEmail && existing?.email_status !== 'sent') {
      const email = normalizeText(link.email).toLowerCase()
      if (!email) {
        emailStatus = 'failed'
        errors.push('No Parent email is available.')
      } else {
        try {
          const response = await sendEmail({
            from: createFromAddress('Football Player'),
            to: email,
            subject: copy.subject,
            text: `${normalizeText(poll.title) || 'Parent Poll'}\n\n${copy.body}`,
            html: `<h1>${escapeHtml(normalizeText(poll.title) || 'Parent Poll')}</h1><p>${escapeHtml(copy.body)}</p>`,
          }, {
            context: {
              clubId: poll.club_id,
              emailType: 'parent_poll_results',
              pollId: poll.id,
              recipientAuthUserId: authUserId,
            },
            idempotencyKey: `poll-results:${poll.id}:${authUserId}`,
          })
          providerMessageId = response?.data?.id || response?.id || null
          emailStatus = 'sent'
          emailSent += 1
        } catch (error) {
          emailStatus = 'failed'
          errors.push(normalizeText(error?.message) || 'Poll result email failed.')
        }
      }
    } else if (existing?.email_status === 'sent') {
      emailStatus = 'sent'
    }

    if (wantsPush && existing?.push_status !== 'sent') {
      try {
        const payload = {
          app: 'parent',
          pollId: poll.id,
          route: 'polls',
          type: 'poll_results',
        }
        await writeParentNotificationInbox({
          body: copy.body,
          client: supabaseAdmin,
          clubId: poll.club_id,
          data: payload,
          intentType: 'poll_results',
          parentLinks: [link],
          teamId: poll.team_id,
          title: copy.subject,
        })
        const devices = await getPushDevices(authUserId)
        if (devices.length === 0) {
          pushStatus = 'no_device'
        } else {
          const pushResult = await sendExpoPushMessages(devices.map((device) => ({
            body: copy.body,
            data: { ...payload, parentLinkId: link.id },
            sound: 'default',
            title: copy.subject,
            to: device.expo_push_token,
          })))
          pushStatus = pushResult.sent > 0 ? 'sent' : 'failed'
          pushSent += pushResult.sent
          if (pushResult.failed > 0) errors.push('One or more Poll result app notifications failed.')
        }
      } catch (error) {
        pushStatus = 'failed'
        errors.push(normalizeText(error?.message) || 'Poll result app notification failed.')
      }
    } else if (existing?.push_status === 'sent') {
      pushStatus = 'sent'
    }

    await supabaseAdmin.from('poll_result_notification_deliveries').upsert({
      auth_user_id: authUserId,
      club_id: poll.club_id,
      communication_channel: channel,
      email_provider_id: providerMessageId,
      email_status: emailStatus,
      last_error: errors.join(' ') || null,
      parent_link_id: link.id,
      poll_id: poll.id,
      push_status: pushStatus,
      recipient_email: normalizeText(link.email).toLowerCase(),
      team_id: poll.team_id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'poll_id,auth_user_id' })
    if (emailStatus === 'failed' || pushStatus === 'failed') failed += 1
  }

  await supabaseAdmin.from('polls').update({
    results_notified_at: failed === 0 ? new Date().toISOString() : null,
    status: 'closed',
    updated_at: new Date().toISOString(),
  }).eq('id', poll.id)

  return { emailSent, failed, parentLinks: parentLinks.length, pushSent, totalVotes: votes.length }
}

export async function processPollResultNotifications({ now = new Date() } = {}) {
  const { data: polls, error } = await supabaseAdmin
    .from('polls')
    .select('id, club_id, team_id, title, audience, status, closes_at, options, notify_results_on_close, results_notified_at')
    .eq('audience', 'parents')
    .eq('notify_results_on_close', true)
    .is('results_notified_at', null)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error) throw error

  const summary = { processed: 0, emailSent: 0, pushSent: 0, skipped: 0 }
  for (const poll of polls || []) {
    const [{ data: votes, error: voteError }, parentLinks] = await Promise.all([
      supabaseAdmin.from('poll_votes').select('option_id, auth_user_id').eq('poll_id', poll.id),
      getEligibleParentLinks(poll),
    ])
    if (voteError) throw voteError

    const eligibleAuthIds = new Set(parentLinks.map((link) => normalizeText(link.auth_user_id)).filter(Boolean))
    const voterAuthIds = new Set((votes || []).map((vote) => normalizeText(vote.auth_user_id)).filter((id) => eligibleAuthIds.has(id)))
    const deadlineReached = poll.closes_at && Date.parse(poll.closes_at) <= now.getTime()
    const everyoneReplied = eligibleAuthIds.size > 0 && voterAuthIds.size >= eligibleAuthIds.size
    if (poll.status !== 'closed' && !deadlineReached && !everyoneReplied) {
      summary.skipped += 1
      continue
    }

    const result = await deliverPollResult({ poll, ranked: rankPollResults(poll, votes || []), votes: votes || [] })
    summary.processed += 1
    summary.emailSent += result.emailSent
    summary.pushSent += result.pushSent
  }

  return summary
}

export default async function handler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)
  if (!authorization.ok) return authorization.response

  try {
    return Response.json(await processPollResultNotifications())
  } catch (error) {
    console.error('Poll result notification worker failed', error)
    return Response.json({ success: false, message: 'Poll results could not be processed.' }, { status: 500 })
  }
}
