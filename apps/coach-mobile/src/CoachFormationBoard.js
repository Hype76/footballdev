import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  applyMobileFormationPreset,
  buildMobileFormationLineup,
  createMobileFormationDraft,
  createMobileFormationPreferenceKey,
  getMobileFormationCapacity,
  getMobileFormationSelectedPlayerIds,
  MOBILE_FORMATION_GAME_FORMATS,
  moveMobileFormationPlayersToBench,
  parseMobileFormationPreferences,
  placeMobileFormationLineup,
  placeMobileFormationPlayer,
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
    pitch: { backgroundColor: palette.pitchSurface, borderColor: 'rgba(255,255,255,0.82)', borderRadius: 18, borderWidth: 2, height: 475, overflow: 'hidden', position: 'relative' },
    pitchHalfway: { backgroundColor: 'rgba(255,255,255,0.68)', height: 1, left: 0, position: 'absolute', right: 0, top: '50%' },
    planHeader: { backgroundColor: palette.surfaceRaised, borderColor: palette.accent, borderRadius: 20, borderWidth: 1, gap: 8, padding: 16 },
    playerName: { color: palette.textPrimary, fontSize: 10, fontWeight: '900', textAlign: 'center' },
    playerSlot: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.accent, borderRadius: 11, borderWidth: 1, justifyContent: 'center', minHeight: 45, paddingHorizontal: 3, position: 'absolute' },
    playerSlotEmpty: { backgroundColor: 'rgba(0,0,0,0.20)', borderColor: 'rgba(255,255,255,0.55)', borderStyle: 'dashed' },
    playerSlotRemoval: { borderColor: palette.warning, borderWidth: 3 },
    playerSlotSelected: { backgroundColor: palette.selected, borderColor: palette.accent, borderWidth: 3 },
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
  const [resourcePublications, setResourcePublications] = useState([])
  const [removalMode, setRemovalMode] = useState(false)
  const [removalIds, setRemovalIds] = useState([])
  const [resourceCategory, setResourceCategory] = useState('general')
  const [selectedMatchId, setSelectedMatchId] = useState(match?.id || '')
  const [selectedPlayerId, setSelectedPlayerId] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showBoards, setShowBoards] = useState(false)
  const [showMatchPicker, setShowMatchPicker] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [showSquad, setShowSquad] = useState(false)
  const [title, setTitle] = useState(match?.id ? `${match.teamName} v ${match.opponent}` : 'Formation Board')
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
    setShowSquad(getMobileFormationSelectedPlayerIds(nextDraft).size === 0)
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
      setShowSetup(false)
      setShowSquad(getMobileFormationSelectedPlayerIds(nextDraft).size === 0)
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
        setShowSquad(getMobileFormationSelectedPlayerIds(formation.draft).size === 0)
        setOffline(true)
      } else setError(normalize(loadError?.message) || 'The Formation Board could not be loaded.')
    } finally { setLoading(false) }
  }, [context, match, preferenceKey, resolvePublications, user])

  useEffect(() => { void load() }, [load])

  const selectedIds = useMemo(() => getMobileFormationSelectedPlayerIds(draft), [draft])
  const currentPreset = presets.find((preset) => preset.key === draft.presetKey)
    || presets.find((preset) => preset.gameFormat === draft.gameFormat)
    || null
  const linkedMatchId = board?.linkedMatchDayId || ''
  const linkedMatch = (match?.id === linkedMatchId ? match : null) || matches.find((candidate) => candidate.id === linkedMatchId) || null
  const activePublication = matchPublications.find((publication) => !(publication.withdrawn_at ?? publication.withdrawnAt)) || null
  const latestResourcePublication = resourcePublications[0] || null
  const unavailable = stale || offline
  const capacity = getMobileFormationCapacity(draft.gameFormat)
  const pitchSlotWidth = useMemo(() => {
    const rowCounts = new Map()
    for (const slot of currentPreset?.slots || []) {
      const row = Math.round(Number(slot.y || 0) / 5) * 5
      rowCounts.set(row, (rowCounts.get(row) || 0) + 1)
    }
    const widestRow = Math.max(1, ...rowCounts.values())
    if (widestRow >= 4) return 23
    if (widestRow === 3) return 29
    if (widestRow === 2) return 41
    return 50
  }, [currentPreset?.slots])
  const selectedPlacement = draft.placements.find((player) => player.playerId === selectedPlayerId)
  const selectedBenchPlayer = draft.bench.find((player) => player.playerId === selectedPlayerId)

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

  const buildLineup = (useFullSquad = false) => {
    if (!currentPreset) return
    const squadDraft = useFullSquad ? setMobileFormationSquad(draft, players) : draft
    setDraft(buildMobileFormationLineup(squadDraft, currentPreset))
    setSelectedPlayerId('')
    setRemovalMode(false)
    setRemovalIds([])
    setShowSquad(false)
    setNotice(useFullSquad ? `Full squad selected. ${Math.min(capacity, players.length)} Players placed and everyone else moved to the Bench.` : 'Starting lineup rebuilt. Remaining selected Players are on the Bench.')
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
    setShowSquad(true)
    setNotice('New standalone Formation Board ready. No match is required.')
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
        <Text style={styles.eyebrow}>{linkedMatchId ? 'Match-linked Formation Board' : 'Standalone Formation Board'}</Text>
        <Text style={styles.heading}>{title || 'Formation Board'}</Text>
        <Text style={styles.body}>{draft.gameFormat} | {(currentPreset?.displayName || draft.presetKey).replace(`${draft.gameFormat}-`, '')} | {draft.placements.length} starting | {draft.bench.length} Bench</Text>
        {linkedMatch ? <Text style={styles.body}>Linked to {linkedMatch.teamName} v {linkedMatch.opponent}</Text> : <Text style={styles.body}>No match linked. Build and save this plan independently.</Text>}
        <View style={styles.row}>
          <View style={styles.status}><Text style={styles.statusText}>{activePublication ? 'Shared with Parents' : board ? 'Private saved board' : 'Not saved yet'}</Text></View>
          {latestResourcePublication ? <View style={styles.status}><Text style={styles.statusText}>In Team Resources</Text></View> : null}
        </View>
        {!match?.id ? <View style={styles.row}><Action label="New board" onPress={startNewBoard} secondary styles={styles} /><Action disabled={!boards.length} label={showBoards ? 'Hide saved boards' : `Open saved (${boards.length})`} onPress={() => setShowBoards((current) => !current)} secondary styles={styles} /></View> : null}
      </View>

      {showBoards ? <View style={styles.card}><Text style={styles.heading}>Saved Formation Boards</Text>{boards.map((item) => <Pressable accessibilityRole="button" key={item.id} onPress={() => void applyBoard(item)} style={styles.savedBoard}><Text style={styles.label}>{item.title}</Text><Text style={styles.body}>{item.linkedMatchDayId ? 'Linked to a match' : 'Standalone'} | Version {item.currentVersionNumber}</Text></Pressable>)}</View> : null}
      {unavailable ? <View style={styles.warning}><Text style={styles.heading}>Offline read</Text><Text style={styles.body}>Showing the last encrypted board. Saving, linking and publishing require a successful online refresh.</Text></View> : null}
      {error ? <View style={styles.warning}><Text style={styles.body}>{error}</Text><Action label="Try again" onPress={load} secondary styles={styles} /></View> : null}
      {notice ? <View style={styles.selectedPanel}><Text style={styles.body}>{notice}</Text></View> : null}

      <View style={styles.card}>
        <View style={styles.rowBetween}><View><Text style={styles.eyebrow}>1. Setup</Text><Text style={styles.heading}>{draft.gameFormat} | {(currentPreset?.displayName || draft.presetKey).replace(`${draft.gameFormat}-`, '')}</Text></View><Action label={showSetup ? 'Done' : 'Change'} onPress={() => setShowSetup((current) => !current)} secondary styles={styles} /></View>
        {showSetup ? <View style={styles.stack}>
          <Text style={styles.label}>Game format</Text>
          <View style={styles.row}>{MOBILE_FORMATION_GAME_FORMATS.map((format) => <Choice key={format.value} label={format.label} onPress={() => chooseFormat(format.value)} selected={draft.gameFormat === format.value} styles={styles} />)}</View>
          <Text style={styles.label}>Formation</Text>
          <View style={styles.row}>{presets.filter((preset) => preset.gameFormat === draft.gameFormat).map((preset) => <Choice key={preset.key} label={preset.displayName || preset.key.replace(`${draft.gameFormat}-`, '')} onPress={() => rememberPreset(applyMobileFormationPreset(draft, preset))} selected={draft.presetKey === preset.key} styles={styles} />)}</View>
        </View> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}><View><Text style={styles.eyebrow}>2. Squad</Text><Text style={styles.heading}>{selectedIds.size} selected</Text></View><Action label={showSquad ? 'Done' : 'Edit squad'} onPress={() => setShowSquad((current) => !current)} secondary styles={styles} /></View>
        <Action disabled={!currentPreset || !players.length} label="Use full squad & build team" onPress={() => buildLineup(true)} styles={styles} />
        {showSquad ? <View style={styles.stack}>
          <View style={styles.row}><Action label="Select all" onPress={() => setDraft(setMobileFormationSquad(draft, players))} secondary styles={styles} /><Action label="Clear" onPress={() => setDraft(setMobileFormationSquad(draft, []))} secondary styles={styles} /></View>
          <View style={styles.row}>{players.map((player) => <Choice key={player.id} label={`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.playerName}`} onPress={() => setDraft(toggleMobileFormationSquadPlayer(draft, player))} selected={selectedIds.has(player.id)} styles={styles} />)}</View>
          <Action disabled={!currentPreset || !selectedIds.size} label={`Build starting ${Math.min(capacity, selectedIds.size)}`} onPress={() => buildLineup(false)} styles={styles} />
        </View> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}><View><Text style={styles.eyebrow}>3. Arrange</Text><Text style={styles.heading}>Starting lineup</Text></View><Text style={styles.count}>{draft.placements.length}/{capacity}</Text></View>
        <Text style={styles.body}>Use the clear Bench controls below, or tap two Players to swap them.</Text>
        <View style={styles.row}><Action label={removalMode ? 'Cancel taking off' : 'Take Players off'} onPress={() => { setRemovalMode((current) => !current); setRemovalIds([]); setSelectedPlayerId('') }} secondary styles={styles} />{draft.bench.length && draft.placements.length < capacity ? <Action label="Fill empty pitch positions" onPress={() => { setDraft(placeMobileFormationLineup(draft, currentPreset)); setSelectedPlayerId(''); setNotice('Empty pitch positions filled from the Bench.') }} secondary styles={styles} /> : null}</View>
        {removalMode ? <View style={styles.selectedPanel}><Text style={styles.body}>Select one or more starters, then move them together.</Text><Action disabled={!removalIds.length} label={`Move ${removalIds.length || ''} selected to Bench`.replace('  ', ' ')} onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, removalIds)); setRemovalIds([]); setRemovalMode(false) }} styles={styles} /></View> : null}
        {!removalMode && selectedPlayerId ? <View style={styles.selectedPanel}><Text style={styles.body}>{selectedPlacement ? `${selectedPlacement.displayName} selected. Tap another starter or Bench Player to swap.` : `${selectedBenchPlayer?.displayName || 'Bench Player'} selected.`}</Text>{selectedPlacement ? <Action label="Move selected to Bench" onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, [selectedPlayerId])); setSelectedPlayerId('') }} secondary styles={styles} /> : <Action disabled={!selectedBenchPlayer || draft.placements.length >= capacity} label="Move selected to pitch" onPress={() => moveBenchPlayerToPitch(selectedPlayerId)} styles={styles} />}</View> : null}
        <View accessibilityLabel="Formation pitch" style={styles.pitch}>
          <View style={styles.pitchHalfway} />
          {(currentPreset?.slots || []).map((slot) => {
            const player = draft.placements.find((candidate) => candidate.slotId === slot.id)
            const selectedForRemoval = player && removalIds.includes(player.playerId)
            const selected = player && selectedPlayerId === player.playerId
            return (
              <Pressable
                accessibilityHint={player ? removalMode ? 'Selects this Player to move to the Bench' : 'Selects this Player for a swap' : selectedBenchPlayer ? 'Places the selected Bench Player here' : 'This position is empty'}
                accessibilityRole="button"
                accessibilityState={{ selected: Boolean(selected || selectedForRemoval) }}
                key={slot.id}
                onPress={() => {
                  if (player) selectPlayer(player.playerId, 'pitch')
                  else if (selectedBenchPlayer) { setDraft(placeMobileFormationPlayer(draft, selectedPlayerId, slot)); setSelectedPlayerId('') }
                }}
                style={[styles.playerSlot, !player && styles.playerSlotEmpty, selected && styles.playerSlotSelected, selectedForRemoval && styles.playerSlotRemoval, { left: `${Math.max(2, Math.min(98 - pitchSlotWidth, Number(slot.x || 0) - (pitchSlotWidth / 2)))}%`, top: `${Math.max(1, Math.min(89, Number(slot.y || 0) - 5))}%`, width: `${pitchSlotWidth}%` }]}
              >
                <Text numberOfLines={2} style={styles.playerName}>{player ? `${player.shirtNumber ? `${player.shirtNumber} ` : ''}${player.displayName}` : 'Empty'}</Text>
              </Pressable>
            )
          })}
        </View>

        <View style={styles.rowBetween}><Text style={styles.heading}>Bench</Text><Text style={styles.count}>{draft.bench.length}</Text></View>
        {draft.bench.length ? <ScrollView contentContainerStyle={styles.benchContent} horizontal showsHorizontalScrollIndicator={false}>{draft.bench.map((player) => <View key={player.playerId} style={[styles.benchCard, selectedPlayerId === player.playerId && styles.benchCardSelected]}><Pressable accessibilityRole="button" accessibilityState={{ selected: selectedPlayerId === player.playerId }} onPress={() => selectPlayer(player.playerId, 'bench')}><Text style={styles.label}>{`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.displayName}`}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: draft.placements.length >= capacity }} disabled={draft.placements.length >= capacity} onPress={() => moveBenchPlayerToPitch(player.playerId)} style={[styles.benchButton, draft.placements.length >= capacity && styles.benchButtonDisabled]}><Text style={styles.benchButtonText}>Move to pitch</Text></Pressable></View>)}</ScrollView> : <Text style={styles.body}>No Players are on the Bench.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Finish</Text>
        <Text style={styles.heading}>Save first, choose the destination later</Text>
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
      </View>
    </View>
  )
}
