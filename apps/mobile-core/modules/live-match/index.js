import { requireOptionalNativeModule } from 'expo-modules-core'

const native = requireOptionalNativeModule('FootballPlayerLiveMatch')

export async function showLiveMatchNotification(matchId, state) {
  if (!native) throw new Error('live_match_native_module_unavailable')
  return native.showAsync(matchId, state)
}

export async function hideLiveMatchNotification(matchId) {
  if (!native) return
  await native.hideAsync(matchId)
}
