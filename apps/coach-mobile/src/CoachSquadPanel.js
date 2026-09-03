import MaterialIcons from '@expo/vector-icons/MaterialIcons'
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
})

export function CoachSquadPanel({ actions, busy, match, onSetDecision, onNotify, palette, players, styles }) {
  const squad = buildCoachMatchDaySquad(players, match)
  return <View>
    <Text style={styles.cardTitle}>Squad</Text>
    <Text style={styles.body}>{squad.summary.selected} selected · {squad.summary.notSelected} not selected · {squad.summary.undecided + squad.summary.waiting} to choose</Text>
    <Text style={styles.meta}>Choose the squad, then tap Notify when you are ready.</Text>
    {!actions.canSetSquad ? <Text style={styles.body}>{actions.blockedReason || 'Squad decisions are locked after kick-off.'}</Text> : null}
    {squad.rows.map((player) => {
      const chosen = ['selected', 'not_selected'].includes(player.decision)
      const sent = Boolean(player.notifiedAt)
      const controls = [
        { key: 'selected', label: 'Selected', icon: 'check-circle-outline', active: player.decision === 'selected', onPress: () => onSetDecision(player, 'selected') },
        { key: 'not_selected', label: 'Not selected', icon: 'cancel', active: player.decision === 'not_selected', onPress: () => onSetDecision(player, 'not_selected') },
        { key: 'notify', label: sent ? 'Sent' : 'Notify', icon: sent ? 'notifications-active' : 'notifications-none', active: sent, onPress: () => onNotify(player) },
      ]
      return <View key={player.id} style={[layout.row, { borderBottomColor: palette.border }]}>
        <View style={layout.person}><Text style={[layout.name, { color: palette.textPrimary }]}>{player.playerName}</Text><Text style={[layout.meta, { color: palette.textSecondary }]}>{player.availabilityLabel}{player.shirtNumber ? ` · #${player.shirtNumber}` : ''}</Text>{!chosen ? <Text style={[layout.meta, { color: palette.textMuted }]}>Choose selection</Text> : null}</View>
        <View style={layout.controls}>{controls.map((control) => {
          const disabled = busy || !actions.canSetSquad || control.active || (control.key === 'notify' && (!chosen || !player.decisionRevision))
          const color = control.active ? palette.selectedForeground : palette.textPrimary
          return <Pressable key={control.key} accessibilityRole="button" accessibilityLabel={`${control.label}: ${player.playerName}`} accessibilityState={{ disabled, selected: control.active }} disabled={disabled} onPress={control.onPress} style={[layout.control, { backgroundColor: control.active ? palette.selected : 'transparent', borderColor: control.active ? palette.accent : palette.border, opacity: disabled && !control.active ? 0.4 : 1 }]}><MaterialIcons name={control.icon} size={24} color={color} /><Text style={[layout.label, { color }]}>{control.label}</Text></Pressable>
        })}</View>
      </View>
    })}
  </View>
}
