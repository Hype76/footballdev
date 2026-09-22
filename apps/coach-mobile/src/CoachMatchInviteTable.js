import { useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { getCoachInviteDeliveryProgress, getCoachInviteStatusLabel } from '../../mobile-core/src/coachPhase31ECore'
import { contrastSafeColor, themeForeground } from '../../mobile-core/src/themeContrast'
import { formatUkDateTime } from '../../../src/lib/date-format.js'

const responseKey = status => ['pending', 'responded', '', undefined].includes(status) ? 'awaiting' : status

export function CoachMatchInviteTable({ invites, players = [], kind = 'match', palette, selectedPlayerIds, selectionDisabled, onToggleSelection, onFilterChange, onLoadHistory }) {
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'player', direction: 1 })
  const [detailsId, setDetailsId] = useState(null)
  const [historyResult, setHistoryResult] = useState(null)
  const [historyRetry, setHistoryRetry] = useState(0)
  const { width } = useWindowDimensions()
  const styles = useMemo(() => createStyles(palette), [palette])
  const mode = themeForeground(palette.background) === '#000000' ? 'light' : 'dark'
  const awaitingColor = contrastSafeColor('#38a3ff', [palette.surface, palette.surfaceRaised, palette.selected], mode, 4.5)
  const responses = {
    available: { label: kind === 'training' ? 'Attending' : 'Available', icon: 'check-circle', color: palette.success },
    awaiting: { label: 'Awaiting', icon: 'schedule', color: awaitingColor },
    unavailable: { label: kind === 'training' ? 'Not attending' : 'Unavailable', icon: 'cancel', color: palette.danger },
    maybe: { label: 'Maybe', icon: 'help-outline', color: palette.warning },
  }
  const response = invite => responses[responseKey(invite.status)] || { label: getCoachInviteStatusLabel(invite.status, kind), icon: 'info-outline', color: palette.textSecondary }
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
  const historyKey = `${detailsId}:${historyRetry}`
  const history = historyResult?.key === historyKey ? historyResult.data : null
  const historyError = historyResult?.key === historyKey ? historyResult.error : ''
  useEffect(() => {
    let current = true
    if (details && onLoadHistory) Promise.resolve(onLoadHistory(details))
      .then(value => { if (current) setHistoryResult({ key: historyKey, data: value }) })
      .catch(() => { if (current) setHistoryResult({ key: historyKey, error: 'Invite history could not be loaded.' }) })
    return () => { current = false }
  }, [details, onLoadHistory, historyKey])
  const selectFilter = key => { setFilter(filter === key ? 'all' : key); onFilterChange?.() }
  const changeSort = key => setSort(current => ({ key, direction: current.key === key ? -current.direction : 1 }))
  const sortIcon = key => sort.key === key ? sort.direction === 1 ? 'arrow-drop-up' : 'arrow-drop-down' : 'unfold-more'
  const progressLabels = invite => { const p = getCoachInviteDeliveryProgress(invite); return `Sent ${p.sent ? 'yes' : 'no'}, seen ${p.seen ? 'yes' : 'no'}` }
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
    {filter !== 'all' ? <View style={styles.toolbar}><Pressable accessibilityRole="button" accessibilityState={{ selected: filter === 'all' }} onPress={() => { setFilter('all'); onFilterChange?.() }} style={styles.allButton}><Text style={styles.allText}>All {invites.length}</Text></Pressable><Text accessibilityLiveRegion="polite" style={styles.caption}>Showing {visible.length} of {invites.length}</Text></View> : null}
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
            <View accessibilityLabel={progressLabels(invite)} style={styles.message}>{[progress.sent, progress.seen].map((active, index) => <MaterialIcons key={index} name={active ? 'check' : 'radio-button-unchecked'} size={17} color={active ? palette.success : palette.textMuted} accessible={false} />)}</View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${invite.playerName} invitation details`} onPress={() => setDetailsId(invite.id)} style={styles.info}><MaterialIcons name="info-outline" size={19} color={palette.textSecondary} /></Pressable>
        </View>
      })}
      {!visible.length ? <Text style={styles.empty}>{invites.length ? 'No players match this filter.' : `No availability requests have been sent for this ${kind === 'training' ? 'session' : 'fixture'}.`}</Text> : null}
      <View style={styles.legend}>{['Sent', 'Seen'].map(label => <View key={label} style={styles.legendItem}><MaterialIcons name="check" size={16} color={palette.success} /><Text style={styles.caption}>{label}</Text></View>)}<View style={styles.legendItem}><MaterialIcons name="radio-button-unchecked" size={15} color={palette.textMuted} /><Text style={styles.caption}>Not yet</Text></View></View>
    </View>
    <Modal visible={Boolean(details) || detailsId === 'legend'} transparent animationType="fade" onRequestClose={() => setDetailsId(null)}>
      <View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}><ScrollView>
        <Text accessibilityRole="header" style={styles.detailTitle}>{details?.playerName || 'Message status key'}</Text>
        {details && onLoadHistory ? <View>
          <Text style={styles.detailTitle}>Invite history</Text>
          {history ? <>
            <Text style={styles.detailText}>Sent: {history.firstEmailSentAt ? formatUkDateTime(history.firstEmailSentAt) : history.emailSends ? 'Date unavailable' : 'Not confirmed'}</Text>
            {[...history.recentResendRequests].reverse().map((item, index) => <Text key={`reminder:${index}`} style={styles.detailText}>Reminder {Math.max(0, history.resendRequests - history.recentResendRequests.length) + index + 1}: {formatUkDateTime(item.at)}{item.failed && !item.queued ? ' (failed)' : ' (requested)'}</Text>)}
            {!history.resendRequests ? <Text style={styles.detailText}>Reminders: None</Text> : null}

          </> : <Text accessibilityLiveRegion="polite" style={styles.detailText}>{historyError || 'Loading send history...'}</Text>}
          {historyError ? <Pressable accessibilityRole="button" onPress={() => setHistoryRetry(value => value + 1)} style={styles.close}><Text style={styles.allText}>Retry invite history</Text></Pressable> : null}
        </View> : null}
        {details ? <><Text style={styles.detailText}>Response: {response(details).label}</Text>{details.lastError ? <Text style={styles.detailText}>Delivery issue: {details.lastError}</Text> : null}{details.note ? <Text style={styles.detailText}>Note: {details.note}</Text> : null}{details.transportNeedsLift ? <Text style={styles.detailText}>Needs a lift</Text> : details.transportCanOfferLift ? <Text style={styles.detailText}>Offering a lift</Text> : null}</> : null}
        {detailsId === 'legend' ? <><Text style={styles.detailText}>Sent: The message was sent.</Text><Text style={styles.detailText}>Seen: A parent or player has replied.</Text><Text style={styles.detailText}>An empty circle means we do not have confirmation.</Text></> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Close invitation details" onPress={() => setDetailsId(null)} style={styles.close}><Text style={styles.allText}>Close</Text></Pressable>
      </ScrollView></View></View>
    </Modal>
  </View>
}

function createStyles(p) {
  return StyleSheet.create({
    container: { gap: 8 }, filters: { flexDirection: 'row', flexWrap: 'wrap', borderColor: p.border, borderWidth: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: p.surface },
    filter: { flex: 1, minWidth: 94, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 6, paddingVertical: 6, minHeight: 46, borderWidth: 2, borderColor: 'transparent' }, filterSelected: { borderColor: p.accentText, backgroundColor: p.selected }, filterCopy: { flexShrink: 1 }, count: { color: p.textPrimary, fontSize: 18, fontWeight: '800' }, filterLabel: { color: p.textPrimary, fontSize: 11 },
    toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, allButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10 }, allText: { color: p.accentText, fontSize: 13, fontWeight: '800' }, caption: { color: p.textSecondary, fontSize: 11, lineHeight: 16 },
    table: { backgroundColor: p.surface, borderRadius: 7, overflow: 'hidden' }, row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: p.border, paddingLeft: 6 }, header: { backgroundColor: p.surfaceRaised, minHeight: 28 }, selectRow: { flexDirection: 'row', alignItems: 'center', flex: 1, minHeight: 26, paddingVertical: 2 }, selected: { backgroundColor: p.selected },
    number: { width: 38, alignItems: 'flex-start', paddingLeft: 6 }, numberText: { color: p.textSecondary, fontSize: 12 }, player: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 4 }, playerName: { color: p.textPrimary, fontSize: 11, lineHeight: 15, flexShrink: 1 }, response: { width: 98, flexDirection: 'row', alignItems: 'center', gap: 4 }, responseText: { fontSize: 11, lineHeight: 15, flexShrink: 1 }, message: { width: 55, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, info: { width: 27, minHeight: 26, justifyContent: 'center', alignItems: 'center' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 16, paddingHorizontal: 10 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 3 }, empty: { color: p.textSecondary, padding: 16, fontSize: 13 },
    modalBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 20 }, modalCard: { backgroundColor: p.surface, padding: 18, maxHeight: '85%' }, detailTitle: { color: p.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 12 }, detailText: { color: p.textPrimary, fontSize: 14, lineHeight: 21, marginBottom: 10 }, close: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  })
}
