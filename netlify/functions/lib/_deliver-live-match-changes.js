import { createLiveMatchState } from '../../../apps/mobile-core/src/liveMatchState.js'
import { createHash, randomBytes } from 'node:crypto'
import { createLiveActivityApnsRequest, createLiveActivityStartRequest, createLiveActivityProviderToken, sendLiveActivityApns } from './_live-activity-apns.js'

const BUNDLE = { coach: 'com.footballplayer.coach', parent: 'com.footballplayer.parents' }

async function sendAndroidRefresh(follower, matchDayId, stop, finished) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: follower.activity_token, priority: 'high', ttl: 120,
      data: { app: follower.app_role, type: 'live_match_refresh', matchDayId, followId: follower.follow_id, stop, finished } }),
  })
  const result = await response.json().catch(() => ({}))
  return response.ok && result.data?.status === 'ok'
}

export async function deliverLiveMatchChange(matchDayId, { client, send = sendLiveActivityApns, sendAndroid = sendAndroidRefresh, provider, now = () => Date.now() }) {
  if (!client) throw new Error('live_match_delivery_configuration_invalid')
  const { data: match, error: matchError } = await client.from('match_days')
    .select('*, teams:team_id(name)')
    .eq('id', matchDayId).maybeSingle()
  if (matchError) throw matchError
  if (!match) return { delivered: 0, failed: 0 }
  if (['live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(match.status)) {
    const claimed = await client.rpc('claim_registered_live_match_starts', { match_day_id_value: matchDayId })
    if (claimed.error) throw claimed.error
  }
  const { data: followers, error: followError } = await client.rpc('get_live_match_follows_for_delivery', { match_day_id_value: matchDayId })
  if (followError) throw followError
  if (!followers?.length) return { delivered: 0, failed: 0 }
  const { data: events, error: eventsError } = await client.from('match_day_events')
    .select('event_type,team_side,event_status').eq('match_day_id', matchDayId)
  if (eventsError) throw eventsError
  const appleFollowers = followers.filter(follower => follower.platform === 'ios')
  const sampledAtMs = now()
  const confirmedMatch = { ...match, match_day_events: events, teamName: match.teams?.name || match.notification_team_name }
  const state = createLiveMatchState(confirmedMatch, sampledAtMs)
  const end = state.end || match.deleted_at != null || match.previous_hidden_at != null
  const started = ['live', 'half_time', 'second_half', 'extra_time', 'penalties'].includes(match.status)
  const effectiveState = state.end ? createLiveMatchState({ ...confirmedMatch, concluded_at: null, deleted_at: null, status: 'full_time', timer_status: 'full_time', current_match_phase: 'full_time' }, sampledAtMs) : state
  const timestamp = Math.floor(sampledAtMs / 1000)
  // The worker refreshes running matches every three minutes. A paused clock
  // can stay accurate for longer, including a normal half-time interval.
  const staleDate = timestamp + (effectiveState.running ? 4 * 60 : 4 * 60 * 60)
  let providerToken = ''
  try {
    if (appleFollowers.length) providerToken = createLiveActivityProviderToken({ ...provider, nowSeconds: timestamp })
  } catch { /* Android followers can still receive an update. */ }
  const results = await Promise.all(followers.map(async follower => {
    if (follower.platform === 'android') {
      try { return await sendAndroid(follower, matchDayId, end || follower.access_allowed !== true,
        state.end && match.status === 'full_time' && follower.access_allowed === true) }
      catch { return false }
    }
    if (follower.platform !== 'ios') return false
    try {
      if (!follower.activity_token) {
        if (!follower.start_token || follower.remote_start_attempted_at || !started || end || follower.access_allowed !== true) return true
        if (!providerToken) return false
        const handoffToken = randomBytes(32).toString('hex')
        const request = createLiveActivityStartRequest({
          bundleId: BUNDLE[follower.app_role], startToken: follower.start_token,
          providerToken, contentState: effectiveState, timestamp, staleDate,
          activityKey: matchDayId, clubIsHome: follower.club_is_home ?? state.clubIsHome,
          followId: follower.follow_id, handoffToken,
          badgeData: follower.badge_data || null,
        })
        const reserved = await client.rpc('reserve_live_match_remote_start', {
          follow_id_value: follower.follow_id, start_token_value: follower.start_token,
          handoff_secret_hash_value: createHash('sha256').update(handoffToken).digest('hex'),
        })
        if (reserved.error) throw reserved.error
        if (reserved.data !== true) return true
        const result = await send(request, { production: provider.production === true })
        if (result.accepted !== true) {
          const rejected = await client.rpc('reject_live_match_remote_start', {
            follow_id_value: follower.follow_id, start_token_value: follower.start_token,
            retryable_value: result.status === 429 || result.status >= 500,
          })
          if (rejected.error) throw rejected.error
          return false
        }
        const marked = await client.rpc('mark_live_match_remote_started', {
          follow_id_value: follower.follow_id, start_token_value: follower.start_token,
        })
        return !marked.error
      }
      if (!providerToken) return false
      const contentState = follower.access_allowed === true ? effectiveState : {
        homeName: 'Match', awayName: 'Closed', homeScore: 0, awayScore: 0,
        phase: 'Access ended', running: false, elapsedSeconds: null, sampledAtMs,
      }
      const request = createLiveActivityApnsRequest({
        bundleId: BUNDLE[follower.app_role], activityToken: follower.activity_token,
        providerToken, contentState, timestamp,
        staleDate, end: end || follower.access_allowed !== true,
      })
      const result = await send(request, { production: provider.production === true })
      return result.accepted === true || result.reason === 'Unregistered'
    } catch { return false }
  }))
  return { delivered: results.filter(Boolean).length, failed: results.filter(value => !value).length }
}
