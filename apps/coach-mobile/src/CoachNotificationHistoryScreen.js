import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { loadCoachNotificationHistory } from './coachNotificationCache'
import { formatUkDateTime } from '../../../src/lib/date-format.js'

export function CoachNotificationHistoryScreen({ user, context, homeState, onNavigate, onOpenNotification, palette, styles }) {
  const [state, setState] = useState({ items: [], loading: true, error: '' })
  const request = useRef(0)
  const cancelLoad = useCallback(() => { request.current++ }, [])
  const load = useCallback(async ({ force = false } = {}) => {
    const current = ++request.current
    setState(value => ({ ...value, loading: true, error: '' }))
    try {
      const result = await loadCoachNotificationHistory(user, context, { force, onSaved: items => {
        if (current === request.current) setState({ items, loading: false, error: '' })
      } })
      if (current === request.current) setState({ items: result.items, loading: false, error: result.stale ? 'Showing saved notifications. Reconnect to check for updates.' : '' })
    } catch { if (current === request.current) setState(value => ({ ...value, loading: false, error: 'Notification history could not be loaded. Check your connection and refresh.' })) }
  }, [context, user])
  useEffect(() => { void Promise.resolve().then(load); return cancelLoad }, [load, cancelLoad])
  const seen = new Set()
  const items = state.items.filter(item => {
    const key = JSON.stringify([item.title, item.body, item.data, String(item.created_at).slice(0, 16)])
    if (seen.has(key)) return false
    seen.add(key); return true
  })
  return <View style={styles.stack}>
    <Text style={styles.screenTitle}>Notifications</Text>
    <Text style={styles.bodyText}>Player responses and updates. Tap an update for details.</Text>
    <Pressable accessibilityRole="button" disabled={state.loading} onPress={() => void load({ force: true })} style={{ minHeight: 44, paddingVertical: 12 }}><Text style={[styles.bodyText, { color: palette.accentText }]}>{state.loading ? 'Loading notifications...' : 'Refresh notifications'}</Text></Pressable>
    {Number(homeState?.unreadChat) > 0 ? <Pressable accessibilityRole="button" onPress={() => onNavigate('chat')} style={styles.card}><Text style={styles.cardTitle}>Unread Chat</Text><Text style={styles.bodyText}>{homeState.unreadChat} unread messages. Open Chat.</Text></Pressable> : null}
    {state.error ? <Text accessibilityRole="alert" style={styles.bodyText}>{state.error}</Text> : null}
    {!state.loading && !state.error && !items.length ? <Text style={styles.bodyText}>No notification history is available for this Coach context yet.</Text> : null}
    {items.map(item => <Pressable accessibilityRole="button" accessibilityLabel={`Open notification: ${item.title}`} key={String(item.id)} onPress={() => onOpenNotification?.({ ...item.data, targetId: item.data?.targetId || item.data?.matchDayId || '' })} style={{ gap: 6, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: palette.border }}>
      <Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.bodyText}>{item.body}</Text><Text style={styles.helperText}>{formatUkDateTime(item.created_at)}</Text>
    </Pressable>)}
  </View>
}
