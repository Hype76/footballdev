import { createFromAddress, sendEmail } from './lib/_email-provider.js'
import { supabaseAdmin } from './lib/_supabase.js'
import { json } from './lib/_stripe-billing.js'
import { authorizeNativeScheduledRequest, authorizeProcessorRequest } from './lib/_processor-auth.js'
import { getBillingReminderType } from '../../src/lib/billing-reminders.js'
import { getWorkspaceScope } from '../../src/lib/workspace-scope.js'

function reminderCopy(type, workspace) {
  const dueDate = new Date(workspace.billing_start_at).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })
  const timing = type === '7_day' ? 'in 7 days' : type === '1_day' ? 'tomorrow' : 'today'
  return {
    subject: `Payment for ${workspace.name} starts ${timing}`,
    text: `Payment for ${workspace.name} starts ${timing}, on ${dueDate}. Staff access remains available until the billing start date. After that date, staff can still view and export existing information, while editing and management pause until Stripe confirms an active subscription. Sign in at https://footballplayer.online/billing to continue with Stripe.`,
  }
}

async function findBillingOwner(client, workspace) {
  const scope = getWorkspaceScope(workspace.plan_key)
  const { data, error } = await client
    .from('user_club_memberships')
    .select('auth_user_id, email, role, role_label, role_rank, status')
    .eq('club_id', workspace.id)
    .eq('role', scope.ownerRole.key)
    .gte('role_rank', scope.ownerRole.rank)
    .order('role_rank', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw error
  const eligible = (data || []).filter((row) => String(row.status || 'active').toLowerCase() === 'active')
  return eligible.find((row) => row.auth_user_id === workspace.workspace_owner_user_id) || eligible[0] || null
}

export async function processBillingAccessReminders({ client = supabaseAdmin, now = new Date(), sendEmailImpl = sendEmail } = {}) {
  const { data: workspaces, error } = await client
    .from('clubs')
    .select('id, name, plan_key, plan_status, billing_arrangement, billing_start_at, workspace_owner_user_id, archived_at')
    .eq('billing_arrangement', 'deferred')
    .is('archived_at', null)
    .not('billing_start_at', 'is', null)
  if (error) throw error

  const result = { eligible: 0, sent: 0, skipped: 0, failed: 0 }
  for (const workspace of workspaces || []) {
    if (['active', 'trialing'].includes(String(workspace.plan_status || '').toLowerCase())) continue
    let reminderType = getBillingReminderType(workspace.billing_start_at, now)
    if (!reminderType) {
      const { data: retry, error: retryError } = await client
        .from('billing_access_reminders')
        .select('reminder_type, billing_start_at')
        .eq('club_id', workspace.id)
        .eq('billing_start_at', workspace.billing_start_at)
        .eq('status', 'failed')
        .lte('next_retry_at', now.toISOString())
        .order('next_retry_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (retryError) throw retryError
      reminderType = retry?.reminder_type || ''
    }
    if (!reminderType) continue
    result.eligible += 1

    const owner = await findBillingOwner(client, workspace)
    if (!owner?.email) {
      result.skipped += 1
      continue
    }

    const row = {
      club_id: workspace.id,
      billing_start_at: workspace.billing_start_at,
      reminder_type: reminderType,
      intended_recipient_user_id: owner.auth_user_id,
      intended_recipient_role: owner.role,
    }
    const { data: inserted, error: insertError } = await client
      .from('billing_access_reminders')
      .upsert(row, { onConflict: 'club_id,billing_start_at,reminder_type,intended_recipient_user_id', ignoreDuplicates: true })
      .select('id, status, attempt_count')
      .maybeSingle()
    if (insertError) throw insertError

    let reminder = inserted
    if (!reminder) {
      const { data: existing, error: existingError } = await client
        .from('billing_access_reminders')
        .select('id, status, attempt_count, next_retry_at')
        .eq('club_id', workspace.id)
        .eq('billing_start_at', workspace.billing_start_at)
        .eq('reminder_type', reminderType)
        .eq('intended_recipient_user_id', owner.auth_user_id)
        .single()
      if (existingError) throw existingError
      reminder = existing
    }
    if (reminder.status === 'sent' || reminder.status === 'sending') {
      result.skipped += 1
      continue
    }
    if (reminder.next_retry_at && new Date(reminder.next_retry_at) > now) {
      result.skipped += 1
      continue
    }

    const attemptAt = now.toISOString()
    const { data: locked, error: lockError } = await client
      .from('billing_access_reminders')
      .update({ status: 'sending', attempt_count: Number(reminder.attempt_count || 0) + 1, last_attempt_at: attemptAt, updated_at: attemptAt })
      .eq('id', reminder.id)
      .in('status', ['pending', 'failed'])
      .select('id, attempt_count')
      .maybeSingle()
    if (lockError) throw lockError
    if (!locked) {
      result.skipped += 1
      continue
    }

    try {
      const content = reminderCopy(reminderType, workspace)
      const response = await sendEmailImpl({
        from: createFromAddress('Football Player Billing'),
        to: [owner.email],
        subject: content.subject,
        text: content.text,
      }, {
        idempotencyKey: `billing-${workspace.id}-${workspace.billing_start_at}-${reminderType}-${owner.auth_user_id}`,
        context: { emailType: 'billing_access_reminder', clubId: workspace.id, targetEntityType: 'club', targetEntityId: workspace.id },
      })
      await client.from('billing_access_reminders').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        provider_message_id: response?.data?.id || response?.id || null,
        safe_error_code: null,
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', reminder.id)
      result.sent += 1
    } catch (sendError) {
      const retryAt = new Date(now.getTime() + Math.min(24, 2 ** locked.attempt_count) * 60 * 60 * 1000).toISOString()
      await client.from('billing_access_reminders').update({
        status: 'failed',
        safe_error_code: String(sendError.code || sendError.name || 'provider_error').slice(0, 100),
        next_retry_at: retryAt,
        updated_at: new Date().toISOString(),
      }).eq('id', reminder.id)
      result.failed += 1
    }
  }
  return result
}

export async function handler(event) {
  const authorization = authorizeProcessorRequest(event)
  if (!authorization.ok) return authorization.response
  try {
    const result = await processBillingAccessReminders()
    console.info('billing_access_reminder_processing_complete', result)
    return json(200, { success: true, ...result })
  } catch (error) {
    console.error('billing_access_reminder_processing_failed', { code: String(error.code || error.name || 'unknown') })
    return json(500, { success: false, message: 'Billing reminders could not be processed' })
  }
}

export const config = { schedule: '*/15 * * * *' }

export default async function scheduledHandler(request) {
  const authorization = await authorizeNativeScheduledRequest(request)
  if (!authorization.ok) return authorization.response
  try {
    const result = await processBillingAccessReminders()
    console.info('billing_access_reminder_processing_complete', result)
    return Response.json({ success: true, ...result }, { status: 200 })
  } catch (error) {
    console.error('billing_access_reminder_processing_failed', { code: String(error.code || error.name || 'unknown') })
    return Response.json({ success: false, message: 'Billing reminders could not be processed' }, { status: 500 })
  }
}
