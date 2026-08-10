import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import {
  buildCoachFinalMatchReport,
  buildCoachMatchDaySquad,
  createCoachMatchDayEventForm,
  filterCoachMatchDays,
  getCoachMatchDayActions,
  getCoachMatchDayPresentation,
  getCoachMatchDayUndoModel,
  hasCoachMatchDayCommandResult,
  isCoachMatchDayEventVoided,
  isCoachMatchDayFinalReportApplied,
  isCoachMatchDayGoalCorrectionApplied,
  isCoachMatchDayShootoutKickApplied,
  isCoachMatchDayShootoutKickVoided,
  isCoachMatchDaySquadDecisionApplied,
  isCoachMatchDayTimerActionApplied,
  isCoachMatchDayVolunteerSelectionApplied,
  validateCoachMatchDayEventForm,
} from '../../mobile-core/src/coachMatchDayCore'
import {
  correctCoachMatchDayGoal,
  correctCoachMatchDayScore,
  createCoachMatchDayCommandId,
  getCoachMatchDayDetail,
  getCoachMatchDayList,
  recordCoachMatchDayEvent,
  recordCoachMatchDayShootoutKick,
  runCoachMatchDayTimerAction,
  saveCoachMatchDayFinalReport,
  selectCoachMatchDayVolunteer,
  setCoachMatchDaySquadDecision,
  voidCoachMatchDayEvent,
  voidCoachMatchDayShootoutKick,
} from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

const config = getMobileRuntimeConfig('coach')

function normalize(value) { return String(value ?? '').trim() }
function errorMessage(error, fallback) { return normalize(error?.message) || fallback }

function createStyles(palette) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 13, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDanger: { backgroundColor: palette.danger },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 9, padding: 15 },
    cardSelected: { borderColor: palette.accent, borderWidth: 2 },
    cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    chip: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 13 },
    chipActive: { backgroundColor: palette.selected, borderColor: palette.accent },
    chipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '900' },
    chipTextActive: { color: palette.selectedForeground },
    clock: { color: palette.accent, fontSize: 42, fontVariant: ['tabular-nums'], fontWeight: '900', textAlign: 'center' },
    dangerText: { color: palette.danger, fontSize: 13, fontWeight: '800', lineHeight: 19 },
    field: { gap: 5 },
    fieldLabel: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
    meta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
    row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    score: { color: palette.textPrimary, fontSize: 38, fontWeight: '900', textAlign: 'center' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 13, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13, paddingVertical: 9 },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
    stack: { gap: 12 },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    title: { color: palette.textPrimary, fontSize: 29, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 14, borderWidth: 1, gap: 6, padding: 12 },
  })
}

function Button({ danger = false, disabled = false, label, onPress, secondary = false, styles }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [secondary ? styles.secondary : styles.action, danger && styles.actionDanger, disabled && styles.actionDisabled, pressed && { opacity: 0.74 }]}><Text style={secondary ? styles.secondaryText : styles.actionText}>{label}</Text></Pressable>
}

function Chips({ onChange, options, styles, value }) {
  return <View style={styles.tabs}>{options.map((option) => { const selected = value === option.value; return <Pressable accessibilityRole="button" accessibilityState={{ selected }} key={option.value} onPress={() => onChange(option.value)} style={[styles.chip, selected && styles.chipActive]}><Text style={[styles.chipText, selected && styles.chipTextActive]}>{option.label}</Text></Pressable> })}</View>
}

function Field({ label, multiline = false, onChangeText, styles, value }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} multiline={multiline} onChangeText={onChangeText} style={[styles.input, multiline && styles.inputMultiline]} value={String(value ?? '')} /></View>
}

function MatchList({ filter, matches, onOpen, selectedId, setFilter, styles }) {
  const visible = filterCoachMatchDays(matches, filter)
  return <View style={styles.stack}>
    <Chips onChange={setFilter} options={[{ label: 'Today and live', value: 'current' }, { label: 'Upcoming', value: 'upcoming' }, { label: 'Previous', value: 'previous' }, { label: 'All', value: 'all' }]} styles={styles} value={filter} />
    {visible.length === 0 ? <Text style={styles.body}>No fixtures match this view.</Text> : null}
    {visible.map((match) => { const view = getCoachMatchDayPresentation(match); return <Pressable accessibilityRole="button" key={match.id} onPress={() => onOpen(match)} style={[styles.card, selectedId === match.id && styles.cardSelected]}><Text style={styles.cardTitle}>{view.displayName}</Text><Text style={styles.meta}>{match.matchDate || 'Date TBC'} | {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime || 'Time TBC'} | {match.status.replaceAll('_', ' ')}</Text><Text style={styles.body}>{view.displayScore} | {view.phaseLabel}</Text></Pressable> })}
  </View>
}

function SquadPanel({ actions, busy, match, onSetDecision, players, styles }) {
  const squad = buildCoachMatchDaySquad(players, match)
  return <View style={styles.stack}>
    <View style={styles.card}><Text style={styles.cardTitle}>Squad summary</Text><Text style={styles.body}>Selected {squad.summary.selected} | Waiting {squad.summary.waiting} | Not selected {squad.summary.notSelected} | Undecided {squad.summary.undecided}</Text><Text style={styles.meta}>Availability and squad decisions are separate authoritative states. Optimistic concurrency protects each decision.</Text></View>
    {!actions.canSetSquad ? <View style={styles.warning}><Text style={styles.body}>{actions.blockedReason || 'Squad decisions are locked after the fixture starts.'}</Text></View> : null}
    {squad.rows.map((player) => <View key={player.id} style={styles.card}><Text style={styles.cardTitle}>{player.playerName}</Text><Text style={styles.meta}>{player.availabilityLabel} | {player.decisionLabel}{player.shirtNumber ? ` | #${player.shirtNumber}` : ''}</Text><View style={styles.tabs}>{['selected', 'waiting', 'not_selected', 'undecided'].map((decision) => <Button disabled={busy || !actions.canSetSquad || decision === player.decision} key={decision} label={decision.replace('_', ' ')} onPress={() => onSetDecision(player, decision)} secondary styles={styles} />)}</View></View>)}
  </View>
}

function VolunteerPanel({ actions, busy, match, onSelect, styles }) {
  const assignmentByRole = new Map((match.roleAssignments || []).map((item) => [item.role, item]))
  return <View style={styles.stack}>
    <View style={styles.warning}><Text style={styles.cardTitle}>{config.isProduction ? 'Canonical recipient action' : 'Communications disabled'}</Text><Text style={styles.body}>{config.isProduction ? 'Volunteer assignment is online-only. A confirmed change uses canonical production authority and may queue the approved recipient notification.' : 'This test app does not send scorer requests, availability reminders, email, or push notifications. It can only select from existing server-authoritative responses.'}</Text></View>
    {match.volunteerEligibilityError ? <Text style={styles.dangerText}>{match.volunteerEligibilityError}</Text> : null}
    {['scorer', 'linesman', 'referee'].map((role) => { const assignment = assignmentByRole.get(role); const assignmentRequest = (match.availabilityRequests || []).find((request) => request.parentLinkId === assignment?.parentLinkId); return <View key={role} style={styles.card}><Text style={styles.cardTitle}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text><Text style={styles.body}>{assignment?.playerName || (assignment ? 'Assigned Parent' : 'Not assigned')}</Text>{assignment && assignmentRequest ? <Button disabled={busy || !actions.canSelectVolunteers} label="Remove assignment" onPress={() => onSelect(assignmentRequest, role, false)} secondary styles={styles} /> : null}{(match.availabilityRequests || []).filter((request) => role !== 'scorer' || request.scorerEligible).filter((request) => request[`volunteer${role.charAt(0).toUpperCase() + role.slice(1)}Response`] === 'yes').map((request) => <Button disabled={busy || !actions.canSelectVolunteers} key={`${role}-${request.id}`} label={`Select ${request.recipientName || request.playerName || 'eligible Parent'}`} onPress={() => onSelect(request, role, true)} secondary styles={styles} />)}</View> })}
  </View>
}

function LivePanel({ actions, busy, eventForm, match, onEventForm, onPrepare, onScore, onTimer, scoreDraft, setScoreDraft, styles }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const view = getCoachMatchDayPresentation(match, now)
  return <View style={styles.stack}>
    <View style={styles.card}><Text style={styles.cardTitle}>{view.displayName}</Text><Text accessibilityLiveRegion="polite" style={styles.score}>{view.displayScore}</Text><Text accessibilityLiveRegion="polite" style={styles.clock}>{view.clock}</Text><Text style={styles.meta}>{view.phaseLabel} | {view.lifecycle.replaceAll('_', ' ')}</Text></View>
    {actions.blockedReason ? <View style={styles.warning}><Text style={styles.body}>{actions.blockedReason}</Text></View> : null}
    <View style={styles.tabs}>{actions.timerActions.map((item) => <Button disabled={busy || item.disabled} key={item.action} label={item.label} onPress={() => onPrepare({ kind: 'timer', label: item.label, run: () => onTimer(item.action) })} styles={styles} />)}</View>
    <View style={styles.card}><Text style={styles.cardTitle}>Correct score</Text><View style={styles.row}><Field label="Home" onChangeText={(value) => setScoreDraft({ ...scoreDraft, home: value })} styles={styles} value={scoreDraft.home} /><Field label="Away" onChangeText={(value) => setScoreDraft({ ...scoreDraft, away: value })} styles={styles} value={scoreDraft.away} /></View><Button disabled={busy || !actions.canRecordEvents} label="Review score correction" onPress={() => onPrepare({ kind: 'score', label: 'Save score correction', run: onScore })} secondary styles={styles} /></View>
    <View style={styles.card}><Text style={styles.cardTitle}>Record event</Text><Chips onChange={(value) => onEventForm(createCoachMatchDayEventForm(value, match))} options={[{ label: 'Goal', value: 'goal' }, { label: 'Yellow card', value: 'yellow_card' }, { label: 'Red card', value: 'red_card' }, { label: 'Substitution', value: 'substitution' }]} styles={styles} value={eventForm.eventType} /><Chips onChange={(value) => onEventForm({ ...eventForm, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={eventForm.teamSide} /><Field label="Minute" onChangeText={(value) => onEventForm({ ...eventForm, minute: value })} styles={styles} value={eventForm.minute} />{eventForm.eventType === 'goal' ? <><Field label="Scorer" onChangeText={(value) => onEventForm({ ...eventForm, scorerName: value })} styles={styles} value={eventForm.scorerName} /><Field label="Scorer shirt number" onChangeText={(value) => onEventForm({ ...eventForm, scorerShirtNumber: value })} styles={styles} value={eventForm.scorerShirtNumber} /><Field label="Assist" onChangeText={(value) => onEventForm({ ...eventForm, assistName: value })} styles={styles} value={eventForm.assistName} /><View style={styles.row}><Text style={styles.fieldLabel}>Penalty goal</Text><Switch accessibilityLabel="Penalty goal" onValueChange={(value) => onEventForm({ ...eventForm, isPenaltyGoal: value })} value={eventForm.isPenaltyGoal} /></View></> : <><Field label={eventForm.eventType === 'substitution' ? 'Player off' : 'Player'} onChangeText={(value) => onEventForm({ ...eventForm, playerName: value })} styles={styles} value={eventForm.playerName} />{eventForm.eventType === 'substitution' ? <Field label="Player on" onChangeText={(value) => onEventForm({ ...eventForm, playerOnName: value })} styles={styles} value={eventForm.playerOnName} /> : null}</>}<Field label="Notes" multiline onChangeText={(value) => onEventForm({ ...eventForm, notes: value })} styles={styles} value={eventForm.notes} /><Button disabled={busy || !actions.canRecordEvents} label="Review event" onPress={() => onPrepare({ kind: 'event', label: `Record ${eventForm.eventType.replaceAll('_', ' ')}`, run: () => onScore('event') })} styles={styles} /></View>
  </View>
}

function TimelinePanel({ busy, match, onCorrectGoal, onPrepare, onUndo, styles }) {
  const [undoEvent, setUndoEvent] = useState(null)
  const [correctEvent, setCorrectEvent] = useState(null)
  const [goalDraft, setGoalDraft] = useState(null)
  const [correctionReason, setCorrectionReason] = useState('')
  const [reasonCode, setReasonCode] = useState('')
  const [note, setNote] = useState('')
  const visibleEvents = (match.events || []).slice(-200)
  return <View style={styles.stack}>
    {(match.events || []).length === 0 ? <Text style={styles.body}>No Match Day events have been recorded.</Text> : null}
    {(match.events || []).length > visibleEvents.length ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Showing the latest {visibleEvents.length} timeline events.</Text> : null}
    {visibleEvents.map((event) => { const undo = getCoachMatchDayUndoModel(event); return <View key={event.id} style={styles.card}><Text style={styles.cardTitle}>{event.eventType.replaceAll('_', ' ')} {event.minute === null ? '' : `${event.minute}'`}</Text><Text style={styles.body}>{event.scorerName || event.playerName || event.notes || event.teamSide}</Text><Text style={styles.meta}>{event.homeScore} - {event.awayScore} | {event.eventStatus}</Text>{event.eventType === 'goal' && event.eventStatus !== 'voided' ? <Button disabled={busy} label="Correct goal details" onPress={() => { setCorrectEvent(event); setCorrectionReason(''); setGoalDraft({ assistName: event.assistName, assistShirtNumber: event.assistShirtNumber, minute: String(event.minute ?? ''), notes: event.notes, scorerName: event.scorerName, scorerShirtNumber: event.scorerShirtNumber, teamSide: event.teamSide }) }} secondary styles={styles} /> : null}{undo.canUndo ? <Button disabled={busy} label="Undo event" onPress={() => { setUndoEvent(event); setReasonCode(''); setNote('') }} secondary styles={styles} /> : null}</View> })}
    {correctEvent && goalDraft ? <View style={styles.warning}><Text style={styles.cardTitle}>Correct goal details</Text><Chips onChange={(value) => setGoalDraft({ ...goalDraft, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={goalDraft.teamSide} /><Field label="Minute" onChangeText={(value) => setGoalDraft({ ...goalDraft, minute: value })} styles={styles} value={goalDraft.minute} /><Field label="Scorer" onChangeText={(value) => setGoalDraft({ ...goalDraft, scorerName: value })} styles={styles} value={goalDraft.scorerName} /><Field label="Scorer shirt number" onChangeText={(value) => setGoalDraft({ ...goalDraft, scorerShirtNumber: value })} styles={styles} value={goalDraft.scorerShirtNumber} /><Field label="Assist" onChangeText={(value) => setGoalDraft({ ...goalDraft, assistName: value })} styles={styles} value={goalDraft.assistName} /><Field label="Correction reason" onChangeText={setCorrectionReason} styles={styles} value={correctionReason} /><Button disabled={busy || !correctionReason} label="Review goal correction" onPress={() => onPrepare({ kind: 'correct-goal', label: 'Correct goal and retain audit history', run: async () => { const validated = validateCoachMatchDayEventForm({ ...goalDraft, eventType: 'goal' }); await onCorrectGoal(correctEvent, validated, correctionReason); setCorrectEvent(null); setGoalDraft(null) } })} styles={styles} /><Button label="Cancel" onPress={() => { setCorrectEvent(null); setGoalDraft(null) }} secondary styles={styles} /></View> : null}
    {undoEvent ? <View style={styles.warning}><Text style={styles.cardTitle}>Confirm timeline correction</Text><Chips onChange={setReasonCode} options={getCoachMatchDayUndoModel(undoEvent).options} styles={styles} value={reasonCode} /><Field label="Correction note" multiline onChangeText={setNote} styles={styles} value={note} /><Button disabled={busy || !reasonCode} danger label="Review undo" onPress={() => onPrepare({ kind: 'undo', label: 'Void timeline event', run: async () => { await onUndo(undoEvent, { note, reasonCode }); setUndoEvent(null) } })} styles={styles} /><Button label="Cancel" onPress={() => setUndoEvent(null)} secondary styles={styles} /></View> : null}
  </View>
}

function ShootoutPanel({ busy, match, onKick, onPrepare, onVoid, styles }) {
  const [kick, setKick] = useState({ notes: '', outcome: 'scored', playerName: '', teamSide: 'club' })
  return <View style={styles.stack}><View style={styles.card}><Text style={styles.cardTitle}>Penalty shootout</Text><Text style={styles.score}>{match.homeShootoutScore} - {match.awayShootoutScore}</Text><Chips onChange={(value) => setKick({ ...kick, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={kick.teamSide} /><Chips onChange={(value) => setKick({ ...kick, outcome: value })} options={[{ label: 'Scored', value: 'scored' }, { label: 'Missed', value: 'missed' }]} styles={styles} value={kick.outcome} /><Field label="Player" onChangeText={(value) => setKick({ ...kick, playerName: value })} styles={styles} value={kick.playerName} /><Field label="Notes" onChangeText={(value) => setKick({ ...kick, notes: value })} styles={styles} value={kick.notes} /><Button disabled={busy || match.currentMatchPhase !== 'penalties'} label="Review penalty" onPress={() => onPrepare({ kind: 'kick', label: 'Record penalty', run: () => onKick(kick) })} styles={styles} /></View>{(match.shootoutEvents || []).map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.kickNumber}. {item.teamSide} {item.outcome}</Text><Text style={styles.body}>{item.playerName || 'Player not recorded'}</Text>{item.eventStatus !== 'voided' ? <Button disabled={busy} label="Void penalty" onPress={() => onPrepare({ kind: 'void-kick', label: 'Void penalty kick', run: () => onVoid(item.id) })} secondary styles={styles} /> : null}</View>)}</View>
}

function ReportPanel({ busy, match, onSave, styles }) {
  const report = buildCoachFinalMatchReport(match)
  const [notes, setNotes] = useState(match.finalReport?.staffNotes || '')
  return <View style={styles.stack}><View style={styles.card}><Text style={styles.cardTitle}>Result and FA submission helper</Text><Text selectable style={styles.score}>{report.result.finalScore}</Text><Text style={styles.meta}>Deferred. Current approved source has no canonical FA SMS, deep-link message format, or authorised direct integration. The Coach app will not invent or automatically send one.</Text></View><View style={styles.card}><Text style={styles.cardTitle}>Final Match Report</Text><Text style={styles.body}>Active events {report.activeEvents.length} | Voided {report.voidedEvents.length} | Cards {report.activeCards.length} | Substitutions {report.activeSubstitutions.length}</Text><Field label="Staff notes" multiline onChangeText={setNotes} styles={styles} value={notes} /><Button disabled={busy || match.status !== 'full_time'} label="Save final report" onPress={() => onSave(notes)} styles={styles} /></View></View>
}

export function CoachMatchDayScreen({ context, onNavigate, palette, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [eventForm, setEventForm] = useState(createCoachMatchDayEventForm())
  const [filter, setFilter] = useState('current')
  const [loading, setLoading] = useState(true)
  const [match, setMatch] = useState(null)
  const [matches, setMatches] = useState([])
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState('overview')
  const [pending, setPending] = useState(null)
  const [players, setPlayers] = useState([])
  const [scoreDraft, setScoreDraft] = useState({ away: '0', home: '0' })
  const [stale, setStale] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const appState = useRef(AppState.currentState)

  const cache = useCallback(async (nextMatches, nextMatch, nextPlayers) => saveCoachOfflineResources(user.id, context, { matchDayDetail: nextMatch || null, matchDayList: nextMatches, matchDayPlayers: nextPlayers }), [context, user.id])
  const load = useCallback(async () => {
    setError(''); setNotice(''); setLoading(true)
    try {
      const [nextMatches, nextPlayers] = await Promise.all([getCoachMatchDayList(user), getCoachPlayerList(user)])
      setMatches(nextMatches); setPlayers(nextPlayers); setStale(false); setReconciling(false)
      let nextMatch = match?.id ? await getCoachMatchDayDetail(user, match.id) : null
      if (nextMatch) { setMatch(nextMatch); setScoreDraft({ away: String(nextMatch.awayScore), home: String(nextMatch.homeScore) }) }
      await cache(nextMatches, nextMatch, nextPlayers)
    } catch (loadError) {
      const saved = await readCoachOfflineResources(user.id, context).catch(() => null)
      if (saved?.resources?.matchDayList) { setMatches(saved.resources.matchDayList); setPlayers(saved.resources.matchDayPlayers || []); setMatch(saved.resources.matchDayDetail || null); setStale(true) }
      else setError(errorMessage(loadError, 'Match Day could not be loaded.'))
    } finally { setLoading(false) }
  }, [cache, context, match?.id, user])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackgrounded = /inactive|background/.test(appState.current)
      appState.current = nextState
      if (wasBackgrounded && nextState === 'active') void load()
    })
    return () => subscription.remove()
  }, [load])

  const open = async (summary) => {
    setBusy(true); setError('')
    try { const detail = await getCoachMatchDayDetail(user, summary.id); setMatch(detail); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setEventForm(createCoachMatchDayEventForm('goal', detail)); setPanel('overview'); setStale(false); await cache(matches, detail, players) }
    catch (openError) { setError(errorMessage(openError, 'Fixture details could not be loaded.')) }
    finally { setBusy(false) }
  }
  const replace = async (operation, verify) => {
    setBusy(true); setError(''); setNotice(''); setReconciling(false)
    try {
      const detail = await operation()
      const nextMatches = matches.map((item) => item.id === detail.id ? detail : item)
      setMatch(detail); setMatches(nextMatches); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setStale(false)
      await cache(nextMatches, detail, players)
      return detail
    } catch (operationError) {
      setReconciling(true)
      let detail
      try {
        detail = await getCoachMatchDayDetail(user, match.id)
      } catch {
        setError(`${errorMessage(operationError, 'The Match Day result is uncertain.')} Refresh to reconcile with the server before retrying.`)
        throw operationError
      }
      const nextMatches = matches.map((item) => item.id === detail.id ? detail : item)
      setMatch(detail); setMatches(nextMatches); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setStale(false)
      await cache(nextMatches, detail, players).catch(() => {})
      setReconciling(false)
      if (verify?.(detail) === true) {
        setNotice('The server confirmed that the Match Day change was saved. No retry is needed.')
        return detail
      }
      setError(`${errorMessage(operationError, 'The Match Day change failed.')} The server confirmed it was not saved. Review the current state before retrying.`)
      throw operationError
    } finally { setBusy(false) }
  }
  const confirm = async () => { const action = pending; setPending(null); if (!action) return; try { await action.run() } catch { return } }
  const actions = getCoachMatchDayActions({ context, match, reconciling, stale })
  const submitEvent = async () => { const validated = validateCoachMatchDayEventForm(eventForm); const commandId = createCoachMatchDayCommandId(); await replace(() => recordCoachMatchDayEvent(user, match, validated, commandId), (detail) => hasCoachMatchDayCommandResult(detail, commandId)); setEventForm(createCoachMatchDayEventForm(validated.eventType, match)) }

  return <View style={styles.stack}>
    <Text accessibilityRole="header" style={styles.title}>Match Day</Text><Text style={styles.body}>Server-authoritative fixture execution, squad, clock, events, volunteers, shootout, corrections, and final report.</Text>
    <View style={styles.tabs}><Button label="Availability" onPress={() => onNavigate('invites')} secondary styles={styles} /><Button label="Team Chat" onPress={() => onNavigate('chat')} secondary styles={styles} /><Button label="Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} /></View>
    {loading ? <View style={styles.card}><ActivityIndicator /><Text style={styles.body}>Loading authoritative Match Day data...</Text></View> : null}
    {reconciling ? <View accessibilityLiveRegion="assertive" style={styles.warning}><ActivityIndicator /><Text style={styles.cardTitle}>Reconciling the last action</Text><Text style={styles.body}>The current fixture remains visible, but changes are blocked until the server result is known.</Text></View> : null}
    {notice ? <View accessibilityLiveRegion="polite" style={styles.card}><Text style={styles.body}>{notice}</Text></View> : null}
    {error ? <View style={styles.warning}><Text style={styles.dangerText}>{error}</Text><Button label="Refresh" onPress={load} secondary styles={styles} /></View> : null}
    {stale ? <View style={styles.warning}><Text style={styles.cardTitle}>Offline read</Text><Text style={styles.body}>Showing encrypted cached Match Day data. Every change is disabled until a successful refresh.</Text></View> : null}
    <MatchList filter={filter} matches={matches} onOpen={open} selectedId={match?.id} setFilter={setFilter} styles={styles} />
    {match ? <><Chips onChange={setPanel} options={[{ label: 'Overview', value: 'overview' }, { label: 'Squad', value: 'squad' }, { label: 'Volunteers', value: 'volunteers' }, { label: 'Live', value: 'live' }, { label: 'Timeline', value: 'timeline' }, { label: 'Shootout', value: 'shootout' }, { label: 'Report', value: 'report' }]} styles={styles} value={panel} />
      {panel === 'overview' ? <View style={styles.card}><Text style={styles.cardTitle}>{getCoachMatchDayPresentation(match).displayName}</Text><Text style={styles.score}>{getCoachMatchDayPresentation(match).displayScore}</Text><Text style={styles.body}>{match.matchDate} | {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime} | {match.homeAway}</Text><Text style={styles.body}>{match.venueName || 'Venue TBC'}{match.venueAddress ? ` | ${match.venueAddress}` : ''}</Text><Text style={styles.meta}>Clock {match.clockMode}, {match.matchDurationMinutes} minutes | Rule {match.conclusionRule.replaceAll('_', ' ')}</Text><View style={styles.warning}><Text style={styles.body}>Fixture-linked lineup, captain, goalkeeper, and Formation Board are not in the current canonical Match Day model. No inferred data is shown or saved.</Text></View></View> : null}
      {panel === 'squad' ? <SquadPanel actions={actions} busy={busy} match={match} onSetDecision={(player, decision) => setPending({ label: `Set ${player.playerName} to ${decision.replaceAll('_', ' ')}`, run: () => replace(() => setCoachMatchDaySquadDecision(user, match, player.id, decision, player.decidedAt || null), (detail) => isCoachMatchDaySquadDecisionApplied(detail, player.id, decision)) })} players={players} styles={styles} /> : null}
      {panel === 'volunteers' ? <VolunteerPanel actions={actions} busy={busy} match={match} onSelect={(request, role, selected) => setPending({ label: `${selected ? 'Assign' : 'Remove'} ${role}`, run: () => replace(() => selectCoachMatchDayVolunteer(user, match, request, role, selected), (detail) => isCoachMatchDayVolunteerSelectionApplied(detail, request, role, selected)) })} styles={styles} /> : null}
      {panel === 'live' ? <LivePanel actions={actions} busy={busy} eventForm={eventForm} match={match} onEventForm={setEventForm} onPrepare={setPending} onScore={(kind) => { if (kind === 'event') return submitEvent(); const commandId = createCoachMatchDayCommandId(); return replace(() => correctCoachMatchDayScore(user, match, scoreDraft.home, scoreDraft.away, commandId), (detail) => hasCoachMatchDayCommandResult(detail, commandId)) }} onTimer={(action) => replace(() => runCoachMatchDayTimerAction(user, match, action), (detail) => isCoachMatchDayTimerActionApplied(detail, action))} scoreDraft={scoreDraft} setScoreDraft={setScoreDraft} styles={styles} /> : null}
      {panel === 'timeline' ? <TimelinePanel busy={busy || reconciling} match={match} onCorrectGoal={(event, goal, reason) => replace(() => correctCoachMatchDayGoal(user, match, event, goal, reason), (detail) => isCoachMatchDayGoalCorrectionApplied(detail, event.id, goal, reason))} onPrepare={setPending} onUndo={(event, input) => replace(() => voidCoachMatchDayEvent(user, match, event, input), (detail) => isCoachMatchDayEventVoided(detail, event.id))} styles={styles} /> : null}
      {panel === 'shootout' ? <ShootoutPanel busy={busy || reconciling} match={match} onKick={(kick) => { const priorKickIds = (match.shootoutEvents || []).map((item) => item.id); return replace(() => recordCoachMatchDayShootoutKick(user, match, kick), (detail) => isCoachMatchDayShootoutKickApplied(detail, priorKickIds, kick)) }} onPrepare={setPending} onVoid={(id) => replace(() => voidCoachMatchDayShootoutKick(user, match, id), (detail) => isCoachMatchDayShootoutKickVoided(detail, id))} styles={styles} /> : null}
      {panel === 'report' ? <ReportPanel busy={busy || reconciling} key={`${match.id}:${match.finalReport?.updatedAt || ''}`} match={match} onSave={(notes) => setPending({ label: 'Save final Match Day report', run: () => replace(() => saveCoachMatchDayFinalReport(user, match, notes), (detail) => isCoachMatchDayFinalReportApplied(detail, notes)) })} styles={styles} /> : null}
    </> : null}
    {pending ? <View accessibilityLiveRegion="assertive" style={styles.warning}><Text style={styles.cardTitle}>Confirm Match Day change</Text><Text style={styles.body}>{pending.label}</Text><Text style={styles.meta}>The server will recheck Team scope, role, payment, fixture state, and concurrency before saving. The full fixture will then be refreshed.</Text><Button disabled={busy || reconciling} label="Confirm" onPress={confirm} styles={styles} /><Button label="Cancel" onPress={() => setPending(null)} secondary styles={styles} /></View> : null}
  </View>
}
