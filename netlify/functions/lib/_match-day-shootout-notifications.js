export async function deliverShootoutNotifications({ matchDayId = null, kickId = null, client, deliver } = {}) {
  client ||= (await import('./_supabase.js')).supabaseAdmin
  const { data: intents, error } = await client.rpc('claim_match_day_shootout_notifications', {
    match_day_id_value: matchDayId, kick_id_value: kickId,
  })
  if (error) throw error
  let completed = 0
  let failed = 0
  for (const intent of intents || []) {
    let failure = ''
    try {
      const [{ data: match, error: matchError }, { data: kick, error: kickError }] = await Promise.all([
        client.from('match_days').select('*, teams:team_id(name,notification_display_name), clubs:club_id(name,status)')
          .eq('id', intent.match_day_id).is('deleted_at', null).maybeSingle(),
        client.from('match_day_shootout_kicks').select('*').eq('id', intent.kick_id)
          .eq('match_day_id', intent.match_day_id).eq('event_status', 'active').maybeSingle(),
      ])
      if (matchError || kickError) throw matchError || kickError
      if (match && kick && !['cancelled', 'postponed'].includes(match.status)) {
        const { data: targets, error: targetError } = await client.rpc('get_match_day_parent_notification_link_ids', { match_day_id_value: match.id })
        if (targetError) throw targetError
        deliver ||= (await import('../send-match-day-push.js')).deliverMatchDayNotification
        const result = await deliver({ match, type: 'shootout_kick', eventId: kick.id, targetParentLinkIds: [...new Set(targets || [])] })
        if (result.mobileFailed || result.webFailed || result.fanFailed) throw new Error('Some shootout notifications were not accepted.')
      }
      completed += 1
    } catch (error) {
      failure = error.message || 'Shootout notification delivery failed.'
      failed += 1
    }
    const completion = await client.rpc('complete_match_day_shootout_notification', {
      kick_id_value: intent.kick_id, attempt_value: intent.attempt, error_value: failure,
    })
    if (completion.error) throw completion.error
  }
  return { completed, failed }
}
