import { supabaseAdmin } from './_supabase.js'
import { deliverMatchDayNotification } from '../send-match-day-push.js'
import { createFromAddress, sendEmail } from './_email-provider.js'
import { resolveReachableEmailLogo } from '../../../src/lib/email-branding.js'
import { buildSquadDecisionEmail, cleanSquadNotificationCopy } from '../../../src/lib/squad-decision-email.js'

export async function deliverSquadDecisionNotifications(ids, { admin = supabaseAdmin, deliver = deliverMatchDayNotification, email = sendEmail, resolveLogo = resolveReachableEmailLogo } = {}) {
  let completed = 0
  const logos = new Map()
  for (const id of ids) {
    const { data: receipt, error } = await admin.rpc('claim_squad_notification_push', { notification_id: id })
    if (error) throw error
    if (!receipt) continue
    try {
      const { data: match, error: matchError } = await admin.from('match_days')
        .select('*,clubs:club_id(name,logo_url,theme_accent),teams:team_id(name,notification_display_name)').eq('id', receipt.match_day_id).single()
      if (matchError) throw matchError
      if (receipt.delivery_channel === 'email') {
        const clubName = match.clubs?.name || 'Your football club'
        const clubLogoUrl = match.clubs?.logo_url || ''
        if (!logos.has(clubLogoUrl)) logos.set(clubLogoUrl, await resolveLogo({ clubLogoUrl }))
        const logo = logos.get(clubLogoUrl)
        const content = buildSquadDecisionEmail({ match, receipt, logoUrl: logo.source === 'club' ? logo.url : '' })
        await email({
          from: createFromAddress(clubName), to: receipt.recipient_email,
          ...content,
        }, {
          idempotencyKey: `squad-decision:${receipt.id}`,
          context: { emailType: 'squad_decision', clubId: match.club_id, teamId: match.team_id, actorId: receipt.notified_by, targetEntityType: 'match_day', targetEntityId: match.id },
        })
      } else {
        const result = await deliver({
        match, type: 'matchday_update', targetParentLinkIds: [receipt.parent_link_id], inboxAlreadySaved: true,
        notificationCopy: { matchTitle: receipt.title, detailedBody: cleanSquadNotificationCopy(receipt.body), minimalBody: "Your child's squad selection has been updated. Please open Matchday for details.", tag: 'match-day-' + match.id, renotify: false },
      })
        if (result.mobileFailed || result.webFailed) throw new Error('A phone notification could not be delivered.')
      }
      const { error: savedError } = await admin.from('match_day_squad_notifications').update({ push_finished_at: new Date().toISOString(), push_error: null }).eq('id', id)
      if (savedError) throw savedError
      completed += 1
    } catch {
      // Keep the same recipient receipt and provider key when retrying delivery.
      const { error: saveError } = await admin.from('match_day_squad_notifications').update({ push_claimed_at: null, push_error: 'Notification delivery will retry.' }).eq('id', id)
      if (saveError) throw saveError
    }
  }
  return { completed }
}
