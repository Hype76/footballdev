import AsyncStorage from '@react-native-async-storage/async-storage'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  applyMobileFormationPreset,
  assignMobileFormationPlayerToSlot,
  createMobileFormationDraft,
  createMobileFormationPreferenceKey,
  getMobileFormationCapacity,
  getMobileFormationPitchPercent,
  getMobileFormationPitchRatio,
  getMobileFormationSelectedPlayerIds,
  getMobileFormationSlotLabel,
  MOBILE_FORMATION_GAME_FORMATS,
  moveMobileFormationPlayer,
  moveMobileFormationPlayersToBench,
  parseMobileFormationPreferences,
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
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

const normalize = (value) => String(value ?? '').trim()
const RESOURCE_CATEGORIES = Object.freeze([
  Object.freeze({ label: 'General', value: 'general' }),
  Object.freeze({ label: 'Training', value: 'training' }),
  Object.freeze({ label: 'Match day', value: 'match_day' }),
  Object.freeze({ label: 'Development', value: 'development' }),
  Object.freeze({ label: 'Admin', value: 'admin' }),
])
const WORKFLOW_STEPS = Object.freeze([
  Object.freeze({ label: 'Formation', value: 'formation' }),
  Object.freeze({ label: 'Squad', value: 'squad' }),
  Object.freeze({ label: 'Lineup', value: 'lineup' }),
  Object.freeze({ label: 'Save', value: 'finish' }),
])

function createStyles(palette) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderColor: palette.accent, borderRadius: 14, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 50, minWidth: 138, paddingHorizontal: 14, paddingVertical: 11 },
    actionDanger: { backgroundColor: palette.surfaceRaised, borderColor: palette.danger },
    actionDisabled: { opacity: 0.45 },
    actionSecondary: { backgroundColor: palette.surfaceRaised, borderColor: palette.border },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    actionTextDanger: { color: palette.danger },
    actionTextSecondary: { color: palette.textPrimary },
    benchButton: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 10, justifyContent: 'center', minHeight: 38, paddingHorizontal: 10 },
    benchButtonDisabled: { opacity: 0.45 },
    benchButtonText: { color: palette.accentForeground, fontSize: 12, fontWeight: '900' },
    benchCard: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, gap: 8, minWidth: 158, padding: 10 },
    benchCardSelected: { backgroundColor: palette.selected, borderColor: palette.accent, borderWidth: 2 },
    benchContent: { gap: 8, paddingBottom: 2, paddingRight: 12 },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 11, padding: 14 },
    chip: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, minHeight: 44, paddingHorizontal: 13, paddingVertical: 10 },
    chipSelected: { backgroundColor: palette.selected, borderColor: palette.accent },
    chipText: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    chipTextSelected: { color: palette.selectedForeground },
    count: { color: palette.accent, fontSize: 13, fontWeight: '900' },
    eyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
    heading: { color: palette.textPrimary, fontSize: 20, fontWeight: '900' },
    input: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 13, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 50, paddingHorizontal: 13, paddingVertical: 10 },
    label: { color: palette.textPrimary, fontSize: 14, fontWeight: '900' },
    modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'flex-end' },
    modalPanel: { backgroundColor: palette.surface, borderColor: palette.border, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, gap: 12, maxHeight: '86%', padding: 16 },
    modalPlayer: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 13, paddingVertical: 10 },
    emptySlot: { alignItems: 'center', backgroundColor: 'rgba(16,24,40,0.72)', borderColor: 'rgba(255,255,255,0.82)', borderRadius: 24, borderStyle: 'dashed', borderWidth: 2, height: 44, justifyContent: 'center', position: 'absolute', transform: [{ translateX: -22 }, { translateY: -22 }], width: 44, zIndex: 4 },
    emptySlotLabel: { backgroundColor: 'rgba(16,24,40,0.86)', borderRadius: 7, color: 'rgb(255,255,255)', fontSize: 9, fontWeight: '900', left: -27, paddingHorizontal: 5, paddingVertical: 2, position: 'absolute', textAlign: 'center', top: 46, width: 98 },
    marker: { alignItems: 'center', height: 74, justifyContent: 'flex-start', position: 'absolute', transform: [{ translateX: -38 }, { translateY: -25 }], width: 76, zIndex: 10 },
    markerBadge: { alignItems: 'center', backgroundColor: 'rgb(16,24,40)', borderColor: 'rgb(255,255,255)', borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 20, minWidth: 20, paddingHorizontal: 4, position: 'absolute', right: -8, top: -5, zIndex: 3 },
    markerBadgeText: { color: 'rgb(255,255,255)', fontSize: 10, fontWeight: '900', lineHeight: 12 },
    markerCircle: { alignItems: 'center', backgroundColor: 'rgb(247,250,248)', borderColor: 'rgb(255,255,255)', borderRadius: 25, borderWidth: 3, elevation: 5, height: 50, justifyContent: 'center', shadowColor: 'rgb(16,24,40)', shadowOffset: { height: 3, width: 0 }, shadowOpacity: 0.28, shadowRadius: 5, width: 50 },
    markerCircleDragging: { backgroundColor: 'rgb(224,242,254)', borderColor: 'rgb(186,230,253)', transform: [{ scale: 1.1 }] },
    markerCircleRemoval: { borderColor: palette.warning, borderWidth: 4 },
    markerCircleSelected: { backgroundColor: palette.selected, borderColor: palette.accent, borderWidth: 4 },
    markerName: { backgroundColor: 'rgba(16,24,40,0.9)', borderRadius: 7, color: 'rgb(255,255,255)', fontSize: 9, fontWeight: '900', marginTop: 3, maxWidth: 76, paddingHorizontal: 5, paddingVertical: 2, textAlign: 'center' },
    markerSilhouetteHead: { borderRadius: 7, height: 14, marginBottom: 2, width: 14 },
    markerSilhouetteShoulders: { borderTopLeftRadius: 14, borderTopRightRadius: 14, height: 14, width: 28 },
    pitch: { backgroundColor: 'rgb(35,122,69)', borderColor: 'rgb(255,255,255)', borderRadius: 22, borderWidth: 4, height: 475, overflow: 'hidden', position: 'relative' },
    pitchBoxBottom: { borderBottomWidth: 0, bottom: 11 },
    pitchBoxLarge: { borderColor: 'rgba(255,255,255,0.82)', borderWidth: 2, height: '14%', left: '24%', position: 'absolute', width: '52%' },
    pitchBoxSmall: { borderColor: 'rgba(255,255,255,0.82)', borderWidth: 2, height: '6%', left: '38%', position: 'absolute', width: '24%' },
    pitchBoxTop: { borderTopWidth: 0, top: 11 },
    pitchCentreCircle: { borderColor: 'rgba(255,255,255,0.82)', borderRadius: 43, borderWidth: 2, height: 86, left: '50%', position: 'absolute', top: '50%', transform: [{ translateX: -43 }, { translateY: -43 }], width: 86 },
    pitchCentreSpot: { backgroundColor: 'rgba(255,255,255,0.82)', borderRadius: 5, height: 10, left: '50%', position: 'absolute', top: '50%', transform: [{ translateX: -5 }, { translateY: -5 }], width: 10 },
    pitchHalfway: { backgroundColor: 'rgba(255,255,255,0.82)', height: 2, left: 11, position: 'absolute', right: 11, top: '50%' },
    pitchOutline: { borderColor: 'rgba(255,255,255,0.82)', borderRadius: 17, borderWidth: 2, bottom: 11, left: 11, position: 'absolute', right: 11, top: 11 },
    pitchStripe: { bottom: 0, position: 'absolute', top: 0, width: '12.5%' },
    planHeader: { backgroundColor: palette.surfaceRaised, borderColor: palette.accent, borderRadius: 20, borderWidth: 1, gap: 8, padding: 16 },
    progress: { flexDirection: 'row', gap: 6 },
    progressItem: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 10, borderWidth: 1, flex: 1, gap: 3, minHeight: 50, paddingHorizontal: 5, paddingVertical: 7 },
    progressItemActive: { backgroundColor: palette.selected, borderColor: palette.accent },
    progressLabel: { color: palette.textSecondary, fontSize: 10, fontWeight: '800', textAlign: 'center' },
    progressLabelActive: { color: palette.selectedForeground },
    progressNumber: { color: palette.textSecondary, fontSize: 11, fontWeight: '900' },
    progressNumberActive: { color: palette.accent },
    row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    rowBetween: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
    savedBoard: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, gap: 4, padding: 12 },
    selectedPanel: { backgroundColor: palette.selected, borderColor: palette.accent, borderRadius: 15, borderWidth: 1, gap: 8, padding: 12 },
    stack: { gap: 12 },
    status: { alignSelf: 'flex-start', backgroundColor: palette.selected, borderColor: palette.accent, borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
    statusText: { color: palette.selectedForeground, fontSize: 12, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 15, borderWidth: 1, gap: 8, padding: 13 },
  })
}

function Action({ danger = false, disabled = false, label, onPress, secondary = false, styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, secondary && styles.actionSecondary, danger && styles.actionDanger, disabled && styles.actionDisabled, pressed && { opacity: 0.78 }]}
    >
      <Text style={[styles.actionText, secondary && styles.actionTextSecondary, danger && styles.actionTextDanger]}>{label}</Text>
    </Pressable>
  )
}

function Choice({ label, onPress, selected, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>
}

function PitchLines({ styles }) {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => <View key={index} style={[styles.pitchStripe, { backgroundColor: index % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)', left: `${index * 12.5}%` }]} />)}
      <View style={styles.pitchOutline} />
      <View style={styles.pitchHalfway} />
      <View style={styles.pitchCentreCircle} />
      <View style={styles.pitchCentreSpot} />
      <View style={[styles.pitchBoxLarge, styles.pitchBoxTop]} />
      <View style={[styles.pitchBoxLarge, styles.pitchBoxBottom]} />
      <View style={[styles.pitchBoxSmall, styles.pitchBoxTop]} />
      <View style={[styles.pitchBoxSmall, styles.pitchBoxBottom]} />
    </>
  )
}

function FormationPlayerMarker({ canMove, layout, onMove, onPress, palette, player, removal, selected, styles }) {
  const [dragging, setDragging] = useState(false)
  const [livePosition, setLivePosition] = useState(null)
  const playerX = getMobileFormationPitchRatio(player.x)
  const playerY = getMobileFormationPitchRatio(player.y)

  const clamp = useCallback((value) => Math.max(0.04, Math.min(0.96, value)), [])
  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => canMove && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4),
    onPanResponderMove: (_, gesture) => {
      if (!canMove || !layout.width || !layout.height) return
      if (Math.abs(gesture.dx) <= 4 && Math.abs(gesture.dy) <= 4) return
      setDragging(true)
      setLivePosition({
        x: clamp(playerX + (gesture.dx / layout.width)),
        y: clamp(playerY + (gesture.dy / layout.height)),
      })
    },
    onPanResponderRelease: (_, gesture) => {
      const moved = canMove && layout.width && layout.height && (Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4)
      if (moved) onMove({
        x: clamp(playerX + (gesture.dx / layout.width)),
        y: clamp(playerY + (gesture.dy / layout.height)),
      })
      else onPress()
      setDragging(false)
      setLivePosition(null)
    },
    onPanResponderTerminate: () => {
      setDragging(false)
      setLivePosition(null)
    },
    onPanResponderTerminationRequest: () => false,
  }), [canMove, clamp, layout.height, layout.width, onMove, onPress, playerX, playerY])

  const position = livePosition || { x: playerX, y: playerY }
  const silhouetteColor = selected ? palette.selectedForeground : 'rgb(52,64,84)'
  return (
    <View
      {...panResponder.panHandlers}
      accessibilityHint={canMove ? 'Tap to change this Player. Drag to move the Player freely around the pitch.' : 'Tap to select this Player.'}
      accessibilityLabel={`${player.displayName}${player.shirtNumber ? `, shirt ${player.shirtNumber}` : ''}`}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected || removal) }}
      style={[styles.marker, { left: `${position.x * 100}%`, top: `${position.y * 100}%` }]}
    >
      <View style={[styles.markerCircle, selected && styles.markerCircleSelected, removal && styles.markerCircleRemoval, dragging && styles.markerCircleDragging]}>
        <View style={[styles.markerSilhouetteHead, { backgroundColor: silhouetteColor }]} />
        <View style={[styles.markerSilhouetteShoulders, { backgroundColor: silhouetteColor }]} />
        {player.shirtNumber ? <View style={styles.markerBadge}><Text style={styles.markerBadgeText}>{player.shirtNumber}</Text></View> : null}
      </View>
      <Text numberOfLines={1} style={styles.markerName}>{player.displayName}</Text>
    </View>
  )
}

function publicationResourceId(publication) {
  return normalize(publication?.resource_id ?? publication?.resourceId)
}

export function CoachFormationBoard({ context, match = null, matches = [], palette, players, stale, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [board, setBoard] = useState(null)
  const [boards, setBoards] = useState([])
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(() => createMobileFormationDraft())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [offline, setOffline] = useState(false)
  const [presets, setPresets] = useState([])
  const [matchPublications, setMatchPublications] = useState([])
  const [pitchLayout, setPitchLayout] = useState({ height: 475, width: 320 })
  const [resourcePublications, setResourcePublications] = useState([])
  const [removalMode, setRemovalMode] = useState(false)
  const [removalIds, setRemovalIds] = useState([])
  const [resourceCategory, setResourceCategory] = useState('general')
  const [selectedMatchId, setSelectedMatchId] = useState(match?.id || '')
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [activeSlotId, setActiveSlotId] = useState('')
  const [slotSearch, setSlotSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showBoards, setShowBoards] = useState(false)
  const [showMatchPicker, setShowMatchPicker] = useState(false)
  const [title, setTitle] = useState(match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board')
  const [workflowStep, setWorkflowStep] = useState('formation')
  const preferenceKey = useMemo(() => createMobileFormationPreferenceKey({ clubId: context.clubId, teamId: context.teamId, userId: user.id }), [context.clubId, context.teamId, user.id])

  const resolvePublications = useCallback(async (nextBoard) => {
    if (!nextBoard?.id) return { matchItems: [], resourceItems: [] }
    const [matchItems, resourceItems] = await Promise.all([
      getCoachFormationPublications(user, nextBoard.id),
      getCoachFormationResourcePublications(user, nextBoard.id),
    ])
    return { matchItems, resourceItems }
  }, [user])

  const applyBoard = useCallback(async (nextBoard, nextPresets = presets) => {
    const nextDraft = createMobileFormationDraft({ board: nextBoard })
    const nextPublications = await resolvePublications(nextBoard)
    setBoard(nextBoard)
    setDraft(nextDraft)
    setTitle(nextBoard?.title || 'Formation Board')
    setSelectedMatchId(nextBoard?.linkedMatchDayId || '')
    setMatchPublications(nextPublications.matchItems)
    setResourcePublications(nextPublications.resourceItems)
    setPresets(nextPresets)
    setSelectedPlayerId('')
    setShowBoards(false)
    setWorkflowStep('lineup')
  }, [presets, resolvePublications])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [savedPreference, nextPresets, nextBoards] = await Promise.all([
        AsyncStorage.getItem(preferenceKey),
        getCoachFormationPresets(user),
        getCoachFormationBoards(user),
      ])
      const preference = parseMobileFormationPreferences(savedPreference) || { gameFormat: '11v11', presetKey: '11v11-4-4-2' }
      const matchingPreset = nextPresets.find((preset) => preset.key === preference.presetKey)
        || nextPresets.find((preset) => preset.key === '11v11-4-4-2')
        || nextPresets.find((preset) => preset.gameFormat === '11v11')
        || nextPresets[0]
      const linkedBoard = match?.id ? nextBoards.find((candidate) => candidate.linkedMatchDayId === match.id) || null : null
      const nextDraft = createMobileFormationDraft({ board: linkedBoard, gameFormat: matchingPreset?.gameFormat || preference.gameFormat, presetKey: matchingPreset?.key || preference.presetKey })
      const nextPublications = await resolvePublications(linkedBoard)
      setBoard(linkedBoard)
      setBoards(nextBoards)
      setDraft(nextDraft)
      setPresets(nextPresets)
      setMatchPublications(nextPublications.matchItems)
      setResourcePublications(nextPublications.resourceItems)
      setSelectedMatchId(linkedBoard?.linkedMatchDayId || match?.id || '')
      setWorkflowStep(linkedBoard ? 'lineup' : 'formation')
      setTitle(linkedBoard?.title || (match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board'))
      setOffline(false)
      await saveCoachOfflineResources(user.id, context, { formation: { board: linkedBoard, boards: nextBoards, draft: nextDraft, matchDayId: match?.id || '', matchPublications: nextPublications.matchItems, presets: nextPresets, resourcePublications: nextPublications.resourceItems } }).catch(() => {})
    } catch (loadError) {
      const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
      const formation = saved?.resources?.formation
      if (formation?.draft) {
        setBoard(formation.board || null)
        setBoards(Array.isArray(formation.boards) ? formation.boards : [])
        setDraft(formation.draft)
        setPresets(Array.isArray(formation.presets) ? formation.presets : [])
        setMatchPublications(Array.isArray(formation.matchPublications) ? formation.matchPublications : [])
        setResourcePublications(Array.isArray(formation.resourcePublications) ? formation.resourcePublications : [])
        setSelectedMatchId(formation.board?.linkedMatchDayId || '')
        setTitle(formation.board?.title || 'Formation Board')
        setWorkflowStep(formation.board ? 'lineup' : 'formation')
        setOffline(true)
      } else setError(normalize(loadError?.message) || 'The Formation Board could not be loaded.')
    } finally { setLoading(false) }
  }, [context, match, preferenceKey, resolvePublications, user])

  useEffect(() => { void load() }, [load])

  const selectedIds = useMemo(() => getMobileFormationSelectedPlayerIds(draft), [draft])
  const currentPreset = presets.find((preset) => preset.key === draft.presetKey)
    || presets.find((preset) => preset.gameFormat === draft.gameFormat)
    || null
  const activeSlot = currentPreset?.slots?.find((slot) => slot.id === activeSlotId) || null
  const activeSlotPlayer = draft.placements.find((player) => player.slotId === activeSlotId) || null
  const filteredSlotPlayers = players.filter((player) => selectedIds.has(player.id) && player.playerName.toLowerCase().includes(slotSearch.trim().toLowerCase()))
  const linkedMatchId = board?.linkedMatchDayId || ''
  const linkedMatch = (match?.id === linkedMatchId ? match : null) || matches.find((candidate) => candidate.id === linkedMatchId) || null
  const activePublication = matchPublications.find((publication) => !(publication.withdrawn_at ?? publication.withdrawnAt)) || null
  const latestResourcePublication = resourcePublications[0] || null
  const unavailable = stale || offline
  const capacity = getMobileFormationCapacity(draft.gameFormat)
  const workflowStepIndex = WORKFLOW_STEPS.findIndex((step) => step.value === workflowStep)
  const rememberPreset = (nextDraft) => {
    setDraft(nextDraft)
    setSelectedPlayerId('')
    void AsyncStorage.setItem(preferenceKey, serializeMobileFormationPreferences(nextDraft)).catch(() => {})
  }

  const chooseFormat = (gameFormat) => {
    const preset = presets.find((candidate) => candidate.gameFormat === gameFormat && candidate.key === `${gameFormat}-4-4-2`)
      || presets.find((candidate) => candidate.gameFormat === gameFormat)
    if (preset) rememberPreset(applyMobileFormationPreset(draft, preset))
  }

  const startNewBoard = () => {
    const preset = presets.find((candidate) => candidate.key === draft.presetKey) || presets[0]
    const nextDraft = createMobileFormationDraft({ gameFormat: preset?.gameFormat || '11v11', presetKey: preset?.key || '11v11-4-4-2' })
    setBoard(null)
    setDraft(nextDraft)
    setTitle('Formation Board')
    setSelectedMatchId(match?.id || '')
    setMatchPublications([])
    setResourcePublications([])
    setSelectedPlayerId('')
    setShowBoards(false)
    setWorkflowStep('formation')
    setNotice('New standalone Formation Board ready. Confirm the formation to begin.')
  }

  const persistBoard = async () => {
    const startedAt = Date.now()
    let nextBoard = board
    try {
      nextBoard = board
        ? await saveCoachFormationBoard(user, board, draft, title)
        : await createCoachFormationBoard(user, match, draft, title)
      if (match?.id && nextBoard.linkedMatchDayId !== match.id) nextBoard = await linkCoachFormationBoard(user, nextBoard.id, match.id)
      const nextBoards = await getCoachFormationBoards(user)
      const nextPublications = await resolvePublications(nextBoard)
      setBoard(nextBoard)
      setBoards(nextBoards)
      setDraft(createMobileFormationDraft({ board: nextBoard }))
      setTitle(nextBoard.title)
      setSelectedMatchId(nextBoard.linkedMatchDayId || selectedMatchId)
      setMatchPublications(nextPublications.matchItems)
      setResourcePublications(nextPublications.resourceItems)
      return nextBoard
    } catch (saveError) {
      if (!nextBoard) {
        const reconciled = await getCoachFormationBoards(user).then((items) => items.find((candidate) => (
          candidate.title === title.trim() && new Date(candidate.createdAt || 0).getTime() >= startedAt - 5000
        ))).catch(() => null)
        if (reconciled) {
          setBoard(reconciled)
          setDraft(createMobileFormationDraft({ board: reconciled }))
          nextBoard = reconciled
        }
      }
      throw new Error(nextBoard
        ? 'The private Formation Board is preserved, but the latest save needs another online retry.'
        : normalize(saveError?.message) || 'The Formation Board could not be saved.')
    }
  }

  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const nextBoard = await persistBoard()
      setNotice(nextBoard.linkedMatchDayId ? 'Private Formation Board saved and linked to its match.' : 'Standalone Formation Board saved privately. You can link or publish it whenever you are ready.')
    } catch (saveError) { setError(saveError.message) }
    finally { setBusy(false) }
  }

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
    } catch (linkError) { setError(normalize(linkError?.message) || 'The Formation Board could not be linked to that match.') }
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
        } catch (publishError) { setError(normalize(publishError?.message) || 'The Formation Board could not be published to Team Resources.') }
        finally { setBusy(false) }
      } },
    ],
  )

  const saveAndPublish = () => Alert.alert(
    activePublication ? 'Update the Parent match plan?' : 'Share this match plan with Parents?',
    'The latest pitch and Bench will be saved and shared with authorised Parents for the linked fixture. Staff notes and unselected Players are not shared.',
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
        } catch (publishError) { setError(normalize(publishError?.message) || 'The match plan could not be saved and shared.') }
        finally { setBusy(false) }
      } },
    ],
  )

  const withdraw = () => Alert.alert(
    'Withdraw the Parent plan?',
    'The saved private Formation Board remains available to staff.',
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
    setSelectedPlayerId('')
    setActiveSlotId(slotId)
    setSlotSearch('')
  }

  const chooseSlotPlayer = (player) => {
    if (!activeSlot) return
    const replacedPlayer = activeSlotPlayer
    setDraft(assignMobileFormationPlayerToSlot(draft, player, activeSlot))
    setActiveSlotId('')
    setSlotSearch('')
    setNotice(replacedPlayer
      ? `${player.playerName} added at ${getMobileFormationSlotLabel(activeSlot)}. ${replacedPlayer.displayName} moved to the Bench.`
      : `${player.playerName} added at ${getMobileFormationSlotLabel(activeSlot)}.`)
  }

  const selectPlayer = (playerId, location) => {
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

  if (loading) return <View style={styles.card}><ActivityIndicator color={palette.accent} /><Text style={styles.body}>Loading Formation Board...</Text></View>

  return (
    <View style={styles.stack}>
      <View style={styles.planHeader}>
        <View style={styles.rowBetween}>
          <View><Text style={styles.eyebrow}>{linkedMatchId ? 'Match-linked plan' : 'Standalone plan'}</Text><Text style={styles.heading}>{title || 'Formation Board'}</Text></View>
          <View style={styles.status}><Text style={styles.statusText}>{activePublication ? 'Shared' : board ? 'Saved' : 'New'}</Text></View>
        </View>
        <Text style={styles.body}>{draft.gameFormat} | {(currentPreset?.displayName || draft.presetKey).replace(`${draft.gameFormat}-`, '')} | {draft.placements.length} on pitch | {draft.bench.length} Bench</Text>
        {linkedMatch ? <Text style={styles.body}>{linkedMatch.teamName} v {linkedMatch.opponent}</Text> : null}
        {!match?.id ? <View style={styles.row}><Action label="New board" onPress={startNewBoard} secondary styles={styles} /><Action disabled={!boards.length} label={showBoards ? 'Hide saved' : `Open saved (${boards.length})`} onPress={() => setShowBoards((current) => !current)} secondary styles={styles} /></View> : null}
      </View>

      {showBoards ? <View style={styles.card}><Text style={styles.heading}>Saved Formation Boards</Text>{boards.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => void applyBoard(item)} style={styles.savedBoard}><Text style={styles.label}>{item.title}</Text><Text style={styles.body}>{item.linkedMatchDayId ? 'Linked to a match' : 'Standalone'} | Version {item.currentVersionNumber}</Text></Pressable>)}</View> : null}
      {unavailable ? <View style={styles.warning}><Text style={styles.heading}>Offline read</Text><Text style={styles.body}>Showing the last encrypted board. Saving, linking and publishing require a successful online refresh.</Text></View> : null}
      {error ? <View style={styles.warning}><Text style={styles.body}>{error}</Text><Action label="Try again" onPress={load} secondary styles={styles} /></View> : null}
      {notice ? <View style={styles.selectedPanel}><Text style={styles.body}>{notice}</Text></View> : null}

      <View accessibilityLabel={`Formation Board step ${workflowStepIndex + 1} of ${WORKFLOW_STEPS.length}`} style={styles.progress}>
        {WORKFLOW_STEPS.map((step, index) => <View key={step.value} style={[styles.progressItem, index === workflowStepIndex && styles.progressItemActive]}><Text style={[styles.progressNumber, index === workflowStepIndex && styles.progressNumberActive]}>{index + 1}</Text><Text style={[styles.progressLabel, index === workflowStepIndex && styles.progressLabelActive]}>{step.label}</Text></View>)}
      </View>

      {workflowStep === 'formation' ? <View style={styles.card}>
        <Text style={styles.eyebrow}>Step 1 of 4</Text>
        <Text style={styles.heading}>Choose formation</Text>
        <Text style={styles.body}>Your last choice is remembered, but you must confirm the formation before choosing Players. The pitch will then load every position as an empty slot.</Text>
        <Text style={styles.label}>Game format</Text>
        <View style={styles.row}>{MOBILE_FORMATION_GAME_FORMATS.map((format) => <Choice key={format.value} label={format.label} onPress={() => chooseFormat(format.value)} selected={draft.gameFormat === format.value} styles={styles} />)}</View>
        <Text style={styles.label}>Formation</Text>
        <View style={styles.row}>{presets.filter((preset) => preset.gameFormat === draft.gameFormat).map((preset) => <Choice key={preset.key} label={preset.displayName || preset.key.replace(`${draft.gameFormat}-`, '')} onPress={() => rememberPreset(applyMobileFormationPreset(draft, preset))} selected={draft.presetKey === preset.key} styles={styles} />)}</View>
        <Action disabled={!currentPreset} label="Confirm formation" onPress={() => { setWorkflowStep('squad'); setNotice('Formation confirmed. Choose the Players available for this plan.') }} styles={styles} />
      </View> : null}

      {workflowStep === 'squad' ? <View style={styles.card}>
        <Text style={styles.eyebrow}>Step 2 of 4</Text>
        <View style={styles.rowBetween}><Text style={styles.heading}>Choose squad</Text><Text style={styles.count}>{selectedIds.size} selected</Text></View>
        <Text style={styles.body}>Select the Players for this plan. They will start on the Bench so you can assign each pitch position yourself.</Text>
        <View style={styles.row}><Action label="Select full squad" onPress={() => setDraft(setMobileFormationSquad(draft, players))} secondary styles={styles} /><Action label="Clear" onPress={() => setDraft(setMobileFormationSquad(draft, []))} secondary styles={styles} /></View>
        <View style={styles.row}>{players.map((player) => <Choice key={player.id} label={`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.playerName}`} onPress={() => setDraft(toggleMobileFormationSquadPlayer(draft, player))} selected={selectedIds.has(player.id)} styles={styles} />)}</View>
        <View style={styles.row}><Action label="Back" onPress={() => setWorkflowStep('formation')} secondary styles={styles} /><Action disabled={!selectedIds.size} label="Load empty pitch" onPress={() => { setWorkflowStep('lineup'); setNotice(`${selectedIds.size} Players selected. Tap an empty pitch position to add a Player.`) }} styles={styles} /></View>
      </View> : null}

      {workflowStep === 'lineup' ? <View style={styles.card}>
        <Text style={styles.eyebrow}>Step 3 of 4</Text>
        <View style={styles.rowBetween}><Text style={styles.heading}>Build lineup</Text><Text style={styles.count}>{draft.placements.length}/{capacity}</Text></View>
        <Text style={styles.body}>Tap an empty position to add a Player. Drag any Player marker freely around the pitch to show the movement or shape you want. Tap a marker to replace or swap that Player.</Text>
        {draft.placements.length ? <Action label={removalMode ? 'Cancel taking off' : 'Take Players off'} onPress={() => { setRemovalMode((current) => !current); setRemovalIds([]); setSelectedPlayerId('') }} secondary styles={styles} /> : null}
        {removalMode ? <View style={styles.selectedPanel}><Text style={styles.body}>Select one or more starters, then move them together.</Text><Action disabled={!removalIds.length} label={`Move ${removalIds.length || ''} selected to Bench`.replace('  ', ' ')} onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, removalIds)); setRemovalIds([]); setRemovalMode(false) }} styles={styles} /></View> : null}
        <View accessibilityLabel="Formation pitch" onLayout={(event) => setPitchLayout(event.nativeEvent.layout)} style={styles.pitch}>
          <PitchLines styles={styles} />
          {(currentPreset?.slots || []).filter((slot) => !draft.placements.some((candidate) => candidate.slotId === slot.id)).map((slot) => (
            <Pressable
              accessibilityHint="Opens the Player picker for this empty position"
              accessibilityLabel={`Add Player at ${getMobileFormationSlotLabel(slot)}`}
              accessibilityRole="button"
              key={slot.id}
              onPress={() => openSlotPicker(slot.id)}
              style={[styles.emptySlot, { left: `${getMobileFormationPitchPercent(slot.x)}%`, top: `${getMobileFormationPitchPercent(slot.y)}%` }]}
            >
              <MaterialIcons color="rgb(255,255,255)" name="add" size={24} />
              <Text numberOfLines={2} style={styles.emptySlotLabel}>{getMobileFormationSlotLabel(slot)}</Text>
            </Pressable>
          ))}
          {draft.placements.map((player) => (
            <FormationPlayerMarker
              canMove={!removalMode}
              key={player.playerId}
              layout={pitchLayout}
              onMove={(coordinates) => {
                setDraft((current) => moveMobileFormationPlayer(current, player.playerId, coordinates))
                setSelectedPlayerId('')
                setNotice(`${player.displayName} moved. Save the board to keep this coaching position.`)
              }}
              onPress={() => {
                if (removalMode) selectPlayer(player.playerId, 'pitch')
                else if (player.slotId) openSlotPicker(player.slotId)
                else selectPlayer(player.playerId, 'pitch')
              }}
              palette={palette}
              player={player}
              removal={removalIds.includes(player.playerId)}
              selected={selectedPlayerId === player.playerId}
              styles={styles}
            />
          ))}
        </View>

        <View style={styles.rowBetween}><Text style={styles.heading}>Bench</Text><Text style={styles.count}>{draft.bench.length}</Text></View>
        {draft.bench.length ? <ScrollView contentContainerStyle={styles.benchContent} horizontal showsHorizontalScrollIndicator={false}>{draft.bench.map((player) => <View key={player.playerId} style={[styles.benchCard, selectedPlayerId === player.playerId && styles.benchCardSelected]}><Pressable accessibilityRole="button" accessibilityState={{ selected: selectedPlayerId === player.playerId }} onPress={() => selectPlayer(player.playerId, 'bench')}><Text style={styles.label}>{`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.displayName}`}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: draft.placements.length >= capacity }} disabled={draft.placements.length >= capacity} onPress={() => moveBenchPlayerToPitch(player.playerId)} style={[styles.benchButton, draft.placements.length >= capacity && styles.benchButtonDisabled]}><Text style={styles.benchButtonText}>Move to pitch</Text></Pressable></View>)}</ScrollView> : <Text style={styles.body}>No Players are on the Bench.</Text>}
        <View style={styles.row}><Action label="Edit squad" onPress={() => setWorkflowStep('squad')} secondary styles={styles} /><Action disabled={!selectedIds.size} label="Continue to save" onPress={() => setWorkflowStep('finish')} styles={styles} /></View>
      </View> : null}

      {workflowStep === 'finish' ? <View style={styles.card}>
        <Text style={styles.eyebrow}>Step 4 of 4</Text>
        <Text style={styles.heading}>Save first, choose the destination later</Text>
        <Text style={styles.body}>{draft.placements.length} on pitch | {draft.bench.length} Bench | {draft.gameFormat} {(currentPreset?.displayName || draft.presetKey).replace(`${draft.gameFormat}-`, '')}</Text>
        <Action disabled={busy || unavailable || !title.trim() || !selectedIds.size} label={busy ? 'Saving...' : 'Save private Formation Board'} onPress={() => void save()} styles={styles} />
        <Text style={styles.body}>Saving does not require a match and does not share anything.</Text>

        {!linkedMatchId ? <View style={styles.stack}>
          <View style={styles.rowBetween}><Text style={styles.label}>Optional match link</Text><Action label={showMatchPicker ? 'Hide matches' : 'Choose match'} onPress={() => setShowMatchPicker((current) => !current)} secondary styles={styles} /></View>
          {showMatchPicker ? <View style={styles.stack}>{matches.length ? matches.map((item) => <Choice key={item.id} label={`${item.matchDate || 'Date TBC'} | ${item.teamName} v ${item.opponent}`} onPress={() => setSelectedMatchId(item.id)} selected={selectedMatchId === item.id} styles={styles} />) : <Text style={styles.body}>No Match Day fixture is available for this Team.</Text>}<Action disabled={busy || unavailable || !selectedMatchId || !selectedIds.size} label="Save and link to match" onPress={() => void linkToMatch()} secondary styles={styles} /></View> : null}
        </View> : <Text style={styles.body}>Linked to {linkedMatch?.teamName || 'Team'} v {linkedMatch?.opponent || 'opponent'}.</Text>}

        <View style={styles.stack}>
          <Text style={styles.label}>Optional Team Resources publication</Text>
          <View style={styles.row}>{RESOURCE_CATEGORIES.map((category) => <Choice key={category.value} label={category.label} onPress={() => setResourceCategory(category.value)} selected={resourceCategory === category.value} styles={styles} />)}</View>
          <Action disabled={busy || unavailable || !selectedIds.size} label={latestResourcePublication ? 'Save and update Team Resource' : 'Save and publish to Team Resources'} onPress={publishToResources} secondary styles={styles} />
        </View>

        {linkedMatchId ? <Action disabled={busy || unavailable || !title.trim() || !selectedIds.size} label={activePublication ? 'Save and update Parents' : 'Save and share with Parents'} onPress={saveAndPublish} secondary styles={styles} /> : <Text style={styles.body}>Parent sharing becomes available after you link the saved board to a match.</Text>}
        <Pressable accessibilityRole="button" onPress={() => setShowAdvanced((current) => !current)}><Text style={styles.count}>{showAdvanced ? 'Hide plan options' : 'Plan name and options'}</Text></Pressable>
        {showAdvanced ? <View style={styles.stack}><Text style={styles.label}>Plan name</Text><TextInput accessibilityLabel="Formation plan title" onChangeText={setTitle} style={styles.input} value={title} />{activePublication ? <Action danger disabled={busy || unavailable} label="Withdraw Parent plan" onPress={withdraw} secondary styles={styles} /> : null}</View> : null}
        <Action label="Back to lineup" onPress={() => setWorkflowStep('lineup')} secondary styles={styles} />
      </View> : null}

      <Modal animationType="slide" onRequestClose={() => setActiveSlotId('')} transparent visible={Boolean(activeSlot)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.rowBetween}>
              <View><Text style={styles.eyebrow}>Choose Player</Text><Text style={styles.heading}>{getMobileFormationSlotLabel(activeSlot)}</Text></View>
              <Action label="Close" onPress={() => setActiveSlotId('')} secondary styles={styles} />
            </View>
            {activeSlotPlayer ? <View style={styles.selectedPanel}><Text style={styles.label}>Currently {activeSlotPlayer.displayName}</Text><Action label="Move to Bench" onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, [activeSlotPlayer.playerId])); setActiveSlotId(''); setNotice(`${activeSlotPlayer.displayName} moved to the Bench.`) }} secondary styles={styles} /></View> : <Text style={styles.body}>This position is empty. Choose any Player in the squad.</Text>}
            <TextInput accessibilityLabel="Search squad" onChangeText={setSlotSearch} placeholder="Search squad" placeholderTextColor={palette.textSecondary} style={styles.input} value={slotSearch} />
            <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
              {filteredSlotPlayers.map((player) => {
                const placement = draft.placements.find((item) => item.playerId === player.id)
                const onBench = draft.bench.some((item) => item.playerId === player.id)
                const current = placement?.slotId === activeSlotId
                const location = placement ? getMobileFormationSlotLabel(currentPreset?.slots?.find((slot) => slot.id === placement.slotId)) : onBench ? 'Bench' : 'Not selected yet'
                return <Pressable accessibilityRole="button" accessibilityState={{ disabled: current }} disabled={current} key={player.id} onPress={() => chooseSlotPlayer(player)} style={[styles.modalPlayer, current && styles.actionDisabled]}><View><Text style={styles.label}>{`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.playerName}`}</Text><Text style={styles.body}>{current ? 'Already in this position' : location}</Text></View><Text style={styles.count}>{current ? 'Current' : activeSlotPlayer ? 'Choose' : 'Add'}</Text></Pressable>
              })}
              {!filteredSlotPlayers.length ? <Text style={styles.body}>No Players match that search.</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}
