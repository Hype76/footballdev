import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { buildCoachMatchDaySquad } from '../../mobile-core/src/coachMatchDayCore'

const layout = StyleSheet.create({
  row: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 8, minHeight: 88, paddingVertical: 9 },
  person: { flex: 1, gap: 4, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 11, lineHeight: 16 },
  controls: { flexDirection: 'row', gap: 3 },
  control: { alignItems: 'center', borderRadius: 10, borderWidth: 1, gap: 3, justifyContent: 'center', minHeight: 60, width: 49 },
  label: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  toolbar: { flexDirection: 'row', gap: 12, marginTop: 12 },
  toolbarButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 6 },
  send: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 48, marginVertical: 8, padding: 10 },
})

export function CoachSquadPanel({ actions, busy, match, onSetDecision, onNotify, palette, players, styles }) {
  const squad = buildCoachMatchDaySquad(players, match)
  const [chosen, setChosen] = useState({})
  const [results, setResults] = useState({})
  const [summary, setSummary] = useState('')
  const [sending, setSending] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const sendingRef = useRef(false)
  const decidingRef = useRef(false)
  const locked = busy || sending || deciding || !actions.canSetSquad
  const wasSent = (player) => Boolean(player.notifiedAt) || (results[player.id]?.revision === player.decisionRevision && results[player.id]?.sent === true)
  const available = squad.rows.filter((player) => player.canNotify && ['selected', 'not_selected'].includes(player.decision) && player.decisionRevision && !wasSent(player))
  const chosenPlayers = available.filter((player) => chosen[player.id] === player.decisionRevision)
  const setDecision = async (player, decision) => {
    if (locked || decidingRef.current) return
    decidingRef.current = true; setDeciding(true); setSummary('')
    try {
      const detail = await onSetDecision(player, decision)
      const saved = buildCoachMatchDaySquad(players, detail).rows.find((row) => row.id === player.id)
      if (saved?.decision === decision && saved.canNotify && saved.decisionRevision && !saved.notifiedAt) {
        setChosen((current) => ({ ...current, [player.id]: saved.decisionRevision }))
      }
    } catch {
      setSummary('The selection could not be confirmed. Refresh before trying again.')
    } finally { decidingRef.current = false; setDeciding(false) }
  }
  const send = async () => {
    if (locked || sendingRef.current || chosenPlayers.length === 0) return
    sendingRef.current = true; setSending(true); setSummary('')
    try {
      const outcomes = await onNotify(chosenPlayers)
      const byPlayer = Object.fromEntries(outcomes.map((item) => [item.playerId, item]))
      setResults((current) => ({ ...current, ...byPlayer }))
      setChosen((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !byPlayer[id]?.sent)))
      const sentCount = outcomes.filter((item) => item.sent).length
      const failedCount = chosenPlayers.length - sentCount
      setSummary(`${sentCount} ${sentCount === 1 ? 'player' : 'players'} notified.${failedCount ? ` ${failedCount} could not be notified. See the details below.` : ''}`)
    } catch {
      setSummary('Notifications could not be confirmed. Try again; saved notifications will not be duplicated.')
    } finally { sendingRef.current = false; setSending(false) }
  }
  const sendButton = <Pressable accessibilityRole="button" disabled={locked || chosenPlayers.length === 0} onPress={send} style={[layout.send, { backgroundColor: palette.selected, opacity: locked || !chosenPlayers.length ? 0.4 : 1 }]}><Text style={{ color: palette.selectedForeground, fontWeight: '800' }}>{sending ? 'Sending...' : `Send notifications (${chosenPlayers.length})`}</Text></Pressable>
  return <View>
    <Text style={styles.cardTitle}>Squad</Text>
    <Text style={styles.body}>{squad.summary.selected} selected · {squad.summary.notSelected} not selected · {squad.summary.undecided + squad.summary.waiting} to choose</Text>
    <Text style={styles.meta}>Selecting either option ticks Notify. Send notifications when you are ready.</Text>
    {!actions.canSetSquad ? <Text style={styles.body}>{actions.blockedReason || 'Squad decisions are locked after kick-off.'}</Text> : null}
    <View style={layout.toolbar}>
      <Pressable accessibilityRole="button" disabled={locked || available.length === 0} onPress={() => { setChosen(Object.fromEntries(available.map((player) => [player.id, player.decisionRevision]))); setSummary('') }} style={layout.toolbarButton}><Text style={[styles.body, { color: palette.accent, opacity: locked || !available.length ? 0.4 : 1 }]}>Tick all unsent</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={locked || chosenPlayers.length === 0} onPress={() => { setChosen({}); setSummary('') }} style={layout.toolbarButton}><Text style={[styles.body, { color: palette.accent, opacity: locked || !chosenPlayers.length ? 0.4 : 1 }]}>Clear</Text></Pressable>
    </View>
    {sendButton}
    {summary ? <Text accessibilityLiveRegion="polite" style={styles.body}>{summary}</Text> : null}
    {squad.rows.map((player) => {
      const decided = ['selected', 'not_selected'].includes(player.decision)
      const sent = wasSent(player)
      const picked = chosen[player.id] === player.decisionRevision
      const result = results[player.id]?.revision === player.decisionRevision ? results[player.id] : null
      const controls = [
        { key: 'selected', label: 'Selected', icon: 'check-circle-outline', active: player.decision === 'selected', onPress: () => setDecision(player, 'selected') },
        { key: 'not_selected', label: 'Not selected', icon: 'cancel', active: player.decision === 'not_selected', onPress: () => setDecision(player, 'not_selected') },
        { key: 'notify', label: sent ? 'Sent' : 'Notify', icon: sent ? 'notifications-active' : picked ? 'check-box' : 'check-box-outline-blank', active: sent || picked, onPress: () => { setChosen((current) => ({ ...current, [player.id]: picked ? '' : player.decisionRevision })); setSummary('') } },
      ].filter((control) => control.key !== 'notify' || player.canNotify || sent)
      return <View key={player.id} style={[layout.row, { borderBottomColor: palette.border }]}>
        <View style={layout.person}><Text style={[layout.name, { color: player.notificationContactState === 'no_contact' ? palette.danger || '#ef4444' : palette.textPrimary }]}>{player.playerName}</Text><Text style={[layout.meta, { color: palette.textSecondary }]}>{player.availabilityLabel}{player.shirtNumber ? ` · #${player.shirtNumber}` : ''}</Text>{!decided ? <Text style={[layout.meta, { color: palette.textMuted }]}>Choose selection</Text> : null}{player.notificationContactState === 'no_contact' ? <Text accessibilityLabel={`${player.playerName}: No contact details`} style={[layout.meta, { color: palette.danger || '#ef4444' }]}>No contact details</Text> : player.notificationContactState === 'disabled' ? <Text style={[layout.meta, { color: palette.textSecondary }]}>Notifications are switched off.</Text> : player.notificationContactState === 'unknown' ? <Text style={[layout.meta, { color: palette.textSecondary }]}>Contact details need refreshing.</Text> : null}{player.emailRecipientCount > 0 && !sent ? <Text style={[layout.meta, { color: palette.textSecondary }]}>{player.appRecipientCount > 0 ? 'App and email' : 'By email'}</Text> : null}{result?.message && !sent ? <Text style={[layout.meta, { color: palette.textPrimary }]}>{result.message}</Text> : null}</View>
        <View style={layout.controls}>{controls.map((control) => {
          const disabled = locked || (control.key === 'notify' ? sent || !decided || !player.decisionRevision : control.active)
          const color = control.active ? palette.selectedForeground : palette.textPrimary
          return <Pressable key={control.key} accessibilityRole={control.key === 'notify' && !sent ? 'checkbox' : 'button'} accessibilityLabel={`${control.label}: ${player.playerName}`} aria-checked={control.key === 'notify' && !sent ? picked : undefined} accessibilityState={{ disabled, selected: control.active, ...(control.key === 'notify' && !sent ? { checked: picked } : {}) }} disabled={disabled} onPress={control.onPress} style={[layout.control, { backgroundColor: control.active ? palette.selected : 'transparent', borderColor: control.active ? palette.accent : palette.border, opacity: disabled && !control.active ? 0.4 : 1 }]}><MaterialIcons name={control.icon} size={24} color={color} /><Text style={[layout.label, { color }]}>{control.label}</Text></Pressable>
        })}</View>
      </View>
    })}
    {squad.rows.length > 5 ? sendButton : null}
  </View>
}
