import React, { useEffect, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { readLiveMatchFollow, startLiveMatchFollow, stopLiveMatchFollow } from './liveMatchFollow'
import { supabase } from './supabase'

export function LiveMatchFollowAction({ role, matchId, parentLinkId = null, textStyle }) {
  const [following, setFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setFollowing(false)
    void readLiveMatchFollow(role, matchId).then(saved => {
      if (active) setFollowing(Boolean(saved))
    }).catch(() => {})
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') setFollowing(false)
      if (event === 'SIGNED_IN') void readLiveMatchFollow(role, matchId).then(saved => {
        if (active) setFollowing(Boolean(saved))
      }).catch(() => {})
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [role, matchId, parentLinkId])
  if (!matchId || Platform.OS === 'web') return null
  const label = following ? 'Stop following on lock screen' : 'Follow on lock screen'
  return <View style={{ borderTopWidth: 1, borderTopColor: '#ffffff33', marginTop: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy }} disabled={busy}
      onPress={async () => {
        setBusy(true); setError('')
        try {
          if (following) { await stopLiveMatchFollow(role, matchId); setFollowing(false) }
          else { await startLiveMatchFollow(role, matchId, parentLinkId); setFollowing(true) }
        } catch (caught) { setError(caught?.message || 'Could not update live match following.') }
        finally { setBusy(false) }
      }} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={textStyle}>{busy ? 'Updating...' : label}</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={textStyle}>{error}</Text> : null}
  </View>
}
