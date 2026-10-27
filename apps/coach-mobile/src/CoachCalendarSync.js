import { useEffect, useRef, useState } from 'react'
import { Alert, Linking, Platform, Pressable, Text, View } from 'react-native'
import { changeCoachCalendarSubscription, readCoachCalendarSubscription } from '../../mobile-core/src/coachCalendarSubscription'
import { getAppleCalendarSubscriptionUrl } from '../../mobile-core/src/calendarSubscriptionCore.js'

export function CoachCalendarSync({ user, context, offline, styles }) {
  const [expanded, setExpanded] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  useEffect(() => {
    mounted.current = true
    void readCoachCalendarSubscription(user, context).then(value => { if (mounted.current) setUrl(value) }).catch(() => {})
    return () => { mounted.current = false }
  }, [context, user])

  async function change(action) {
    if (offline || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice('')
    try {
      const nextUrl = action === 'connect' && url ? url : await changeCoachCalendarSubscription(user, context, action)
      if (!mounted.current) return
      setUrl(nextUrl)
      if (action === 'connect' && Platform.OS === 'ios') {
        await Linking.openURL(getAppleCalendarSubscriptionUrl(nextUrl, 'coach'))
        if (mounted.current) setNotice('Confirm the subscription in Apple Calendar. Changes sync when Apple refreshes the calendar.')
      } else {
        setNotice(action === 'revoke' ? 'Calendar link revoked.' : 'Press and hold the private link to copy it. Add it using Other calendars, then From URL in Google Calendar on a computer.')
      }
    } catch {
      if (mounted.current) setNotice('The calendar could not be connected. Check your connection and try again.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const action = (label, onPress) => <Pressable accessibilityRole="button" disabled={busy || offline}
    accessibilityState={{ disabled: busy || offline }} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center' }}>
    <Text style={styles.body}>{label}</Text>
  </Pressable>
  return <View style={{ borderBottomWidth: 1, borderBottomColor: '#68746c', paddingVertical: 6 }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={styles.label}>Phone calendar {expanded ? '−' : '+'}</Text>
    </Pressable>
    {expanded ? <>
      <Text style={styles.body}>Sync this {context.teamId ? 'team' : 'club'} calendar for the next 90 days. Event times, changes and cancellations update when your calendar app refreshes. Keep the link private.</Text>
      {action(Platform.OS === 'ios' ? 'Connect Apple Calendar' : 'Show private calendar link', () => { void change('connect') })}
      {url ? <Text selectable accessibilityLabel="Private Coach calendar link" style={styles.body}>{url}</Text> : null}
      {url ? <>
        {action('Replace calendar link', () => Alert.alert('Replace calendar link?', 'The old link will stop working. Add the replacement in your calendar app.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Replace', onPress: () => { void change('generate') } },
        ]))}
        {action('Revoke calendar link', () => Alert.alert('Revoke calendar link?', 'This stops calendar updates through the current link.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Revoke', style: 'destructive', onPress: () => { void change('revoke') } },
        ]))}
      </> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
    </> : null}
  </View>
}
