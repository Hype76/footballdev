import { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Linking, Pressable, Text, View } from 'react-native'
import { createNotificationExplainer, notificationExplainerKey, notificationSetupChoice } from './notificationExplainerCore'
import { enableParentNotifications, loadParentNotificationState } from './notifications'
import { getParentCommunicationPreference } from './communicationPreferences'
import { supabase } from '../../mobile-core/src/supabase'
import { normalizeNotificationCategories } from '../../mobile-core/src/notificationCategories'

export function NotificationExplainer({ accountId, linkId, config, homeReady, settingsOpen, palette, onState }) {
  const [snapshot, setSnapshot] = useState(null)
  const [controller, setController] = useState(null)
  useEffect(() => {
    if (!accountId || !linkId) return undefined
    let key
    try { key = notificationExplainerKey(accountId, config.apiBaseUrl) } catch { return undefined }
    const next = createNotificationExplainer({
      key, storage: AsyncStorage, publish: setSnapshot,
      load: async () => {
        const [state, communication, result] = await Promise.all([
          loadParentNotificationState({ apiBaseUrl: config.apiBaseUrl }),
          getParentCommunicationPreference(config.apiBaseUrl),
          (async () => {
            const abort = new AbortController()
            const timer = setTimeout(() => abort.abort(), 10000)
            try { return await supabase.from('mobile_notification_preferences').select('game_day, invites, chats, resources').eq('app', 'parent').maybeSingle().abortSignal(abort.signal) }
            finally { clearTimeout(timer) }
          })(),
        ])
        if (result.error) throw result.error
        return { state, communication, categories: normalizeNotificationCategories({ ...result.data, gameDay: result.data?.game_day }) }
      },
      setup: async isCurrent => {
        const state = await enableParentNotifications({ apiBaseUrl: config.apiBaseUrl, easProjectId: config.easProjectId, parentLinkId: linkId, isCurrent })
        if (isCurrent()) onState(state)
        return state
      },
      openSettings: () => Linking.openSettings(),
    })
    setSnapshot(null); setController(next)
    const subscription = AppState.addEventListener('change', state => { void next.appState(state) })
    return () => { next.dispose(); subscription.remove() }
  }, [accountId, linkId, config, onState])
  useEffect(() => {
    if (controller && (homeReady || settingsOpen)) void controller.refresh()
  }, [controller, homeReady, settingsOpen])
  const choice = snapshot?.data ? notificationSetupChoice(snapshot.data.state) : null
  const showExplainer = homeReady && snapshot?.ready && !snapshot.dismissed && snapshot.data?.eligible && !snapshot.data.state.permissionGranted && choice
  const showSetup = settingsOpen && snapshot?.ready && snapshot.data?.eligible && choice
  if (!showExplainer && !showSetup && !(homeReady && snapshot?.initiated && snapshot?.error)) return null
  const text = { color: palette.text, fontSize: 15, lineHeight: 22 }
  const actionStyle = { minHeight: 48, justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8 }
  return <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: 12, gap: 8 }}>
    <Text accessibilityRole="header" style={[text, { fontWeight: '700' }]}>Phone notifications</Text>
    {showExplainer ? <Text style={text}>Enable phone notifications for goal alerts and invitation updates. You can choose which alerts you receive in Settings.</Text> : null}
    <Text style={text}>You can still view updates in the app.</Text>
    {snapshot?.error ? <Text accessibilityLiveRegion="polite" style={text}>{snapshot.error}</Text> : null}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {choice && (showExplainer || showSetup) ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: snapshot.busy }} disabled={snapshot.busy} onPress={() => { void controller.act() }} style={actionStyle}><Text style={[text, { fontWeight: '700' }]}>{snapshot.busy ? 'Checking setup...' : choice}</Text></Pressable> : null}
      {showExplainer ? <Pressable accessibilityRole="button" disabled={snapshot.busy} onPress={() => { void controller.dismiss().catch(() => {}) }} style={actionStyle}><Text style={text}>Not now</Text></Pressable> : null}
    </View>
  </View>
}
