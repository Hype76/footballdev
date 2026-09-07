export async function deliverCoachMatchDayCommands(commandId = null, actorUserId = null, { client, deliver } = {}) {
  client ||= (await import('./_supabase.js')).supabaseAdmin
  deliver ||= (await import('../send-match-day-push.js')).deliverMatchDayNotification
  const { data: commands, error } = await client.rpc('claim_coach_match_day_command_notifications', { command_id_value: commandId, actor_user_id_value: actorUserId })
  if (error) throw error
  let completed = 0
  let failed = 0
  const startedAt = Date.now()
  for (const command of commands || []) {
    // Unfinished leases become retryable after two minutes if a provider is slow.
    if (Date.now() - startedAt > 18000) break
    let failure = ''
    try {
      const { data: targets, error: targetError } = await client.rpc('get_match_day_parent_notification_link_ids', { match_day_id_value: command.match.id })
      if (targetError) throw targetError
      const { data: context, error: contextError } = await client.from('match_days')
        .select('id, teams:team_id(name,notification_display_name), clubs:club_id(name,status)').eq('id', command.match.id).is('deleted_at', null).maybeSingle()
      if (contextError) throw contextError
      if (!context) throw new Error('The match is no longer available.')
      const result = await deliver({ match: { ...command.match, teams: context.teams, clubs: context.clubs }, type: command.type, eventId: command.eventId || '', targetParentLinkIds: [...new Set(targets || [])] })
      if (result.mobileFailed || result.webFailed || result.fanFailed) throw new Error('Some match notifications were not accepted. Delivery will be retried.')
      completed += 1
    } catch (error) { failure = error.message || 'Match notification delivery failed.'; failed += 1 }
    const result = await client.rpc('complete_coach_match_day_command_notification', { command_id_value: command.id, error_value: failure })
    if (result.error) throw result.error
  }
  return { completed, failed }
}
