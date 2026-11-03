import React, { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform, Pressable, Text, View } from 'react-native'
import { readLiveMatchFollow, startLiveMatchFollowOnce, stopLiveMatchFollow } from './liveMatchFollow'
import { supabase } from './supabase'

async function autoFollowPreferenceKey(role, matchId) {
  const { data } = await supabase.auth.getUser()
  if (!data?.user?.id) throw new Error('Sign in to follow this match.')
  return `fp.live-match.auto.v1.${role}.${data.user.id}.${matchId}`
}

export function LiveMatchFollowAction({ role, matchId, parentLinkId = null, textStyle }) {
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!matchId || Platform.OS === 'web') return undefined
    let active = true
    setFollowing(false)
    void (async () => {
      try {
        const saved = await readLiveMatchFollow(role, matchId)
        if (!active) return
        if (saved) { setFollowing(true); return }
        const preferenceKey = await autoFollowPreferenceKey(role, matchId)
        if (await AsyncStorage.getItem(preferenceKey) === 'off' || !active) return
        setBusy(true)
        const started = await startLiveMatchFollowOnce(role, matchId, parentLinkId)
        if (active) setFollowing(Boolean(started))
      } catch (caught) {
        if (active) setError(caught?.message || 'Could not show the live match on your lock screen.')
      } finally {
        if (active) setBusy(false)
      }
    })()
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') setFollowing(false)
      if (event === 'SIGNED_IN') void readLiveMatchFollow(role, matchId).then(saved => {
        if (active) setFollowing(Boolean(saved))
      }).catch(() => {})
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [role, matchId, parentLinkId])
  if (!matchId || Platform.OS === 'web') return null
  const label = following ? 'Stop lock screen score' : 'Show score on lock screen'
  return <View style={{ borderTopWidth: 1, borderTopColor: '#ffffff33', marginTop: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy }} disabled={busy}
      onPress={async () => {
        setBusy(true); setError('')
        try {
          const preferenceKey = await autoFollowPreferenceKey(role, matchId)
          if (following) {
            await stopLiveMatchFollow(role, matchId)
            await AsyncStorage.setItem(preferenceKey, 'off')
            setFollowing(false)
          } else {
            await startLiveMatchFollowOnce(role, matchId, parentLinkId)
            await AsyncStorage.removeItem(preferenceKey)
            setFollowing(true)
          }
        } catch (caught) { setError(caught?.message || 'Could not update live match following.') }
        finally { setBusy(false) }
      }} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={textStyle}>{busy ? 'Starting lock screen score...' : label}</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={textStyle}>{error}</Text> : null}
  </View>
}
