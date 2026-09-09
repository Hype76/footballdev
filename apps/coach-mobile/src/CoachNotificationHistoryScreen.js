import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { getCoachNotificationHistory } from '../../mobile-core/src/coachNotificationHistory'

export function CoachNotificationHistoryScreen({ user, homeState, onNavigate, onOpenNotification, palette, styles }) {
  const [state, setState] = useState({ items: [], loading: true, error: '' })
  const request = useRef(0)
  const cancelLoad = useCallback(() => { request.current++ }, [])
  const load = useCallback(async () => {
    const current = ++request.current
    setState(value => ({ ...value, loading: true, error: '' }))
    try {
      const items = await getCoachNotificationHistory(user)
      if (current === request.current) setState({ items, loading: false, error: '' })
    } catch { if (current === request.current) setState(value => ({ ...value, loading: false, error: 'Notification history could not be loaded. Check your connection and refresh.' })) }
  }, [user])
  useEffect(() => { void Promise.resolve().then(load); return cancelLoad }, [load, cancelLoad])
  const seen = new Set()
  const items = state.items.filter(item => {
    const key = JSON.stringify([item.title, item.body, item.data, String(item.created_at).slice(0, 16)])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  return <View style={styles.stack}>
    <Text style={styles.screenTitle}>Notifications</Text>
    <Text style={styles.bodyText}>Recent notifications for this Coach context. Tap one to open its details.</Text>
    <Pressable accessibilityRole="button" disabled={state.loading} onPress={() => void load()} style={{ minHeight: 44, paddingVertical: 12 }}><Text style={[styles.bodyText, { color: palette.accentText }]}>{state.loading ? 'Loading notifications...' : 'Refresh notifications'}</Text></Pressable>
    {Number(homeState?.unreadChat) > 0 ? <Pressable accessibilityRole="button" onPress={() => onNavigate('chat')} style={styles.card}><Text style={styles.cardTitle}>Unread Chat</Text><Text style={styles.bodyText}>{homeState.unreadChat} unread messages. Open Chat.</Text></Pressable> : null}
    {state.error ? <Text accessibilityRole="alert" style={styles.bodyText}>{state.error}</Text> : null}
    {!state.loading && !state.error && !items.length ? <Text style={styles.bodyText}>No notification history is available for this Coach context yet.</Text> : null}
    {items.map(item => <Pressable accessibilityRole="button" accessibilityLabel={`Open notification: ${item.title}`} key={String(item.id)} onPress={() => onOpenNotification?.({ ...item.data, targetId: item.data?.targetId || item.data?.matchDayId || '' })} style={[styles.card, { gap: 6 }]}>
      <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.bodyText}>{item.body}</Text><Text style={styles.helperText}>{new Date(item.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
    </Pressable>)}
  </View>
}
