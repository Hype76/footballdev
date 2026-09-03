import { supabaseAdmin } from './_supabase.js'
import { deliverMatchDayNotification } from '../send-match-day-push.js'

export async function deliverSquadDecisionNotifications(ids, { admin = supabaseAdmin, deliver = deliverMatchDayNotification } = {}) {
  let completed = 0
  for (const id of ids) {
    const { data: receipt, error } = await admin.rpc('claim_squad_notification_push', { notification_id: id })
    if (error) throw error
    if (!receipt) continue
    try {
      const { data: match, error: matchError } = await admin.from('match_days')
        .select('*,clubs:club_id(name),teams:team_id(name,notification_display_name)').eq('id', receipt.match_day_id).single()
      if (matchError) throw matchError
      const result = await deliver({
        match, type: 'matchday_update', targetParentLinkIds: [receipt.parent_link_id], inboxAlreadySaved: true,
        notificationCopy: { matchTitle: receipt.title, detailedBody: receipt.body, minimalBody: "Your child's squad selection has been updated. Please open Matchday for details.", tag: 'match-day-' + match.id, renotify: false },
      })
      if (result.mobileFailed || result.webFailed) throw new Error('A phone notification could not be delivered.')
      const { error: savedError } = await admin.from('match_day_squad_notifications').update({ push_finished_at: new Date().toISOString(), push_error: null }).eq('id', id)
      if (savedError) throw savedError
      completed += 1
    } catch {
      // The in-app notification is already saved. Retry phone delivery from the outbox.
      const { error: saveError } = await admin.from('match_day_squad_notifications').update({ push_claimed_at: null, push_error: 'Phone delivery will retry.' }).eq('id', id)
      if (saveError) throw saveError
    }
  }
  return { completed }
}
