import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { Platform } from 'react-native'
import { showLiveMatchNotification, hideLiveMatchNotification } from '../modules/live-match/index.js'
import { getMobileRuntimeConfig } from './config'
import { createLiveMatchState } from './liveMatchState'
import { createLiveMatchStartBarrier, reconcileSavedLiveMatchFollow, revokeSavedLiveMatchFollows } from './liveMatchSignOutCore'
import { supabase } from './supabase'

const iosActivity = Platform.OS === 'ios' ? requireOptionalNativeModule('ReactNativeWidgetExtension') : null
const keyFor = (role, userId, matchId) => `fp.live-match.v1.${role}.${userId}.${matchId}`
const startBarrier = createLiveMatchStartBarrier()

export function startLiveMatchFollowOnce(role, matchId, parentLinkId = null) {
  return startBarrier.start(role, matchId, () => startLiveMatchFollow(role, matchId, parentLinkId))
}

async function confirmedMatch(role, matchId, parentLinkId) {
  if (role === 'parent') {
    const { data, error } = await supabase.rpc('get_parent_portal_match_days', { parent_link_id_value: parentLinkId })
    if (error) throw error
    const row = data?.find(item => item.id === matchId)
    if (!row) throw new Error('Match access is no longer available.')
    return row
  }
  const { data, error } = await supabase.from('match_days').select('*, teams:team_id(name)').eq('id', matchId).maybeSingle()
  if (error || !data) throw error || new Error('Match access is no longer available.')
  return { ...data, teamName: data.teams?.name }
}

export async function readLiveMatchFollow(role, matchId) {
  const { data } = await supabase.auth.getUser()
  if (!data?.user?.id) return null
  const key = keyFor(role, data.user.id, matchId)
  const raw = await AsyncStorage.getItem(key)
  let saved
  try { saved = raw ? JSON.parse(raw) : null } catch { return null }
  if (saved?.rollbackPending && saved.followId) return saved
  return reconcileSavedLiveMatchFollow(saved, {
    check: async followId => {
      const { data: active, error } = await supabase.rpc('is_live_match_follow_active', { follow_id_value: followId })
      if (error) throw error
      return active
    },
    clear: async stale => {
      if (Platform.OS === 'ios' && stale.activityId) await iosActivity?.endMatchActivity(stale.activityId).catch(() => {})
      if (Platform.OS === 'android') await hideLiveMatchNotification(matchId).catch(() => {})
      await AsyncStorage.removeItem(key)
    },
  })
}

async function startLiveMatchFollow(role, matchId, parentLinkId = null) {
  const generation = startBarrier.generation(role)
  let registeredFollowId = '', activityId = '', userId = ''
  try {
    startBarrier.check(role, generation)
    const config = getMobileRuntimeConfig(role)
    if (!config.isUsable || config.appRole !== role) throw new Error('Live match is unavailable in this build.')
    const { data: auth, error: authError } = await supabase.auth.getUser()
    if (authError || !auth?.user?.id) throw new Error('Sign in to follow this match.')
    userId = auth.user.id
    const match = await confirmedMatch(role, matchId, parentLinkId)
    startBarrier.check(role, generation)
    const state = createLiveMatchState(match, Date.now())
    if (state.end) throw new Error('This match has ended.')
    let token = ''
    if (Platform.OS === 'ios') {
      if (!iosActivity?.activitiesEnabled()) throw new Error('Live Activities are off in iPhone settings.')
      activityId = iosActivity.startMatchActivity(matchId, state)
      for (let attempt = 0; attempt < 120 && !token; attempt += 1) {
        startBarrier.check(role, generation)
        token = iosActivity.getMatchActivityToken(activityId) || ''
        if (!token) await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (!token) throw new Error('The iPhone could not start this live match. Try again.')
    } else if (Platform.OS === 'android') {
      const permission = await Notifications.getPermissionsAsync()
      const granted = permission.granted || (await Notifications.requestPermissionsAsync()).granted
      if (!granted) throw new Error('Enable notifications to follow the match.')
      token = (await Notifications.getExpoPushTokenAsync({ projectId: config.easProjectId })).data
    } else throw new Error('Live match is available on phones only.')
    startBarrier.check(role, generation)
    const { data: followId, error } = await supabase.rpc('follow_live_match', {
      match_day_id_value: matchId, app_role_value: role, platform_value: Platform.OS,
      activity_token_value: token, parent_link_id_value: parentLinkId,
    })
    if (error || !followId) throw error || new Error('Could not follow this match.')
    registeredFollowId = followId
    startBarrier.check(role, generation)
    const saved = { followId, activityId, parentLinkId }
    await AsyncStorage.setItem(keyFor(role, userId, matchId), JSON.stringify(saved))
    startBarrier.check(role, generation)
    if (Platform.OS === 'android') await showLiveMatchNotification(matchId, state)
    startBarrier.check(role, generation)
    return saved
  } catch (error) {
    let revoked = false
    if (registeredFollowId) {
      try {
        const result = await supabase.rpc('stop_following_live_match', { follow_id_value: registeredFollowId })
        revoked = !result.error && result.data === true
      } catch { revoked = false }
    }
    if (activityId) await iosActivity?.endMatchActivity(activityId).catch(() => {})
    if (Platform.OS === 'android') await hideLiveMatchNotification(matchId).catch(() => {})
    if (userId) {
      const key = keyFor(role, userId, matchId)
      if (registeredFollowId && !revoked) {
        await AsyncStorage.setItem(key, JSON.stringify({ followId: registeredFollowId, activityId, parentLinkId, rollbackPending: true })).catch(() => {})
      } else {
        await AsyncStorage.removeItem(key).catch(() => {})
      }
    }
    throw error
  }
}

export async function stopLiveMatchFollow(role, matchId) {
  const { data } = await supabase.auth.getUser()
  if (!data?.user?.id) throw new Error('Sign in to stop following this match.')
  const key = keyFor(role, data.user.id, matchId)
  const saved = await readLiveMatchFollow(role, matchId)
  if (!saved) return
  const { error } = await supabase.rpc('stop_following_live_match', { follow_id_value: saved.followId })
  if (error) throw error
  if (Platform.OS === 'ios' && saved.activityId) await iosActivity?.endMatchActivity(saved.activityId)
  if (Platform.OS === 'android') await hideLiveMatchNotification(matchId)
  await AsyncStorage.removeItem(key)
}

export async function refreshLiveMatchNotification(role, matchId) {
  if (Platform.OS !== 'android') return
  const saved = await readLiveMatchFollow(role, matchId)
  if (!saved || saved.rollbackPending) return
  try {
    const match = await confirmedMatch(role, matchId, saved.parentLinkId)
    const state = createLiveMatchState(match, Date.now())
    if (state.end) await stopLiveMatchFollow(role, matchId)
    else await showLiveMatchNotification(matchId, state)
  } catch {
    await hideLiveMatchNotification(matchId)
  }
}

export async function revokeLiveMatchFollowsBeforeSignOut(role) {
  await startBarrier.beforeSignOut(role)
  try {
    const allKeys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(`fp.live-match.v1.${role}.`))
    if (!allKeys.length) return
    const { data, error } = await supabase.auth.getUser()
    if (error || !data?.user?.id) throw error || new Error('Sign in to stop live match updates.')
    const prefix = `fp.live-match.v1.${role}.${data.user.id}.`
    const keys = allKeys.filter(key => key.startsWith(prefix))
    if (!keys.length) return
    await revokeSavedLiveMatchFollows({
      keys,
      read: async key => {
        const raw = await AsyncStorage.getItem(key)
        try { return raw ? JSON.parse(raw) : null } catch { return null }
      },
      revoke: followId => supabase.rpc('stop_following_live_match', { follow_id_value: followId }),
      finish: async entries => {
        if (Platform.OS === 'ios') await iosActivity?.endAllMatchActivities()
        if (Platform.OS === 'android') for (const key of entries) await hideLiveMatchNotification(key.slice(-36))
      },
      remove: entries => AsyncStorage.multiRemove(entries),
    })
  } catch (error) {
    startBarrier.allow(role)
    throw error
  }
}

export async function clearLiveMatchOnSignOut(role) {
  await startBarrier.beforeSignOut(role)
  try {
    const prefix = `fp.live-match.v1.${role}.`
    const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix))
    if (Platform.OS === 'ios') await iosActivity?.endAllMatchActivities().catch(() => {})
    if (Platform.OS === 'android') {
      for (const key of keys) await hideLiveMatchNotification(key.slice(-36)).catch(() => {})
    }
  } finally {
    startBarrier.allow(role)
  }
}
