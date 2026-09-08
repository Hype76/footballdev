import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { getCoachInviteDeliveryProgress, getCoachInviteStatusLabel } from '../../mobile-core/src/coachPhase31ECore'
import { contrastSafeColor, themeForeground } from '../../mobile-core/src/themeContrast'

const responseKey = status => ['pending', 'responded', '', undefined].includes(status) ? 'awaiting' : status

export function CoachMatchInviteTable({ invites, players = [], palette, selectedPlayerIds, selectionDisabled, onToggleSelection, onFilterChange }) {
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'player', direction: 1 })
  const [detailsId, setDetailsId] = useState(null)
  const { width } = useWindowDimensions()
  const styles = useMemo(() => createStyles(palette), [palette])
  const mode = themeForeground(palette.background) === '#000000' ? 'light' : 'dark'
  const awaitingColor = contrastSafeColor('#38a3ff', [palette.surface, palette.surfaceRaised, palette.selected], mode, 4.5)
  const responses = {
    available: { label: 'Available', icon: 'check-circle', color: palette.success },
    awaiting: { label: 'Awaiting', icon: 'schedule', color: awaitingColor },
    unavailable: { label: 'Unavailable', icon: 'cancel', color: palette.danger },
    maybe: { label: 'Maybe', icon: 'help-outline', color: palette.warning },
  }
  const response = invite => responses[responseKey(invite.status)] || { label: getCoachInviteStatusLabel(invite.status, 'match'), icon: 'info-outline', color: palette.textSecondary }
  const counts = invites.reduce((value, invite) => { const key = responseKey(invite.status); value[key] = (value[key] || 0) + 1; return value }, {})
  const filterKeys = [...new Set(['available', 'awaiting', 'unavailable', ...Object.keys(counts)])]
  const playerById = new Map(players.map(player => [player.id, player]))
  const visible = invites.filter(invite => filter === 'all' || responseKey(invite.status) === filter).sort((a, b) => {
    const comparison = sort.key === 'response' ? response(a).label.localeCompare(response(b).label) : a.playerName.localeCompare(b.playerName)
    return comparison * sort.direction || a.playerName.localeCompare(b.playerName)
  })
  useEffect(() => {
    const hiddenSelection = selectedPlayerIds.some(id => !invites.some(invite => invite.playerId === id && (filter === 'all' || responseKey(invite.status) === filter)))
    if (hiddenSelection) onFilterChange?.()
  }, [filter, invites, onFilterChange, selectedPlayerIds])
  const details = invites.find(invite => invite.id === detailsId)
  const selectFilter = key => { setFilter(filter === key ? 'all' : key); onFilterChange?.() }
  const changeSort = key => setSort(current => ({ key, direction: current.key === key ? -current.direction : 1 }))
  const sortIcon = key => sort.key === key ? sort.direction === 1 ? 'arrow-drop-up' : 'arrow-drop-down' : 'unfold-more'
  const progressLabels = invite => { const p = getCoachInviteDeliveryProgress(invite); return `Sent ${p.sent ? 'yes' : 'no'}, delivered ${p.delivered ? 'yes' : 'no'}, seen ${p.seen ? 'yes' : 'no'}` }
  return <View style={styles.container}>
    <View style={styles.filters}>
      {filterKeys.map(key => {
        const item = responses[key] || response({ status: key })
        return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Filter ${item.label}, ${counts[key] || 0} players`} accessibilityState={{ selected: filter === key }} onPress={() => selectFilter(key)} style={[styles.filter, width < 360 && { flexDirection: 'column', gap: 2 }, filter === key && styles.filterSelected]}>
          <MaterialIcons name={item.icon} size={25} color={item.color} accessible={false} />
          <View style={[styles.filterCopy, width < 360 && { alignItems: 'center' }]}><Text style={styles.count}>{counts[key] || 0}</Text><Text style={styles.filterLabel}>{item.label}</Text></View>
        </Pressable>
      })}
    </View>
    <View style={styles.toolbar}><Pressable accessibilityRole="button" accessibilityState={{ selected: filter === 'all' }} onPress={() => { setFilter('all'); onFilterChange?.() }} style={styles.allButton}><Text style={styles.allText}>All {invites.length}</Text></Pressable><Text accessibilityLiveRegion="polite" style={styles.caption}>Showing {visible.length} of {invites.length}</Text></View>
    <View style={styles.table}>
      <View style={[styles.row, styles.header]}>
        <Text style={[styles.number, styles.caption]}>#</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Sort by player" onPress={() => changeSort('player')} style={styles.player}><Text style={styles.caption}>Player</Text><MaterialIcons name={sortIcon('player')} color={palette.textSecondary} size={16} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Sort by response" onPress={() => changeSort('response')} style={styles.response}><Text style={styles.caption}>Response</Text><MaterialIcons name={sortIcon('response')} color={palette.textSecondary} size={16} /></Pressable>
        <Text style={[styles.message, styles.caption]}>Message</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Message status key" onPress={() => setDetailsId('legend')} style={styles.info}><MaterialIcons name="info-outline" size={19} color={palette.textSecondary} /></Pressable>
      </View>
      {visible.map(invite => {
        const item = response(invite), progress = getCoachInviteDeliveryProgress(invite), selected = selectedPlayerIds.includes(invite.playerId)
        return <View key={invite.id} style={[styles.row, selected && styles.selected]}>
          <Pressable accessibilityRole="checkbox" accessibilityLabel={`${invite.playerName}, ${item.label}, ${progressLabels(invite)}`} accessibilityState={{ checked: selected, disabled: selectionDisabled }} disabled={selectionDisabled} onPress={() => onToggleSelection(invite.playerId)} style={styles.selectRow}>
            <View style={styles.number}>{selected ? <MaterialIcons name="check-box" size={18} color={palette.accentText} /> : <Text style={styles.numberText}>{playerById.get(invite.playerId)?.shirtNumber || ''}</Text>}</View>
            <View style={styles.player}><Text style={styles.playerName}>{invite.playerName}</Text>{invite.transportNeedsLift || invite.transportCanOfferLift ? <MaterialIcons name="directions-car" size={15} color={invite.transportNeedsLift ? palette.danger : palette.accentText} accessibilityLabel={invite.transportNeedsLift ? 'Needs a lift' : 'Offering a lift'} /> : null}</View>
            <View style={styles.response}><MaterialIcons name={item.icon} size={18} color={item.color} accessible={false} /><Text style={[styles.responseText, { color: item.color }]}>{item.label}</Text></View>
            <View accessibilityLabel={progressLabels(invite)} style={styles.message}>{[progress.sent, progress.delivered, progress.seen].map((active, index) => <MaterialIcons key={index} name={active ? 'check' : 'radio-button-unchecked'} size={17} color={active ? palette.success : palette.textMuted} accessible={false} />)}</View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${invite.playerName} invitation details`} onPress={() => setDetailsId(invite.id)} style={styles.info}><MaterialIcons name="info-outline" size={19} color={palette.textSecondary} /></Pressable>
        </View>
      })}
      {!visible.length ? <Text style={styles.empty}>{invites.length ? 'No players match this filter.' : 'No availability requests have been sent for this fixture.'}</Text> : null}
      <View style={styles.legend}>{['Sent', 'Delivered', 'Seen'].map(label => <View key={label} style={styles.legendItem}><MaterialIcons name="check" size={16} color={palette.success} /><Text style={styles.caption}>{label}</Text></View>)}<View style={styles.legendItem}><MaterialIcons name="radio-button-unchecked" size={15} color={palette.textMuted} /><Text style={styles.caption}>Not yet</Text></View></View>
    </View>
    <Text style={styles.caption}>Tap a player to select them. Tap the info icon for message details.</Text>
    <Modal visible={Boolean(details) || detailsId === 'legend'} transparent animationType="fade" onRequestClose={() => setDetailsId(null)}>
      <View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}><ScrollView>
        <Text accessibilityRole="header" style={styles.detailTitle}>{details?.playerName || 'Message status key'}</Text>
        {details ? <><Text style={styles.detailText}>Response: {response(details).label}</Text>{Object.entries(getCoachInviteDeliveryProgress(details)).map(([key, active]) => <Text key={key} style={styles.detailText}>{key === 'seen' ? 'Seen' : key === 'sent' ? 'Sent' : 'Delivered'}: {active ? 'Yes' : 'Not yet'}</Text>)}{details.lastError ? <Text style={styles.detailText}>Delivery issue: {details.lastError}</Text> : null}{details.note ? <Text style={styles.detailText}>Note: {details.note}</Text> : null}{details.transportNeedsLift ? <Text style={styles.detailText}>Needs a lift</Text> : details.transportCanOfferLift ? <Text style={styles.detailText}>Offering {details.transportSeatsOffered || 1} carpool seats</Text> : null}</> : null}
        <Text style={styles.detailText}>Message icons show Sent, Delivered and Seen, from left to right. An empty circle means that step is not confirmed yet.</Text><Text style={styles.detailText}>Sent and Delivered show provider progress. Seen is confirmed only after a Parent or Player response is recorded. A response entered by staff does not mark it Seen.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close invitation details" onPress={() => setDetailsId(null)} style={styles.close}><Text style={styles.allText}>Close</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </View>
}

function createStyles(p) {
  return StyleSheet.create({
    container: { gap: 8 }, filters: { flexDirection: 'row', flexWrap: 'wrap', borderColor: p.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: p.surface },
    filter: { flex: 1, minWidth: 94, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 10, minHeight: 62, borderWidth: 2, borderColor: 'transparent' }, filterSelected: { borderColor: p.accentText, backgroundColor: p.selected }, filterCopy: { flexShrink: 1 }, count: { color: p.textPrimary, fontSize: 18, fontWeight: '800' }, filterLabel: { color: p.textPrimary, fontSize: 11 },
    toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, allButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 }, allText: { color: p.accentText, fontSize: 13, fontWeight: '800' }, caption: { color: p.textSecondary, fontSize: 11, lineHeight: 16 },
    table: { backgroundColor: p.surface, borderRadius: 10, borderWidth: 1, borderColor: p.border, overflow: 'hidden' }, row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: p.border, paddingLeft: 6 }, header: { backgroundColor: p.surfaceRaised, minHeight: 40 }, selectRow: { flexDirection: 'row', alignItems: 'center', flex: 1, minHeight: 34, paddingVertical: 3 }, selected: { backgroundColor: p.selected },
    number: { width: 22, alignItems: 'center' }, numberText: { color: p.textSecondary, fontSize: 12 }, player: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 4 }, playerName: { color: p.textPrimary, fontSize: 12, lineHeight: 16, flexShrink: 1 }, response: { width: 99, flexDirection: 'row', alignItems: 'center', gap: 4 }, responseText: { fontSize: 11, lineHeight: 15, flexShrink: 1 }, message: { width: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, info: { width: 32, minHeight: 34, justifyContent: 'center', alignItems: 'center' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, padding: 10 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 }, empty: { color: p.textSecondary, padding: 16, fontSize: 13 },
    modalBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 20 }, modalCard: { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: 16, padding: 18, maxHeight: '85%' }, detailTitle: { color: p.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 12 }, detailText: { color: p.textPrimary, fontSize: 14, lineHeight: 21, marginBottom: 10 }, close: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  })
}
