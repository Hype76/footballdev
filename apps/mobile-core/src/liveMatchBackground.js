import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'
import { hideLiveMatchNotification } from '../modules/live-match/index.js'
import { clearLiveMatchOnSignOut, readLiveMatchFollow, refreshLiveMatchNotification, stopLiveMatchFollow } from './liveMatchFollow'
import { getMobileRuntimeConfig } from './config'
import { supabase } from './supabase'

const taskName = 'fp.live-match.android.v1'
const matchIdPattern = /^[0-9a-fA-F-]{36}$/

TaskManager.defineTask(taskName, async ({ data, error }) => {
  if (error || Platform.OS !== 'android') return
  const payload = data?.data || data
  if (payload?.type !== 'live_match_refresh' || !['coach', 'parent'].includes(payload.app)
    || !matchIdPattern.test(String(payload.matchDayId || ''))) return
  const saved = await readLiveMatchFollow(payload.app, payload.matchDayId)
  if (!saved || saved.followId !== payload.followId) return
  if (payload.stop === true) {
    try { await stopLiveMatchFollow(payload.app, payload.matchDayId) }
    finally { await hideLiveMatchNotification(payload.matchDayId) }
    return
  }
  await refreshLiveMatchNotification(payload.app, payload.matchDayId)
})

export async function registerLiveMatchBackground() {
  const role = getMobileRuntimeConfig().appRole
  if (['coach', 'parent'].includes(role)) supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') void clearLiveMatchOnSignOut(role).catch(() => {})
  })
  if (Platform.OS !== 'android') return
  await Notifications.registerTaskAsync(taskName)
}
