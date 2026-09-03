import { getGoalScorerSide, setGoalOwnGoal } from '../../../src/lib/matchday-goal-credit.js'
import { getMatchClockDescription } from '../../../src/lib/matchday-event-time.js'
import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { activateKeepAwakeAsync, deactivateKeepAwake, isAvailableAsync } from 'expo-keep-awake'
import { AppState, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { buildCompletedMatchEventPresentation } from '../../../src/lib/matchday-final-report.js'
import {
  buildCoachFinalMatchReport,
  captureCoachMatchDayAction,
  createCoachMatchDayEventForm,
  filterCoachMatchDayPlayerChoices,
  filterCoachMatchDays,
  getCoachMatchDayOpponentPlayers,
  getCoachMatchDayActions,
  getCoachVolunteerAssignmentLabel,
  getCoachVolunteerPersonLabel,
  getCoachMatchDayPresentation,
  getCoachMatchDaySelectedPlayers,
  getCoachMatchDayUndoModel,
  hasCoachMatchDayCommandResult,
  isCoachMatchDayEventVoided,
  isCoachMatchDayFinalReportApplied,
  isCoachMatchDayGoalCorrectionApplied,
  isCoachMatchDayShootoutKickApplied,
  isCoachMatchDayShootoutKickVoided,
  isCoachMatchDaySquadDecisionApplied,
  reconcileCoachSquadNotificationResults,
  isCoachMatchDayTimerActionApplied,
  isCoachMatchDayVolunteerSelectionApplied,
  pickCoachMatchDayLinkedPlayer,
  updateCoachMatchDayLinkedPlayer,
  validateCoachMatchDayEventForm,
} from '../../mobile-core/src/coachMatchDayCore'
import {
  correctCoachMatchDayGoal,
  correctCoachMatchDayScore,
  createCoachMatchDayCommandId,
  getCoachMatchDayDetail,
  getCoachMatchDayList,
  normalizeCoachMatchDay,
  recordCoachMatchDayEvent,
  recordCoachMatchDayShootoutKick,
  runCoachMatchDayTimerAction,
  saveCoachMatchDayFinalReport,
  selectCoachMatchDayVolunteer,
  setCoachMatchDaySquadDecision,
  notifyCoachMatchDaySquadDecisions,
  voidCoachMatchDayEvent,
  voidCoachMatchDayShootoutKick,
} from '../../mobile-core/src/coachMatchDayData'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { useConfirmedConnectionIssue, useConfirmedConnectionMessage } from '../../mobile-core/src/useConfirmedConnectionIssue'
import { getMatchDayFilterIconKey, getMatchDayPanelIconKey, getMobileIconName } from '../../mobile-core/src/mobileIconSystem'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { CoachFormationBoard } from './CoachFormationBoard'
import { CoachFixtureForm } from './CoachFixtureForm'
import { CoachGuestScorer } from './CoachGuestScorer'
import { CoachSquadPanel } from './CoachSquadPanel'
import { getCoachFriendlyError } from './coachFriendlyErrors'

const config = getMobileRuntimeConfig('coach')
const MATCH_DAY_PANEL_OPTIONS = [
  { label: 'Overview', value: 'overview' },
  { label: 'Squad', value: 'squad' },
  { label: 'Formation', value: 'formation' },
  { label: 'Volunteers', value: 'volunteers' },
  { label: 'Live', value: 'live' },
  { label: 'Timeline', value: 'timeline' },
  { label: 'Shootout', value: 'shootout' },
  { label: 'Report', value: 'report' },
]
const MATCH_DAY_EVENT_TITLES = Object.freeze({ goal: 'Add goal', red_card: 'Red card', substitution: 'Substitution', yellow_card: 'Yellow card' })

function normalize(value) { return String(value ?? '').trim() }
const errorMessage = getCoachFriendlyError
function label(value, fallback = '') { return normalize(value).replace(/_/g, ' ') || fallback }
function normalizeCachedMatches(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item === 'object')
    .map(normalizeCoachMatchDay)
}

function createStyles(palette) {
  return StyleSheet.create({
    action: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 13, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
    actionDanger: { backgroundColor: palette.danger },
    actionDisabled: { opacity: 0.45 },
    actionText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900', textAlign: 'center' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    card: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 9, padding: 15 },
    cardSelected: { borderColor: palette.accent, borderWidth: 2 },
    cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    fixtureHero: { backgroundColor: palette.selected, borderColor: palette.accent, borderRadius: 17, borderWidth: 1, gap: 11, padding: 15 },
    fixtureHeroLive: { borderWidth: 2 },
    fixtureTitle: { color: palette.textPrimary, fontSize: 22, fontWeight: '900', lineHeight: 28 },
    gameMode: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 17, borderWidth: 1, gap: 12, padding: 15 },
    gameModeEyebrow: { color: palette.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1.3, textTransform: 'uppercase' },
    gameStat: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, flex: 1, gap: 4, minWidth: 88, padding: 11 },
    gameStatHeading: { alignItems: 'center', flexDirection: 'row', gap: 6 },
    gameStatLabel: { color: palette.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
    gameStatValue: { color: palette.textPrimary, fontSize: 18, fontVariant: ['tabular-nums'], fontWeight: '900' },
    gameStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    liveSync: { alignSelf: 'flex-start', backgroundColor: palette.surface, borderColor: palette.accent, borderRadius: 9, borderWidth: 1, color: palette.accent, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 7 },
    quickAction: { flexBasis: '47%', flexGrow: 1 },
    quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    timelineItem: { borderTopColor: palette.border, borderTopWidth: 1, gap: 3, paddingTop: 10 },
    timelineMinute: { color: palette.accent, fontSize: 13, fontWeight: '900' },
    chip: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 },
    chipActive: { backgroundColor: palette.selected, borderColor: palette.accent },
    chipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '900' },
    chipTextActive: { color: palette.selectedForeground },
    clock: { color: palette.accent, fontSize: 42, fontVariant: ['tabular-nums'], fontWeight: '900', textAlign: 'center' },
    dangerText: { color: palette.danger, fontSize: 13, fontWeight: '800', lineHeight: 19 },
    emptyState: { alignItems: 'center', gap: 6, minHeight: 118, paddingVertical: 22 },
    field: { gap: 5 },
    fieldLabel: { color: palette.textPrimary, fontSize: 13, fontWeight: '900' },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 15, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputText: { color: palette.textPrimary, fontSize: 15 },
    inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
    linkedInput: { flex: 1 },
    linkedInputRow: { alignItems: 'stretch', flexDirection: 'row', gap: 8 },
    playerChoiceEmpty: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18, paddingHorizontal: 11, paddingVertical: 10 },
    playerChoiceList: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
    playerChoiceMeta: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    playerChoiceName: { color: palette.textPrimary, flex: 1, fontSize: 14, fontWeight: '900' },
    playerChoiceRow: { alignItems: 'center', borderBottomColor: palette.border, borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 48, paddingHorizontal: 11, paddingVertical: 9 },
    playerChoiceToggle: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 48, minWidth: 76, paddingHorizontal: 10 },
    playerChoiceToggleText: { color: palette.accent, fontSize: 12, fontWeight: '900' },
    meta: { color: palette.textMuted, fontSize: 12, fontWeight: '700', lineHeight: 18 },
    modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
    actionModalCard: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, gap: 12, maxHeight: '92%', padding: 18 },
    actionModalContent: { gap: 12, paddingBottom: 12 },
    actionModalHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
    actionModalScreen: { flex: 1, justifyContent: 'flex-end' },
    capturedPill: { alignSelf: 'flex-start', backgroundColor: palette.selected, borderColor: palette.accent, borderRadius: 999, borderWidth: 1, color: palette.selectedForeground, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
    modalCard: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 18, borderWidth: 1, gap: 10, marginHorizontal: 20, padding: 18 },
    modalScreen: { flex: 1, justifyContent: 'center' },
    pickerActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
    pickerButton: { alignItems: 'center', borderColor: palette.border, borderRadius: 10, borderWidth: 1, minHeight: 42, justifyContent: 'center', minWidth: 88, paddingHorizontal: 12 },
    pickerButtonText: { color: palette.accent, fontSize: 14, fontWeight: '900' },
    pickerPanel: { backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, gap: 8, overflow: 'hidden', padding: 8 },
    row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    score: { color: palette.textPrimary, fontSize: 38, fontWeight: '900', textAlign: 'center' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13, paddingVertical: 9 },
    secondaryDanger: { backgroundColor: palette.surfaceRaised, borderColor: palette.danger },
    secondaryDangerText: { color: palette.danger },
    secondaryWarning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning },
    secondaryWarningText: { color: palette.warning },
    secondaryText: { color: palette.textPrimary, fontSize: 13, fontWeight: '900', textAlign: 'center' },
    stack: { gap: 12 },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    title: { color: palette.textPrimary, fontSize: 29, fontWeight: '900' },
    warning: { backgroundColor: palette.surfaceRaised, borderColor: palette.warning, borderRadius: 14, borderWidth: 1, gap: 6, padding: 12 },
  })
}

function Button({ danger = false, disabled = false, iconKey = '', label, onPress, secondary = false, styles, warning = false }) {
  const contentStyle = [secondary ? styles.secondaryText : styles.actionText, danger && secondary && styles.secondaryDangerText, warning && secondary && styles.secondaryWarningText]
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [secondary ? styles.secondary : styles.action, danger && (secondary ? styles.secondaryDanger : styles.actionDanger), warning && secondary && styles.secondaryWarning, disabled && styles.actionDisabled, pressed && { opacity: 0.74 }]}>{iconKey ? <MaterialIcons name={getMobileIconName(iconKey)} size={21} style={contentStyle} /> : null}<Text style={contentStyle}>{label}</Text></Pressable>
}

function Chips({ iconResolver = null, onChange, options, styles, value }) {
  return <View style={styles.tabs}>{options.map((option) => { const selected = value === option.value; const iconStyle = [styles.chipText, selected && styles.chipTextActive]; const iconKey = option.iconKey || iconResolver?.(option.value); return <Pressable accessibilityRole="button" accessibilityState={{ selected }} key={option.value} onPress={() => onChange(option.value)} style={[styles.chip, selected && styles.chipActive]}>{iconKey ? <MaterialIcons name={getMobileIconName(iconKey)} size={20} style={iconStyle} /> : null}<Text style={iconStyle}>{option.label}</Text></Pressable> })}</View>
}

function Field({ keyboardType = 'default', label, multiline = false, onChangeText, styles, value }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} keyboardType={keyboardType} multiline={multiline} onChangeText={onChangeText} style={[styles.input, multiline && styles.inputMultiline]} value={String(value ?? '')} /></View>
}

function LinkedPlayerField({ emptyMessage, field, form, label: fieldLabel, onChange, playerChoices, prefix, styles }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const valueKey = field === 'shirt' ? `${prefix}ShirtNumber` : `${prefix}Name`
  const value = String(form?.[valueKey] ?? '')
  const choices = filterCoachMatchDayPlayerChoices(playerChoices, query)
  const choose = (player) => {
    onChange(pickCoachMatchDayLinkedPlayer(form, prefix, player))
    setOpen(false)
  }
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{fieldLabel}</Text>
    <View style={styles.linkedInputRow}>
      <TextInput
        accessibilityLabel={fieldLabel}
        onChangeText={(nextValue) => { onChange(updateCoachMatchDayLinkedPlayer(form, prefix, field, nextValue, playerChoices)); setQuery(nextValue); setOpen(true) }}
        onFocus={() => setOpen(true)}
        style={[styles.input, styles.linkedInput]}
        value={value}
      />
      <Pressable accessibilityLabel={`Show ${fieldLabel} choices`} accessibilityRole="button" onPress={() => { setQuery(''); setOpen((current) => !current) }} style={styles.playerChoiceToggle}><Text style={styles.playerChoiceToggleText}>{open ? 'Hide' : 'Choose'}</Text></Pressable>
    </View>
    {open ? <ScrollView accessibilityLabel={`${fieldLabel} players`} keyboardShouldPersistTaps="handled" nestedScrollEnabled style={[styles.playerChoiceList, { maxHeight: 260 }]}>
      {choices.length === 0 ? <Text style={styles.playerChoiceEmpty}>{emptyMessage}</Text> : choices.map((player, index) => <Pressable accessibilityRole="button" key={`${player.id}:${player.playerName}:${player.shirtNumber}`} onPress={() => choose(player)} style={[styles.playerChoiceRow, index === choices.length - 1 && { borderBottomWidth: 0 }]}><Text style={styles.playerChoiceName}>{player.playerName || 'Name not set'}</Text><Text style={styles.playerChoiceMeta}>{player.shirtNumber ? `Shirt ${player.shirtNumber}` : 'Shirt not set'}</Text></Pressable>)}
    </ScrollView> : null}
  </View>
}

function LinkedPlayerFields({ emptyMessage, form, nameLabel, onChange, playerChoices, prefix, shirtLabel, styles }) {
  return <>
    <LinkedPlayerField emptyMessage={emptyMessage} field="name" form={form} label={nameLabel} onChange={onChange} playerChoices={playerChoices} prefix={prefix} styles={styles} />
    <LinkedPlayerField emptyMessage={emptyMessage} field="shirt" form={form} label={shirtLabel} onChange={onChange} playerChoices={playerChoices} prefix={prefix} styles={styles} />
  </>
}

function MatchDayActionSheet({ busy, capturedClock, children, onClose, styles, title }) {
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose() }} transparent visible>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.actionModalScreen}>
      <Pressable accessibilityLabel={`Close ${title}`} disabled={busy} onPress={onClose} style={styles.modalBackdrop} />
      <View accessibilityViewIsModal style={styles.actionModalCard}>
        <View style={styles.actionModalHeader}>
          <View style={{ flex: 1, gap: 7 }}><Text style={styles.gameModeEyebrow}>Game mode</Text><Text accessibilityRole="header" style={styles.title}>{title}</Text>{capturedClock ? <Text style={styles.capturedPill}>Time captured at {capturedClock}</Text> : null}</View>
          <Button disabled={busy} label="Close" onPress={onClose} secondary styles={styles} />
        </View>
        <ScrollView contentContainerStyle={styles.actionModalContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}

function MatchList({ filter, matches, onOpen, selectedId, setFilter, styles }) {
  const visible = filterCoachMatchDays(matches, filter)
  return <View style={styles.stack}>
    <Chips onChange={setFilter} options={[{ iconKey: getMatchDayFilterIconKey('current'), label: 'Today and live', value: 'current' }, { iconKey: getMatchDayFilterIconKey('upcoming'), label: 'Upcoming', value: 'upcoming' }, { iconKey: getMatchDayFilterIconKey('previous'), label: 'Previous', value: 'previous' }, { iconKey: getMatchDayFilterIconKey('all'), label: 'All', value: 'all' }]} styles={styles} value={filter} />
    {visible.length === 0 ? <View style={styles.emptyState}><MaterialIcons name="sports-soccer" size={40} style={styles.secondaryText} /><Text style={styles.cardTitle}>No fixtures match this view.</Text><Text style={styles.meta}>Select a filter above to view fixtures.</Text></View> : null}
    {visible.map((match) => { const view = getCoachMatchDayPresentation(match); return <Pressable accessibilityRole="button" key={match.id} onPress={() => onOpen(match)} style={[styles.card, selectedId === match.id && styles.cardSelected]}><Text style={styles.cardTitle}>{view.displayName}</Text><Text style={styles.meta}>{match.matchDate || 'Date TBC'} | {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime || 'Time TBC'} | {label(match.status, 'scheduled')}</Text><Text style={styles.body}>{view.displayScore} | {view.phaseLabel}</Text></Pressable> })}
  </View>
}

function isLiveMatch(match) {
  return ['extra_time', 'half_time', 'live', 'penalties', 'second_half'].includes(normalize(match?.status))
}

function formatFixtureDate(value) {
  const normalized = normalize(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized || 'Date TBC'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Europe/London',
    weekday: 'short',
  }).format(new Date(`${normalized}T12:00:00Z`))
}

function FixtureHero({ match, now, styles }) {
  const [currentNow, setCurrentNow] = useState(() => Date.now())
  useEffect(() => {
    if (Number.isFinite(now) || !isLiveMatch(match)) return undefined
    const clockId = setInterval(() => setCurrentNow(Date.now()), 1000)
    return () => clearInterval(clockId)
  }, [match, now])
  const view = getCoachMatchDayPresentation(match, Number.isFinite(now) ? now : currentNow)
  const live = isLiveMatch(match)
  return <View style={[styles.fixtureHero, live && styles.fixtureHeroLive]}>
    <View style={styles.tabs}>
      <Text style={styles.liveSync}>{live ? 'Live sync on' : label(match.status, 'Scheduled')}</Text>
      <Text style={styles.liveSync}>{view.phaseLabel}</Text>
      {match.homeAway ? <Text style={styles.liveSync}>{label(match.homeAway)}</Text> : null}
      {match.fixtureType ? <Text style={styles.liveSync}>{label(match.fixtureType)}</Text> : null}
    </View>
    <Text accessibilityRole="header" style={styles.fixtureTitle}>{view.displayName}</Text>
    <Text style={styles.body}>{formatFixtureDate(match.matchDate)}, {match.kickoffTimeTbc ? 'Kick-off TBC' : match.kickoffTime || 'Time TBC'} at {match.venueName || 'Venue TBC'}</Text>
    <View style={styles.card}>
      <View style={styles.gameStatHeading}><MaterialIcons name={getMobileIconName('match.score')} size={20} style={styles.secondaryText} /><Text style={styles.gameStatLabel}>Score</Text></View>
      <Text accessibilityLiveRegion="polite" style={styles.score}>{view.displayScore}</Text>
      <View style={styles.gameStats}>
        <View style={styles.gameStat}><View style={styles.gameStatHeading}><MaterialIcons name={getMobileIconName('match.timer')} size={18} style={styles.secondaryText} /><Text style={styles.gameStatLabel}>Match timer</Text></View><Text accessibilityLiveRegion="polite" style={styles.gameStatValue}>{view.clock}</Text></View>
        <View style={styles.gameStat}><View style={styles.gameStatHeading}><MaterialIcons name={getMobileIconName('match.period')} size={18} style={styles.secondaryText} /><Text style={styles.gameStatLabel}>Period</Text></View><Text style={styles.gameStatValue}>{view.phaseLabel}</Text></View>
      </View>
    </View>
  </View>
}

function VolunteerPanel({ actions, busy, match, onSelect, styles }) {
  const assignmentByRole = new Map((match.roleAssignments || []).map((item) => [item.role, item]))
  return <View style={styles.stack}>
    <View style={styles.warning}><Text style={styles.cardTitle}>{config.isProduction ? 'Volunteer roles' : 'Communications disabled'}</Text><Text style={styles.body}>{config.isProduction ? 'Choose a scorer, linesman or referee from the people who offered to help. The person you select may receive a notification.' : 'This test app does not send scorer requests, availability reminders, email, or push notifications. It can only select from existing responses.'}</Text></View>
    {match.volunteerEligibilityError ? <Text style={styles.dangerText}>{match.volunteerEligibilityError}</Text> : null}
    {['scorer', 'linesman', 'referee'].map((role) => { const assignment = assignmentByRole.get(role); const assignmentRequest = (match.availabilityRequests || []).find((request) => request.parentLinkId === assignment?.parentLinkId); const removalTarget = assignment ? { ...(assignmentRequest || {}), parentLinkId: assignment.parentLinkId, requestId: assignmentRequest?.requestId || '' } : null; return <View key={role} style={styles.card}><Text style={styles.cardTitle}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text><Text style={styles.body}>{getCoachVolunteerAssignmentLabel(assignment, match.availabilityRequests)}</Text>{removalTarget ? <Button disabled={busy || !actions.canSelectVolunteers} label="Remove assignment" onPress={() => onSelect(removalTarget, role, false)} secondary styles={styles} /> : null}{(match.availabilityRequests || []).filter((request) => role !== 'scorer' || request.scorerEligible).filter((request) => request[`volunteer${role.charAt(0).toUpperCase() + role.slice(1)}Response`] === 'yes').map((request) => <Button disabled={busy || !actions.canSelectVolunteers} key={`${role}-${request.id}`} label={`${assignment ? 'Change to' : 'Select'} ${getCoachVolunteerPersonLabel(request)}`} onPress={() => onSelect(request, role, true)} secondary styles={styles} />)}</View> })}
  </View>
}

function LiveTimeline({ match, styles }) {
  const visibleEvents = (match.events || []).slice(-50).reverse()
  return <View style={styles.card}>
    <View style={styles.sectionHeader}><Text style={styles.cardTitle}>Match Timeline</Text><Text style={styles.liveSync}>Coach view</Text></View>
    {visibleEvents.length === 0 ? <Text style={styles.body}>No match events yet. Goals, cards and match actions will appear here once recorded.</Text> : null}
    {visibleEvents.map((event) => {
      const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: false })
      return <View key={event.id} style={styles.timelineItem}>
        <Text style={styles.timelineMinute}>{presentation.minuteLabel}</Text>
        <Text style={styles.cardTitle}>{presentation.title}</Text>
        <Text style={styles.body}>{presentation.detail || event.notes || label(event.teamSide)}</Text>
        <Text style={styles.meta}>{event.homeScore} - {event.awayScore} | {label(event.eventStatus)}</Text>
      </View>
    })}
  </View>
}

function LivePanel({ actions, busy, eventForm, match, onEventForm, onExit, onPrepare, onScore, onTimer, players, scoreDraft, setScoreDraft, styles }) {
  const [now, setNow] = useState(() => Date.now())
  const [actionSheet, setActionSheet] = useState(null)
  const [actionError, setActionError] = useState('')
  const [keepAwake, setKeepAwake] = useState(false)
  const [keepAwakeAvailable, setKeepAwakeAvailable] = useState(true)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => {
    let mounted = true
    void isAvailableAsync().then((available) => mounted && setKeepAwakeAvailable(available)).catch(() => mounted && setKeepAwakeAvailable(false))
    return () => {
      mounted = false
      void deactivateKeepAwake('football-player-coach-game-day').catch(() => {})
    }
  }, [])
  const view = getCoachMatchDayPresentation(match, now)
  const selectedPlayers = useMemo(() => getCoachMatchDaySelectedPlayers(players, match), [match, players])
  const opponentPlayers = useMemo(() => getCoachMatchDayOpponentPlayers(match), [match])
  const scorerSide = eventForm.eventType === 'goal' ? getGoalScorerSide(eventForm) : eventForm.teamSide
  const playerChoices = scorerSide === 'opponent' ? opponentPlayers : selectedPlayers
  const playerChoiceEmptyMessage = scorerSide === 'opponent'
    ? 'No opponent players have been saved yet. You can type the details.'
    : 'No selected active team players are available. Select a Match participant or choose Other.'
  const participantOptions = ['goal', 'substitution'].includes(eventForm.eventType)
    ? [{ label: 'Player', value: 'player' }, { label: 'Other', value: 'other' }]
    : [{ label: 'Player', value: 'player' }, { label: 'Coach', value: 'coach' }, { label: 'Other', value: 'other' }]
  const prepareEvent = (eventType) => {
    const pressedAt = Date.now()
    const form = createCoachMatchDayEventForm(eventType, match, pressedAt)
    onEventForm(form)
    setActionError('')
    setActionSheet({ capturedClock: form.capturedClock, kind: 'event', title: MATCH_DAY_EVENT_TITLES[eventType] || 'Match event' })
  }
  const prepareScoreCorrection = () => {
    const capture = captureCoachMatchDayAction(match, 'score_correction', Date.now())
    setActionSheet({ capturedClock: capture.capturedClock, kind: 'score', title: 'Correct score' })
    setActionError('')
  }
  const timerAction = (action) => actions.timerActions.find((item) => item.action === action)
  const runTimer = (action, fallbackLabel) => {
    const item = timerAction(action)
    if (!item) return
    if (['hydration', 'pause', 'resume'].includes(action)) {
      void onTimer(action).catch(() => {})
      return
    }
    onPrepare({ kind: action === 'start' ? 'start-match' : 'timer', label: item.label || fallbackLabel, run: () => onTimer(action) })
  }
  const saveEvent = async () => {
    try {
      const saved = await onScore('event')
      if (!saved) throw new Error('The Match Day event was not confirmed by the server.')
      setActionSheet(null)
      setActionError('')
      return true
    } catch (saveError) {
      setActionError(errorMessage(saveError, 'This Match Day event could not be saved. Check the details and try again.'))
      return false
    }
  }
  const saveScore = async () => {
    try {
      const saved = await onScore('score')
      if (!saved) throw new Error('The score correction was not confirmed by the server.')
      setActionSheet(null)
      setActionError('')
      return true
    } catch (saveError) {
      setActionError(errorMessage(saveError, 'This score correction could not be saved. Check the details and try again.'))
      return false
    }
  }
  const toggleKeepAwake = async (enabled) => {
    try {
      if (enabled) await activateKeepAwakeAsync('football-player-coach-game-day')
      else await deactivateKeepAwake('football-player-coach-game-day')
      setKeepAwake(enabled)
    } catch {
      setKeepAwake(false)
      setKeepAwakeAvailable(false)
    }
  }
  return <View style={styles.stack}>
    {actions.blockedReason ? <View style={styles.warning}><Text style={styles.body}>{actions.blockedReason}</Text></View> : null}
    {actions.startBlockedReason ? <View style={styles.warning}><Text style={styles.cardTitle}>Not available to start today</Text><Text style={styles.body}>This fixture is scheduled for {formatFixtureDate(match.matchDate)}. It can only be started on that date. If the match has moved, edit the fixture date first.</Text></View> : null}
    <View style={styles.gameMode}>
      <Text style={styles.gameModeEyebrow}>Game mode</Text>
      <Text style={styles.cardTitle}>Live controller</Text>
      <Button iconKey="panel.overview" label="Exit Game Mode" onPress={onExit} secondary styles={styles} />
      <View style={styles.gameStats}>
        <View style={styles.gameStat}><View style={styles.gameStatHeading}><MaterialIcons name={getMobileIconName('match.score')} size={18} style={styles.secondaryText} /><Text style={styles.gameStatLabel}>Score</Text></View><Text style={styles.gameStatValue}>{view.displayScore}</Text></View>
        <View style={styles.gameStat}><View style={styles.gameStatHeading}><MaterialIcons name={getMobileIconName('match.timer')} size={18} style={styles.secondaryText} /><Text style={styles.gameStatLabel}>Match timer</Text></View><Text style={styles.gameStatValue}>{view.clock}</Text></View>
        <View style={styles.gameStat}><View style={styles.gameStatHeading}><MaterialIcons name={getMobileIconName('match.period')} size={18} style={styles.secondaryText} /><Text style={styles.gameStatLabel}>Period</Text></View><Text style={styles.gameStatValue}>{view.phaseLabel}</Text></View>
      </View>
      <View style={styles.card}>
        <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Keep screen awake</Text><Text style={styles.meta}>{keepAwakeAvailable ? 'Optional for this Game Day session. No match data is changed.' : 'Unavailable on this device.'}</Text></View><Switch accessibilityLabel="Keep screen awake" disabled={!keepAwakeAvailable} onValueChange={toggleKeepAwake} value={keepAwake} /></View>
      </View>
      <Text style={styles.meta}>{getMatchClockDescription(match)}</Text>
      <View style={styles.quickActions}>
        <View style={styles.quickAction}><Button disabled={busy || !actions.canRecordEvents} iconKey="match.goal" label="Goal" onPress={() => prepareEvent('goal')} styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !actions.canRecordEvents} iconKey="match.yellow-card" label="Yellow" onPress={() => prepareEvent('yellow_card')} secondary styles={styles} warning /></View>
        <View style={styles.quickAction}><Button danger disabled={busy || !actions.canRecordEvents} iconKey="match.red-card" label="Red" onPress={() => prepareEvent('red_card')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !actions.canRecordEvents} iconKey="match.substitution" label="Sub" onPress={() => prepareEvent('substitution')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('pause')} iconKey="match.pause" label="Pause" onPress={() => runTimer('pause', 'Pause')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('hydration')} iconKey="match.hydration" label="Hydration" onPress={() => runTimer('hydration', 'Hydration')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button disabled={busy || !timerAction('half_time')} iconKey="match.half-time" label="HT" onPress={() => runTimer('half_time', 'Half time')} secondary styles={styles} /></View>
        <View style={styles.quickAction}><Button danger disabled={busy || !timerAction('full_time')} iconKey="match.full-time" label="FT" onPress={() => runTimer('full_time', 'Full time')} styles={styles} /></View>
        {timerAction('start') ? <View style={styles.quickAction}><Button disabled={busy} label="Start match" onPress={() => runTimer('start', 'Start match')} styles={styles} /></View> : null}
        {timerAction('resume') ? <View style={styles.quickAction}><Button disabled={busy} label="Resume" onPress={() => runTimer('resume', 'Resume')} secondary styles={styles} /></View> : null}
      </View>
      <Button disabled={busy || !actions.canRecordEvents} iconKey="match.correct-score" label="Correct score" onPress={prepareScoreCorrection} secondary styles={styles} />
    </View>
    {actionSheet?.kind === 'event' ? <MatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title={actionSheet.title}>
      <Text style={styles.body}>The match time was captured when you pressed the action. Add the details without rushing.</Text>
      <Text style={styles.fieldLabel}>{eventForm.eventType === 'goal' ? 'Goal awarded to' : 'Team'}</Text>
      <Chips onChange={(value) => { setActionError(''); onEventForm({ ...eventForm, assistName: '', assistShirtNumber: '', participantType: 'player', playerName: '', playerOnName: '', playerOnParticipantType: 'player', playerOnShirtNumber: '', playerShirtNumber: '', scorerName: '', scorerParticipantType: 'player', scorerShirtNumber: '', teamSide: value }) }} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={eventForm.teamSide} />
      <Field keyboardType="number-pad" label="Match minute" onChangeText={(value) => onEventForm({ ...eventForm, minute: value })} styles={styles} value={eventForm.minute} />
      <Field keyboardType="number-pad" label="Added minutes" onChangeText={(value) => onEventForm({ ...eventForm, stoppageMinute: value })} styles={styles} value={eventForm.stoppageMinute} />
      {eventForm.teamSide === 'club' && eventForm.eventType !== 'goal' ? <Text style={styles.meta}>Choose Player for a selected active team participant. Choose Coach or Other for a match-only name that will not change a player record.</Text> : null}
      {eventForm.eventType === 'goal' ? <>
        <View style={styles.row}><Text style={styles.fieldLabel}>Own goal</Text><Switch accessibilityLabel="Own goal" disabled={busy} onValueChange={(value) => onEventForm(setGoalOwnGoal(eventForm, value))} value={eventForm.isOwnGoal === true} /></View>
        {eventForm.isOwnGoal ? <Text style={styles.meta}>{scorerSide === 'club' ? 'Our player scored an own goal. The opponent receives the goal.' : 'An opponent scored an own goal. Our team receives the goal.'}</Text> : null}
        {scorerSide === 'club' ? <><Text style={styles.fieldLabel}>Scorer type</Text><Chips onChange={(value) => onEventForm({ ...eventForm, scorerName: '', scorerParticipantType: value, scorerShirtNumber: '' })} options={participantOptions} styles={styles} value={eventForm.scorerParticipantType} /></> : null}
        {scorerSide === 'opponent' || eventForm.scorerParticipantType === 'player'
          ? <LinkedPlayerFields emptyMessage={playerChoiceEmptyMessage} form={eventForm} key={`goal-scorer:${scorerSide}`} nameLabel={scorerSide === 'opponent' ? 'Scorer (Optional)' : 'Scorer'} onChange={onEventForm} playerChoices={playerChoices} prefix="scorer" shirtLabel={scorerSide === 'opponent' ? 'Scorer shirt number (Optional)' : 'Scorer shirt number'} styles={styles} />
          : <Field label={eventForm.scorerParticipantType === 'coach' ? 'Coach name' : 'Other participant name'} onChangeText={(value) => onEventForm({ ...eventForm, scorerName: value, scorerShirtNumber: '' })} styles={styles} value={eventForm.scorerName} />}
        {!eventForm.isOwnGoal ? <LinkedPlayerFields emptyMessage={playerChoiceEmptyMessage} form={eventForm} key={`goal-assist:${scorerSide}`} nameLabel={scorerSide === 'opponent' ? 'Assist (Optional)' : 'Assist'} onChange={onEventForm} playerChoices={playerChoices} prefix="assist" shirtLabel={scorerSide === 'opponent' ? 'Assist shirt number (Optional)' : 'Assist shirt number'} styles={styles} /> : null}
        <View style={styles.row}><Text style={styles.fieldLabel}>Penalty</Text><Switch disabled={busy || eventForm.isOwnGoal} accessibilityLabel="Penalty" onValueChange={(value) => onEventForm({ ...eventForm, isPenaltyGoal: value })} value={eventForm.isPenaltyGoal} /></View>
      </> : <>
        {eventForm.teamSide === 'club' ? <><Text style={styles.fieldLabel}>{eventForm.eventType === 'substitution' ? 'Participant off type' : 'Participant type'}</Text><Chips onChange={(value) => onEventForm({ ...eventForm, participantType: value, playerName: '', playerShirtNumber: '' })} options={participantOptions} styles={styles} value={eventForm.participantType} /></> : null}
        {eventForm.teamSide === 'opponent' || eventForm.participantType === 'player'
          ? <LinkedPlayerFields emptyMessage={playerChoiceEmptyMessage} form={eventForm} key={`event-player:${eventForm.eventType}:${eventForm.teamSide}`} nameLabel={eventForm.teamSide === 'opponent' ? `${eventForm.eventType === 'substitution' ? 'Player off' : 'Player'} (Optional)` : eventForm.eventType === 'substitution' ? 'Player off' : 'Player'} onChange={onEventForm} playerChoices={playerChoices} prefix="player" shirtLabel={eventForm.teamSide === 'opponent' ? `${eventForm.eventType === 'substitution' ? 'Player off shirt number' : 'Player shirt number'} (Optional)` : eventForm.eventType === 'substitution' ? 'Player off shirt number' : 'Player shirt number'} styles={styles} />
          : <Field label={eventForm.participantType === 'coach' ? 'Coach name' : 'Other participant name'} onChangeText={(value) => onEventForm({ ...eventForm, playerName: value, playerShirtNumber: '' })} styles={styles} value={eventForm.playerName} />}
        {eventForm.eventType === 'substitution' && eventForm.teamSide === 'club' ? <><Text style={styles.fieldLabel}>Participant on type</Text><Chips onChange={(value) => onEventForm({ ...eventForm, playerOnName: '', playerOnParticipantType: value, playerOnShirtNumber: '' })} options={[{ label: 'Player', value: 'player' }, { label: 'Other', value: 'other' }]} styles={styles} value={eventForm.playerOnParticipantType} /></> : null}
        {eventForm.eventType === 'substitution' ? (eventForm.teamSide === 'opponent' || eventForm.playerOnParticipantType === 'player'
          ? <LinkedPlayerFields emptyMessage={playerChoiceEmptyMessage} form={eventForm} key={`event-player-on:${eventForm.teamSide}`} nameLabel={eventForm.teamSide === 'opponent' ? 'Player on (Optional)' : 'Player on'} onChange={onEventForm} playerChoices={playerChoices} prefix="playerOn" shirtLabel={eventForm.teamSide === 'opponent' ? 'Player on shirt number (Optional)' : 'Player on shirt number'} styles={styles} />
          : <Field label="Other participant on name" onChangeText={(value) => onEventForm({ ...eventForm, playerOnName: value, playerOnShirtNumber: '' })} styles={styles} value={eventForm.playerOnName} />) : null}
      </>}
      <Field label="Notes" multiline onChangeText={(value) => onEventForm({ ...eventForm, notes: value })} styles={styles} value={eventForm.notes} />
      {actionError ? <View accessibilityLiveRegion="assertive" style={styles.warning}><Text style={styles.dangerText}>{actionError}</Text></View> : null}
      <Button disabled={busy || !actions.canRecordEvents} label={busy ? 'Saving...' : `Record ${eventForm.eventType.replaceAll('_', ' ')}`} onPress={saveEvent} styles={styles} />
    </MatchDayActionSheet> : null}
    {actionSheet?.kind === 'score' ? <MatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Correct score">
      <Text style={styles.body}>Use this only when the displayed score is wrong. The correction remains in the Match Day audit history.</Text>
      <View style={styles.row}><View style={{ flex: 1 }}><Field label="Home" onChangeText={(value) => setScoreDraft({ ...scoreDraft, home: value })} styles={styles} value={scoreDraft.home} /></View><View style={{ flex: 1 }}><Field label="Away" onChangeText={(value) => setScoreDraft({ ...scoreDraft, away: value })} styles={styles} value={scoreDraft.away} /></View></View>
      {actionError ? <View accessibilityLiveRegion="assertive" style={styles.warning}><Text style={styles.dangerText}>{actionError}</Text></View> : null}
      <Button disabled={busy || !actions.canRecordEvents} label={busy ? 'Saving...' : 'Save score correction'} onPress={saveScore} styles={styles} />
    </MatchDayActionSheet> : null}
    <LiveTimeline match={match} styles={styles} />
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
    {visibleEvents.map((event) => { const undo = getCoachMatchDayUndoModel(event); const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: false }); return <View key={event.id} style={styles.card}><Text style={styles.cardTitle}>{presentation.title} {presentation.minuteLabel}</Text><Text style={styles.body}>{presentation.detail || event.notes || event.teamSide}</Text><Text style={styles.meta}>{event.homeScore} - {event.awayScore} | {event.eventStatus}</Text>{event.eventType === 'goal' && event.eventStatus !== 'voided' ? <Button disabled={busy} label="Correct goal details" onPress={() => { setCorrectEvent(event); setCorrectionReason(''); setGoalDraft({ isOwnGoal: event.isOwnGoal === true, stoppageMinute: String(event.stoppageMinute ?? ''), assistName: event.assistName, assistShirtNumber: event.assistShirtNumber, minute: String(event.minute ?? ''), notes: event.notes, scorerName: event.scorerName, scorerShirtNumber: event.scorerShirtNumber, teamSide: event.teamSide }) }} secondary styles={styles} /> : null}{undo.canUndo ? <Button disabled={busy} label="Undo event" onPress={() => { setUndoEvent(event); setReasonCode(''); setNote('') }} secondary styles={styles} /> : null}</View> })}
    {correctEvent && goalDraft ? <View style={styles.warning}><Text style={styles.cardTitle}>Correct goal details</Text><Chips onChange={(value) => setGoalDraft({ ...goalDraft, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={goalDraft.teamSide} /><Field label="Minute" onChangeText={(value) => setGoalDraft({ ...goalDraft, minute: value })} styles={styles} value={goalDraft.minute} /><Field keyboardType="number-pad" label="Added minutes" onChangeText={(value) => setGoalDraft({ ...goalDraft, stoppageMinute: value })} styles={styles} value={goalDraft.stoppageMinute} /><View style={styles.row}><Text style={styles.fieldLabel}>Own goal</Text><Switch accessibilityLabel="Corrected goal is an own goal" disabled={busy} onValueChange={(value) => setGoalDraft(setGoalOwnGoal(goalDraft, value))} value={goalDraft.isOwnGoal} /></View><Field label="Scorer" onChangeText={(value) => setGoalDraft({ ...goalDraft, scorerName: value })} styles={styles} value={goalDraft.scorerName} /><Field label="Scorer shirt number" onChangeText={(value) => setGoalDraft({ ...goalDraft, scorerShirtNumber: value })} styles={styles} value={goalDraft.scorerShirtNumber} /><Field label="Assist" onChangeText={(value) => setGoalDraft({ ...goalDraft, assistName: value })} styles={styles} value={goalDraft.assistName} /><Field label="Correction reason" onChangeText={setCorrectionReason} styles={styles} value={correctionReason} /><Button disabled={busy || !correctionReason} label="Review goal correction" onPress={() => onPrepare({ kind: 'correct-goal', label: 'Correct goal and retain audit history', run: async () => { const validated = validateCoachMatchDayEventForm({ ...goalDraft, eventType: 'goal' }); await onCorrectGoal(correctEvent, validated, correctionReason); setCorrectEvent(null); setGoalDraft(null) } })} styles={styles} /><Button label="Cancel" onPress={() => { setCorrectEvent(null); setGoalDraft(null) }} secondary styles={styles} /></View> : null}
    {undoEvent ? <View style={styles.warning}><Text style={styles.cardTitle}>Confirm timeline correction</Text><Chips onChange={setReasonCode} options={getCoachMatchDayUndoModel(undoEvent).options} styles={styles} value={reasonCode} /><Field label="Correction note" multiline onChangeText={setNote} styles={styles} value={note} /><Button disabled={busy || !reasonCode} danger label="Review undo" onPress={() => onPrepare({ kind: 'undo', label: 'Void timeline event', run: async () => { await onUndo(undoEvent, { note, reasonCode }); setUndoEvent(null) } })} styles={styles} /><Button label="Cancel" onPress={() => setUndoEvent(null)} secondary styles={styles} /></View> : null}
  </View>
}

function ShootoutPanel({ busy, match, onKick, onPrepare, onVoid, styles }) {
  const [kick, setKick] = useState({ notes: '', outcome: 'scored', playerName: '', teamSide: 'club' })
  return <View style={styles.stack}><View style={styles.card}><Text style={styles.cardTitle}>Penalty shootout</Text><Text style={styles.score}>{match.homeShootoutScore} - {match.awayShootoutScore}</Text><Chips onChange={(value) => setKick({ ...kick, teamSide: value })} options={[{ label: 'Our Team', value: 'club' }, { label: 'Opponent', value: 'opponent' }]} styles={styles} value={kick.teamSide} /><Chips onChange={(value) => setKick({ ...kick, outcome: value })} options={[{ label: 'Scored', value: 'scored' }, { label: 'Missed', value: 'missed' }]} styles={styles} value={kick.outcome} /><Field label="Player" onChangeText={(value) => setKick({ ...kick, playerName: value })} styles={styles} value={kick.playerName} /><Field label="Notes" onChangeText={(value) => setKick({ ...kick, notes: value })} styles={styles} value={kick.notes} /><Button disabled={busy || match.currentMatchPhase !== 'penalties'} label="Review penalty" onPress={() => onPrepare({ kind: 'kick', label: 'Record penalty', run: () => onKick(kick) })} styles={styles} /></View>{(match.shootoutEvents || []).map((item) => <View key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.kickNumber}. {item.teamSide} {item.outcome}</Text><Text style={styles.body}>{item.playerName || 'Player not recorded'}</Text>{item.eventStatus !== 'voided' ? <Button disabled={busy} label="Void penalty" onPress={() => onPrepare({ kind: 'void-kick', label: 'Void penalty kick', run: () => onVoid(item.id) })} secondary styles={styles} /> : null}</View>)}</View>
}

function ReportPanel({ busy, canConclude, canSave, match, onConclude, onSave, styles }) {
  const report = buildCoachFinalMatchReport(match)
  const activeEvents = report.activeEvents.slice().reverse()
  const [notes, setNotes] = useState(match.finalReport?.staffNotes || '')
  return <View style={styles.stack}>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Final result</Text>
      <Text selectable style={styles.score}>{report.result.finalScore}</Text>
      {report.result.shootoutScore ? <Text style={styles.body}>Shootout {report.result.shootoutScore}{report.result.shootoutWinner ? ` | ${report.result.shootoutWinner} won` : ''}</Text> : null}
      {match.status === 'full_time' && !match.concludedAt ? <><Text style={styles.body}>Review the score and match events below, then conclude the match.</Text><Button disabled={busy || !canConclude} label="Conclude match" onPress={onConclude} styles={styles} /></> : null}
      {match.concludedAt ? <Text style={styles.body}>Match concluded</Text> : null}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Match summary</Text>
      <Text style={styles.body}>Goals {report.activeGoals.length} | Cards {report.activeCards.length} | Substitutions {report.activeSubstitutions.length}</Text>
      <Text style={styles.meta}>Active events {report.activeEvents.length} | Corrected or voided events {report.voidedEvents.length}</Text>
      {activeEvents.length === 0 ? <Text style={styles.body}>No match events were recorded.</Text> : null}
      {activeEvents.map((event) => {
        const presentation = buildCompletedMatchEventPresentation(event, match)
        return <View key={event.id} style={styles.field}><View style={styles.row}><Text style={styles.fieldLabel}>{presentation.minuteLabel} | {presentation.title}</Text><Text style={styles.meta}>{presentation.scoreLabel}</Text></View><Text style={styles.body}>{presentation.team.name}{presentation.detail ? ` | ${presentation.detail}` : ''}</Text>{presentation.notes ? <Text style={styles.meta}>{presentation.notes}</Text> : null}</View>
      })}
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Final Match Report</Text>
      {match.status !== 'full_time' ? <Text style={styles.body}>Finish the match before saving the final report.</Text> : null}
      {!canSave && match.status === 'full_time' ? <Text style={styles.body}>Reconnect and confirm Coach access before saving this report.</Text> : null}
      <Field label="Coach notes" multiline onChangeText={setNotes} styles={styles} value={notes} />
      <Button disabled={busy || !canSave} label="Save final report" onPress={() => onSave(notes)} styles={styles} />
    </View>
  </View>
}

export function CoachMatchDayScreen({ context, matchDayTarget, onMatchDayTargetHandled, onNavigate, onQuickActionHandled, onRequestScrollTop, palette, quickAction, user }) {
  const styles = useMemo(() => createStyles(palette), [palette])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [eventForm, setEventForm] = useState(createCoachMatchDayEventForm())
  const [filter, setFilter] = useState(matchDayTarget?.fixtureId ? 'all' : 'current')
  const [fixtureFormOpen, setFixtureFormOpen] = useState(false)
  const [fixtureFormMatch, setFixtureFormMatch] = useState(null)
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
  const confirmedStale = useConfirmedConnectionIssue(stale)
  const visibleError = useConfirmedConnectionMessage(error)
  const appState = useRef(AppState.currentState)
  const backgroundedAt = useRef(0)
  const busyRef = useRef(false)
  const contextRef = useRef(context)
  const loadInFlight = useRef(false)
  const matchRef = useRef(null)
  const selectedMatchId = useRef('')
  const targetRequestId = useRef('')
  const userRef = useRef(user)

  const requestedFixtureId = String(matchDayTarget?.fixtureId || '').trim()
  const selectedMatchIsLive = isLiveMatch(match)
  if (requestedFixtureId && targetRequestId.current !== matchDayTarget?.requestId) {
    targetRequestId.current = matchDayTarget.requestId
    selectedMatchId.current = requestedFixtureId
  }

  contextRef.current = context
  userRef.current = user

  useEffect(() => {
    busyRef.current = busy || reconciling
  }, [busy, reconciling])

  useEffect(() => {
    matchRef.current = match
    selectedMatchId.current = match?.id || requestedFixtureId || ''
  }, [match, requestedFixtureId])

  const cache = useCallback(async (nextMatches, nextMatch, nextPlayers) => saveCoachOfflineResources(userRef.current.id, contextRef.current, { matchDayDetail: nextMatch || null, matchDayList: nextMatches, matchDayPlayers: nextPlayers }), [])
  const load = useCallback(async () => {
    if (loadInFlight.current || busyRef.current) return
    loadInFlight.current = true
    setError(''); setNotice(''); setLoading(true)
    const currentUser = userRef.current
    const currentContext = contextRef.current
    const selectionBeforeLoad = selectedMatchId.current
    const saved = await readCoachOfflineResources(currentUser.id, currentContext).catch(() => null)
    const hasCachedMatches = Array.isArray(saved?.resources?.matchDayList)
    const cachedMatch = saved?.resources?.matchDayDetail && typeof saved.resources.matchDayDetail === 'object'
      ? normalizeCoachMatchDay(saved.resources.matchDayDetail)
      : null
    if (hasCachedMatches) {
      setMatches(normalizeCachedMatches(saved.resources.matchDayList))
      setPlayers(Array.isArray(saved.resources.matchDayPlayers) ? saved.resources.matchDayPlayers : [])
      if (!selectionBeforeLoad && cachedMatch) {
        selectedMatchId.current = cachedMatch.id
        matchRef.current = cachedMatch
        setMatch(cachedMatch)
      }
      setStale(true)
      setLoading(false)
    }
    try {
      const [matchesResult, playersResult] = await Promise.allSettled([
        withMobileAsyncTimeout(() => getCoachMatchDayList(currentUser)),
        withMobileAsyncTimeout(() => getCoachPlayerList(currentUser)),
      ])
      if (matchesResult.status === 'rejected') throw matchesResult.reason
      const nextMatches = matchesResult.value
      const nextPlayers = playersResult.status === 'fulfilled'
        ? playersResult.value
        : Array.isArray(saved?.resources?.matchDayPlayers) ? saved.resources.matchDayPlayers : []
      setMatches(nextMatches); setPlayers(nextPlayers); setReconciling(false)
      const activeSelectionId = selectedMatchId.current
      let nextMatch = null
      if (activeSelectionId) {
        try {
          nextMatch = await withMobileAsyncTimeout(() => getCoachMatchDayDetail(currentUser, activeSelectionId))
        } catch (detailError) {
          const exactCachedMatch = cachedMatch?.id === activeSelectionId ? cachedMatch : null
          if (exactCachedMatch) {
            matchRef.current = exactCachedMatch
            setMatch(exactCachedMatch)
          } else if (matchRef.current?.id !== activeSelectionId) {
            matchRef.current = null
            setMatch(null)
          }
          setStale(true)
          setError(errorMessage(detailError, 'Fixture details could not be refreshed.'))
          await cache(nextMatches, exactCachedMatch, nextPlayers)
          return
        }
      }
      if (nextMatch && selectedMatchId.current === nextMatch.id) {
        matchRef.current = nextMatch
        setMatch(nextMatch)
        setScoreDraft({ away: String(nextMatch.awayScore), home: String(nextMatch.homeScore) })
      }
      setStale(false)
      await cache(nextMatches, nextMatch || matchRef.current, nextPlayers)
    } catch (loadError) {
      if (!hasCachedMatches) setError(errorMessage(loadError, 'Match Day could not be loaded.'))
    } finally {
      loadInFlight.current = false
      setLoading(false)
    }
  }, [cache])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!requestedFixtureId || loading || match?.id !== requestedFixtureId) return
    setPanel(isLiveMatch(match) ? 'live' : 'overview')
    onMatchDayTargetHandled?.()
  }, [loading, match, onMatchDayTargetHandled, requestedFixtureId])
  useEffect(() => {
    if (quickAction?.intent !== 'create-match') return
    setFixtureFormMatch(null)
    setFixtureFormOpen(true)
    setError('')
    setNotice('')
    onRequestScrollTop?.()
    onQuickActionHandled?.()
  }, [onQuickActionHandled, onRequestScrollTop, quickAction])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appState.current
      if (nextState === 'background' && previousState !== 'background') backgroundedAt.current = Date.now()
      appState.current = nextState
      const returnedFromBackground = previousState === 'background' && nextState === 'active'
      if (returnedFromBackground && Date.now() - backgroundedAt.current >= 2500 && !busyRef.current) void load()
    })
    return () => subscription.remove()
  }, [load])
  useEffect(() => {
    if (!selectedMatchIsLive || stale || reconciling) return undefined
    const refreshId = setInterval(() => { if (!busyRef.current) void load() }, 15000)
    return () => clearInterval(refreshId)
  }, [load, match?.id, reconciling, selectedMatchIsLive, stale])

  const open = async (summary) => {
    selectedMatchId.current = summary.id
    setBusy(true); setError('')
    try { const detail = await withMobileAsyncTimeout(() => getCoachMatchDayDetail(user, summary.id)); matchRef.current = detail; setMatch(detail); setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) }); setEventForm(createCoachMatchDayEventForm('goal', detail)); setPanel(isLiveMatch(detail) ? 'live' : 'overview'); setStale(false); await cache(matches, detail, players) }
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
  const notifySquad = async (choices) => {
    if (busyRef.current) return []
    busyRef.current = true
    setBusy(true); setError(''); setNotice('')
    let results = []; let detail = null; let message = ''
    try {
      try { results = await notifyCoachMatchDaySquadDecisions(user, match, choices) }
      catch (notifyError) { message = errorMessage(notifyError, 'Notifications could not be confirmed. Try again.') }
      try {
        detail = await getCoachMatchDayDetail(user, match.id)
        const nextMatches = matches.map((item) => item.id === detail.id ? detail : item)
        matchRef.current = detail
        setMatch(detail); setMatches(nextMatches); setStale(false)
        await cache(nextMatches, detail, players).catch(() => {})
      } catch { /* Per-player server results remain valid if the following refresh fails. */ }
      return reconcileCoachSquadNotificationResults(choices, results, detail, message)
    } finally { busyRef.current = false; setBusy(false) }
  }
  const actions = getCoachMatchDayActions({ context, match, reconciling, stale })
  const submitEvent = async () => { const validated = validateCoachMatchDayEventForm(eventForm); const commandId = createCoachMatchDayCommandId(); const detail = await replace(() => recordCoachMatchDayEvent(user, match, validated, commandId), (nextDetail) => hasCoachMatchDayCommandResult(nextDetail, commandId)); setEventForm(createCoachMatchDayEventForm(validated.eventType, detail)); return detail }
  const handleFixtureCreated = async (result) => {
    setFixtureFormOpen(false)
    onRequestScrollTop?.()
    setNotice(result.calendarScopeWarning
      ? `The fixture was added to Coach calendars, but squad calendars could not be updated: ${result.calendarScopeWarning}`
      : result.invitationWarning
        || (result.calendarTarget === 'coach'
          ? 'Fixture added to Coach calendars. No squad requests or notifications were sent.'
          : result.calendarTarget === 'squad'
            ? 'Fixture added to Coach and squad calendars. No availability requests or notifications were sent.'
            : 'Fixture created. Match Day controls are ready.'))
    const summary = normalizeCoachMatchDay(result.match)
    setMatches((current) => [summary, ...current.filter((item) => item.id !== summary.id)])
    try {
      const detail = await getCoachMatchDayDetail(user, summary.id)
      setMatch(detail)
      setPanel('overview')
      setScoreDraft({ away: String(detail.awayScore), home: String(detail.homeScore) })
    } catch {
      setMatch(summary)
    }
  }

  const handleFixtureUpdated = async (updatedMatch) => {
    setFixtureFormOpen(false)
    setFixtureFormMatch(null)
    onRequestScrollTop?.()
    const summary = normalizeCoachMatchDay(updatedMatch)
    setMatches((current) => current.map((item) => item.id === summary.id ? summary : item))
    setMatch(summary)
    setPanel('overview')
    setNotice('Fixture details updated. No new availability request was sent.')
    await cache(matches.map((item) => item.id === summary.id ? summary : item), summary, players).catch(() => {})
  }

  const closeFixture = () => {
    selectedMatchId.current = ''
    matchRef.current = null
    setMatch(null)
    setPanel('overview')
  }

  const focusedLiveMode = Boolean(match && !fixtureFormOpen && panel === 'live')

  return <View style={styles.stack}>
    {!focusedLiveMode ? <><Text accessibilityRole="header" style={styles.title}>Game Day</Text><Text style={styles.body}>Live fixture control with server-authoritative squad, clock, events, volunteers, shootout, and corrections.</Text></> : null}
    {!match ? <View style={styles.tabs}><Button iconKey="coach.availability" label="Availability" onPress={() => onNavigate('invites')} secondary styles={styles} /><Button iconKey="coach.chat" label="Team Chat" onPress={() => onNavigate('chat')} secondary styles={styles} /><Button iconKey="route.calendar" label="Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} /></View> : null}
    {!match && !fixtureFormOpen && !stale && Number(context.roleRank || 0) >= 20 ? <Button iconKey="match.create" label="Create match" onPress={() => { setFixtureFormMatch(null); setFixtureFormOpen(true); setError(''); setNotice(''); onRequestScrollTop?.() }} styles={styles} /> : null}
    {fixtureFormOpen ? <CoachFixtureForm match={fixtureFormMatch} matches={matches} onCancel={() => { setFixtureFormOpen(false); setFixtureFormMatch(null); onRequestScrollTop?.() }} onCreated={handleFixtureCreated} onUpdated={handleFixtureUpdated} players={players} styles={styles} user={user} /> : null}
    {match && !fixtureFormOpen && ['overview', 'volunteers'].includes(panel) ? <CoachGuestScorer key={match.id} match={match} buttonComponent={Button} styles={styles} disabled={stale || busy || reconciling} /> : null}
    {loading ? <View style={styles.card}><BrandLoader /><Text style={styles.body}>Loading authoritative Match Day data...</Text></View> : null}
    {reconciling ? <View accessibilityLiveRegion="assertive" style={styles.warning}><BrandLoader /><Text style={styles.cardTitle}>Reconciling the last action</Text><Text style={styles.body}>The current fixture remains visible, but changes are blocked until the server result is known.</Text></View> : null}
    {notice ? <View accessibilityLiveRegion="polite" style={styles.card}><Text style={styles.body}>{notice}</Text></View> : null}
    {error && !visibleError ? <View style={styles.card}><BrandLoader /><Text style={styles.body}>Checking for the latest Match Day information...</Text></View> : null}
    {visibleError ? <View style={styles.warning}><Text style={styles.dangerText}>{visibleError}</Text><Button label="Refresh" onPress={load} secondary styles={styles} /></View> : null}
    {confirmedStale ? <View style={styles.warning}><Text style={styles.cardTitle}>Offline read</Text><Text style={styles.body}>Showing encrypted cached Match Day data. Every change is disabled until a successful refresh.</Text></View> : null}
    {!fixtureFormOpen && !match ? <MatchList filter={filter} matches={matches} onOpen={open} selectedId={match?.id} setFilter={setFilter} styles={styles} /> : null}
    {match && !fixtureFormOpen ? <>{!focusedLiveMode ? <><Button iconKey="action.back" label="Back to fixtures" onPress={closeFixture} secondary styles={styles} /><Chips iconResolver={getMatchDayPanelIconKey} onChange={setPanel} options={MATCH_DAY_PANEL_OPTIONS} styles={styles} value={panel} /></> : null}
      {match.status === 'full_time' && !match.concludedAt && panel !== 'report' ? <View style={styles.card}><Text style={styles.cardTitle}>Ready for coach review</Text><Text style={styles.body}>Full time has been recorded. Review the result and conclude this match.</Text><Button disabled={busy || reconciling} label="Review and conclude" onPress={() => { setPanel('report'); onRequestScrollTop?.() }} styles={styles} /></View> : null}
      {panel === 'overview' ? <View style={styles.stack}><FixtureHero match={match} styles={styles} /><View style={styles.card}><Text style={styles.cardTitle}>Fixture details</Text><Text style={styles.body}>{match.venueAddress || match.venueName || 'Venue TBC'}</Text>{match.notes ? <><Text style={styles.fieldLabel}>Match notes</Text><Text style={styles.body}>{match.notes}</Text></> : null}<Text style={styles.meta}>Clock {match.clockMode}, {match.matchDurationMinutes} minutes | Rule {label(match.conclusionRule, 'normal time')}</Text>{['scheduled', 'scorer_request', 'postponed'].includes(match.status) ? <Button label="Edit fixture" onPress={() => { setFixtureFormMatch(match); setFixtureFormOpen(true); setError(''); setNotice(''); onRequestScrollTop?.() }} secondary styles={styles} /> : null}</View>{actions.timerActions.some((item) => item.action === 'start') ? <View style={styles.card}><Text style={styles.cardTitle}>Ready for kick-off?</Text><Text style={styles.body}>Start the match clock and open the live controller.</Text><Button disabled={busy || reconciling} label="Start match" onPress={() => setPending({ kind: 'start-match', label: 'Start match', run: async () => { const detail = await replace(() => runCoachMatchDayTimerAction(user, match, 'start'), (nextDetail) => isCoachMatchDayTimerActionApplied(nextDetail, 'start')); setPanel('live'); return detail } })} styles={styles} /></View> : actions.startBlockedReason ? <View style={styles.warning}><Text style={styles.cardTitle}>Not available to start today</Text><Text style={styles.body}>This fixture is scheduled for {formatFixtureDate(match.matchDate)}. It can only be started on that date. If the match has moved, edit the fixture date first.</Text></View> : <Button label="Open Game Mode" onPress={() => setPanel('live')} styles={styles} />}</View> : null}
      {panel === 'squad' ? <CoachSquadPanel key={match.id} actions={actions} busy={busy || reconciling} match={match} palette={palette}
        onSetDecision={(player, decision) => replace(() => setCoachMatchDaySquadDecision(user, match, player.id, decision, player.decidedAt || null), (detail) => isCoachMatchDaySquadDecisionApplied(detail, player.id, decision))}
        onNotify={notifySquad}
        players={players} styles={styles} /> : null}
      {panel === 'formation' ? <CoachFormationBoard context={context} match={match} palette={palette} players={players} stale={stale} user={user} /> : null}
      {panel === 'volunteers' ? <VolunteerPanel actions={actions} busy={busy} match={match} onSelect={(request, role, selected) => setPending({ label: `${selected ? 'Assign' : 'Remove'} ${role}`, run: () => replace(() => selectCoachMatchDayVolunteer(user, match, request, role, selected), (detail) => isCoachMatchDayVolunteerSelectionApplied(detail, request, role, selected)) })} styles={styles} /> : null}
      {panel === 'live' ? <LivePanel actions={actions} busy={busy} eventForm={eventForm} match={match} onEventForm={setEventForm} onExit={() => setPanel('overview')} onPrepare={setPending} onScore={(kind) => { if (kind === 'event') return submitEvent(); const commandId = createCoachMatchDayCommandId(); return replace(() => correctCoachMatchDayScore(user, match, scoreDraft.home, scoreDraft.away, commandId), (detail) => hasCoachMatchDayCommandResult(detail, commandId)) }} onTimer={(action) => replace(() => runCoachMatchDayTimerAction(user, match, action), (detail) => isCoachMatchDayTimerActionApplied(detail, action))} players={players} scoreDraft={scoreDraft} setScoreDraft={setScoreDraft} styles={styles} /> : null}
      {panel === 'timeline' ? <TimelinePanel busy={busy || reconciling} match={match} onCorrectGoal={(event, goal, reason) => replace(() => correctCoachMatchDayGoal(user, match, event, goal, reason), (detail) => isCoachMatchDayGoalCorrectionApplied(detail, event.id, goal, reason))} onPrepare={setPending} onUndo={(event, input) => replace(() => voidCoachMatchDayEvent(user, match, event, input), (detail) => isCoachMatchDayEventVoided(detail, event.id))} styles={styles} /> : null}
      {panel === 'shootout' ? <ShootoutPanel busy={busy || reconciling} match={match} onKick={(kick) => { const priorKickIds = (match.shootoutEvents || []).map((item) => item.id); return replace(() => recordCoachMatchDayShootoutKick(user, match, kick), (detail) => isCoachMatchDayShootoutKickApplied(detail, priorKickIds, kick)) }} onPrepare={setPending} onVoid={(id) => replace(() => voidCoachMatchDayShootoutKick(user, match, id), (detail) => isCoachMatchDayShootoutKickVoided(detail, id))} styles={styles} /> : null}
      {panel === 'report' ? <ReportPanel busy={busy || reconciling} canConclude={actions.timerActions.some((item) => item.action === 'conclude')} onConclude={() => setPending({ kind: 'conclude', label: `Conclude ${getCoachMatchDayPresentation(match).displayName} at ${getCoachMatchDayPresentation(match).displayScore}? Check the score and events first.`, run: () => replace(() => runCoachMatchDayTimerAction(user, match, 'conclude'), (detail) => isCoachMatchDayTimerActionApplied(detail, 'conclude')) })} canSave={actions.canSaveFinalReport} key={`${match.id}:${match.finalReport?.updatedAt || ''}`} match={match} onSave={(notes) => setPending({ label: 'Save final Match Day report', run: () => replace(() => saveCoachMatchDayFinalReport(user, match, notes), (detail) => isCoachMatchDayFinalReportApplied(detail, notes)) })} styles={styles} /> : null}
    </> : null}
    <Modal animationType="fade" onRequestClose={() => setPending(null)} transparent visible={Boolean(pending)}><View accessibilityViewIsModal style={styles.modalScreen}><Pressable accessibilityLabel="Cancel Match Day change" onPress={() => setPending(null)} style={styles.modalBackdrop} /><View accessibilityLiveRegion="assertive" style={styles.modalCard}><Text style={styles.cardTitle}>{pending?.kind === 'start-match' ? 'Start this match?' : 'Confirm this change'}</Text><Text style={styles.body}>{pending?.kind === 'start-match' ? `This starts the match clock for ${getCoachMatchDayPresentation(match).displayName} and makes Match Day live.` : pending?.label}</Text><Text style={styles.meta}>{pending?.kind === 'start-match' ? 'Only start when both teams are ready for kick-off.' : 'This change will be checked and saved online before the fixture refreshes.'}</Text><Button disabled={busy || reconciling} label={pending?.kind === 'start-match' ? 'Start match' : 'Confirm'} onPress={confirm} styles={styles} /><Button label="Cancel" onPress={() => setPending(null)} secondary styles={styles} /></View></View></Modal>
  </View>
}
