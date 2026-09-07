import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, Pressable, StyleSheet, Switch, Text, View } from 'react-native'
import { supabase } from './supabase'
import { GAME_DAY_CHOICES, normalizeNotificationCategories } from './notificationCategories'

const SWITCHES = [
  { key: 'invites', label: 'Invites', iconKey: 'more.invites', copy: 'Invitations, availability replies and calendar changes.' },
  { key: 'chats', label: 'Chats', iconKey: 'more.chat', copy: 'Messages, team conversations and polls.' },
  { key: 'resources', label: 'New resources', iconKey: 'more.resources', copy: 'Alerts when a resource is shared with you.' },
]

async function preferenceRequest(query) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try { return await query.abortSignal(controller.signal) } finally { clearTimeout(timer) }
}

export function NotificationCategorySettings({ app, userId, palette: themePalette, Icon: iconComponent, client = supabase }) {
  const Icon = iconComponent
  const palette = { ...themePalette, text: themePalette.text || themePalette.textPrimary, textMuted: themePalette.textSecondary || themePalette.textMuted, accentMuted: themePalette.selectedSurface || themePalette.selected || themePalette.accentMuted }
  const [state, setState] = useState({ preferences: null, loading: true, saving: false, message: '' })
  const active = useRef(0)
  const saving = useRef(false)
  const load = useCallback(async () => {
    if (saving.current) return
    const request = ++active.current
    setState(previous => ({ ...previous, loading: true, message: '' }))
    try {
      // RLS selects the authenticated owner; older Coach profile IDs can differ.
      const { data, error } = await preferenceRequest(client.from('mobile_notification_preferences')
        .select('game_day, invites, chats, resources').eq('app', app).maybeSingle())
      if (error) throw error
      if (active.current === request) setState({ preferences: normalizeNotificationCategories({ ...data, gameDay: data?.game_day }), loading: false, saving: false, message: '' })
    } catch {
      if (active.current === request) setState(previous => ({ ...previous, loading: false, message: 'Connect to the internet and retry. Your saved choices have not been changed.' }))
    }
  }, [app, client, userId])
  useEffect(() => {
    setState({ preferences: null, loading: true, saving: false, message: '' })
    void load()
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void load() })
    return () => { active.current += 1; subscription.remove() }
  }, [load])

  const change = async (key, value) => {
    if (saving.current || state.loading || !state.preferences) return
    saving.current = true
    const request = ++active.current
    setState(previous => ({ ...previous, saving: true, message: '' }))
    try {
      const { data, error } = await preferenceRequest(client.rpc('set_mobile_notification_preference', { app_value: app, key_value: key, value_json: value }))
      if (error) throw error
      if (active.current === request) setState({ preferences: normalizeNotificationCategories(data), loading: false, saving: false, message: 'Saved.' })
    } catch {
      if (active.current === request) setState(previous => ({ ...previous, saving: false, message: 'Could not confirm this change. Reconnect and retry to check your saved choices.' }))
    } finally { saving.current = false }
  }
  const disabled = state.loading || state.saving || !state.preferences
  const text = { color: palette.text }
  const muted = { color: palette.textMuted }
  return <View style={styles.stack}>
    <Text style={[styles.title, text]} accessibilityRole="header">Choose your alerts</Text>
    <Text style={[styles.copy, muted]}>These push choices apply to your {app === 'coach' ? 'Coach' : 'Parent'} account on every device. You can still find updates in the app.</Text>
    <Text style={[styles.title, text]} accessibilityRole="header">Game Day</Text>
    {GAME_DAY_CHOICES.map(choice => {
      const selected = state.preferences?.gameDay === choice.key
      return <Pressable key={choice.key} accessibilityRole="radio" accessibilityLabel={choice.label}
        accessibilityState={{ checked: selected, disabled }} aria-checked={selected} aria-disabled={disabled} disabled={disabled} onPress={() => change('gameDay', choice.key)}
        style={({ pressed }) => [styles.choice, { borderColor: selected ? palette.accent : palette.border, backgroundColor: selected ? palette.accentMuted : 'transparent' }, pressed && styles.pressed]}>
        <Icon iconKey={choice.iconKey} color={selected ? palette.accent : palette.textMuted} size={28} />
        <View style={styles.copyColumn}><Text style={[styles.label, text]}>{choice.label}</Text><Text style={[styles.copy, muted]}>{choice.copy}</Text></View>
        <Icon name={selected ? 'radio-button-checked' : 'radio-button-unchecked'} iconKey={selected ? 'settings.selected' : 'settings.badge'} color={selected ? palette.accent : palette.textMuted} size={24} />
      </Pressable>
    })}
    <Text style={[styles.copy, muted]}>Game Day Off only stops match alerts. Choose your other alerts below.</Text>
    {SWITCHES.map(choice => <View key={choice.key} style={[styles.switchRow, { borderColor: palette.border }]}>
      <Icon iconKey={choice.iconKey} color={palette.accent} size={28} />
      <View style={styles.copyColumn}><Text style={[styles.label, text]}>{choice.label}</Text><Text style={[styles.copy, muted]}>{choice.copy}</Text></View>
      <Switch accessibilityLabel={choice.label} disabled={disabled} value={state.preferences?.[choice.key] === true}
        onValueChange={value => change(choice.key, value)} trackColor={{ false: palette.borderStrong || palette.border, true: palette.accentMuted }}
        thumbColor={state.preferences?.[choice.key] ? palette.accent : palette.textMuted} />
    </View>)}
    {state.loading || state.saving ? <Text accessibilityLiveRegion="polite" style={[styles.copy, muted]}>{state.saving ? 'Saving your choice...' : 'Checking your saved choices...'}</Text> : null}
    {state.message ? <Text accessibilityLiveRegion="polite" style={[styles.copy, muted]}>{state.message}</Text> : null}
    {state.message && state.message !== 'Saved.' ? <Pressable accessibilityRole="button" accessibilityLabel="Retry notification choices" disabled={state.saving || state.loading} onPress={load} style={styles.retry}><Text style={[styles.label, { color: palette.accent }]}>Retry</Text></Pressable> : null}
  </View>
}

const styles = StyleSheet.create({
  stack: { gap: 14 }, title: { fontSize: 18, fontWeight: '700' }, label: { fontSize: 16, fontWeight: '700' },
  copy: { fontSize: 14, lineHeight: 21 }, copyColumn: { flex: 1, gap: 4, minWidth: 0 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, padding: 14, minHeight: 78 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, paddingVertical: 14 },
  retry: { minHeight: 44, justifyContent: 'center' }, pressed: { opacity: 0.75 },
})
