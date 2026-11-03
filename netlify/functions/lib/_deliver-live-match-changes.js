import { createLiveMatchState } from '../../../apps/mobile-core/src/liveMatchState.js'
import { createLiveActivityApnsRequest, createLiveActivityProviderToken, sendLiveActivityApns } from './_live-activity-apns.js'

const BUNDLE = { coach: 'com.footballplayer.coach', parent: 'com.footballplayer.parents' }

async function sendAndroidRefresh(follower, matchDayId, stop) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: follower.activity_token, priority: 'high', ttl: 120,
      data: { app: follower.app_role, type: 'live_match_refresh', matchDayId, followId: follower.follow_id, stop } }),
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
  const { data: followers, error: followError } = await client.rpc('get_live_match_follows_for_delivery', { match_day_id_value: matchDayId })
  if (followError) throw followError
  if (!followers?.length) return { delivered: 0, failed: 0 }
  const appleFollowers = followers.filter(follower => follower.platform === 'ios')
  const sampledAtMs = now()
  const state = createLiveMatchState({ ...match, teamName: match.teams?.name || match.notification_team_name }, sampledAtMs)
  const end = state.end || match.deleted_at != null || match.previous_hidden_at != null
  const effectiveState = state.end ? createLiveMatchState({ ...match, concluded_at: null, deleted_at: null, status: 'full_time', timer_status: 'full_time', current_match_phase: 'full_time', teamName: match.teams?.name || match.notification_team_name }, sampledAtMs) : state
  const timestamp = Math.floor(sampledAtMs / 1000)
  let providerToken = ''
  try {
    if (appleFollowers.length) providerToken = createLiveActivityProviderToken({ ...provider, nowSeconds: timestamp })
  } catch { /* Android followers can still receive an update. */ }
  const results = await Promise.all(followers.map(async follower => {
    if (follower.platform === 'android') {
      try { return await sendAndroid(follower, matchDayId, end || follower.access_allowed !== true) }
      catch { return false }
    }
    if (follower.platform !== 'ios') return false
    try {
      if (!providerToken) return false
      const contentState = follower.access_allowed === true ? effectiveState : {
        homeName: 'Match', awayName: 'Closed', homeScore: 0, awayScore: 0,
        phase: 'Access ended', running: false, elapsedSeconds: null, sampledAtMs,
      }
      const request = createLiveActivityApnsRequest({
        bundleId: BUNDLE[follower.app_role], activityToken: follower.activity_token,
        providerToken, contentState, timestamp,
        staleDate: timestamp + 240, end: end || follower.access_allowed !== true,
      })
      const result = await send(request, { production: provider.production === true })
      return result.accepted === true
    } catch { return false }
  }))
  return { delivered: results.filter(Boolean).length, failed: results.filter(value => !value).length }
}
