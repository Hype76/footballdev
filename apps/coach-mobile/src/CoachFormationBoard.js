import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import AsyncStorage from '@react-native-async-storage/async-storage'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Component, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState, Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
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
  getCoachFormationBoards,
  saveCoachMatchFormationBoard,
  getCoachFormationPresets,
  getCoachFormationPublications,
} from '../../mobile-core/src/coachFormationBoardData'
import { readCoachOfflineResources, saveCoachFormationLocalDraft, saveCoachOfflineResources } from './offline'
import { findFormationLocalDraft, formationContentKey, formationDraftKey, formationMatchesBoard, getActiveFormationPublication, getFormationSaveLabel } from '../../mobile-core/src/coachFormationDraftCore'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { isRetryableFormationSaveError } from './coachFormationSaveQueueCore'
import { canEditCoachFormationBoard, getCoachFormationMarkerVisualPosition, getCoachFormationRouteScope } from './coachFormationEntryCore'
import { getMobileIconName } from '../../mobile-core/src/mobileIconSystem'

import { CoachFormationWorkspaceContext } from './coachFormationWorkspaceContext'

const normalize = (value) => String(value ?? '').trim()
const WHITE_SHIRT = require('../../mobile-core/assets/formation-shirt-white.png')
const GOLD_SHIRT = require('../../mobile-core/assets/formation-shirt-gold.png')
const BOARD_TABS = Object.freeze([
  Object.freeze({ icon: 'grid-view', label: 'Formation', value: 'formation' }),
  Object.freeze({ icon: 'groups', label: 'Players', value: 'players' }),
  Object.freeze({ icon: 'save', label: 'Save', value: 'share' }),
])

function createStyles(palette, fullScreen = false) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, minWidth: 132, paddingHorizontal: 14, paddingVertical: 11 },
    actionDanger: { backgroundColor: palette.surfaceRaised },
    actionDisabled: { opacity: 0.45 },
    actionSecondary: { backgroundColor: palette.surfaceRaised },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    actionTextDanger: { color: palette.danger },
    actionTextSecondary: { color: palette.textPrimary },
    bench: { backgroundColor: fullScreen ? 'rgba(3,35,20,0.94)' : palette.surfaceRaised, borderBottomColor: palette.border, borderBottomWidth: 1, borderTopColor: palette.border, borderTopWidth: 1, paddingBottom: 4 },
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
    dock: { backgroundColor: fullScreen ? 'rgba(3,35,20,0.94)' : 'transparent', borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 4, paddingTop: 9 },
    dockItem: { alignItems: 'center', borderRadius: 18, flex: 1, gap: 4, justifyContent: 'center', minHeight: 60, paddingHorizontal: 6, paddingVertical: 6 },
    dockItemActive: { backgroundColor: palette.selected },
    dockItemDisabled: { opacity: 0.48 },
    dockItemShare: { backgroundColor: 'rgb(11,67,36)' },
    dockLabel: { color: fullScreen ? 'white' : palette.textSecondary, fontSize: 12, fontWeight: '700', textAlign: 'center' },
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
    marker: { alignItems: 'center', height: 70, justifyContent: 'flex-start', position: 'absolute', transform: [{ translateX: -32 }, { translateY: -25 }], width: 64, zIndex: 10 },
    markerDragging: { opacity: 0.78, transform: [{ translateX: -32 }, { translateY: -25 }, { scale: 1.08 }] },
    markerImage: { height: 46, resizeMode: 'contain', width: 52 },
    markerName: { backgroundColor: 'rgba(3,35,20,0.94)', borderRadius: 6, color: 'rgb(255,255,255)', fontSize: 12, fontWeight: '700', lineHeight: 15, marginTop: -6, maxWidth: 64, paddingHorizontal: 3, paddingVertical: 2, textAlign: 'center' },
    markerNumber: { color: 'rgb(5,62,34)', fontSize: 16, fontWeight: '900', left: 0, position: 'absolute', right: 0, textAlign: 'center', top: 15 },
    markerNumberGoalkeeper: { color: 'rgb(34,24,4)' },
    markerSelection: { borderColor: fullScreen ? 'rgb(185,255,218)' : palette.accentText, borderRadius: 31, borderWidth: 3, height: 49, position: 'absolute', top: -2, width: 56 },
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
    shirtSmallName: { backgroundColor: fullScreen ? 'rgb(3,35,20)' : palette.surfaceRaised, borderRadius: 6, color: fullScreen ? 'white' : palette.textPrimary, fontSize: 12, fontWeight: '700', lineHeight: 15, marginTop: -8, maxWidth: 78, paddingHorizontal: 6, paddingVertical: 2, textAlign: 'center' },
    shirtSmallNumber: { color: 'rgb(5,62,34)', fontSize: 15, fontWeight: '900', left: 0, position: 'absolute', right: 0, textAlign: 'center', top: 18 },
    shirtWrap: { alignItems: 'center', height: 54, width: 60 },
    statusText: { color: palette.accentText, fontSize: 12, fontWeight: '700' },
    warning: { borderLeftColor: palette.warning, borderLeftWidth: 2, gap: 8, paddingLeft: 12, paddingVertical: 8 },
    workspace: { gap: 8 },
    canvas: { backgroundColor: 'rgb(10,108,47)', flex: 1, gap: 0, overflow: 'hidden' },
    field: { bottom: 112, left: 2, position: 'absolute', right: 2, top: 44 },
    pitchCanvas: { aspectRatio: undefined, borderRadius: 0, borderWidth: 2, flex: 1, height: '100%' },
    canvasFooter: { bottom: 0, left: 0, position: 'absolute', right: 0, zIndex: 25 },
    canvasText: { color: 'white' },
    canvasUndo: { alignSelf: 'flex-end', backgroundColor: 'rgba(3,35,20,0.94)', paddingHorizontal: 10, position: 'absolute', right: 4, top: 0, zIndex: 30 },
    canvasAlert: { backgroundColor: palette.surface, maxHeight: 140, paddingHorizontal: 8 },
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
  movedBeforeHold = false
  holdTimer = null

  clearHold = () => {
    clearTimeout(this.holdTimer)
    this.holdTimer = null
  }

  prepareGesture = () => {
    this.clearHold()
    this.movedBeforeHold = false
    if (this.props.canMove) this.holdTimer = setTimeout(() => {
      if (this.movedBeforeHold || !this.props.canMove) return
      this.beginGesture()
      this.setState({ dragging: true })
      Vibration.vibrate(20)
    }, 350)
  }

  clamp = (value) => Math.max(0.04, Math.min(0.96, value))

  beginGesture = () => {
    if (this.gestureActive) return
    this.gestureActive = true
    this.props.onGestureStart?.()
  }

  endGesture = () => {
    this.clearHold()
    if (!this.gestureActive) return
    this.gestureActive = false
    this.props.onGestureEnd?.()
  }

  componentWillUnmount() {
    this.endGesture()
  }

  panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => this.props.canEdit,
    onMoveShouldSetPanResponder: () => false,
    onPanResponderGrant: this.prepareGesture,
    onPanResponderMove: (_, gesture) => {
      if (!this.gestureActive) {
        if (Math.hypot(gesture.dx, gesture.dy) > 8 || gesture.numberActiveTouches > 1) {
          this.movedBeforeHold = true
          this.clearHold()
        }
        return
      }
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
      const moved = this.gestureActive && canMove && layout.width && layout.height && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4)
      if (moved) onMove({
        x: this.clamp(playerX + (gesture.dx / layout.width)),
        y: this.clamp(playerY + (gesture.dy / layout.height)),
      })
      else if (canEdit && !this.gestureActive && !this.movedBeforeHold && Math.hypot(gesture.dx, gesture.dy) <= 8) onPress()
      this.endGesture()
      this.setState({ dragging: false, livePosition: null })
    },
    onPanResponderTerminate: () => {
      this.endGesture()
      this.setState({ dragging: false, livePosition: null })
    },
    onPanResponderTerminationRequest: () => !this.gestureActive,
    onShouldBlockNativeResponder: () => this.gestureActive,
  })

  render() {
    const { canEdit, canMove, layout, player, removal, selected, styles } = this.props
    const playerX = getMobileFormationPitchRatio(player.x)
    const playerY = getMobileFormationPitchRatio(player.y)
    const position = this.state.livePosition || { x: playerX, y: playerY }
    const visualPosition = getCoachFormationMarkerVisualPosition(position, layout, { markerWidth: 64, markerHeight: 70, anchorY: 25 })
    const goalkeeper = player.positionGroup === 'goalkeeper' || player.slotId === 'gk'
    return (
      <View
        {...this.panResponder.panHandlers}
        accessibilityHint={canEdit ? canMove ? 'Tap to change this Player. Hold briefly, then drag to move the Player.' : 'Tap to select this Player.' : 'This player position is read-only.'}
        onAccessibilityTap={() => { if (canEdit) this.props.onPress() }}
        accessibilityLabel={`${player.displayName}${player.shirtNumber ? `, shirt ${player.shirtNumber}` : ''}`}
        accessibilityRole={canEdit ? 'button' : 'image'}
        accessibilityState={{ disabled: !canEdit, selected: Boolean(selected || removal) }}
        style={[styles.marker, this.state.dragging && styles.markerDragging, { left: `${visualPosition.x * 100}%`, top: `${visualPosition.y * 100}%` }]}
      >
        <Image accessibilityIgnoresInvertColors source={goalkeeper ? GOLD_SHIRT : WHITE_SHIRT} style={styles.markerImage} />
        {player.shirtNumber ? <Text style={[styles.markerNumber, goalkeeper && styles.markerNumberGoalkeeper]}>{player.shirtNumber}</Text> : null}
        {selected || removal || this.state.dragging ? <View pointerEvents="none" style={styles.markerSelection} /> : null}
        <Text numberOfLines={1} style={styles.markerName}>{player.displayName}</Text>
      </View>
    )
  }
}

function ScrollSafePressable({ onPress, ...props }) {
  const touch = useRef(null)
  const trackMovement = (event) => {
    if (!touch.current) return
    const { pageX, pageY, touches } = event.nativeEvent
    if (Math.hypot(pageX - touch.current.x, pageY - touch.current.y) > 8 || touches?.length > 1) touch.current.cancelled = true
  }
  return <Pressable {...props}
    onTouchStart={(event) => { const { pageX, pageY } = event.nativeEvent; touch.current = { x: pageX, y: pageY, cancelled: false } }}
    onTouchMove={trackMovement}
    onTouchEnd={trackMovement}
    onTouchCancel={() => { if (touch.current) touch.current.cancelled = true }}
    onPress={(event) => { if (!touch.current?.cancelled) onPress?.(event) }}
  />
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

export function CoachFormationBoard({ context, match = null, matches = [], onBack, onMarkerGestureEnd, onMarkerGestureStart, palette, players, registerBackHandler, user }) {
  const inWorkspace = useContext(CoachFormationWorkspaceContext)
  const fullScreen = Boolean(inWorkspace)
  const styles = useMemo(() => createStyles(palette, fullScreen), [palette, fullScreen])
  const [board, setBoard] = useState(null)
  const [boards, setBoards] = useState([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraftState] = useState(() => createMobileFormationDraft())
  const [error, setError] = useState('')
  const [errorRetry, setErrorRetry] = useState('load')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [undoMove, setUndoMove] = useState(null)
  const [refreshPending, setRefreshPending] = useState(false)
  const [presets, setPresets] = useState([])
  const [matchPublications, setMatchPublications] = useState([])
  const [pitchLayout, setPitchLayout] = useState({ height: 475, width: 320 })
  const [serverBoardUnavailable, setServerBoardUnavailable] = useState(false)
  const [removalMode, setRemovalMode] = useState(false)
  const [removalIds, setRemovalIds] = useState([])
  const [shared, setShared] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [activeSlotId, setActiveSlotId] = useState('')
  const [slotSearch, setSlotSearch] = useState('')
  const [showBoards, setShowBoards] = useState(false)
  const [title, setTitleState] = useState(match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board')
  const [activeSheet, setActiveSheet] = useState('')
  const [benchExpanded, setBenchExpanded] = useState(!fullScreen)
  const [savedContentKey, setSavedContentKey] = useState('')
  const [draftScope, setDraftScope] = useState('')
  const routeScope = getCoachFormationRouteScope(user, context, match?.id)
  const [localState, setLocalState] = useState('idle')
  const [queuedRetryPending, setQueuedRetryPending] = useState(false)
  const [queuedSaveAcknowledged, setQueuedSaveAcknowledged] = useState(false)
  const [restoredDraftKey, setRestoredDraftKey] = useState('')
  const draftWriteSequence = useRef(0)
  const queuedRetryInFlight = useRef(false)
  const editorSnapshotRef = useRef({ draft, title, shared })
  const saveOfflineFormationRef = useRef(null)
  const persistBoardRef = useRef(null)
  editorSnapshotRef.current = { draft, title, shared }
  const editorRevision = useRef(0)
  const loadSequence = useRef(0)
  const propsRef = useRef({ context, match, user })
  useEffect(() => {
    propsRef.current = { context, match, user }
  }, [context, match, user])
  const setDraft = useCallback((value) => {
    ++editorRevision.current
    setUndoMove(null)
    setDraftState(value)
  }, [])
  const commitPlayerMove = (nextDraft) => {
    if (nextDraft === draft) return
    setDraft(nextDraft)
    setUndoMove({ before: draft, after: nextDraft })
  }
  useEffect(() => {
    if (!undoMove) return undefined
    const timer = setTimeout(() => setUndoMove(null), 8000)
    return () => clearTimeout(timer)
  }, [undoMove])
  const setTitle = useCallback((value) => {
    ++editorRevision.current
    setTitleState(value)
  }, [])
  const preferenceKey = useMemo(() => createMobileFormationPreferenceKey({ clubId: context.clubId, teamId: context.teamId, userId: user.id }), [context.clubId, context.teamId, user.id])

  const resolvePublications = useCallback(async (nextBoard, actingUser) => ({
    matchItems: nextBoard?.id ? await getCoachFormationPublications(actingUser, nextBoard.id) : [],
  }), [])

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
    setMatchPublications(nextPublications.matchItems)
    setShared(local?.shared ?? Boolean(getActiveFormationPublication(nextPublications.matchItems, nextBoard.linkedMatchDayId)))
    setPresets(nextPresets)
    setSelectedPlayerId('')
    setShowBoards(false)
    setActiveSheet('')
    setRefreshPending(false)
    setServerBoardUnavailable(false)
    setNotice(local ? 'Your unsent changes are restored. Review them before saving to the match.' : '')
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
    setShared(false)
    setQueuedRetryPending(false)
    setQueuedSaveAcknowledged(false)
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
    const restoredBoardId = localDraft?.board?.id || (cacheMatchesRoute ? savedFormation?.board?.id : '') || ''
    const currentPendingKey = `${currentMatch?.id || ''}:${restoredBoardId || 'new'}`
    const legacyPending = savedFormation?.pendingSave
    const pendingSave = savedFormation?.pendingSaves?.[currentPendingKey]
      || (legacyPending?.matchDayId === currentMatch?.id && String(legacyPending.boardId || '') === restoredBoardId ? legacyPending : null)
    setQueuedRetryPending(Boolean(pendingSave))
    setQueuedSaveAcknowledged(Boolean(pendingSave?.acknowledged))
    const restored = localDraft || (pendingSave ? { board: pendingSave.board || null, draft: pendingSave.draft, title: pendingSave.title, shared: pendingSave.shared } : null)
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
      setShared(restored?.shared ?? Boolean(getActiveFormationPublication(savedFormation.matchPublications || [], currentMatch?.id)))
      setTitle(cachedTitle)
      setActiveSheet('')
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
        candidate.linkedMatchDayId === currentMatch?.id
        && (attemptedDraft.boardId ? candidate.id === attemptedDraft.boardId : candidate.createdByProfileId === attemptedCreatorId && new Date(candidate.createdAt || 0).getTime() >= pendingThreshold)
        && formationMatchesBoard(attemptedDraft.draft, attemptedDraft.title, candidate)
      )) || null : null
      // Keep the restored base version so a concurrent coach edit still conflicts.
      const nextBoard = recoveredBoard || (restored ? restored.board || null : linkedBoard)
      const nextDraft = restored?.draft || pendingSave?.draft
        || createMobileFormationDraft({ board: nextBoard, gameFormat: matchingPreset?.gameFormat || preference.gameFormat, presetKey: matchingPreset?.key || preference.presetKey })
      const nextPublications = await resolvePublications(nextBoard, currentUser)
      if (!isCurrent()) return
      const recoveredPublication = getActiveFormationPublication(nextPublications.matchItems, currentMatch?.id)
      const recoveredAudienceMatches = pendingSave?.shared
        ? Boolean(recoveredPublication && (recoveredPublication.board_version_id ?? recoveredPublication.boardVersionId) === recoveredBoard?.currentVersionId)
        : !recoveredPublication
      const unresolvedPendingSave = pendingSave && !(recoveredBoard && recoveredAudienceMatches) ? pendingSave : null
      setQueuedRetryPending(Boolean(unresolvedPendingSave))
      setQueuedSaveAcknowledged(Boolean(unresolvedPendingSave?.acknowledged))
      const editorChangedDuringRefresh = showedCachedBoard && editorRevision.current !== refreshRevision
      const cachedBoardUnavailable = showedCachedBoard && cachedBoardId && !restored && !refreshedCachedBoard
      setDraftScope(routeScope)
      setBoards(nextBoards)
      setPresets(nextPresets)
      setMatchPublications(nextPublications.matchItems)
      if (!editorChangedDuringRefresh) {
        setBoard(nextBoard)
        setShared(restored?.shared ?? pendingSave?.shared ?? Boolean(getActiveFormationPublication(nextPublications.matchItems, currentMatch?.id)))
        setDraft(nextDraft)
        const nextTitle = restored?.title || pendingSave?.title || nextBoard?.title || (currentMatch?.id ? `${currentMatch.teamName} v ${currentMatch.opponent}` : 'Formation Board')
        setSavedContentKey(nextBoard ? formationContentKey(createMobileFormationDraft({ board: nextBoard }), nextBoard.title) : formationContentKey(createMobileFormationDraft({ gameFormat: nextDraft.gameFormat, presetKey: nextDraft.presetKey }), currentMatch?.id ? `${currentMatch.teamName} v ${currentMatch.opponent}` : 'Formation Board'))
        setRestoredDraftKey(localEntry?.[0] || '')
        setLocalState(restored ? 'saved' : 'idle')
        setTitle(nextTitle)
        setNotice(recoveredBoard
          ? 'The previous server save was found. Your Formation Board is ready.'
          : restored || unresolvedPendingSave
            ? 'Your unsent Formation Board is restored from this device. Review the lineup, then save it to the match.'
            : cachedBoardUnavailable
              ? 'The cached Formation Board is no longer available to this account. It was not restored or sent.'
            : '')
      }
      setRefreshPending(false)
      setServerBoardUnavailable(Boolean(cachedBoardUnavailable))
      setLoading(false)
      if (!editorChangedDuringRefresh) {
        const pendingForWrite = unresolvedPendingSave || (savedFormation?.pendingSave && String(savedFormation.pendingSave.matchDayId || '') !== String(currentMatch?.id || '') ? undefined : null)
        await saveOfflineFormationRef.current?.({ nextBoard, nextBoards, nextDraft, nextPresets, nextPublications: nextPublications.matchItems, pendingSave: pendingForWrite, pendingQueueKey: pendingSave?.queueKey }).catch(() => {})
      }
    } catch (loadError) {
      if (!isCurrent()) return
      if (restored?.draft || (cacheMatchesRoute && savedFormation?.draft)) {
        if (pendingSave) setNotice('Your unsent Formation Board is saved on this device. Connect when you are ready to finish saving it.')
        setQueuedRetryPending(Boolean(pendingSave))
        setQueuedSaveAcknowledged(Boolean(pendingSave?.acknowledged))
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
  const hasEditAuthority = canEditCoachFormationBoard(user)
  const canEdit = hasEditAuthority && !refreshPending && !serverBoardUnavailable
  const capacity = getMobileFormationCapacity(draft.gameFormat)
  const availablePlayers = getMobileAvailableFormationPlayers(players, availabilityRows)
  const contentKey = formationContentKey(draft, title)
  const hasUnsavedChanges = Boolean(savedContentKey && (contentKey !== savedContentKey || shared !== Boolean(activePublication)))
  const matchBoards = boards.filter((item) => item.linkedMatchDayId === match?.id)
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
        shared,
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
  }, [board, currentDraftKey, draft, draftScope, hasEditAuthority, hasUnsavedChanges, onBack, routeScope, shared, title])

  useEffect(() => {
    registerBackHandler?.(handleBack)
    return () => registerBackHandler?.(null)
  }, [handleBack, registerBackHandler])

  useEffect(() => {
    if (!canEdit || loading || busy || !savedContentKey || draftScope !== routeScope) return
    const sequence = ++draftWriteSequence.current
    const entry = hasUnsavedChanges ? {
      board, draft, title, shared, workflowStep: 'lineup', matchDayId: match?.id || '', savedAt: new Date().toISOString(),
    } : null
    if (entry) setLocalState('saving')
    void saveCoachFormationLocalDraft(user.id, context, currentDraftKey, entry).then(() => {
      if (sequence === draftWriteSequence.current) setLocalState(entry ? 'saved' : 'idle')
    }).catch(() => {
      if (sequence === draftWriteSequence.current) setLocalState('failed')
    })
  }, [board, busy, canEdit, contentKey, context, currentDraftKey, draft, draftScope, hasUnsavedChanges, loading, match?.id, routeScope, savedContentKey, shared, title, user.id])

  const confirmDraftReplacement = (action) => {
    if (!hasUnsavedChanges || !canEdit) { void action(); return }
    Alert.alert('Discard these changes?', 'These edits have not been saved to the match. Keep editing to save them first.', [
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
    const nextTitle = `Lineup ${matchBoards.length + 1}`
    setTitle(nextTitle)
    setSavedContentKey(formationContentKey(nextDraft, nextTitle))
    setRestoredDraftKey('')
    setLocalState('idle')
    setMatchPublications([])
    setShared(false)
    setSelectedPlayerId('')
    setShowBoards(false)
    setActiveSheet('')
    setServerBoardUnavailable(false)
    setNotice('New Formation Board ready. Tap any pitch position to choose a Player.')
  }

  const saveOfflineFormation = async ({ nextBoard = board, nextBoards = boards, nextDraft = draft, nextPresets = presets, nextPublications = matchPublications, pendingSave, pendingQueueKey } = {}) => {
    const pendingKey = `${match?.id || ''}:${pendingSave?.boardId || nextBoard?.id || board?.id || 'new'}`
    const pendingSaveChanges = pendingSave === undefined ? undefined : {
      ...((pendingSave?.queueKey || pendingQueueKey) ? { [pendingSave?.queueKey || pendingQueueKey]: null } : {}),
      [pendingKey]: pendingSave,
    }
    await saveCoachOfflineResources(user.id, context, {
      formation: {
        board: nextBoard,
        boards: nextBoards,
        draft: nextDraft,
        matchDayId: match?.id || '',
        matchPublications: nextPublications,
        pendingSave: pendingSave === undefined ? undefined : pendingSave,
        pendingSaveChanges,
        presets: nextPresets,
      },
    })
  }
  saveOfflineFormationRef.current = saveOfflineFormation

  const reconcilePendingBoard = async (pendingSave) => {
    if (!pendingSave?.startedAt || !normalize(pendingSave?.title)) return null
    const threshold = new Date(pendingSave.startedAt).getTime() - (2 * 60 * 1000)
    const createdByProfileId = normalize(pendingSave.createdByProfileId) || user.id
    const items = await getCoachFormationBoards(user)
    return items.find((candidate) => (
      candidate.linkedMatchDayId === match?.id
      && candidate.createdByProfileId === createdByProfileId
      && new Date(candidate.createdAt || 0).getTime() >= threshold
      && formationMatchesBoard(pendingSave.draft, pendingSave.title, candidate)
    )) || null
  }

  const persistBoard = async ({ queuedSave = null, queuedEditorRevision = null } = {}) => {
    if (!canEdit) throw new Error('Coach or manager plan access is required to save formations.')
    if (!match?.id) throw new Error('Open a match before saving a Formation Board.')
    const saveBoard = queuedSave ? queuedSave.board || null : board
    const saveDraft = queuedSave?.draft || draft
    const saveTitle = queuedSave?.title || title
    const saveShared = queuedSave ? queuedSave.shared === true : shared
    if (saveBoard?.linkedMatchDayId && saveBoard.linkedMatchDayId !== match.id) throw new Error('This board belongs to another match.')
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
    const cachedPending = cachedFormation?.pendingSaves?.[`${match.id}:${saveBoard?.id || 'new'}`] || cachedFormation?.pendingSave
    const previousPendingSave = queuedSave || (String(cachedFormation?.matchDayId || '') === String(match?.id || '')
      && String(cachedPending?.boardId || '') === String(saveBoard?.id || '')
      && cachedPending?.draft
      && formationContentKey(cachedPending.draft, cachedPending.title) === formationContentKey(saveDraft, saveTitle)
      ? cachedPending : null)
    const pendingSave = queuedSave || {
      board: saveBoard || null,
      boardId: saveBoard?.id || '',
      createdByProfileId: normalize(previousPendingSave?.createdByProfileId) || normalize(saveBoard?.createdByProfileId) || user.id,
      draft: saveDraft,
      expectedVersionNumber: saveBoard?.currentVersionNumber ?? null,
      matchDayId: match.id,
      queueKey: `${match.id}:${saveBoard?.id || 'new'}`,
      shared: saveShared,
      startedAt: !saveBoard && previousPendingSave?.startedAt ? previousPendingSave.startedAt : new Date().toISOString(),
      title: normalize(saveTitle) || 'Formation Board',
    }
    let nextBoard = saveBoard
    let serverAcknowledged = Boolean(queuedSave?.acknowledged)
    let savedLocally = false
    if (!queuedSave) await saveOfflineFormation({ pendingSave }).then(() => { savedLocally = true }).catch(() => {})
    try {
      requireActiveBoard()
      if (!queuedSave?.acknowledged && !nextBoard) {
        nextBoard = await reconcilePendingBoard(queuedSave || previousPendingSave)
      }
      requireActiveBoard()
      if (!queuedSave?.acknowledged) {
        nextBoard = await saveCoachMatchFormationBoard(user, match, nextBoard, saveDraft, saveTitle, saveShared)
        serverAcknowledged = true
        requireActiveBoard()
        const acknowledgedPendingSave = { ...pendingSave, acknowledged: true, board: nextBoard, boardId: nextBoard.id, expectedVersionNumber: nextBoard.currentVersionNumber }
        await saveOfflineFormation({ nextBoard, pendingSave: acknowledgedPendingSave }).catch(() => {})
      }
      // Retain a confirmed server identity even if refresh or local storage fails.
      setBoard(nextBoard)
      const nextBoards = await getCoachFormationBoards(user)
      if (queuedSave?.acknowledged && !nextBoards.some((candidate) => candidate.id === nextBoard.id)) throw new Error('The saved Formation Board is no longer available to this account.')
      const nextPublications = await resolvePublications(nextBoard, user)
      if (queuedSave?.acknowledged && queuedSave.shared && !getActiveFormationPublication(nextPublications.matchItems, match.id)) throw new Error('The saved Formation Board visibility could not be confirmed. It remains queued for review.')
      requireActiveBoard()
      const currentEditor = editorSnapshotRef.current
      const preserveCurrentDraft = queuedSave && (
        queuedEditorRevision !== editorRevision.current
        || formationContentKey(currentEditor.draft, currentEditor.title) !== formationContentKey(saveDraft, saveTitle)
        || currentEditor.shared !== saveShared
      )
      setBoard(nextBoard)
      setBoards(nextBoards)
      if (!preserveCurrentDraft) {
        setDraft(createMobileFormationDraft({ board: nextBoard }))
        setTitle(nextBoard.title)
      }
      setSavedContentKey(formationContentKey(createMobileFormationDraft({ board: nextBoard }), nextBoard.title))
      setMatchPublications(nextPublications.matchItems)
      await saveOfflineFormation({ nextBoard, nextBoards, nextDraft: preserveCurrentDraft ? currentEditor.draft : createMobileFormationDraft({ board: nextBoard }), nextPublications: nextPublications.matchItems, pendingSave: null, pendingQueueKey: pendingSave.queueKey }).catch(() => {})
      if (!preserveCurrentDraft) await saveCoachFormationLocalDraft(user.id, context, currentDraftKey, null).catch(() => {})
      setQueuedRetryPending(false)
      setQueuedSaveAcknowledged(false)
      if (!preserveCurrentDraft) {
        setRestoredDraftKey('')
        setLocalState('idle')
      } else setLocalState('saved')
      return nextBoard
    } catch (saveError) {
      if (saveError.code === 'formation_navigation_changed') throw saveError
      const retryable = isRetryableFormationSaveError(saveError)
      const hasQueuedSnapshot = savedLocally || Boolean(queuedSave)
      if (!retryable) {
        await saveOfflineFormation({ nextBoard, pendingSave: null, pendingQueueKey: pendingSave.queueKey }).catch(() => {})
      }
      setQueuedRetryPending(retryable && hasQueuedSnapshot)
      setQueuedSaveAcknowledged(serverAcknowledged)
      requireActiveBoard()
      if (String(saveError?.message || '').includes('formation_board_version_conflict')) {
        const conflict = new Error('Another coach has saved a newer version. Your changes remain on this device. Reload the latest version to continue, or keep this screen open to review your changes first.')
        conflict.code = 'formation_conflict'
        throw conflict
      }
      if (retryable && hasQueuedSnapshot) {
        const queuedError = new Error('Saved on this phone. It will retry when the connection returns.')
        queuedError.code = 'formation_save_queued'
        throw queuedError
      }
      if (serverAcknowledged) throw new Error(`Saved to this match, but the latest lineup could not be refreshed. ${saveError.message}`)
      if (retryable) throw new Error('Your Formation Board could not be saved on this device or confirmed online. Keep this screen open and retry when connected.')
      throw saveError
    }
  }

  persistBoardRef.current = persistBoard

  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const nextBoard = await persistBoard()
      setNotice(`${nextBoard.title} saved to this match. ${shared ? 'Visible to parents and players.' : 'Coaches only.'}`)
    } catch (saveError) {
      if (saveError.code === 'formation_navigation_changed' || saveError.code === 'formation_save_queued') return
      setErrorRetry(saveError.code === 'formation_conflict' ? 'conflict' : 'save')
      setError(saveError.message)
    }
    finally { setBusy(false) }
  }

  const retryQueuedSave = useCallback(async () => {
    if (queuedRetryInFlight.current || !queuedRetryPending || busy || loading || refreshPending || serverBoardUnavailable || !canEdit || !match?.id) return
    queuedRetryInFlight.current = true
    try {
      const currentRoute = getCoachFormationRouteScope(user, context, match.id)
      if (currentRoute !== routeScope) return
      const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
      const currentProps = propsRef.current
      if (currentProps.match?.id !== match.id || currentProps.user?.id !== user.id || currentProps.context?.id !== context.id) return
      const formation = saved?.resources?.formation
      const pendingKey = `${match.id}:${board?.id || 'new'}`
      const pendingSave = formation?.pendingSaves?.[pendingKey]
        || (String(formation?.pendingSave?.matchDayId || '') === String(match.id) && (!formation.pendingSave.boardId || formation.pendingSave.boardId === board?.id) ? formation.pendingSave : null)
      if (!pendingSave || String(pendingSave.matchDayId || '') !== String(match.id)) return
      if (pendingSave.boardId && !pendingSave.board) return
      const queuedEditorRevision = editorRevision.current
      setBusy(true)
      setError('')
      const nextBoard = await persistBoardRef.current({ queuedEditorRevision, queuedSave: pendingSave })
      setNotice(`${nextBoard.title} saved to this match. ${pendingSave.shared ? 'Visible to parents and players.' : 'Coaches only.'}`)
    } catch (retryError) {
      if (retryError.code === 'formation_navigation_changed' || retryError.code === 'formation_save_queued' || isRetryableFormationSaveError(retryError)) return
      setErrorRetry(retryError.code === 'formation_conflict' ? 'conflict' : 'save')
      setError(retryError.message)
    } finally {
      queuedRetryInFlight.current = false
      setBusy(false)
    }
  }, [board?.id, busy, canEdit, context, loading, match?.id, queuedRetryPending, refreshPending, routeScope, serverBoardUnavailable, user])

  useEffect(() => {
    const retry = (state) => { if (state === 'active') void retryQueuedSave() }
    const subscription = AppState.addEventListener('change', retry)
    return () => subscription.remove()
  }, [retryQueuedSave])

  useEffect(() => {
    if (!queuedRetryPending || AppState.currentState !== 'active') return undefined
    const timer = setInterval(() => void retryQueuedSave(), 30_000)
    return () => clearInterval(timer)
  }, [queuedRetryPending, retryQueuedSave])

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

  const moveBenchPlayerToPitch = (playerId) => {
    if (!canEdit) return
    if (!currentPreset) return
    const nextDraft = placeMobileFormationPlayerInNextSlot(draft, currentPreset, playerId)
    if (nextDraft === draft) setNotice('The pitch is full. Move a starter to the Bench or swap the two Players.')
    else {
      commitPlayerMove(nextDraft)
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
    commitPlayerMove(assignMobileFormationPlayerToSlot(draft, player, activeSlot))
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
    commitPlayerMove(swapMobileFormationPlayers(draft, selectedPlayerId, playerId))
    setSelectedPlayerId('')
  }

  if (loading || draftScope !== routeScope) return (
    <View style={[styles.workspace, fullScreen && styles.canvas, fullScreen && { height: '100%' }]}>
      {!registerBackHandler && onBack ? <Pressable accessibilityLabel="Back from Formation Board" accessibilityRole="button" onPress={() => void handleBack()} style={styles.topIcon}><Text style={styles.label}>Back</Text></Pressable> : null}
      <View style={styles.card}><BrandLoader /><Text style={styles.body}>Loading Formation Board...</Text></View>
    </View>
  )

  const closeSheet = () => {
    setActiveSheet('')
    setShowBoards(false)
  }

  return (
    <View pointerEvents={busy ? 'none' : 'auto'} style={[styles.workspace, fullScreen && styles.canvas]}>
      {!registerBackHandler && onBack ? <Pressable accessibilityLabel="Back from Formation Board" accessibilityRole="button" onPress={() => void handleBack()} style={styles.topIcon}><Text style={styles.label}>Back</Text></Pressable> : null}
      <View style={fullScreen ? styles.field : null}>
      <View accessibilityLabel="Formation pitch" onLayout={(event) => setPitchLayout(event.nativeEvent.layout)} style={[styles.pitch, fullScreen && styles.pitchCanvas]}>
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
              commitPlayerMove(moveMobileFormationPlayer(draft, player.playerId, coordinates))
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

      </View>

      {undoMove && canEdit && undoMove.after === draft ? <View style={[styles.rowBetween, fullScreen && styles.canvasUndo]} accessibilityLiveRegion="polite"><Text style={[styles.body, fullScreen && styles.canvasText]}>Lineup changed</Text><Pressable accessibilityRole="button" accessibilityLabel="Undo last player move" onPress={() => { setDraft(undoMove.before); setSelectedPlayerId(''); setNotice(''); }} style={styles.topIcon}><Text style={[styles.count, fullScreen && styles.canvasText]}>Undo</Text></Pressable></View> : null}
      <View style={fullScreen ? styles.canvasFooter : null}>
      <View style={styles.bench}>
        <Pressable accessibilityLabel={`${benchExpanded ? 'Collapse' : 'Expand'} substitutes, ${draft.bench.length} Players`} accessibilityRole="button" onPress={() => setBenchExpanded((current) => !current)} style={styles.benchHeader}>
          <Text style={[styles.heading, fullScreen && { color: 'white', fontSize: 16, paddingHorizontal: 12 }]}>Subs ({draft.bench.length})</Text>
          <MaterialIcons color={fullScreen ? 'white' : palette.textPrimary} name={benchExpanded ? 'expand-less' : 'expand-more'} size={28} />
        </Pressable>
        {benchExpanded ? draft.bench.length ? <ScrollView contentContainerStyle={styles.benchContent} horizontal showsHorizontalScrollIndicator={false}>{draft.bench.map((player) => { const selected = selectedPlayerId === player.playerId; return <ScrollSafePressable accessibilityHint={canEdit ? draft.placements.length >= capacity ? 'Select this substitute for a swap from the pitch.' : 'Moves this substitute into the next empty pitch position.' : 'This substitute is read-only.'} accessibilityLabel={`${player.displayName}${player.shirtNumber ? `, shirt ${player.shirtNumber}` : ''}, substitute`} accessibilityRole="button" accessibilityState={{ disabled: !canEdit, selected }} disabled={!canEdit} key={player.playerId} onPress={() => draft.placements.length < capacity ? moveBenchPlayerToPitch(player.playerId) : selectPlayer(player.playerId, 'bench')} style={[styles.benchPlayerButton, selected && styles.benchPlayerButtonSelected]}><ShirtPlayer name={player.displayName} number={player.shirtNumber} styles={styles} /></ScrollSafePressable> })}</ScrollView> : <Text style={[styles.body, fullScreen && styles.canvasText]}>No substitutes selected.</Text> : null}
        {benchExpanded && selectedBenchPlayer ? <Text accessibilityLiveRegion="polite" style={[styles.body, fullScreen && styles.canvasText]}>{selectedBenchPlayer.displayName} selected. Tap a starter to swap.</Text> : null}
      </View>

      <ScrollView style={fullScreen ? styles.canvasAlert : null}>
      {!hasEditAuthority ? <View style={styles.warning}><Text style={styles.label}>Viewing only</Text><Text style={styles.body}>Coach or manager plan access is required to edit, save or share this Formation Board.</Text></View> : null}
      {localState === 'failed' ? <Text accessibilityRole="alert" style={styles.body}>Changes could not be protected on this device. Keep this screen open and save to the match when connected.</Text> : null}
      {serverBoardUnavailable ? <View style={styles.warning}><Text style={styles.heading}>Board unavailable</Text><Text style={styles.body}>The saved board is no longer available to this account. Cached content cannot be edited or sent.</Text></View> : null}
      {error ? <View style={styles.warning}><Text style={styles.body}>{error}</Text><Action disabled={busy || (!canEdit && errorRetry === 'save')} label={errorRetry === 'conflict' ? 'Reload latest version' : errorRetry === 'save' ? 'Retry save' : errorRetry === 'back' ? 'Retry Back' : 'Try again'} onPress={errorRetry === 'conflict' ? reloadLatestBoard : errorRetry === 'save' ? save : errorRetry === 'back' ? handleBack : load} secondary styles={styles} /></View> : null}
      {removalMode && canEdit ? <View style={styles.selectedPanel}><Text style={styles.body}>Tap starters to select them, then move the selection to the Bench.</Text><View style={styles.row}><Action disabled={!removalIds.length} label={`Move ${removalIds.length || ''} selected to Bench`.replace('  ', ' ')} onPress={() => { commitPlayerMove(moveMobileFormationPlayersToBench(draft, removalIds)); setRemovalIds([]); setRemovalMode(false) }} styles={styles} /><Action label="Cancel" onPress={() => { setRemovalIds([]); setRemovalMode(false) }} secondary styles={styles} /></View></View> : null}

      </ScrollView>
      <View accessibilityLabel="Formation Board tools" style={styles.dock}>
        <Pressable accessibilityRole="button" accessibilityLabel={matchBoards.length ? `Saved lineups (${matchBoards.length})` : 'Formation Board options'} onPress={() => { setShowBoards(matchBoards.length > 0); setActiveSheet('details') }} style={styles.dockItem}><MaterialIcons color={fullScreen ? 'white' : palette.textPrimary} name="more-horiz" size={24} /><Text style={styles.dockLabel}>{matchBoards.length ? `Saved (${matchBoards.length})` : 'Options'}</Text></Pressable>
        {BOARD_TABS.map((tab) => { const active = activeSheet === tab.value; const share = tab.value === 'share'; const disabled = !canEdit && !share; return <Pressable accessibilityRole="button" accessibilityState={{ disabled, selected: active }} disabled={disabled} key={tab.value} onPress={() => setActiveSheet(tab.value)} style={[styles.dockItem, active && styles.dockItemActive, share && styles.dockItemShare, disabled && styles.dockItemDisabled]}><MaterialIcons color={share ? 'rgb(104,242,162)' : active ? palette.selectedForeground : fullScreen ? 'white' : palette.textSecondary} name={tab.icon} size={28} /><Text style={[styles.dockLabel, active && styles.dockLabelActive, share && styles.dockLabelShare]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{tab.label}</Text></Pressable> })}
      </View>

      </View>

      <Modal accessibilityViewIsModal animationType="slide" onRequestClose={closeSheet} transparent visible={Boolean(activeSheet)}>
        <SafeAreaProvider>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.modalBackdrop}>
          <View accessibilityLabel={`${activeSheet || 'Formation Board'} options`} role="dialog" style={styles.modalPanel}>
            <View style={styles.sheetHandle} />
            <View style={styles.rowBetween}>
              <Text style={styles.heading}>{activeSheet === 'formation' ? 'Formation' : activeSheet === 'players' ? 'Players' : activeSheet === 'share' ? 'Save to match' : 'Board options'}</Text>
              <Pressable accessibilityLabel="Close options" accessibilityRole="button" onPress={closeSheet} style={styles.topIcon}><MaterialIcons color={palette.textPrimary} name="close" size={25} /></Pressable>
            </View>

            {activeSheet === 'formation' ? <ScrollView contentContainerStyle={styles.stack}>
              <Text style={styles.body}>Change the shape at any time. Your goalkeeper stays in goal, and outfield players keep their positions as closely as the new shape allows.</Text>
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

            {activeSheet === 'share' ? <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
              <Text style={styles.body}>{match ? `${match.teamName} v ${match.opponent}` : 'Open a match to save this board.'}</Text>
              {match ? <Text style={styles.body}>Find saved lineups in Match Day, open this match, then choose Formation and tap Saved.</Text> : null}
              <Text style={styles.label}>Lineup name</Text>
              <TextInput editable={canEdit && !busy} accessibilityLabel="Formation plan title" maxLength={120} onChangeText={setTitle} style={styles.input} value={title} />
              <Text style={styles.label}>Who can see this lineup?</Text>
              <Choice disabled={!canEdit || busy} label="Coaches only" onPress={() => setShared(false)} selected={!shared} styles={styles} />
              <Choice disabled={!canEdit || busy} label="Parents and players" onPress={() => setShared(true)} selected={shared} styles={styles} />
              {error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : null}
              {queuedRetryPending ? <Text accessibilityLiveRegion="polite" style={styles.body}>{queuedSaveAcknowledged ? 'Saved to this match. Refreshing the saved lineup is pending. Keep this board open to retry the refresh automatically.' : 'Saved on this phone. Saving to the match has not been confirmed. Keep this board open to retry automatically, or tap Save to match to retry now.'}</Text> : null}
              {notice.startsWith(`${title} saved to this match.`) ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
            <Action disabled={!canEdit || busy || !match?.id || !title.trim() || !selectedIds.size} label={busy ? 'Saving...' : 'Save to match'} onPress={() => void save()} styles={styles} />
            </ScrollView> : null}

            {activeSheet === 'details' ? <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Plan name</Text>
              <TextInput editable={canEdit && !busy} accessibilityLabel="Formation plan title" onChangeText={setTitle} style={[styles.input, !canEdit && styles.actionDisabled]} value={title} />
              <Text style={styles.body}>{saveLabel} | {draft.placements.length} on pitch | {draft.bench.length} Subs</Text>
              {draft.placements.length ? <Action disabled={!canEdit} label={removalMode ? 'Cancel taking Players off' : 'Take Players off'} onPress={() => { setRemovalMode((current) => !current); setRemovalIds([]); setSelectedPlayerId(''); closeSheet() }} secondary styles={styles} /> : null}
              <Action disabled={!hasEditAuthority || refreshPending || busy} iconKey="action.new-board" label={serverBoardUnavailable ? 'Start replacement board' : 'New board'} onPress={() => { closeSheet(); confirmDraftReplacement(startNewBoard) }} secondary styles={styles} />
              {matchBoards.length ? <Pressable accessibilityRole="button" onPress={() => setShowBoards((current) => !current)}><Text style={styles.count}>{showBoards ? 'Hide saved boards' : `Open saved boards (${matchBoards.length})`}</Text></Pressable> : null}
              {showBoards ? matchBoards.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => { closeSheet(); confirmDraftReplacement(() => applyBoard(item)) }} style={styles.savedBoard}><Text style={styles.label}>{item.title}</Text><Text style={styles.body}>Saved to this match | Version {item.currentVersionNumber}</Text></Pressable>) : null}
            </ScrollView> : null}
          </View>
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      <Modal accessibilityViewIsModal animationType="slide" onRequestClose={() => setActiveSlotId('')} transparent visible={Boolean(activeSlot)}>
        <SafeAreaProvider>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.modalBackdrop}>
          <View accessibilityLabel="Choose Player" role="dialog" style={styles.modalPanel}>
            <View style={styles.sheetHandle} />
            <View style={styles.rowBetween}>
              <View><Text style={styles.eyebrow}>Choose Player</Text><Text style={styles.heading}>{getMobileFormationSlotLabel(activeSlot)}</Text></View>
              <Pressable accessibilityLabel="Close Player picker" accessibilityRole="button" onPress={() => setActiveSlotId('')} style={styles.topIcon}><MaterialIcons color={palette.textPrimary} name="close" size={25} /></Pressable>
            </View>
            {activeSlotPlayer ? <View style={styles.selectedPanel}><Text style={styles.label}>Currently {activeSlotPlayer.displayName}</Text><Action disabled={!canEdit} label="Move to Bench" onPress={() => { commitPlayerMove(moveMobileFormationPlayersToBench(draft, [activeSlotPlayer.playerId])); setActiveSlotId(''); setNotice(`${activeSlotPlayer.displayName} moved to the Bench.`) }} secondary styles={styles} /></View> : <Text style={styles.body}>This position is empty. Choose any Player from the team.</Text>}
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
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </View>
  )
}
