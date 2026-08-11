import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  applyMobileFormationPreset,
  createMobileFormationDraft,
  createMobileFormationPreferenceKey,
  getMobileFormationSelectedPlayerIds,
  MOBILE_FORMATION_GAME_FORMATS,
  moveMobileFormationPlayersToBench,
  parseMobileFormationPreferences,
  placeMobileFormationLineup,
  placeMobileFormationPlayer,
  serializeMobileFormationPreferences,
  setMobileFormationSquad,
  toggleMobileFormationSquadPlayer,
} from '../../mobile-core/src/coachFormationBoardCore'
import {
  createCoachFormationBoard,
  getCoachFormationBoards,
  getCoachFormationPresets,
  getCoachFormationPublications,
  linkCoachFormationBoard,
  publishCoachFormationBoard,
  saveCoachFormationBoard,
  withdrawCoachFormationBoard,
} from '../../mobile-core/src/coachFormationBoardData'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

const normalize = (value) => String(value ?? '').trim()

function createStyles(palette) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderColor: palette.accent, borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDanger: { backgroundColor: palette.surfaceRaised, borderColor: palette.danger },
    actionDisabled: { opacity: 0.45 },
    actionSecondary: { backgroundColor: palette.surfaceRaised, borderColor: palette.border },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    actionTextDanger: { color: palette.danger },
    actionTextSecondary: { color: palette.textPrimary },
    bench: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 21 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 14 },
    chip: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, minHeight: 44, paddingHorizontal: 13, paddingVertical: 10 },
    chipSelected: { backgroundColor: palette.selected, borderColor: palette.accent },
    chipText: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    chipTextSelected: { color: palette.accent },
    heading: { color: palette.textPrimary, fontSize: 19, fontWeight: '900' },
    input: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 13, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 50, paddingHorizontal: 13, paddingVertical: 10 },
    label: { color: palette.textPrimary, fontSize: 14, fontWeight: '900' },
    pitch: { backgroundColor: palette.pitchSurface, borderColor: 'rgba(255,255,255,0.8)', borderRadius: 18, borderWidth: 2, height: 540, overflow: 'hidden', position: 'relative' },
    pitchHalfway: { backgroundColor: 'rgba(255,255,255,0.65)', height: 1, left: 0, position: 'absolute', right: 0, top: '50%' },
    playerName: { color: palette.textPrimary, fontSize: 10, fontWeight: '900', textAlign: 'center' },
    playerSlot: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.accent, borderRadius: 11, borderWidth: 1, justifyContent: 'center', minHeight: 48, paddingHorizontal: 4, position: 'absolute', width: '36%' },
    playerSlotEmpty: { backgroundColor: 'rgba(0,0,0,0.20)', borderColor: 'rgba(255,255,255,0.55)', borderStyle: 'dashed' },
    playerSlotRemoval: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    selectedSummary: { color: palette.accent, fontSize: 13, fontWeight: '900' },
    stack: { gap: 12 },
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
  return <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></Pressable>
}

export function CoachFormationBoard({ context, match, palette, players, stale, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [board, setBoard] = useState(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(() => createMobileFormationDraft())
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [offline, setOffline] = useState(false)
  const [presets, setPresets] = useState([])
  const [publications, setPublications] = useState([])
  const [removalMode, setRemovalMode] = useState(false)
  const [removalIds, setRemovalIds] = useState([])
  const [selectedBenchPlayerId, setSelectedBenchPlayerId] = useState('')
  const [title, setTitle] = useState(`${match.teamName} v ${match.opponent}`)
  const preferenceKey = useMemo(() => createMobileFormationPreferenceKey({ clubId: context.clubId, teamId: context.teamId, userId: user.id }), [context.clubId, context.teamId, user.id])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [savedPreference, nextPresets, boards] = await Promise.all([
        AsyncStorage.getItem(preferenceKey),
        getCoachFormationPresets(user),
        getCoachFormationBoards(user),
      ])
      const preference = parseMobileFormationPreferences(savedPreference) || { gameFormat: '11v11', presetKey: '11v11-4-4-2' }
      const linkedBoard = boards.find((candidate) => candidate.linkedMatchDayId === match.id) || null
      const matchingPreset = nextPresets.find((preset) => preset.key === preference.presetKey)
        || nextPresets.find((preset) => preset.key === '11v11-4-4-2')
        || nextPresets.find((preset) => preset.gameFormat === '11v11')
        || nextPresets[0]
      const nextDraft = createMobileFormationDraft({ board: linkedBoard, gameFormat: matchingPreset?.gameFormat || preference.gameFormat, presetKey: matchingPreset?.key || preference.presetKey })
      const nextPublications = linkedBoard ? await getCoachFormationPublications(user, linkedBoard.id) : []
      setBoard(linkedBoard)
      setDraft(nextDraft)
      setPresets(nextPresets)
      setPublications(nextPublications)
      setTitle(linkedBoard?.title || `${match.teamName} v ${match.opponent}`)
      setOffline(false)
      await saveCoachOfflineResources(user.id, context, { formation: { board: linkedBoard, draft: nextDraft, matchDayId: match.id, presets: nextPresets, publications: nextPublications } }).catch(() => {})
    } catch (loadError) {
      const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
      const formation = saved?.resources?.formation
      if (formation?.matchDayId === match.id && formation?.draft) {
        setBoard(formation.board || null)
        setDraft(formation.draft)
        setPresets(Array.isArray(formation.presets) ? formation.presets : [])
        setPublications(Array.isArray(formation.publications) ? formation.publications : [])
        setTitle(formation.board?.title || `${match.teamName} v ${match.opponent}`)
        setOffline(true)
      } else {
        setError(normalize(loadError?.message) || 'The formation plan could not be loaded.')
      }
    } finally {
      setLoading(false)
    }
  }, [context, match.id, match.opponent, match.teamName, preferenceKey, user])

  useEffect(() => { void load() }, [load])

  const selectedIds = useMemo(() => getMobileFormationSelectedPlayerIds(draft), [draft])
  const currentPreset = presets.find((preset) => preset.key === draft.presetKey)
    || presets.find((preset) => preset.gameFormat === draft.gameFormat)
    || null
  const activePublication = publications.find((publication) => !(publication.withdrawn_at ?? publication.withdrawnAt)) || null
  const unavailable = stale || offline

  const rememberPreset = (nextDraft) => {
    setDraft(nextDraft)
    void AsyncStorage.setItem(preferenceKey, serializeMobileFormationPreferences(nextDraft)).catch(() => {})
  }

  const chooseFormat = (gameFormat) => {
    const preset = presets.find((candidate) => candidate.gameFormat === gameFormat && candidate.key === `${gameFormat}-4-4-2`)
      || presets.find((candidate) => candidate.gameFormat === gameFormat)
    if (preset) rememberPreset(applyMobileFormationPreset(draft, preset))
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    const startedAt = Date.now()
    let nextBoard = board
    try {
      nextBoard = board
        ? await saveCoachFormationBoard(user, board, draft, title)
        : await createCoachFormationBoard(user, match, draft, title)
      setBoard(nextBoard)
      if (nextBoard.linkedMatchDayId !== match.id) nextBoard = await linkCoachFormationBoard(user, nextBoard.id, match.id)
      setBoard(nextBoard)
      setDraft(createMobileFormationDraft({ board: nextBoard }))
      setTitle(nextBoard.title)
      setPublications(await getCoachFormationPublications(user, nextBoard.id))
      setNotice('Private match plan saved. Parents cannot see it until you publish it.')
    } catch (saveError) {
      if (!nextBoard) {
        const reconciled = await getCoachFormationBoards(user).then((boards) => boards.find((candidate) => (
          candidate.linkedMatchDayId === match.id
          || (candidate.title === title.trim() && new Date(candidate.createdAt || 0).getTime() >= startedAt - 5000)
        ))).catch(() => null)
        if (reconciled) {
          nextBoard = reconciled
          setBoard(reconciled)
          setDraft(createMobileFormationDraft({ board: reconciled }))
        }
      }
      setError(nextBoard
        ? 'The existing private formation is preserved, but the latest save, Match link, or final confirmation needs another online retry. This board will be reused.'
        : normalize(saveError?.message) || 'The formation plan could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const publish = () => Alert.alert(
    'Publish this match plan?',
    'Parents linked to this Team and match will see the pitch and Bench. Staff notes and unselected Players are not shared.',
    [
      { style: 'cancel', text: 'Cancel' },
      { text: 'Publish', onPress: async () => {
        setBusy(true)
        setError('')
        try {
          await publishCoachFormationBoard(user, board, match.id)
          setPublications(await getCoachFormationPublications(user, board.id))
          setNotice('The latest saved match plan is now visible to authorised Parents.')
        } catch (publishError) {
          setError(normalize(publishError?.message) || 'The formation plan could not be published.')
        } finally { setBusy(false) }
      } },
    ],
  )

  const withdraw = () => Alert.alert(
    'Withdraw the Parent plan?',
    'The saved private formation remains available to staff.',
    [
      { style: 'cancel', text: 'Cancel' },
      { style: 'destructive', text: 'Withdraw', onPress: async () => {
        setBusy(true)
        setError('')
        try {
          await withdrawCoachFormationBoard(user, board, match.id)
          setPublications(await getCoachFormationPublications(user, board.id))
          setNotice('The match plan is no longer visible to Parents.')
        } catch (withdrawError) {
          setError(normalize(withdrawError?.message) || 'The formation plan could not be withdrawn.')
        } finally { setBusy(false) }
      } },
    ],
  )

  if (loading) return <View style={styles.card}><ActivityIndicator /><Text style={styles.body}>Loading formations...</Text></View>

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.heading}>Formation plan</Text>
        <Text style={styles.body}>Choose the squad once, place the lineup, and keep every other selected Player on the Bench.</Text>
        <TextInput accessibilityLabel="Formation plan title" onChangeText={setTitle} style={styles.input} value={title} />
      </View>
      {unavailable ? <View style={styles.warning}><Text style={styles.heading}>Offline read</Text><Text style={styles.body}>Showing the last encrypted formation plan. Saving and Parent publishing require a successful online refresh.</Text></View> : null}
      {error ? <View style={styles.warning}><Text style={styles.body}>{error}</Text><Action label="Try again" onPress={load} secondary styles={styles} /></View> : null}
      {notice ? <View style={styles.card}><Text style={styles.body}>{notice}</Text></View> : null}

      <View style={styles.card}>
        <Text style={styles.label}>Game format</Text>
        <View style={styles.row}>{MOBILE_FORMATION_GAME_FORMATS.map((format) => <Choice key={format.value} label={format.label} onPress={() => chooseFormat(format.value)} selected={draft.gameFormat === format.value} styles={styles} />)}</View>
        <Text style={styles.label}>Formation</Text>
        <View style={styles.row}>{presets.filter((preset) => preset.gameFormat === draft.gameFormat).map((preset) => <Choice key={preset.key} label={preset.displayName || preset.key.replace(`${draft.gameFormat}-`, '')} onPress={() => rememberPreset(applyMobileFormationPreset(draft, preset))} selected={draft.presetKey === preset.key} styles={styles} />)}</View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}><Text style={styles.heading}>Squad</Text><Text style={styles.selectedSummary}>{selectedIds.size} selected</Text></View>
        <View style={styles.row}><Action label="Select all" onPress={() => setDraft(setMobileFormationSquad(draft, players))} secondary styles={styles} /><Action label="Clear" onPress={() => setDraft(setMobileFormationSquad(draft, []))} secondary styles={styles} /></View>
        <View style={styles.row}>{players.map((player) => <Choice key={player.id} label={`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.playerName}`} onPress={() => setDraft(toggleMobileFormationSquadPlayer(draft, player))} selected={selectedIds.has(player.id)} styles={styles} />)}</View>
      </View>

      <View style={styles.card}>
        <View style={styles.row}><Action disabled={!currentPreset || !draft.bench.length} label="Place all" onPress={() => setDraft(placeMobileFormationLineup(draft, currentPreset))} styles={styles} /><Action label={removalMode ? 'Cancel taking off' : 'Take Players off lineup'} onPress={() => { setRemovalMode(!removalMode); setRemovalIds([]); setSelectedBenchPlayerId('') }} secondary styles={styles} /></View>
        {removalMode ? <View style={styles.warning}><Text style={styles.body}>Tap one or more Players on the pitch, then move them to the Bench.</Text><Action disabled={!removalIds.length} label={`Move ${removalIds.length || ''} selected to Bench`.replace('  ', ' ')} onPress={() => { setDraft(moveMobileFormationPlayersToBench(draft, removalIds)); setRemovalIds([]); setRemovalMode(false) }} styles={styles} /></View> : null}
        <View accessibilityLabel="Formation pitch" style={styles.pitch}>
          <View style={styles.pitchHalfway} />
          {(currentPreset?.slots || []).map((slot) => {
            const player = draft.placements.find((candidate) => candidate.slotId === slot.id)
            const selectedForRemoval = player && removalIds.includes(player.playerId)
            return (
              <Pressable
                accessibilityHint={player ? removalMode ? 'Selects this Player to move to the Bench' : 'Player is placed on the pitch' : selectedBenchPlayerId ? 'Places the selected Bench Player here' : 'Choose a Player from the Bench first'}
                accessibilityRole="button"
                key={slot.id}
                onPress={() => {
                  if (player && removalMode) setRemovalIds((current) => current.includes(player.playerId) ? current.filter((id) => id !== player.playerId) : [...current, player.playerId])
                  else if (!player && selectedBenchPlayerId) { setDraft(placeMobileFormationPlayer(draft, selectedBenchPlayerId, slot)); setSelectedBenchPlayerId('') }
                }}
                style={[styles.playerSlot, !player && styles.playerSlotEmpty, selectedForRemoval && styles.playerSlotRemoval, { left: `${Math.max(2, Math.min(64, Number(slot.x || 0) - 18))}%`, top: `${Math.max(1, Math.min(89, Number(slot.y || 0) - 5))}%` }]}
              >
                <Text numberOfLines={2} style={styles.playerName}>{player ? `${player.shirtNumber ? `${player.shirtNumber} ` : ''}${player.displayName}` : 'Empty'}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.heading}>Bench</Text>
        <Text style={styles.body}>Tap a Bench Player, then tap an empty pitch position.</Text>
        <View style={styles.bench}>{draft.bench.map((player) => <Choice key={player.playerId} label={`${player.shirtNumber ? `#${player.shirtNumber} ` : ''}${player.displayName}`} onPress={() => setSelectedBenchPlayerId((current) => current === player.playerId ? '' : player.playerId)} selected={selectedBenchPlayerId === player.playerId} styles={styles} />)}</View>
        {!draft.bench.length ? <Text style={styles.body}>No Players are on the Bench.</Text> : null}
      </View>

      <View style={styles.card}>
        <Action disabled={busy || unavailable || !title.trim() || !selectedIds.size} label={busy ? 'Saving...' : 'Save private match plan'} onPress={() => void save()} styles={styles} />
        <Action disabled={busy || unavailable || !board?.currentVersionId} label={activePublication ? 'Publish updated plan to Parents' : 'Publish plan to Parents'} onPress={publish} secondary styles={styles} />
        {activePublication ? <Action danger disabled={busy || unavailable} label="Withdraw Parent plan" onPress={withdraw} secondary styles={styles} /> : null}
        <Text style={styles.body}>{activePublication ? 'Parent view is live. Publishing again creates a new immutable version.' : 'Private draft only. Parents cannot see this plan.'}</Text>
      </View>
    </View>
  )
}
