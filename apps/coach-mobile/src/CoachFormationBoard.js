import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import AsyncStorage from '@react-native-async-storage/async-storage'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  applyMobileFormationPreset,
  assignMobileFormationPlayerToSlot,
  createMobileFormationDraft,
  createMobileFormationPreferenceKey,
  getMobileFormationCapacity,
  getMobileAvailableFormationPlayers,
  getMobileFormationPitchPercent,
  getMobileFormationPitchRatio,
  getMobileFormationPlayerAvailability,
  getMobileFormationPresetSlots,
  getMobileFormationSelectedPlayerIds,
  getMobileFormationSlotLabel,
  getMobileFormationSlotShortLabel,
  MOBILE_FORMATION_GAME_FORMATS,
  moveMobileFormationPlayer,
  moveMobileFormationPlayersToBench,
  parseMobileFormationPreferences,
  placeMobileFormationLineup,
  placeMobileFormationPlayerInNextSlot,
  serializeMobileFormationPreferences,
  setMobileFormationSquad,
  swapMobileFormationPlayers,
  toggleMobileFormationSquadPlayer,
} from '../../mobile-core/src/coachFormationBoardCore'
import {
  createCoachFormationBoard,
  getCoachFormationBoards,
  getCoachFormationPresets,
  getCoachFormationPublications,
  getCoachFormationResourcePublications,
  linkCoachFormationBoard,
  publishCoachFormationBoard,
  publishCoachFormationResource,
  saveCoachFormationBoard,
  withdrawCoachFormationBoard,
} from '../../mobile-core/src/coachFormationBoardData'
import { readCoachOfflineResources, saveCoachFormationLocalDraft, saveCoachOfflineResources } from './offline'
import { findFormationLocalDraft, formationContentKey, formationDraftKey, formationMatchesBoard, getActiveFormationPublication, getFormationSaveLabel } from '../../mobile-core/src/coachFormationDraftCore'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { canEditCoachFormationBoard, getCoachFormationMarkerVisualPosition, getCoachFormationRouteScope } from './coachFormationEntryCore'
import { getMobileIconName } from '../../mobile-core/src/mobileIconSystem'

const normalize = (value) => String(value ?? '').trim()
const RESOURCE_CATEGORIES = Object.freeze([
  Object.freeze({ label: 'General', value: 'general' }),
  Object.freeze({ label: 'Training', value: 'training' }),
  Object.freeze({ label: 'Match day', value: 'match_day' }),
  Object.freeze({ label: 'Development', value: 'development' }),
  Object.freeze({ label: 'Admin', value: 'admin' }),
])
const WHITE_SHIRT = require('../../mobile-core/assets/formation-shirt-white.png')
const GOLD_SHIRT = require('../../mobile-core/assets/formation-shirt-gold.png')
const BOARD_TABS = Object.freeze([
  Object.freeze({ icon: 'grid-view', label: 'Formation', value: 'formation' }),
  Object.freeze({ icon: 'groups', label: 'Players', value: 'players' }),
  Object.freeze({ icon: 'ios-share', label: 'Share', value: 'share' }),
])

function createStyles(palette) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, minWidth: 132, paddingHorizontal: 14, paddingVertical: 11 },
    actionDanger: { backgroundColor: palette.surfaceRaised },
    actionDisabled: { opacity: 0.45 },
    actionSecondary: { backgroundColor: palette.surfaceRaised },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    actionTextDanger: { color: palette.danger },
    actionTextSecondary: { color: palette.textPrimary },
    bench: { borderBottomColor: palette.border, borderBottomWidth: 1, borderTopColor: palette.border, borderTopWidth: 1, paddingBottom: 4 },
    benchContent: { gap: 18, paddingHorizontal: 4, paddingTop: 2 },
    benchHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 44 },
    benchPlayer: { alignItems: 'center', minWidth: 74 },
    benchPlayerButton: { borderBottomColor: 'transparent', borderBottomWidth: 3, paddingBottom: 2 },
    benchPlayerButtonSelected: { borderBottomColor: palette.accentText },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    card: { borderTopColor: palette.border, borderTopWidth: 1, gap: 11, paddingVertical: 14 },
    chip: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderRadius: 999, flexDirection: 'row', gap: 6, minHeight: 44, paddingHorizontal: 13, paddingVertical: 10 },
    chipSelected: { backgroundColor: palette.selected },
    chipText: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    chipTextSelected: { color: palette.textPrimary },
    count: { color: palette.accentText, fontSize: 13, fontWeight: '900' },
    dock: { borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingTop: 9 },
    dockItem: { alignItems: 'center', borderRadius: 18, flex: 1, gap: 4, justifyContent: 'center', minHeight: 68, paddingHorizontal: 8, paddingVertical: 8 },
    dockItemActive: { backgroundColor: palette.selected },
    dockItemDisabled: { opacity: 0.48 },
    dockItemShare: { backgroundColor: 'rgb(11,67,36)' },
    dockLabel: { color: palette.textSecondary, fontSize: 13, fontWeight: '700' },
    dockLabelActive: { color: palette.selectedForeground },
    dockLabelShare: { color: 'rgb(104,242,162)' },
    eyebrow: { color: palette.accentText, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
    heading: { color: palette.textPrimary, fontSize: 20, fontWeight: '900' },
    input: { backgroundColor: palette.surfaceRaised, borderBottomColor: palette.border, borderBottomWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 50, paddingHorizontal: 4, paddingVertical: 10 },
    label: { color: palette.textPrimary, fontSize: 14, fontWeight: '900' },
    modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'flex-end' },
    modalPanel: { backgroundColor: palette.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 12, maxHeight: '88%', padding: 16, paddingBottom: 24 },
    modalPlayer: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingVertical: 10 },
    emptySlot: { alignItems: 'center', backgroundColor: 'rgba(4,45,25,0.7)', borderColor: 'rgba(255,255,255,0.9)', borderRadius: 25, borderStyle: 'dashed', borderWidth: 2, height: 46, justifyContent: 'center', position: 'absolute', transform: [{ translateX: -23 }, { translateY: -23 }], width: 46, zIndex: 4 },
    emptySlotLabel: { backgroundColor: 'rgba(16,24,40,0.9)', borderRadius: 7, color: 'rgb(255,255,255)', fontSize: 9, fontWeight: '900', left: -2, paddingHorizontal: 3, paddingVertical: 2, position: 'absolute', textAlign: 'center', top: 46, width: 48 },
    marker: { alignItems: 'center', height: 86, justifyContent: 'flex-start', position: 'absolute', transform: [{ translateX: -39 }, { translateY: -33 }], width: 78, zIndex: 10 },
    markerDragging: { opacity: 0.78, transform: [{ translateX: -39 }, { translateY: -33 }, { scale: 1.08 }] },
    markerImage: { height: 60, resizeMode: 'contain', width: 68 },
    markerName: { backgroundColor: 'rgba(3,35,20,0.94)', borderRadius: 6, color: 'rgb(255,255,255)', fontSize: 12, fontWeight: '700', lineHeight: 15, marginTop: -6, maxWidth: 78, paddingHorizontal: 5, paddingVertical: 2, textAlign: 'center' },
    markerNumber: { color: 'rgb(5,62,34)', fontSize: 16, fontWeight: '900', left: 0, position: 'absolute', right: 0, textAlign: 'center', top: 21 },
    markerNumberGoalkeeper: { color: 'rgb(34,24,4)' },
    markerSelection: { borderColor: palette.accentText, borderRadius: 31, borderWidth: 3, height: 63, position: 'absolute', top: -2, width: 70 },
    pitch: { aspectRatio: 0.69, backgroundColor: 'rgb(10,108,47)', borderColor: 'rgb(255,255,255)', borderRadius: 18, borderWidth: 3, overflow: 'hidden', position: 'relative', width: '100%' },
    pitchArc: { borderColor: 'rgba(255,255,255,0.9)', borderRadius: 35, borderWidth: 2, height: 70, position: 'absolute', width: 70 },
    pitchArcBottom: { bottom: -35 },
    pitchArcTop: { top: -35 },
    pitchArcWindow: { height: 35, left: '50%', overflow: 'hidden', position: 'absolute', transform: [{ translateX: -35 }], width: 70 },
    pitchArcWindowBottom: { bottom: '14%' },
    pitchArcWindowTop: { top: '14%' },
    pitchBoxBottom: { borderBottomWidth: 0, bottom: 0 },
    pitchBoxLarge: { borderColor: 'rgba(255,255,255,0.82)', borderWidth: 2, height: '14%', left: '24%', position: 'absolute', width: '52%' },
    pitchBoxSmall: { borderColor: 'rgba(255,255,255,0.82)', borderWidth: 2, height: '6%', left: '38%', position: 'absolute', width: '24%' },
    pitchBoxTop: { borderTopWidth: 0, top: 0 },
    pitchCentreCircle: { borderColor: 'rgba(255,255,255,0.82)', borderRadius: 43, borderWidth: 2, height: 86, left: '50%', position: 'absolute', top: '50%', transform: [{ translateX: -43 }, { translateY: -43 }], width: 86 },
    pitchCentreSpot: { backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: 5, height: 10, left: '50%', position: 'absolute', top: '50%', transform: [{ translateX: -5 }, { translateY: -5 }], width: 10 },
    pitchCorner: { borderColor: 'rgba(255,255,255,0.9)', borderRadius: 14, borderWidth: 2, height: 28, position: 'absolute', width: 28 },
    pitchCornerBottom: { bottom: -14 },
    pitchCornerLeft: { left: -14 },
    pitchCornerRight: { right: -14 },
    pitchCornerTop: { top: -14 },
    pitchHalfway: { backgroundColor: 'rgba(255,255,255,0.82)', height: 2, left: 0, position: 'absolute', right: 0, top: '50%' },
    pitchPenaltySpot: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 4, height: 8, left: '50%', position: 'absolute', transform: [{ translateX: -4 }], width: 8 },
    pitchPenaltySpotBottom: { bottom: '9%' },
    pitchPenaltySpotTop: { top: '9%' },
    pitchStripe: { height: '12.5%', left: 0, position: 'absolute', right: 0 },
    planHeader: { alignItems: 'center', gap: 2, paddingBottom: 2 },
    planHeaderRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
    planTitle: { color: palette.textPrimary, flex: 1, fontSize: 20, fontWeight: '700', paddingHorizontal: 8, textAlign: 'center' },
    statusRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
    statusDot: { color: palette.textSecondary, fontSize: 13 },
    statusMuted: { color: palette.textSecondary, fontSize: 13, fontWeight: '700' },
    topIcon: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
    row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    rowBetween: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    savedBoard: { borderBottomColor: palette.border, borderBottomWidth: 1, gap: 4, minHeight: 56, paddingVertical: 12 },
    selectedPanel: { borderLeftColor: palette.accentText, borderLeftWidth: 2, gap: 8, paddingLeft: 12, paddingVertical: 8 },
    sheetHandle: { alignSelf: 'center', backgroundColor: palette.border, borderRadius: 3, height: 5, marginBottom: 2, width: 48 },
    stack: { gap: 12 },
    shirtSmall: { height: 54, resizeMode: 'contain', width: 60 },
    shirtSmallName: { backgroundColor: palette.surfaceRaised, borderRadius: 6, color: palette.textPrimary, fontSize: 12, fontWeight: '700', lineHeight: 15, marginTop: -8, maxWidth: 78, paddingHorizontal: 6, paddingVertical: 2, textAlign: 'center' },
    shirtSmallNumber: { color: 'rgb(5,62,34)', fontSize: 15, fontWeight: '900', left: 0, position: 'absolute', right: 0, textAlign: 'center', top: 18 },
    shirtWrap: { alignItems: 'center', height: 54, width: 60 },
    statusText: { color: palette.accentText, fontSize: 12, fontWeight: '700' },
    warning: { borderLeftColor: palette.warning, borderLeftWidth: 2, gap: 8, paddingLeft: 12, paddingVertical: 8 },
    workspace: { gap: 8 },
  })
}

function Action({ danger = false, disabled = false, iconKey = '', label, onPress, secondary = false, styles }) {
  const contentStyle = [styles.actionText, secondary && styles.actionTextSecondary, danger && styles.actionTextDanger]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && styles.actionDisabled, pressed && { opacity: 0.78 }]}
    >
      {iconKey ? <MaterialIcons name={getMobileIconName(iconKey)} size={20} style={contentStyle} /> : null}
      <Text style={contentStyle}>{label}</Text>
    </Pressable>
  )
}

function Choice({ disabled = false, iconKey = '', label, onPress, selected, styles }) {
  const contentStyle = [styles.chipText, selected && styles.chipTextSelected]
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[styles.chip, selected && styles.chipSelected, disabled && styles.actionDisabled]}>{iconKey ? <MaterialIcons name={getMobileIconName(iconKey)} size={19} style={contentStyle} /> : null}<Text style={contentStyle}>{label}</Text></Pressable>
}

function PitchLines({ styles }) {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => <View key={index} style={[styles.pitchStripe, { backgroundColor: index % 2 ? 'rgba(255,255,255,0.055)' : 'rgba(0,0,0,0.075)', top: `${index * 12.5}%` }]} />)}
      <View style={styles.pitchHalfway} />
      <View style={styles.pitchCentreCircle} />
      <View style={styles.pitchCentreSpot} />
      <View style={[styles.pitchBoxLarge, styles.pitchBoxTop]} />
      <View style={[styles.pitchBoxLarge, styles.pitchBoxBottom]} />
      <View style={[styles.pitchBoxSmall, styles.pitchBoxTop]} />
      <View style={[styles.pitchBoxSmall, styles.pitchBoxBottom]} />
      <View style={[styles.pitchArcWindow, styles.pitchArcWindowTop]}><View style={[styles.pitchArc, styles.pitchArcTop]} /></View>
      <View style={[styles.pitchArcWindow, styles.pitchArcWindowBottom]}><View style={[styles.pitchArc, styles.pitchArcBottom]} /></View>
      <View style={[styles.pitchPenaltySpot, styles.pitchPenaltySpotTop]} />
      <View style={[styles.pitchPenaltySpot, styles.pitchPenaltySpotBottom]} />
      <View style={[styles.pitchCorner, styles.pitchCornerLeft, styles.pitchCornerTop]} />
      <View style={[styles.pitchCorner, styles.pitchCornerRight, styles.pitchCornerTop]} />
      <View style={[styles.pitchCorner, styles.pitchCornerLeft, styles.pitchCornerBottom]} />
      <View style={[styles.pitchCorner, styles.pitchCornerRight, styles.pitchCornerBottom]} />
    </>
  )
}

class FormationPlayerMarker extends Component {
  state = { dragging: false, livePosition: null }
  gestureActive = false

  clamp = (value) => Math.max(0.04, Math.min(0.96, value))

  beginGesture = () => {
    if (this.gestureActive) return
    this.gestureActive = true
    this.props.onGestureStart?.()
  }

  endGesture = () => {
    if (!this.gestureActive) return
    this.gestureActive = false
    this.props.onGestureEnd?.()
  }

  componentWillUnmount() {
    this.endGesture()
  }

  panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => this.props.canEdit,
    onMoveShouldSetPanResponder: (_, gesture) => this.props.canMove && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
    onPanResponderGrant: this.beginGesture,
    onPanResponderMove: (_, gesture) => {
      const { canMove, layout, player } = this.props
      if (!canMove || !layout.width || !layout.height) return
      if (Math.abs(gesture.dx) <= 4 && Math.abs(gesture.dy) <= 4) return
      const playerX = getMobileFormationPitchRatio(player.x)
      const playerY = getMobileFormationPitchRatio(player.y)
      this.setState({
        dragging: true,
        livePosition: {
          x: this.clamp(playerX + (gesture.dx / layout.width)),
          y: this.clamp(playerY + (gesture.dy / layout.height)),
        },
      })
    },
    onPanResponderRelease: (_, gesture) => {
      const { canEdit, canMove, layout, onMove, onPress, player } = this.props
      const playerX = getMobileFormationPitchRatio(player.x)
      const playerY = getMobileFormationPitchRatio(player.y)
      const moved = canMove && layout.width && layout.height && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4)
      if (moved) onMove({
        x: this.clamp(playerX + (gesture.dx / layout.width)),
        y: this.clamp(playerY + (gesture.dy / layout.height)),
      })
      else if (canEdit) onPress()
      this.endGesture()
      this.setState({ dragging: false, livePosition: null })
    },
    onPanResponderTerminate: () => {
      this.endGesture()
      this.setState({ dragging: false, livePosition: null })
    },
    onPanResponderTerminationRequest: () => false,
  })

  render() {
    const { canEdit, canMove, layout, player, removal, selected, styles } = this.props
    const playerX = getMobileFormationPitchRatio(player.x)
    const playerY = getMobileFormationPitchRatio(player.y)
    const position = this.state.livePosition || { x: playerX, y: playerY }
    const visualPosition = getCoachFormationMarkerVisualPosition(position, layout)
    const goalkeeper = player.positionGroup === 'goalkeeper' || player.slotId === 'gk'
    return (
      <View
        {...this.panResponder.panHandlers}
        accessibilityHint={canEdit ? canMove ? 'Tap to change this Player. Drag to move the Player freely around the pitch.' : 'Tap to select this Player.' : 'This player position is read-only.'}
        accessibilityLabel={`${player.displayName}${player.shirtNumber ? `, shirt ${player.shirtNumber}` : ''}`}
        accessibilityRole={canEdit ? 'button' : 'image'}
        accessibilityState={{ disabled: !canEdit, selected: Boolean(selected || removal) }}
        style={[styles.marker, this.state.dragging && styles.markerDragging, { left: `${visualPosition.x * 100}%`, top: `${visualPosition.y * 100}%` }]}
      >
        <Image accessibilityIgnoresInvertColors source={goalkeeper ? GOLD_SHIRT : WHITE_SHIRT} style={styles.markerImage} />
        {player.shirtNumber ? <Text style={[styles.markerNumber, goalkeeper && styles.markerNumberGoalkeeper]}>{player.shirtNumber}</Text> : null}
        {selected || removal ? <View pointerEvents="none" style={styles.markerSelection} /> : null}
        <Text numberOfLines={1} style={styles.markerName}>{player.displayName}</Text>
      </View>
    )
  }
}

function ShirtPlayer({ goalkeeper = false, name, number, styles }) {
  return <View style={styles.benchPlayer}>
    <View style={styles.shirtWrap}>
      <Image accessibilityIgnoresInvertColors source={goalkeeper ? GOLD_SHIRT : WHITE_SHIRT} style={styles.shirtSmall} />
      {number ? <Text style={styles.shirtSmallNumber}>{number}</Text> : null}
    </View>
    <Text numberOfLines={1} style={styles.shirtSmallName}>{name}</Text>
  </View>
}

function publicationResourceId(publication) {
  return normalize(publication?.resource_id ?? publication?.resourceId)
}

export function CoachFormationBoard({ context, match = null, matches = [], onBack, onMarkerGestureEnd, onMarkerGestureStart, palette, players, registerBackHandler, stale, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [board, setBoard] = useState(null)
  const [boards, setBoards] = useState([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraftState] = useState(() => createMobileFormationDraft())
  const [error, setError] = useState('')
  const [errorRetry, setErrorRetry] = useState('load')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [offline, setOffline] = useState(false)
  const [refreshPending, setRefreshPending] = useState(false)
  const [presets, setPresets] = useState([])
  const [matchPublications, setMatchPublications] = useState([])
  const [pitchLayout, setPitchLayout] = useState({ height: 475, width: 320 })
  const [resourcePublications, setResourcePublications] = useState([])
  const [serverBoardUnavailable, setServerBoardUnavailable] = useState(false)
  const [removalMode, setRemovalMode] = useState(false)
  const [removalIds, setRemovalIds] = useState([])
  const [resourceCategory, setResourceCategory] = useState('general')
  const [selectedMatchId, setSelectedMatchId] = useState(match?.id || '')
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [activeSlotId, setActiveSlotId] = useState('')
  const [slotSearch, setSlotSearch] = useState('')
  const [showBoards, setShowBoards] = useState(false)
  const [showMatchPicker, setShowMatchPicker] = useState(false)
  const [title, setTitleState] = useState(match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board')
  const [activeSheet, setActiveSheet] = useState('')
  const [benchExpanded, setBenchExpanded] = useState(true)
  const [savedContentKey, setSavedContentKey] = useState('')
  const [draftScope, setDraftScope] = useState('')
  const routeScope = getCoachFormationRouteScope(user, context, match?.id)
  const [localState, setLocalState] = useState('idle')
  const [restoredDraftKey, setRestoredDraftKey] = useState('')
  const draftWriteSequence = useRef(0)
  const editorRevision = useRef(0)
  const loadSequence = useRef(0)
  const propsRef = useRef({ context, match, user })
  useEffect(() => {
    propsRef.current = { context, match, user }
  }, [context, match, user])
  const setDraft = useCallback((value) => {
    ++editorRevision.current
    setDraftState(value)
  }, [])
  const setTitle = useCallback((value) => {
    ++editorRevision.current
    setTitleState(value)
  }, [])
  const preferenceKey = useMemo(() => createMobileFormationPreferenceKey({ clubId: context.clubId, teamId: context.teamId, userId: user.id }), [context.clubId, context.teamId, user.id])

  const resolvePublications = useCallback(async (nextBoard, actingUser) => {
    if (!nextBoard?.id) return { matchItems: [], resourceItems: [] }
    const [matchItems, resourceItems] = await Promise.all([
      getCoachFormationPublications(actingUser, nextBoard.id),
      getCoachFormationResourcePublications(actingUser, nextBoard.id),
    ])
    return { matchItems, resourceItems }
  }, [])

  const applyBoard = useCallback(async (nextBoard, nextPresets = presets) => {
    const { context: currentContext, user: currentUser } = propsRef.current
    const request = ++loadSequence.current
    const saved = await readCoachOfflineResources(currentUser.id, currentContext).catch(() => null)
    if (request !== loadSequence.current) return
    const localEntry = findFormationLocalDraft(saved?.resources?.formation, '', nextBoard.id)
    const local = localEntry?.[1]
    const nextDraft = local?.draft || createMobileFormationDraft({ board: nextBoard })
    const baseBoard = local?.board || nextBoard
    const nextPublications = await resolvePublications(nextBoard, currentUser)
    if (request !== loadSequence.current) return
    setBoard(baseBoard)
    setDraft(nextDraft)
    setTitle(local?.title || nextBoard?.title || 'Formation Board')
    setSavedContentKey(formationContentKey(createMobileFormationDraft({ board: baseBoard }), baseBoard.title))
    setRestoredDraftKey(localEntry?.[0] || '')
    setLocalState(local ? 'saved' : 'idle')
    setSelectedMatchId(nextBoard?.linkedMatchDayId || '')
    setMatchPublications(nextPublications.matchItems)
    setResourcePublications(nextPublications.resourceItems)
    setPresets(nextPresets)
    setSelectedPlayerId('')
    setShowBoards(false)
    setActiveSheet('')
    setOffline(false)
    setRefreshPending(false)
    setServerBoardUnavailable(false)
    setNotice(local ? 'Your unsent changes are restored. Review them before saving to the team.' : '')
  }, [presets, resolvePublications, setDraft, setTitle])

  const load = useCallback(async () => {
    const { context: currentContext, match: currentMatch, user: currentUser } = propsRef.current
    const request = ++loadSequence.current
    const isCurrent = () => request === loadSequence.current
    let refreshRevision = editorRevision.current
    let showedCachedBoard = false
    setLoading(true)
    setDraftScope(routeScope)
    setTitle(currentMatch?.id ? `${currentMatch.teamName} v ${currentMatch.opponent}` : 'Formation Board')
    setBoards([])
    setPresets([])
    setSelectedMatchId(currentMatch?.id || '')
    setSelectedPlayerId('')
    setActiveSlotId('')
    setShowBoards(false)
    setNotice('')
    setRefreshPending(false)
    setServerBoardUnavailable(false)
    setBoard(null)
    setDraft(createMobileFormationDraft())
    setSavedContentKey('')
    setMatchPublications([])
    setResourcePublications([])
    setError('')
    const [savedPreference, savedOffline] = await Promise.all([
      AsyncStorage.getItem(preferenceKey).catch(() => null),
      readCoachOfflineResources(currentUser.id, currentContext).catch(() => null),
    ])
    if (!isCurrent()) return
    const savedFormation = savedOffline?.resources?.formation
    const localEntry = findFormationLocalDraft(savedFormation, currentMatch?.id || '')
    const localDraft = localEntry?.[1]
    const cacheMatchesRoute = String(savedFormation?.matchDayId || '') === String(currentMatch?.id || '')
    const pendingSave = localDraft?.pendingSave || (cacheMatchesRoute ? savedFormation?.pendingSave : null)
    const restored = localDraft || (pendingSave ? { ...savedFormation, draft: pendingSave.draft, title: pendingSave.title } : null)
    if (restored?.draft || (cacheMatchesRoute && savedFormation?.draft)) {
      const cachedBoard = restored ? restored.board || null : savedFormation.board || null
      const cachedDraft = restored?.draft || savedFormation.draft
      const cachedTitle = restored?.title || cachedBoard?.title || 'Formation Board'
      setDraftScope(routeScope)
      setBoard(cachedBoard)
      setBoards(Array.isArray(savedFormation.boards) ? savedFormation.boards : [])
      setDraft(cachedDraft)
      setSavedContentKey(cachedBoard ? formationContentKey(createMobileFormationDraft({ board: cachedBoard }), cachedBoard.title) : formationContentKey(createMobileFormationDraft({ gameFormat: cachedDraft.gameFormat, presetKey: cachedDraft.presetKey }), currentMatch?.id ? `${currentMatch.teamName} v ${currentMatch.opponent}` : 'Formation Board'))
      setRestoredDraftKey(localEntry?.[0] || '')
      setLocalState(restored ? 'saved' : 'idle')
      setPresets(Array.isArray(savedFormation.presets) ? savedFormation.presets : [])
      setMatchPublications(Array.isArray(savedFormation.matchPublications) ? savedFormation.matchPublications : [])
      setResourcePublications(Array.isArray(savedFormation.resourcePublications) ? savedFormation.resourcePublications : [])
      setSelectedMatchId(savedFormation.board?.linkedMatchDayId || '')
      setTitle(cachedTitle)
      setActiveSheet('')
      setOffline(true)
      setRefreshPending(true)
      showedCachedBoard = true
      refreshRevision = editorRevision.current
      setLoading(false)
    }
    try {
      const [nextPresets, nextBoards] = await Promise.all([
        getCoachFormationPresets(currentUser),
        getCoachFormationBoards(currentUser),
      ])
      if (!isCurrent()) return
      const preference = parseMobileFormationPreferences(savedPreference) || { gameFormat: '11v11', presetKey: '11v11-4-4-2' }
      const matchingPreset = nextPresets.find((preset) => preset.key === preference.presetKey)
        || nextPresets.find((preset) => preset.key === '11v11-4-4-2')
        || nextPresets.find((preset) => preset.gameFormat === '11v11')
        || nextPresets[0]
      const cachedBoardId = normalize(savedFormation?.board?.id)
      const refreshedCachedBoard = cachedBoardId ? nextBoards.find((candidate) => candidate.id === cachedBoardId) || null : null
      const linkedBoard = currentMatch?.id ? nextBoards.find((candidate) => candidate.linkedMatchDayId === currentMatch.id) || null : refreshedCachedBoard
      const pendingThreshold = pendingSave?.startedAt ? new Date(pendingSave.startedAt).getTime() - (2 * 60 * 1000) : 0
      const attemptedDraft = pendingSave || (restored?.board ? { boardId: restored.board.id, draft: restored.draft, title: restored.title } : null)
      const attemptedCreatorId = normalize(attemptedDraft?.createdByProfileId) || currentUser.id
      const recoveredBoard = attemptedDraft ? nextBoards.find((candidate) => (
        (attemptedDraft.boardId ? candidate.id === attemptedDraft.boardId : candidate.createdByProfileId === attemptedCreatorId && new Date(candidate.createdAt || 0).getTime() >= pendingThreshold)
        && formationMatchesBoard(attemptedDraft.draft, attemptedDraft.title, candidate)
      )) || null : null
      // Keep the restored base version so a concurrent coach edit still conflicts.
      const nextBoard = recoveredBoard || (restored ? restored.board || null : linkedBoard)
      const nextDraft = restored?.draft || pendingSave?.draft
        || createMobileFormationDraft({ board: nextBoard, gameFormat: matchingPreset?.gameFormat || preference.gameFormat, presetKey: matchingPreset?.key || preference.presetKey })
      const nextPublications = await resolvePublications(nextBoard, currentUser)
      if (!isCurrent()) return
      const unresolvedPendingSave = pendingSave && !recoveredBoard ? pendingSave : null
      const editorChangedDuringRefresh = showedCachedBoard && editorRevision.current !== refreshRevision
      const cachedBoardUnavailable = showedCachedBoard && cachedBoardId && !restored && !refreshedCachedBoard
      setDraftScope(routeScope)
      setBoards(nextBoards)
      setPresets(nextPresets)
      setMatchPublications(nextPublications.matchItems)
      setResourcePublications(nextPublications.resourceItems)
      if (!editorChangedDuringRefresh) {
        setBoard(nextBoard)
        setDraft(nextDraft)
        const nextTitle = restored?.title || pendingSave?.title || nextBoard?.title || (currentMatch?.id ? `${currentMatch.teamName} v ${currentMatch.opponent}` : 'Formation Board')
        setSavedContentKey(nextBoard ? formationContentKey(createMobileFormationDraft({ board: nextBoard }), nextBoard.title) : formationContentKey(createMobileFormationDraft({ gameFormat: nextDraft.gameFormat, presetKey: nextDraft.presetKey }), currentMatch?.id ? `${currentMatch.teamName} v ${currentMatch.opponent}` : 'Formation Board'))
        setRestoredDraftKey(localEntry?.[0] || '')
        setLocalState(restored ? 'saved' : 'idle')
        setSelectedMatchId(nextBoard?.linkedMatchDayId || currentMatch?.id || '')
        setTitle(nextTitle)
        setNotice(recoveredBoard
          ? 'The previous server save was found. Your Formation Board is ready.'
          : restored || unresolvedPendingSave
            ? 'Your unsent Formation Board is restored from this device. Review the lineup, then save it to the team.'
            : cachedBoardUnavailable
              ? 'The cached Formation Board is no longer available to this account. It was not restored or sent.'
            : '')
      }
      setOffline(false)
      setRefreshPending(false)
      setServerBoardUnavailable(Boolean(cachedBoardUnavailable))
      setLoading(false)
      if (!editorChangedDuringRefresh) {
        await saveCoachOfflineResources(currentUser.id, currentContext, { formation: { board: nextBoard, boards: nextBoards, draft: nextDraft, matchDayId: currentMatch?.id || '', matchPublications: nextPublications.matchItems, pendingSave: unresolvedPendingSave, presets: nextPresets, resourcePublications: nextPublications.resourceItems } }).catch(() => {})
      }
    } catch (loadError) {
      if (!isCurrent()) return
      if (restored?.draft || (cacheMatchesRoute && savedFormation?.draft)) {
        if (pendingSave) setNotice('Your unsent Formation Board is saved on this device. Connect when you are ready to finish saving it.')
        setOffline(true)
        setRefreshPending(false)
      } else {
        setErrorRetry('load')
        setError(getCoachFriendlyError(loadError, 'The Formation Board could not be loaded.'))
      }
    } finally { if (isCurrent()) setLoading(false) }
  }, [preferenceKey, resolvePublications, routeScope, setDraft, setTitle])

  useEffect(() => {
    const requests = loadSequence
    const writes = draftWriteSequence
    void load()
    return () => { ++requests.current; ++writes.current }
  }, [load])

  const selectedIds = useMemo(() => getMobileFormationSelectedPlayerIds(draft), [draft])
  const currentPreset = presets.find((preset) => preset.key === draft.presetKey)
    || presets.find((preset) => preset.gameFormat === draft.gameFormat)
    || null
  const currentPresetSlots = useMemo(() => getMobileFormationPresetSlots(currentPreset), [currentPreset])
  const activeSlot = currentPresetSlots.find((slot) => slot.id === activeSlotId) || null
  const activeSlotPlayer = draft.placements.find((player) => player.slotId === activeSlotId) || null
  const selectedBenchPlayer = draft.bench.find((player) => player.playerId === selectedPlayerId) || null
  const filteredSlotPlayers = players.filter((player) => player.playerName.toLowerCase().includes(slotSearch.trim().toLowerCase()))
  const linkedMatchId = board?.linkedMatchDayId || ''
  const linkedMatch = (match?.id === linkedMatchId ? match : null) || matches.find((candidate) => candidate.id === linkedMatchId) || null
  const availabilityMatch = linkedMatch || match || null
  const availabilityRows = availabilityMatch?.playerAvailability || []
  const activePublication = getActiveFormationPublication(matchPublications, linkedMatchId)
  const latestResourcePublication = resourcePublications[0] || null
  const unavailable = stale || offline || serverBoardUnavailable
  const hasEditAuthority = canEditCoachFormationBoard(user)
  const canEdit = hasEditAuthority && !refreshPending && !serverBoardUnavailable
  const capacity = getMobileFormationCapacity(draft.gameFormat)
  const availablePlayers = getMobileAvailableFormationPlayers(players, availabilityRows)
  const formationName = (currentPreset?.displayName || draft.presetKey).replace(`${draft.gameFormat}-`, '')
  const contentKey = formationContentKey(draft, title)
  const hasUnsavedChanges = Boolean(savedContentKey && contentKey !== savedContentKey)
  const currentDraftKey = restoredDraftKey || formationDraftKey(board?.id, match?.id)
  const saveLabel = getFormationSaveLabel({ board, dirty: hasUnsavedChanges, localState, publication: activePublication })

  const handleBack = useCallback(async () => {
    if (!onBack) return
    if (!hasUnsavedChanges || !hasEditAuthority || draftScope !== routeScope) {
      onBack()
      return
    }
    const sequence = ++draftWriteSequence.current
    setBusy(true)
    setError('')
    setLocalState('saving')
    try {
      const { context: currentContext, match: currentMatch, user: currentUser } = propsRef.current
      await saveCoachFormationLocalDraft(currentUser.id, currentContext, currentDraftKey, {
        board,
        draft,
        title,
        workflowStep: 'lineup',
        matchDayId: currentMatch?.id || '',
        savedAt: new Date().toISOString(),
      })
      if (sequence !== draftWriteSequence.current) return
      setLocalState('saved')
      onBack()
    } catch {
      if (sequence !== draftWriteSequence.current) return
      setLocalState('failed')
      setErrorRetry('back')
      setError('These changes could not be protected on this device. Retry before leaving the Formation Board.')
    } finally {
      if (sequence === draftWriteSequence.current) setBusy(false)
    }
  }, [board, currentDraftKey, draft, draftScope, hasEditAuthority, hasUnsavedChanges, onBack, routeScope, title])

  useEffect(() => {
    registerBackHandler?.(handleBack)
    return () => registerBackHandler?.(null)
  }, [handleBack, registerBackHandler])

  useEffect(() => {
    if (!canEdit || loading || busy || !savedContentKey || draftScope !== routeScope) return
    const sequence = ++draftWriteSequence.current
    const entry = hasUnsavedChanges ? {
      board, draft, title, workflowStep: 'lineup', matchDayId: match?.id || '', savedAt: new Date().toISOString(),
    } : null
    if (entry) setLocalState('saving')
    void saveCoachFormationLocalDraft(user.id, context, currentDraftKey, entry).then(() => {
      if (sequence === draftWriteSequence.current) setLocalState(entry ? 'saved' : 'idle')
    }).catch(() => {
      if (sequence === draftWriteSequence.current) setLocalState('failed')
    })
  }, [board, busy, canEdit, contentKey, context, currentDraftKey, draft, draftScope, hasUnsavedChanges, loading, match?.id, routeScope, savedContentKey, title, user.id])

  const confirmDraftReplacement = (action) => {
    if (!hasUnsavedChanges || !canEdit) { void action(); return }
    Alert.alert('Discard these changes?', 'These edits have not been saved to the team. Keep editing to save them first.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard changes', style: 'destructive', onPress: async () => {
        try {
          ++draftWriteSequence.current
          await saveCoachFormationLocalDraft(user.id, context, currentDraftKey, null)
          await action()
        } catch { setError('The board could not be switched safely. Your changes are still open.') }
      } },
    ])
  }
  const rememberPreset = (nextDraft) => {
    if (!canEdit) return
    setDraft(nextDraft)
    setSelectedPlayerId('')
    void AsyncStorage.setItem(preferenceKey, serializeMobileFormationPreferences(nextDraft)).catch(() => {})
  }

  const chooseFormat = (gameFormat) => {
    if (!canEdit) return
    const preset = presets.find((candidate) => candidate.gameFormat === gameFormat && candidate.key === `${gameFormat}-4-4-2`)
      || presets.find((candidate) => candidate.gameFormat === gameFormat)
    if (preset) rememberPreset(applyMobileFormationPreset(draft, preset))
  }

  const startNewBoard = () => {
    if (!hasEditAuthority || refreshPending) return
    const preset = presets.find((candidate) => candidate.key === draft.presetKey) || presets[0]
    const nextDraft = createMobileFormationDraft({ gameFormat: preset?.gameFormat || '11v11', presetKey: preset?.key || '11v11-4-4-2' })
    setBoard(null)
    setDraft(nextDraft)
    const nextTitle = match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board'
    setTitle(nextTitle)
    setSavedContentKey(formationContentKey(nextDraft, nextTitle))
    setRestoredDraftKey('')
    setLocalState('idle')
    setSelectedMatchId(match?.id || '')
    setMatchPublications([])
    setResourcePublications([])
    setSelectedPlayerId('')
    setShowBoards(false)
    setActiveSheet('')
    setServerBoardUnavailable(false)
    setNotice('New Formation Board ready. Tap any pitch position to choose a Player.')
  }

  const saveOfflineFormation = async ({ nextBoard = board, nextBoards = boards, nextDraft = draft, pendingSave = null } = {}) => {
    await saveCoachOfflineResources(user.id, context, {
      formation: {
        board: nextBoard,
        boards: nextBoards,
        draft: nextDraft,
        matchDayId: match?.id || '',
        matchPublications,
        pendingSave,
        presets,
        resourcePublications,
      },
    })
  }

  const reconcilePendingBoard = async (pendingSave) => {
    if (!pendingSave?.startedAt || !normalize(pendingSave?.title)) return null
    const threshold = new Date(pendingSave.startedAt).getTime() - (2 * 60 * 1000)
    const createdByProfileId = normalize(pendingSave.createdByProfileId) || user.id
    const items = await getCoachFormationBoards(user)
    return items.find((candidate) => (
      candidate.createdByProfileId === createdByProfileId
      && new Date(candidate.createdAt || 0).getTime() >= threshold
      && formationMatchesBoard(pendingSave.draft, pendingSave.title, candidate)
    )) || null
  }

  const persistBoard = async () => {
    if (!canEdit) throw new Error('Coach or manager plan access is required to save formations.')
    const operation = loadSequence.current
    const requireActiveBoard = () => {
      if (operation === loadSequence.current) return
      const changed = new Error('The active Formation Board changed.')
      changed.code = 'formation_navigation_changed'
      throw changed
    }
    const cachedBeforeSave = await readCoachOfflineResources(user.id, context).catch(() => null)
    requireActiveBoard()
    const cachedFormation = cachedBeforeSave?.resources?.formation
    const cachedPending = cachedFormation?.pendingSave
    const previousPendingSave = String(cachedFormation?.matchDayId || '') === String(match?.id || '')
      && String(cachedPending?.boardId || '') === String(board?.id || '')
      && cachedPending?.draft
      && formationContentKey(cachedPending.draft, cachedPending.title) === formationContentKey(draft, title)
      ? cachedPending : null
    const pendingSave = {
      boardId: board?.id || '',
      createdByProfileId: normalize(previousPendingSave?.createdByProfileId) || normalize(board?.createdByProfileId) || user.id,
      draft,
      startedAt: !board && previousPendingSave?.startedAt ? previousPendingSave.startedAt : new Date().toISOString(),
      title: normalize(title) || 'Formation Board',
    }
    let nextBoard = board
    let savedLocally = false
    await saveOfflineFormation({ pendingSave }).then(() => { savedLocally = true }).catch(() => {})
    try {
      requireActiveBoard()
      if (!nextBoard) {
        nextBoard = await reconcilePendingBoard(previousPendingSave).catch(() => null)
      }
      requireActiveBoard()
      nextBoard = nextBoard
        ? await saveCoachFormationBoard(user, nextBoard, draft, title)
        : await createCoachFormationBoard(user, match, draft, title)
      requireActiveBoard()
      // Retain a confirmed server identity even if refresh or local storage fails.
      setBoard(nextBoard)
      if (match?.id && nextBoard.linkedMatchDayId !== match.id) nextBoard = await linkCoachFormationBoard(user, nextBoard.id, match.id)
      const nextBoards = await getCoachFormationBoards(user)
      const nextPublications = await resolvePublications(nextBoard, user)
      requireActiveBoard()
      setBoard(nextBoard)
      setBoards(nextBoards)
      setDraft(createMobileFormationDraft({ board: nextBoard }))
      setTitle(nextBoard.title)
      setSavedContentKey(formationContentKey(createMobileFormationDraft({ board: nextBoard }), nextBoard.title))
      setSelectedMatchId(nextBoard.linkedMatchDayId || selectedMatchId)
      setMatchPublications(nextPublications.matchItems)
      setResourcePublications(nextPublications.resourceItems)
      await saveOfflineFormation({ nextBoard, nextBoards, nextDraft: createMobileFormationDraft({ board: nextBoard }), pendingSave: null }).catch(() => {})
      await saveCoachFormationLocalDraft(user.id, context, currentDraftKey, null).catch(() => {})
      setRestoredDraftKey('')
      setLocalState('idle')
      return nextBoard
    } catch (saveError) {
      if (saveError.code === 'formation_navigation_changed') throw saveError
      requireActiveBoard()
      if (String(saveError?.message || '').includes('formation_board_version_conflict')) {
        const conflict = new Error('Another coach has saved a newer version. Your changes remain on this device. Reload the latest version to continue, or keep this screen open to review your changes first.')
        conflict.code = 'formation_conflict'
        throw conflict
      }
      if (!nextBoard) {
        const reconciled = await reconcilePendingBoard(pendingSave).catch(() => null)
        if (reconciled) {
          setBoard(reconciled)
          setDraft(createMobileFormationDraft({ board: reconciled }))
          nextBoard = reconciled
        }
      }
      throw new Error(savedLocally
        ? 'Your Formation Board is saved safely on this device. Connect and retry. The app will check for the previous server save before creating anything again.'
        : 'Your Formation Board could not be saved on this device or confirmed online. Keep this screen open and retry when connected.')
    }
  }

  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const nextBoard = await persistBoard()
      setNotice(nextBoard.linkedMatchDayId ? 'Formation Board saved to the team and linked to its match. Parent publication is unchanged.' : 'Formation Board saved to the team. You can link or publish it whenever you are ready.')
    } catch (saveError) { if (saveError.code === 'formation_navigation_changed') return; setErrorRetry(saveError.code === 'formation_conflict' ? 'conflict' : 'save'); setError(saveError.message) }
    finally { setBusy(false) }
  }

  const reloadLatestBoard = () => confirmDraftReplacement(async () => {
    setBusy(true)
    try {
      const latestBoards = await getCoachFormationBoards(user)
      const latest = latestBoards.find((item) => item.id === board?.id)
      if (!latest) throw new Error('This board is no longer available. Your open lineup has been kept.')
      await applyBoard(latest)
      setBoards(latestBoards)
      setError('')
    } catch (reloadError) { setError(reloadError.message) }
    finally { setBusy(false) }
  })

  const linkToMatch = async () => {
    if (!selectedMatchId) { setError('Choose a match to link.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      let nextBoard = await persistBoard()
      if (nextBoard.linkedMatchDayId !== selectedMatchId) nextBoard = await linkCoachFormationBoard(user, nextBoard.id, selectedMatchId)
      setBoard(nextBoard)
      setBoards(await getCoachFormationBoards(user))
      setMatchPublications(await getCoachFormationPublications(user, nextBoard.id))
      setShowMatchPicker(false)
      const selectedMatch = matches.find((candidate) => candidate.id === selectedMatchId) || match
      setNotice(`Formation Board linked to ${selectedMatch?.teamName || 'Team'} v ${selectedMatch?.opponent || 'opponent'}.`)
    } catch (linkError) { if (linkError.code === 'formation_navigation_changed') return; setErrorRetry(linkError.code === 'formation_conflict' ? 'conflict' : 'save'); setError(normalize(linkError?.message) || 'The Formation Board could not be linked to that match.') }
    finally { setBusy(false) }
  }

  const publishToResources = () => Alert.alert(
    latestResourcePublication ? 'Update the Team Resource?' : 'Publish to Team Resources?',
    'A protected saved version of the pitch and Bench will be added to the Team Resource library. Nothing is sent automatically.',
    [
      { style: 'cancel', text: 'Cancel' },
      { text: latestResourcePublication ? 'Save and update' : 'Save and publish', onPress: async () => {
        setBusy(true); setError(''); setNotice('')
        try {
          const nextBoard = await persistBoard()
          await publishCoachFormationResource(user, nextBoard, resourceCategory, publicationResourceId(latestResourcePublication))
          setResourcePublications(await getCoachFormationResourcePublications(user, nextBoard.id))
          setNotice(latestResourcePublication ? 'Saved and updated in Team Resources.' : 'Saved and published to Team Resources.')
        } catch (publishError) { if (publishError.code === 'formation_navigation_changed') return; setErrorRetry(publishError.code === 'formation_conflict' ? 'conflict' : 'save'); setError(normalize(publishError?.message) || 'The Formation Board could not be published to Team Resources.') }
        finally { setBusy(false) }
      } },
    ],
  )

  const saveAndPublish = () => Alert.alert(
    activePublication ? 'Update the Parent match plan?' : 'Share this match plan with Parents?',
    'The latest pitch and Bench will be saved and shared with authorised Parents for the linked fixture. Coach notes and unselected Players are not shared.',
    [
      { style: 'cancel', text: 'Cancel' },
      { text: activePublication ? 'Save and update' : 'Save and share', onPress: async () => {
        setBusy(true); setError(''); setNotice('')
        try {
          const nextBoard = await persistBoard()
          if (!nextBoard.linkedMatchDayId) throw new Error('Link this Formation Board to a match before sharing it with Parents.')
          await publishCoachFormationBoard(user, nextBoard, nextBoard.linkedMatchDayId)
          setMatchPublications(await getCoachFormationPublications(user, nextBoard.id))
          setNotice('Saved and shared. Authorised Parents can now see the latest match plan.')
        } catch (publishError) { if (publishError.code === 'formation_navigation_changed') return; setErrorRetry(publishError.code === 'formation_conflict' ? 'conflict' : 'save'); setError(normalize(publishError?.message) || 'The match plan could not be saved and shared.') }
        finally { setBusy(false) }
      } },
    ],
  )

  const withdraw = () => Alert.alert(
    'Withdraw the Parent plan?',
    'The saved private Formation Board remains available to Coaches.',
    [
      { style: 'cancel', text: 'Cancel' },
      { style: 'destructive', text: 'Withdraw', onPress: async () => {
        setBusy(true); setError('')
        try {
          await withdrawCoachFormationBoard(user, board, board.linkedMatchDayId)
          setMatchPublications(await getCoachFormationPublications(user, board.id))
          setNotice('The match plan is private again.')
        } catch (withdrawError) { setError(normalize(withdrawError?.message) || 'The Formation Board could not be withdrawn.') }
        finally { setBusy(false) }
      } },
    ],
  )

  const moveBenchPlayerToPitch = (playerId) => {
    if (!canEdit) return
    if (!currentPreset) return
    const nextDraft = placeMobileFormationPlayerInNextSlot(draft, currentPreset, playerId)
    if (nextDraft === draft) setNotice('The pitch is full. Move a starter to the Bench or swap the two Players.')
    else {
      setDraft(nextDraft)
      setSelectedPlayerId('')
      setNotice('Player moved from the Bench to the next empty pitch position.')
    }
  }

  const openSlotPicker = (slotId) => {
    if (!canEdit) return
    setSelectedPlayerId('')
    setActiveSlotId(slotId)
    setSlotSearch('')
  }

  const chooseSlotPlayer = (player) => {
    if (!canEdit || !activeSlot) return
    setDraft(assignMobileFormationPlayerToSlot(draft, player, activeSlot))
    setActiveSlotId('')
    setSlotSearch('')
  }

  const selectPlayer = (playerId, location) => {
    if (!canEdit) return
    if (removalMode) {
      if (location !== 'pitch') return
      setRemovalIds((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId])
      return
    }
    if (!selectedPlayerId || selectedPlayerId === playerId) {
      setSelectedPlayerId(selectedPlayerId === playerId ? '' : playerId)
      return
    }
    setDraft(swapMobileFormationPlayers(draft, selectedPlayerId, playerId))
    setSelectedPlayerId('')
  }

  if (loading || draftScope !== routeScope) return (
    <View style={styles.workspace}>
      <View style={styles.planHeaderRow}>
        <Pressable accessibilityLabel="Back from Formation Board" accessibilityRole="button" accessibilityState={{ disabled: !onBack }} disabled={!onBack} onPress={() => void handleBack()} style={[styles.topIcon, !onBack && { opacity: 0 }]}>
          <MaterialIcons color={palette.textPrimary} name="arrow-back" size={27} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.planTitle}>{title || 'Formation Board'}</Text>
        <View style={styles.topIcon} />
      </View>
      <View style={styles.card}><BrandLoader /><Text style={styles.body}>Loading Formation Board...</Text></View>
    </View>
  )

  const publicationLabel = activePublication
    ? 'Shared with Parents'
    : latestResourcePublication
      ? 'Published to Team Resources'
      : 'Not shared'

  const closeSheet = () => {
    setActiveSheet('')
    setShowBoards(false)
    setShowMatchPicker(false)
  }

  return (
    <View pointerEvents={busy ? 'none' : 'auto'} style={styles.workspace}>
      <View style={styles.planHeader}>
        <View style={styles.planHeaderRow}>
          <Pressable accessibilityLabel="Back from Formation Board" accessibilityRole="button" accessibilityState={{ disabled: !onBack || busy }} disabled={!onBack || busy} onPress={() => void handleBack()} style={[styles.topIcon, !onBack && { opacity: 0 }]}>
            <MaterialIcons color={palette.textPrimary} name="arrow-back" size={27} />
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.planTitle}>{title || 'Formation Board'}</Text>
          <Pressable accessibilityLabel="Formation Board options" accessibilityRole="button" onPress={() => setActiveSheet('details')} style={styles.topIcon}>
            <MaterialIcons color={palette.textPrimary} name="more-vert" size={27} />
          </Pressable>
        </View>
        <View accessibilityLiveRegion="polite" style={styles.statusRow}>
          <Text style={styles.statusText}>{saveLabel}</Text>
          <Text style={styles.statusDot}>•</Text>
          <Text style={styles.statusMuted}>{publicationLabel}</Text>
        </View>
        <Text style={styles.heading}>{formationName || draft.gameFormat}</Text>
      </View>

      {!hasEditAuthority ? <View style={styles.warning}><Text style={styles.label}>Viewing only</Text><Text style={styles.body}>Coach or manager plan access is required to edit, save or share this Formation Board.</Text></View> : null}
      {localState === 'failed' ? <Text accessibilityRole="alert" style={styles.body}>Changes could not be protected on this device. Keep this screen open and save to the team when connected.</Text> : null}
      {unavailable ? <View style={styles.warning}><Text style={styles.heading}>{serverBoardUnavailable ? 'Board unavailable' : refreshPending ? 'Checking saved board' : 'Offline draft'}</Text><Text style={styles.body}>{serverBoardUnavailable ? 'The saved board is no longer available to this account. Cached content cannot be edited or sent.' : refreshPending ? 'Showing the last encrypted board as read-only while the live board is checked.' : 'Showing the last encrypted board. You can keep a private device draft, while saving, linking and publishing require a successful online refresh.'}</Text></View> : null}
      {error ? <View style={styles.warning}><Text style={styles.body}>{error}</Text><Action disabled={busy || (!canEdit && errorRetry === 'save')} label={errorRetry === 'conflict' ? 'Reload latest version' : errorRetry === 'save' ? 'Retry save' : errorRetry === 'back' ? 'Retry Back' : 'Try again'} onPress={errorRetry === 'conflict' ? reloadLatestBoard : errorRetry === 'save' ? save : errorRetry === 'back' ? handleBack : load} secondary styles={styles} /></View> : null}
      {notice ? <View style={styles.selectedPanel}><Text style={styles.body}>{notice}</Text></View> : null}
      {removalMode && canEdit ? <View style={styles.selectedPanel}><Text style={styles.body}>Tap starters to select them, then move the selection to the Bench.</Text><View style={styles.row}><Action disabled={!removalIds.length} label={`Move ${removalIds.length || ''} selected to Bench`.replace('  ', ' ')} onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, removalIds)); setRemovalIds([]); setRemovalMode(false) }} styles={styles} /><Action label="Cancel" onPress={() => { setRemovalIds([]); setRemovalMode(false) }} secondary styles={styles} /></View></View> : null}

      <View accessibilityLabel="Formation pitch" onLayout={(event) => setPitchLayout(event.nativeEvent.layout)} style={styles.pitch}>
        <PitchLines styles={styles} />
        {currentPresetSlots.filter((slot) => !draft.placements.some((candidate) => candidate.slotId === slot.id)).map((slot) => (
          <Pressable
            accessibilityHint="Opens the Player picker for this empty position"
            accessibilityLabel={`Add Player at ${getMobileFormationSlotLabel(slot)}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canEdit }}
            disabled={!canEdit}
            key={slot.id}
            onPress={() => openSlotPicker(slot.id)}
            style={[styles.emptySlot, !canEdit && styles.actionDisabled, { left: `${getMobileFormationPitchPercent(slot.x)}%`, top: `${getMobileFormationPitchPercent(slot.y)}%` }]}
          >
            <MaterialIcons color="rgb(255,255,255)" name="add" size={24} />
            <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.emptySlotLabel}>{getMobileFormationSlotShortLabel(slot)}</Text>
          </Pressable>
        ))}
        {draft.placements.map((player) => (
          <FormationPlayerMarker
            canEdit={canEdit}
            canMove={canEdit && !removalMode}
            key={player.playerId}
            layout={pitchLayout}
            onGestureEnd={onMarkerGestureEnd}
            onGestureStart={onMarkerGestureStart}
            onMove={(coordinates) => {
              setDraft((current) => moveMobileFormationPlayer(current, player.playerId, coordinates))
              setSelectedPlayerId('')
            }}
            onPress={() => {
              if (removalMode) selectPlayer(player.playerId, 'pitch')
              else if (selectedPlayerId) selectPlayer(player.playerId, 'pitch')
              else if (player.slotId) openSlotPicker(player.slotId)
              else selectPlayer(player.playerId, 'pitch')
            }}
            player={player}
            removal={removalIds.includes(player.playerId)}
            selected={selectedPlayerId === player.playerId}
            styles={styles}
          />
        ))}
      </View>

      <View style={styles.bench}>
        <Pressable accessibilityLabel={`${benchExpanded ? 'Collapse' : 'Expand'} substitutes, ${draft.bench.length} Players`} accessibilityRole="button" onPress={() => setBenchExpanded((current) => !current)} style={styles.benchHeader}>
          <Text style={styles.heading}>Subs ({draft.bench.length})</Text>
          <MaterialIcons color={palette.textPrimary} name={benchExpanded ? 'expand-less' : 'expand-more'} size={28} />
        </Pressable>
        {benchExpanded ? draft.bench.length ? <ScrollView contentContainerStyle={styles.benchContent} horizontal showsHorizontalScrollIndicator={false}>{draft.bench.map((player) => { const selected = selectedPlayerId === player.playerId; return <Pressable accessibilityHint={canEdit ? draft.placements.length >= capacity ? 'Select this substitute for a swap from the pitch.' : 'Moves this substitute into the next empty pitch position.' : 'This substitute is read-only.'} accessibilityLabel={`${player.displayName}${player.shirtNumber ? `, shirt ${player.shirtNumber}` : ''}, substitute`} accessibilityRole="button" accessibilityState={{ disabled: !canEdit, selected }} disabled={!canEdit} key={player.playerId} onPress={() => draft.placements.length < capacity ? moveBenchPlayerToPitch(player.playerId) : selectPlayer(player.playerId, 'bench')} style={[styles.benchPlayerButton, selected && styles.benchPlayerButtonSelected]}><ShirtPlayer name={player.displayName} number={player.shirtNumber} styles={styles} /></Pressable> })}</ScrollView> : <Text style={styles.body}>No substitutes selected.</Text> : null}
        {benchExpanded && selectedBenchPlayer ? <Text accessibilityLiveRegion="polite" style={styles.body}>{selectedBenchPlayer.displayName} selected. Tap a starter to swap.</Text> : null}
      </View>

      <View accessibilityLabel="Formation Board tools" style={styles.dock}>
        {BOARD_TABS.map((tab) => { const active = activeSheet === tab.value; const share = tab.value === 'share'; const disabled = !canEdit && !share; return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: active }} disabled={disabled} key={tab.value} onPress={() => setActiveSheet(tab.value)} style={[styles.dockItem, active && styles.dockItemActive, share && styles.dockItemShare, disabled && styles.dockItemDisabled]}><MaterialIcons color={share ? 'rgb(104,242,162)' : active ? palette.selectedForeground : palette.textSecondary} name={tab.icon} size={28} /><Text style={[styles.dockLabel, active && styles.dockLabelActive, share && styles.dockLabelShare]}>{tab.label}</Text></Pressable> })}
      </View>

      <Modal accessibilityViewIsModal animationType="slide" onRequestClose={closeSheet} transparent visible={Boolean(activeSheet)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityLabel={`${activeSheet || 'Formation Board'} options`} role="dialog" style={styles.modalPanel}>
            <View style={styles.sheetHandle} />
            <View style={styles.rowBetween}>
              <Text style={styles.heading}>{activeSheet === 'formation' ? 'Formation' : activeSheet === 'players' ? 'Players' : activeSheet === 'share' ? 'Save and share' : 'Board options'}</Text>
              <Pressable accessibilityLabel="Close options" accessibilityRole="button" onPress={closeSheet} style={styles.topIcon}><MaterialIcons color={palette.textPrimary} name="close" size={25} /></Pressable>
            </View>

            {activeSheet === 'formation' ? <ScrollView contentContainerStyle={styles.stack}>
              <Text style={styles.body}>Change the shape at any time. Players already on the pitch stay selected and move into the new formation in lineup order.</Text>
              <Text style={styles.label}>Game format</Text>
              <View style={styles.row}>{MOBILE_FORMATION_GAME_FORMATS.map((format) => <Choice disabled={!canEdit} key={format.value} label={format.label} onPress={() => chooseFormat(format.value)} selected={draft.gameFormat === format.value} styles={styles} />)}</View>
              <Text style={styles.label}>Formation</Text>
              <View style={styles.row}>{presets.filter((preset) => preset.gameFormat === draft.gameFormat).map((preset) => <Choice disabled={!canEdit} iconKey="formation.formation" key={preset.key} label={preset.displayName || preset.key.replace(`${draft.gameFormat}-`, '')} onPress={() => { rememberPreset(applyMobileFormationPreset(draft, preset)); setNotice('Formation changed. Your selected Players have been kept.'); closeSheet() }} selected={draft.presetKey === preset.key} styles={styles} />)}</View>
            </ScrollView> : null}

            {activeSheet === 'players' ? <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
              <View style={styles.rowBetween}><Text style={styles.body}>{selectedIds.size} selected | {draft.placements.length}/{capacity} on pitch</Text><Text style={styles.count}>{draft.bench.length} Subs</Text></View>
              <Action disabled={!canEdit || !availablePlayers.length} label={`Select available (${availablePlayers.length})`} onPress={() => setDraft(setMobileFormationSquad(draft, availablePlayers))} styles={styles} />
              <View style={styles.row}><Action disabled={!canEdit} label="Select full squad" onPress={() => setDraft(setMobileFormationSquad(draft, players))} secondary styles={styles} /><Action disabled={!canEdit} label="Clear squad" onPress={() => setDraft(setMobileFormationSquad(draft, []))} secondary styles={styles} /></View>
              <Action disabled={!canEdit || !currentPreset || !draft.bench.length || draft.placements.length >= capacity} label="Fill empty positions" onPress={() => { setDraft(placeMobileFormationLineup(draft, currentPreset)); setNotice('Empty pitch positions filled from the selected substitutes.'); closeSheet() }} secondary styles={styles} />
              <Text style={styles.body}>Tap a Player to add or remove them from this plan. Tap a shirt on the pitch to replace or swap that position directly.</Text>
              {players.map((player) => { const selected = selectedIds.has(player.id); const availability = getMobileFormationPlayerAvailability(player.id, availabilityRows); const placement = draft.placements.find((item) => item.playerId === player.id); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: !canEdit }} disabled={!canEdit} key={player.id} onPress={() => setDraft(toggleMobileFormationSquadPlayer(draft, player))} style={[styles.modalPlayer, !canEdit && styles.actionDisabled]}><View><Text style={styles.label}>{`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.playerName}`}</Text><Text style={styles.body}>{availability.label}{placement ? ' | On pitch' : selected ? ' | Substitute' : ''}</Text></View><MaterialIcons color={selected ? palette.accentText : palette.textSecondary} name={selected ? 'check-circle' : 'radio-button-unchecked'} size={24} /></Pressable> })}
            </ScrollView> : null}

            {activeSheet === 'share' ? <ScrollView contentContainerStyle={styles.stack}>
              <Text style={styles.body}>{draft.placements.length} on pitch | {draft.bench.length} Subs | {draft.gameFormat} {formationName}</Text>
              {!canEdit ? <Text style={styles.body}>This board is read-only. Coach or manager plan access is required to save or share changes.</Text> : null}
              <Action disabled={!canEdit || busy || unavailable || !title.trim() || !selectedIds.size} label={busy ? 'Saving...' : 'Save Formation Board'} onPress={() => { closeSheet(); void save() }} styles={styles} />
              <Text style={styles.body}>Saving keeps the board private to the team. Sharing and publication only happen when you choose them below.</Text>
              {!linkedMatchId ? <View style={styles.stack}>
                <View style={styles.rowBetween}><Text style={styles.label}>Optional match link</Text><Pressable accessibilityRole="button" accessibilityState={{ disabled: !canEdit }} disabled={!canEdit} onPress={() => setShowMatchPicker((current) => !current)} style={!canEdit && styles.actionDisabled}><Text style={styles.count}>{showMatchPicker ? 'Hide matches' : 'Choose match'}</Text></Pressable></View>
                {showMatchPicker ? <View style={styles.stack}>{matches.length ? matches.map((item) => <Choice disabled={!canEdit} key={item.id} label={`${item.matchDate || 'Date TBC'} | ${item.teamName} v ${item.opponent}`} onPress={() => setSelectedMatchId(item.id)} selected={selectedMatchId === item.id} styles={styles} />) : <Text style={styles.body}>No Match Day fixture is available for this Team.</Text>}<Action disabled={!canEdit || busy || unavailable || !selectedMatchId || !selectedIds.size} label="Save and link to match" onPress={() => { closeSheet(); void linkToMatch() }} secondary styles={styles} /></View> : null}
              </View> : <Text style={styles.body}>Linked to {linkedMatch?.teamName || 'Team'} v {linkedMatch?.opponent || 'opponent'}.</Text>}
              <Text style={styles.label}>Team Resources category</Text>
              <View style={styles.row}>{RESOURCE_CATEGORIES.map((category) => <Choice disabled={!canEdit} key={category.value} label={category.label} onPress={() => setResourceCategory(category.value)} selected={resourceCategory === category.value} styles={styles} />)}</View>
              <Action disabled={!canEdit || busy || unavailable || !selectedIds.size} label={latestResourcePublication ? 'Save and update Team Resource' : 'Save and publish to Team Resources'} onPress={() => { closeSheet(); publishToResources() }} secondary styles={styles} />
              {linkedMatchId ? <Action disabled={!canEdit || busy || unavailable || !title.trim() || !selectedIds.size} label={activePublication ? 'Save and update Parents' : 'Save and share with Parents'} onPress={() => { closeSheet(); saveAndPublish() }} secondary styles={styles} /> : <Text style={styles.body}>Parent sharing becomes available after this board is linked to a match.</Text>}
            </ScrollView> : null}

            {activeSheet === 'details' ? <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Plan name</Text>
              <TextInput editable={canEdit && !busy} accessibilityLabel="Formation plan title" onChangeText={setTitle} style={[styles.input, !canEdit && styles.actionDisabled]} value={title} />
              <Text style={styles.body}>{linkedMatchId ? 'Match-linked plan' : 'Standalone plan'} | {draft.placements.length} on pitch | {draft.bench.length} Subs</Text>
              {draft.placements.length ? <Action disabled={!canEdit} label={removalMode ? 'Cancel taking Players off' : 'Take Players off'} onPress={() => { setRemovalMode((current) => !current); setRemovalIds([]); setSelectedPlayerId(''); closeSheet() }} secondary styles={styles} /> : null}
              {!match?.id || serverBoardUnavailable ? <Action disabled={!hasEditAuthority || refreshPending} iconKey="action.new-board" label={serverBoardUnavailable ? 'Start replacement board' : 'New board'} onPress={() => { closeSheet(); confirmDraftReplacement(startNewBoard) }} secondary styles={styles} /> : null}
              {!match?.id && boards.length ? <Pressable accessibilityRole="button" onPress={() => setShowBoards((current) => !current)}><Text style={styles.count}>{showBoards ? 'Hide saved boards' : `Open saved boards (${boards.length})`}</Text></Pressable> : null}
              {showBoards ? boards.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => { closeSheet(); confirmDraftReplacement(() => applyBoard(item)) }} style={styles.savedBoard}><Text style={styles.label}>{item.title}</Text><Text style={styles.body}>{item.linkedMatchDayId ? 'Linked to a match' : 'Standalone'} | Version {item.currentVersionNumber}</Text></Pressable>) : null}
              {activePublication ? <Action danger disabled={!canEdit || busy || unavailable} label="Withdraw Parent plan" onPress={() => { closeSheet(); withdraw() }} secondary styles={styles} /> : null}
            </ScrollView> : null}
          </View>
        </View>
      </Modal>

      <Modal accessibilityViewIsModal animationType="slide" onRequestClose={() => setActiveSlotId('')} transparent visible={Boolean(activeSlot)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityLabel="Choose Player" role="dialog" style={styles.modalPanel}>
            <View style={styles.sheetHandle} />
            <View style={styles.rowBetween}>
              <View><Text style={styles.eyebrow}>Choose Player</Text><Text style={styles.heading}>{getMobileFormationSlotLabel(activeSlot)}</Text></View>
              <Pressable accessibilityLabel="Close Player picker" accessibilityRole="button" onPress={() => setActiveSlotId('')} style={styles.topIcon}><MaterialIcons color={palette.textPrimary} name="close" size={25} /></Pressable>
            </View>
            {activeSlotPlayer ? <View style={styles.selectedPanel}><Text style={styles.label}>Currently {activeSlotPlayer.displayName}</Text><Action disabled={!canEdit} label="Move to Bench" onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, [activeSlotPlayer.playerId])); setActiveSlotId(''); setNotice(`${activeSlotPlayer.displayName} moved to the Bench.`) }} secondary styles={styles} /></View> : <Text style={styles.body}>This position is empty. Choose any Player from the team.</Text>}
            <TextInput accessibilityLabel="Search squad" onChangeText={setSlotSearch} placeholder="Search Players" placeholderTextColor={palette.textSecondary} style={styles.input} value={slotSearch} />
            <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
              {filteredSlotPlayers.map((player) => {
                const placement = draft.placements.find((item) => item.playerId === player.id)
                const onBench = draft.bench.some((item) => item.playerId === player.id)
                const current = placement?.slotId === activeSlotId
                const location = placement ? getMobileFormationSlotLabel(currentPresetSlots.find((slot) => slot.id === placement.slotId)) : onBench ? 'Substitute' : 'Not selected yet'
                return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canEdit || current }} disabled={!canEdit || current} key={player.id} onPress={() => chooseSlotPlayer(player)} style={[styles.modalPlayer, (!canEdit || current) && styles.actionDisabled]}><View><Text style={styles.label}>{`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.playerName}`}</Text><Text style={styles.body}>{current ? 'Already in this position' : location}</Text></View><Text style={styles.count}>{current ? 'Current' : activeSlotPlayer ? 'Choose' : 'Add'}</Text></Pressable>
              })}
              {!filteredSlotPlayers.length ? <Text style={styles.body}>No Players match that search.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}
