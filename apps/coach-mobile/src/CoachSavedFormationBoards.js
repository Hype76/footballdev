import { useEffect, useRef, useState } from 'react'
import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { deleteCoachFormationBoard, getCoachFormationBoards } from '../../mobile-core/src/coachFormationBoardData'
import { FormationPitchLines, FormationPlayerArtwork, FormationSubArtwork, formationVisualStyles } from '../../mobile-core/src/FormationBoardVisuals'
import { getFormationMarkerVisualPosition } from '../../mobile-core/src/formationVisualCore'
import { canEditCoachFormationBoard, getCoachFormationRouteScope } from './coachFormationEntryCore'
import { CoachFormationWorkspace } from './CoachFormationWorkspace'

function SavedFormationSnapshot({ board }) {
  const [layout, setLayout] = useState({ width: 0, height: 0 })
  const version = board.currentVersion || {}
  return <View style={{ flex: 1, minHeight: 0, marginTop: 44, paddingBottom: 12 }}>
    <Text accessibilityRole="header" style={{ color: 'white', fontSize: 17, fontWeight: '700', padding: 10 }}>{board.title}</Text>
    <View accessibilityLabel="Saved formation snapshot" onLayout={event => setLayout(event.nativeEvent.layout)} style={[formationVisualStyles.pitch, { aspectRatio: undefined, flex: 1, minHeight: 0 }]}>
      <FormationPitchLines styles={formationVisualStyles} />
      {(version.placements || []).map(player => {
        const position = getFormationMarkerVisualPosition(player, layout, { markerWidth: 64, markerHeight: 70, anchorY: 25 })
        return <View key={player.playerId} accessibilityLabel={player.displayName} style={[formationVisualStyles.marker, { left: `${position.x * 100}%`, top: `${position.y * 100}%` }]}>
          <FormationPlayerArtwork name={player.displayName} number={player.shirtNumber} goalkeeper={player.positionGroup === 'goalkeeper' || player.slotId === 'gk'} />
        </View>
      })}
    </View>
    <Text style={{ color: 'white', fontWeight: '700', padding: 10 }}>Subs ({version.bench?.length || 0})</Text>
    <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12, paddingHorizontal: 10 }}>
      {(version.bench || []).map(player => <FormationSubArtwork key={player.playerId} name={player.displayName} number={player.shirtNumber} />)}
    </ScrollView>
  </View>
}

export function CoachSavedFormationBoards({ context, match, palette, user }) {
  const scope = getCoachFormationRouteScope(user, context, match.id)
  const current = useRef({ scope, user, match })
  current.current = { scope, user, match }
  const [result, setResult] = useState({ scope: '', items: [], error: '' })
  const [expanded, setExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [busyId, setBusyId] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    const request = current.current
    setSelectedId('')
    setBusyId('')
    setExpanded(false)
    getCoachFormationBoards(request.user).then(items => {
      if (active) setResult({ scope, items: items.filter(board => board.linkedMatchDayId === request.match.id), error: '' })
    }).catch(error => {
      if (active) setResult({ scope, items: [], error: error.message || 'Saved formations could not be loaded.' })
    })
    return () => { active = false }
  }, [scope, revision])
  const items = result.scope === scope ? result.items : []
  const selected = items.find(board => board.id === selectedId)
  const remove = (board) => {
    const request = current.current
    Alert.alert('Delete saved formation?', `Delete “${board.title}”? Parents and coaches will no longer see this saved board.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (current.current.scope !== request.scope) return
        setBusyId(board.id)
        try {
          await deleteCoachFormationBoard(request.user, board)
          if (current.current.scope === request.scope) setResult(value => ({ ...value, items: value.items.filter(item => item.id !== board.id) }))
        } catch (error) {
          if (current.current.scope === request.scope) setResult(value => ({ ...value, error: error.message }))
        } finally { if (current.current.scope === request.scope) setBusyId('') }
      } },
    ])
  }
  const row = { alignItems: 'center', flexDirection: 'row', minHeight: 48, gap: 10 }
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel="Saved formations" accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)} style={row}>
      <MaterialIcons color={palette.textPrimary} name="grid-view" size={22} />
      <Text style={{ color: palette.textPrimary, flex: 1, fontWeight: '700' }}>Saved formations ({items.length})</Text>
      <MaterialIcons color={palette.textPrimary} name={expanded ? 'expand-less' : 'expand-more'} size={24} />
    </Pressable>
    {expanded ? <View>
      {result.scope !== scope ? <Text style={{ color: palette.textSecondary }}>Loading saved formations...</Text> : null}
      {result.scope === scope && result.error ? <Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)} style={row}><Text style={{ color: palette.textPrimary }}>{result.error} Tap to retry.</Text></Pressable> : null}
      {result.scope === scope && !items.length && !result.error ? <Text style={{ color: palette.textSecondary }}>No formations saved for this match.</Text> : null}
      {items.map(board => <View key={board.id} style={[row, { borderTopColor: palette.border, borderTopWidth: 1 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`View saved formation ${board.title}`} onPress={() => setSelectedId(board.id)} style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}><Text style={{ color: palette.textPrimary }}>{board.title}</Text></Pressable>
        {board.canDelete && canEditCoachFormationBoard(user) ? <Pressable accessibilityRole="button" accessibilityLabel={`Delete saved formation ${board.title}`} disabled={Boolean(busyId)} onPress={() => remove(board)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><MaterialIcons color={palette.textPrimary} name="delete-outline" size={23} /></Pressable> : null}
      </View>)}
    </View> : null}
    {selected ? <CoachFormationWorkspace onBack={() => setSelectedId('')} palette={palette}><SavedFormationSnapshot board={selected} /></CoachFormationWorkspace> : null}
  </View>
}
