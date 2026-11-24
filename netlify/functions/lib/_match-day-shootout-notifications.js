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
        const delivered = new Set(Object.keys(intent.delivered_channels || {}))
        const checkpoint = {
          has: key => delivered.has(key),
          save: async key => {
            const { data, error } = await client.rpc('checkpoint_match_day_shootout_notification', {
              kick_id_value: kick.id, attempt_value: intent.attempt, delivery_key: key,
            })
            if (error || data !== true) throw error || new Error('Shootout delivery lease expired.')
            delivered.add(key)
          },
        }
        const result = await deliver({ match, type: 'shootout_kick', eventId: kick.id, targetParentLinkIds: [...new Set(targets || [])], checkpoint })
        if (result.mobileFailed || result.webFailed || result.fanFailed || result.adultPlayerFailed) throw new Error('Some shootout notifications were not accepted.')
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

// Each successful target is checkpointed before other failures trigger a retry.
export async function deliverCheckpointedTargets(targets, { channel, keyFor, checkpoint, send, isComplete }) {
  const results = []
  targets = [...new Map(targets.map(target => [keyFor(target), target])).values()]
  for (let offset = 0; offset < targets.length; offset += 10) {
    const group = targets.slice(offset, offset + 10)
    const settled = await Promise.allSettled(group.map(async target => {
      const key = channel + ':' + keyFor(target)
      if (checkpoint.has(key)) return null
      const result = await send(target)
      if (isComplete(result)) await checkpoint.save(key)
      return result
    }))
    results.push(...settled)
  }
  return results
}
