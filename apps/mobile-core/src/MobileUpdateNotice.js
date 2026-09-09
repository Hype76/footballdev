import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

export function MobileUpdateNotice({ update, compact = false }) {
  const [dismissed, setDismissed] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState('')
  const insets = useSafeAreaInsets()
  if (!update.readyOnRestart || dismissed) return null
  const restart = async () => {
    setRestarting(true)
    try { await update.restart() } catch { setError('Restart did not finish. Close and reopen the app to apply the update.'); setRestarting(false) }
  }
  if (compact) return <View accessibilityLiveRegion="polite" testID="parent-update-notice" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, padding: 10, borderRadius: 8, backgroundColor: '#063c29', gap: 8, zIndex: 100 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '700' }}>Update ready</Text>
        <Text style={{ color: '#ffffff', fontSize: 12 }}>Save work first.</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={restarting} onPress={() => void restart()} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: '#ffffff', borderRadius: 6 }}>
        <Text style={{ color: '#063c29', fontSize: 13, fontWeight: '700' }}>{restarting ? 'Restarting...' : 'Restart app'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss update notice" disabled={restarting} onPress={() => setDismissed(true)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Text accessible={false} style={{ color: '#ffffff', fontSize: 24 }}>×</Text>
      </Pressable>
    </View>
    {error ? <Text accessibilityRole="alert" style={{ color: '#ffffff', fontSize: 13 }}>{error}</Text> : null}
  </View>
  return <View accessibilityLiveRegion="polite" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, padding: 14, borderRadius: 12, backgroundColor: '#063c29', borderWidth: 1, borderColor: '#80e5b7', gap: 8, zIndex: 100 }}>
    <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>App update ready</Text>
    <Text style={{ color: '#ffffff', fontSize: 13 }}>Save any work, then restart to apply the latest changes.</Text>
    {error ? <Text style={{ color: '#ffffff' }}>{error}</Text> : null}
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Pressable accessibilityRole="button" disabled={restarting} onPress={() => void restart()} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#ffffff', borderRadius: 8 }}><Text style={{ color: '#063c29', fontWeight: '700' }}>{restarting ? 'Restarting...' : 'Restart app'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={restarting} onPress={() => setDismissed(true)} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}><Text style={{ color: '#ffffff', fontWeight: '700' }}>Later</Text></Pressable>
    </View>
  </View>
}
