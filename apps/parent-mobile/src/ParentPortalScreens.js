import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { getParentCalendarMarkerTone, getParentCalendarMonthGrid, getParentCalendarWindow, groupParentCalendarEvents, isParentCalendarEventCancelled } from '../../mobile-core/src/parentCalendarCore'
import {
  formatParentProductDateTime,
  formatParentProductTime,
} from '../../mobile-core/src/parentDateTimeCore'
import { DEFAULT_PARENT_MOBILE_THEME } from '../../mobile-core/src/parentThemeCore'
import {
  canParentRegisterScorerInterest,
  getParentMatchCalendarUrl,
  getParentMatchDirectionsUrl,
  getParentMatchGroups,
} from './parentExperience'
import { getParentChatRoomContext, getParentInvitationSections, prepareParentChatMessages, prepareParentChatRooms } from './parentPresentationCore'
import {
  getInvitationResponseOptions,
  getParentInvitationDisplayState,
  isParentInvitationActionable,
} from './parentPortalData'

const PARENT_CALENDAR_VIEW_KEY = 'football-player-parent-calendar-view-v1'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function labelize(value) {
  const text = normalizeText(value).replaceAll('_', ' ')
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : ''
}

function formatDate(value, fallback = 'Date to be confirmed') {
  return formatParentProductDateTime(value, { fallback, year: 'numeric' })
}

function formatCalendarDay(value) {
  return formatParentProductDateTime(value, {
    fallback: normalizeText(value) || 'Date to be confirmed',
    includeTime: false,
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  })
}

function colorsFor(themeTokens) {
  const tokens = themeTokens || DEFAULT_PARENT_MOBILE_THEME.tokens
  return {
    accent: tokens.buttonPrimary,
    accentForeground: tokens.accentForeground,
    accentSoft: tokens.accentSoft,
    accentText: tokens.accentText,
    background: tokens.portalBackground,
    border: tokens.border,
    card: tokens.portalSurface,
    danger: tokens.danger,
    event: tokens.accent || tokens.buttonPrimary,
    match: tokens.accentMuted,
    muted: tokens.textSecondary,
    success: tokens.success,
    text: tokens.textPrimary,
    warning: tokens.warning,
  }
}

function usePortalStyles(themeTokens) {
  return useMemo(() => {
    const colors = colorsFor(themeTokens)
    return { colors, styles: StyleSheet.create({
      action: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, minHeight: 46, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
      actionDanger: { backgroundColor: colors.danger },
      actionDisabled: { opacity: 0.45 },
      actionOutline: { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 },
      actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
      actionText: { color: colors.accentForeground, fontSize: 14, fontWeight: '800' },
      actionTextOutline: { color: colors.text },
      body: { color: colors.text, fontSize: 15, lineHeight: 22 },
      card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
      cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
      empty: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center' },
      error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
      field: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: 12, borderWidth: 1, color: colors.text, fontSize: 16, minHeight: 46, paddingHorizontal: 12, paddingVertical: 10 },
      fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
      header: { color: colors.text, fontSize: 28, fontWeight: '900' },
      helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
      meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
      monthCell: { borderColor: colors.border, borderRadius: 10, borderWidth: 1, flex: 1, gap: 4, minHeight: 54, padding: 6 },
      monthCellActive: { borderColor: colors.accent, borderWidth: 2 },
      monthCellMuted: { opacity: 0.42 },
      monthDay: { color: colors.text, fontSize: 13, fontWeight: '800' },
      monthDot: { backgroundColor: colors.accent, borderRadius: 999, height: 6, width: 6 },
      monthDotCancelled: { backgroundColor: colors.danger },
      monthDotEvent: { backgroundColor: colors.event },
      monthDotMatch: { backgroundColor: colors.match },
      monthDotResponse: { backgroundColor: colors.warning },
      monthDotTraining: { backgroundColor: colors.success },
      monthLegend: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
      monthLegendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
      monthLegendText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
      monthGrid: { gap: 5 },
      monthRow: { flexDirection: 'row', gap: 5 },
      monthWeekday: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: '900', textAlign: 'center' },
      dateHeading: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
      pill: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderRadius: 999, color: colors.accentText, fontSize: 12, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5 },
      row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
      score: { color: colors.text, fontSize: 32, fontWeight: '900', textAlign: 'center' },
      section: { gap: 12 },
      stack: { gap: 14 },
      stat: { color: colors.text, fontSize: 16, fontWeight: '700' },
      warning: { color: colors.warning, fontSize: 14, lineHeight: 20 },
      chatScreen: { flex: 1 },
      chatHeader: { borderBottomColor: colors.border, borderBottomWidth: 1, gap: 5, paddingBottom: 10 },
      chatList: { flex: 1 },
      chatListContent: { flexGrow: 1, gap: 8, justifyContent: 'flex-end', paddingVertical: 12 },
      chatRoomContent: { gap: 10, paddingBottom: 16 },
      composer: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 18, borderWidth: 1, flexDirection: 'row', gap: 8, padding: 8 },
      composerField: { flex: 1, maxHeight: 110, minHeight: 46 },
      messageBubble: { alignSelf: 'flex-start', backgroundColor: colors.card, borderColor: colors.border, borderRadius: 16, gap: 4, maxWidth: '86%', paddingHorizontal: 12, paddingVertical: 9 },
      messageBubbleOwn: { alignSelf: 'flex-end', backgroundColor: colors.accentSoft, borderColor: colors.accent },
      messageDelete: { alignSelf: 'flex-end', paddingHorizontal: 4, paddingTop: 3 },
      messageDeleteText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
      messageSender: { color: colors.accentText, fontSize: 12, fontWeight: '900' },
    }) }
  }, [themeTokens])
}

function Button({ danger = false, disabled = false, label, onPress, outline = false, styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, outline && styles.actionOutline, danger && styles.actionDanger, disabled && styles.actionDisabled, pressed && { opacity: 0.78 }]}
    >
      <Text style={[styles.actionText, outline && styles.actionTextOutline]}>{label}</Text>
    </Pressable>
  )
}

function ResourceState({ emptyCopy, error, items, loading, styles }) {
  if (loading && items.length === 0) return <Text accessibilityLiveRegion="polite" style={styles.helper}>Loading...</Text>
  if (error && items.length === 0) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
  if (!loading && items.length === 0) return <Text style={styles.empty}>{emptyCopy}</Text>
  return error ? <Text accessibilityRole="alert" style={styles.warning}>{error} Saved information is shown below.</Text> : null
}

function CalendarEventCard({ activeActionId, event, invitation, isOffline, onRespond, styles }) {
  const actionable = invitation && isParentInvitationActionable(invitation)
  const busy = invitation && activeActionId === `invite:${invitation.invitationId}`
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.pill}>{labelize(['cancelled', 'closed', 'expired'].includes(event.status) ? event.status : event.eventType)}</Text>
        <Text style={styles.meta}>{event.kickoffTimeTbc ? 'Time TBC' : event.calendarTime || 'All day'}</Text>
      </View>
      <Text style={styles.cardTitle}>{event.title}</Text>
      {event.teamName ? <Text style={styles.meta}>{event.teamName}</Text> : null}
      {event.location ? <Text style={styles.meta}>{event.location}</Text> : null}
      {event.responseState ? <Text style={styles.meta}>Response: {labelize(event.responseState)}</Text> : null}
      {event.notes ? <Text style={styles.body}>{event.notes}</Text> : null}
      {actionable ? (
        <View style={styles.actionRow}>
          {getInvitationResponseOptions(invitation).map((option) => (
            <Button
              disabled={isOffline || busy}
              key={option.value}
              label={busy ? 'Saving...' : option.label}
              onPress={() => onRespond(invitation, option.value)}
              outline
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

export function CalendarScreen({ activeActionId, invitations = [], isOffline, link, onDateSelected, onRespond, resource, themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  const [viewMode, setViewMode] = useState('agenda')
  const [windowKey, setWindowKey] = useState('needs-response')
  const [monthCursor, setMonthCursor] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState('')
  useEffect(() => {
    void AsyncStorage.getItem(PARENT_CALENDAR_VIEW_KEY).then((saved) => {
      if (['agenda', 'month'].includes(saved)) setViewMode(saved)
    }).catch(() => {})
  }, [])
  const chooseView = (nextView) => {
    setViewMode(nextView)
    void AsyncStorage.setItem(PARENT_CALENDAR_VIEW_KEY, nextView).catch(() => {})
  }
  const activeEvents = useMemo(
    () => resource.items.filter((event) => !isParentCalendarEventCancelled(event)),
    [resource.items],
  )
  const invitationById = useMemo(
    () => new Map(invitations.map((invitation) => [invitation.invitationId, invitation])),
    [invitations],
  )
  const visibleEvents = useMemo(
    () => getParentCalendarWindow(activeEvents, windowKey),
    [activeEvents, windowKey],
  )
  const groups = useMemo(() => groupParentCalendarEvents(visibleEvents), [visibleEvents])
  const monthDays = useMemo(() => getParentCalendarMonthGrid(activeEvents, monthCursor), [activeEvents, monthCursor])
  const selectedDayEvents = useMemo(() => activeEvents.filter((event) => event.calendarDate === selectedDate), [activeEvents, selectedDate])
  const monthLabel = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(monthCursor)
  const moveMonth = (offset) => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1, 12))
  const markerStyle = (event) => ({
    cancelled: styles.monthDotCancelled,
    event: styles.monthDotEvent,
    match: styles.monthDotMatch,
    response: styles.monthDotResponse,
    training: styles.monthDotTraining,
  })[getParentCalendarMarkerTone(event)]
  const selectDate = (date) => {
    setSelectedDate(date)
    onDateSelected?.(date)
  }
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Calendar</Text><Text style={styles.helper}>Training, matches and club events for {link?.playerName || 'your child'}.</Text></View>
      <View accessibilityLabel="Calendar view" style={styles.actionRow}>
        <Button label="Agenda" onPress={() => chooseView('agenda')} outline={viewMode !== 'agenda'} styles={styles} />
        <Button label="Month" onPress={() => chooseView('month')} outline={viewMode !== 'month'} styles={styles} />
      </View>
      {viewMode === 'agenda' ? <View accessibilityLabel="Calendar date filter" style={styles.actionRow}>
        {[
          { key: 'needs-response', label: 'Needs response' },
          { key: 'next-30', label: 'Next 30 days' },
          { key: 'previous-30', label: 'Previous 30 days' },
          { key: 'upcoming', label: 'All upcoming' },
          { key: 'history', label: 'History' },
          { key: 'date-tbc', label: 'Date TBC' },
        ].map((option) => (
          <Button key={option.key} label={option.label} onPress={() => setWindowKey(option.key)} outline={windowKey !== option.key} styles={styles} />
        ))}
      </View> : null}
      <ResourceState emptyCopy="There are no shared calendar events for this child." {...resource} items={activeEvents} styles={styles} />
      {viewMode === 'month' ? <View style={styles.stack}>
        <View style={styles.row}><Button label="Previous" onPress={() => moveMonth(-1)} outline styles={styles} /><Text style={styles.cardTitle}>{monthLabel}</Text><Button label="Next" onPress={() => moveMonth(1)} outline styles={styles} /></View>
        <Button label="Today" onPress={() => { setMonthCursor(new Date()); setSelectedDate('') }} outline styles={styles} />
        <View style={styles.monthGrid}>
          <View style={styles.monthRow}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <Text key={day} style={styles.monthWeekday}>{day}</Text>)}</View>
          {Array.from({ length: 6 }, (_unused, rowIndex) => <View key={rowIndex} style={styles.monthRow}>{monthDays.slice(rowIndex * 7, rowIndex * 7 + 7).map((day) => <Pressable accessibilityLabel={`${day.date}, ${day.events.length} events`} accessibilityRole="button" key={day.date} onPress={() => selectDate(day.date)} style={[styles.monthCell, !day.inMonth && styles.monthCellMuted, (day.isToday || day.date === selectedDate) && styles.monthCellActive]}><Text style={styles.monthDay}>{day.day}</Text><View style={styles.actionRow}>{day.events.slice(0, 3).map((event) => <View accessibilityLabel={getParentCalendarMarkerTone(event)} key={event.id} style={[styles.monthDot, markerStyle(event)]} />)}</View></Pressable>)}</View>)}
        </View>
        <View accessibilityLabel="Calendar marker key" style={styles.monthLegend}>
          {[['match', 'Match'], ['training', 'Training'], ['response', 'Needs response'], ['event', 'Other']].map(([tone, label]) => <View key={tone} style={styles.monthLegendItem}><View style={[styles.monthDot, ({ event: styles.monthDotEvent, match: styles.monthDotMatch, response: styles.monthDotResponse, training: styles.monthDotTraining })[tone]]} /><Text style={styles.monthLegendText}>{label}</Text></View>)}
        </View>
        {selectedDate ? <View style={styles.section}><Text style={styles.dateHeading}>{formatCalendarDay(selectedDate)}</Text>{selectedDayEvents.length ? selectedDayEvents.map((event) => <CalendarEventCard activeActionId={activeActionId} event={event} invitation={invitationById.get(event.invitationId)} isOffline={isOffline} key={event.id} onRespond={onRespond} styles={styles} />) : <Text style={styles.empty}>No events on this date.</Text>}</View> : <Text style={styles.helper}>Tap a date to see its events.</Text>}
      </View> : null}
      {viewMode === 'agenda' && !resource.loading && activeEvents.length > 0 && visibleEvents.length === 0 ? <Text style={styles.empty}>No Calendar items match this date filter.</Text> : null}
      {viewMode === 'agenda' ? groups.map((group) => (
        <View key={group.date} style={styles.section}>
          <Text accessibilityRole="header" style={styles.dateHeading}>{group.date === 'date-tbc' ? 'Date to be confirmed' : formatCalendarDay(group.date)}</Text>
          {group.events.map((event) => <CalendarEventCard activeActionId={activeActionId} event={event} invitation={invitationById.get(event.invitationId)} isOffline={isOffline} key={event.id} onRespond={onRespond} styles={styles} />)}
        </View>
      )) : null}
    </View>
  )
}

export function InvitationsScreen({ activeActionId, isOffline, link, onBackTarget, onDismiss, onRespond, resource, targetInvitationId = '', themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  const sections = useMemo(() => getParentInvitationSections(resource.items), [resource.items])
  const defaultSection = sections.needsResponse.length ? 'needsResponse' : 'upcoming'
  const [sectionKey, setSectionKey] = useState(defaultSection)
  const activeSectionKey = sectionKey === 'needsResponse' && !sections.needsResponse.length ? 'upcoming' : sectionKey
  const targetedInvitation = targetInvitationId
    ? resource.items.find((invitation) => invitation.invitationId === targetInvitationId) || null
    : null
  const visibleInvitations = targetedInvitation ? [targetedInvitation] : sections[activeSectionKey] || []
  return (
    <View style={styles.stack}>
      {targetedInvitation && onBackTarget ? <Button label="Back to all requests" onPress={onBackTarget} outline styles={styles} /> : null}
      <View><Text accessibilityRole="header" style={styles.header}>{targetedInvitation ? 'Respond to request' : 'Invites'}</Text><Text style={styles.helper}>{targetedInvitation ? 'Review this request and answer it directly.' : `Attendance and volunteer responses for ${link?.playerName || 'your child'}.`}</Text></View>
      {isOffline ? <Text style={styles.warning}>Responses need a connection. Saved invitations remain available to read.</Text> : null}
      {!targetedInvitation ? <View style={styles.actionRow}>{[
        ['needsResponse', 'Needs response'],
        ['upcoming', 'Coming up'],
        ['responded', 'Responded'],
        ['history', 'History'],
      ].map(([key, label]) => <Button key={key} label={`${label}${sections[key].length ? ` (${sections[key].length})` : ''}`} onPress={() => setSectionKey(key)} outline={activeSectionKey !== key} styles={styles} />)}</View> : null}
      <ResourceState emptyCopy="There are no invitations for this child." {...resource} styles={styles} />
      {!resource.loading && resource.items.length > 0 && visibleInvitations.length === 0 ? <Text style={styles.empty}>Nothing is in this section.</Text> : null}
      {visibleInvitations.map((invitation) => {
        const options = getInvitationResponseOptions(invitation)
        const busy = activeActionId === `invite:${invitation.invitationId}`
        const actionable = isParentInvitationActionable(invitation)
        return (
          <View key={invitation.invitationId || `${invitation.sourceRecordId}:${invitation.invitationType}`} style={styles.card}>
            <View style={styles.row}><Text style={styles.pill}>{labelize(getParentInvitationDisplayState(invitation))}</Text><Text style={styles.meta}>{formatDate(invitation.eventStart || invitation.eventDate)}</Text></View>
            <Text style={styles.cardTitle}>{invitation.eventTitle}</Text>
            <Text style={styles.body}>{labelize(invitation.responseState)}</Text>
            {invitation.selectionState && invitation.selectionState !== 'not_applicable' ? <Text style={styles.meta}>Squad or role status: {labelize(invitation.selectionState)}</Text> : null}
            {invitation.eventLocation ? <Text style={styles.meta}>{invitation.eventLocation}</Text> : null}
            {invitation.lockReason ? <Text style={styles.warning}>{invitation.lockReason}</Text> : null}
            {actionable ? (
              <View style={styles.actionRow}>
                {options.map((option) => <Button disabled={isOffline || busy} key={option.value} label={busy ? 'Saving...' : option.label} onPress={() => onRespond(invitation, option.value)} outline styles={styles} />)}
              </View>
            ) : null}
            {!targetedInvitation && onDismiss ? <Button label="Remove from this list" onPress={() => onDismiss(invitation)} outline styles={styles} /> : null}
          </View>
        )
      })}
    </View>
  )
}

function scoreVisible(match) {
  return ['extra_time', 'full_time', 'half_time', 'live', 'penalties', 'second_half'].includes(match.status)
}

function MatchCard({ match, onDismiss, onOpen, styles }) {
  return (
    <View style={styles.card}>
      <View style={styles.row}><Text style={styles.pill}>{labelize(match.status)}</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View>
      <Text style={styles.cardTitle}>{match.teamName || 'Team'} v {match.opponent || 'Opponent'}</Text>
      <Text style={styles.meta}>{match.kickoffTimeTbc ? 'Kick-off time to be confirmed' : formatParentProductTime(match.kickoffTime)}</Text>
      {scoreVisible(match) ? <Text style={styles.score}>{match.homeScore} - {match.awayScore}</Text> : null}
      <Button label="Open Match Day" onPress={() => onOpen(match)} outline styles={styles} />
      {onDismiss ? <Button label="Remove from this list" onPress={() => onDismiss(match)} outline styles={styles} /> : null}
    </View>
  )
}

function GoalForm({ disabled, onAdd, placeholderColor, styles }) {
  const [side, setSide] = useState('club')
  const [scorerName, setScorerName] = useState('')
  const [minute, setMinute] = useState('')
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Add goal</Text>
      <View style={styles.actionRow}>
        <Button disabled={disabled} label="Our team" onPress={() => setSide('club')} outline={side !== 'club'} styles={styles} />
        <Button disabled={disabled} label="Opponent" onPress={() => setSide('opponent')} outline={side !== 'opponent'} styles={styles} />
      </View>
      <TextInput accessibilityLabel="Goal scorer name" editable={!disabled} onChangeText={setScorerName} placeholder="Scorer name, optional" placeholderTextColor={placeholderColor} style={styles.field} value={scorerName} />
      <TextInput accessibilityLabel="Goal minute" editable={!disabled} keyboardType="number-pad" onChangeText={setMinute} placeholder="Minute, optional" placeholderTextColor={placeholderColor} style={styles.field} value={minute} />
      <Button disabled={disabled} label="Record goal" onPress={() => { onAdd({ minute, scorerName, teamSide: side }); setMinute(''); setScorerName('') }} styles={styles} />
    </View>
  )
}

function GoalCorrectionForm({ disabled, events, onCorrect, onVoid, placeholderColor, styles }) {
  const activeGoals = (events || []).filter((event) => event.eventType === 'goal' && !event.voidedAt)
  const [eventId, setEventId] = useState('')
  const selected = activeGoals.find((event) => event.id === eventId) || null
  const [scorerName, setScorerName] = useState('')
  const [minute, setMinute] = useState('')
  const [reason, setReason] = useState('')
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Correct or remove a goal</Text>
      {activeGoals.length === 0 ? <Text style={styles.helper}>No active goal events are available.</Text> : null}
      <View style={styles.actionRow}>
        {activeGoals.map((event) => <Button disabled={disabled} key={event.id} label={`${event.minute == null ? '' : `${event.minute}' `}${event.scorerName || labelize(event.teamSide) || 'Goal'}`} onPress={() => { setEventId(event.id); setScorerName(event.scorerName || ''); setMinute(event.minute == null ? '' : String(event.minute)); setReason('') }} outline={eventId !== event.id} styles={styles} />)}
      </View>
      {selected ? (
        <>
          <TextInput accessibilityLabel="Corrected scorer name" editable={!disabled} onChangeText={setScorerName} placeholder="Scorer name" placeholderTextColor={placeholderColor} style={styles.field} value={scorerName} />
          <TextInput accessibilityLabel="Corrected goal minute" editable={!disabled} keyboardType="number-pad" onChangeText={setMinute} placeholder="Minute" placeholderTextColor={placeholderColor} style={styles.field} value={minute} />
          <TextInput accessibilityLabel="Goal correction reason" editable={!disabled} onChangeText={setReason} placeholder="Reason for correction" placeholderTextColor={placeholderColor} style={styles.field} value={reason} />
          <View style={styles.actionRow}>
            <Button disabled={disabled || !normalizeText(reason)} label="Save goal correction" onPress={() => onCorrect({ event: selected, goal: { minute, scorerName, teamSide: selected.teamSide }, reason })} styles={styles} />
            <Button danger disabled={disabled || !normalizeText(reason)} label="Remove goal" onPress={() => onVoid({ eventId: selected.id, reason })} styles={styles} />
          </View>
        </>
      ) : null}
    </View>
  )
}

function ShootoutControls({ disabled, match, onRecord, onVoid, placeholderColor, styles }) {
  const [teamSide, setTeamSide] = useState('club')
  const [outcome, setOutcome] = useState('scored')
  const [playerName, setPlayerName] = useState('')
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Penalty shootout</Text>
      <Text style={styles.meta}>Shootout: {match.homeShootoutScore || 0} - {match.awayShootoutScore || 0}</Text>
      <View style={styles.actionRow}>
        <Button disabled={disabled} label="Our team" onPress={() => setTeamSide('club')} outline={teamSide !== 'club'} styles={styles} />
        <Button disabled={disabled} label="Opponent" onPress={() => setTeamSide('opponent')} outline={teamSide !== 'opponent'} styles={styles} />
        <Button disabled={disabled} label="Scored" onPress={() => setOutcome('scored')} outline={outcome !== 'scored'} styles={styles} />
        <Button disabled={disabled} label="Missed" onPress={() => setOutcome('missed')} outline={outcome !== 'missed'} styles={styles} />
      </View>
      <TextInput accessibilityLabel="Shootout player name" editable={!disabled} onChangeText={setPlayerName} placeholder="Player name, optional" placeholderTextColor={placeholderColor} style={styles.field} value={playerName} />
      <Button disabled={disabled} label="Record shootout kick" onPress={() => { onRecord({ outcome, playerName, teamSide }); setPlayerName('') }} styles={styles} />
      {(match.shootoutEvents || []).filter((kick) => !kick.voidedAt).map((kick) => (
        <View key={kick.id} style={styles.row}><Text style={styles.body}>{labelize(kick.teamSide)}: {labelize(kick.outcome)} {kick.playerName}</Text><Button danger disabled={disabled} label="Void kick" onPress={() => onVoid({ kickId: kick.id, reason: 'Corrected shootout kick' })} outline styles={styles} /></View>
      ))}
    </View>
  )
}

function ScorerControls({ activeActionId, isOffline, match, onAction, placeholderColor, styles }) {
  const busy = activeActionId.startsWith(`scorer:${match.id}:`)
  const [homeScore, setHomeScore] = useState(String(match.homeScore || 0))
  const [awayScore, setAwayScore] = useState(String(match.awayScore || 0))
  const disabled = isOffline || busy
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Accepted Parent scorer</Text>
        <Text style={styles.helper}>All Game Day changes are checked by the server. Controls are unavailable offline.</Text>
        {isOffline ? <Text style={styles.warning}>Connect before changing the clock, score or events.</Text> : null}
        <View style={styles.actionRow}>
          {match.timerStatus === 'not_started' ? <Button disabled={disabled} label="Start match" onPress={() => onAction('start')} styles={styles} /> : null}
          <Button disabled={disabled} label="Start clock" onPress={() => onAction('timer', 'start')} outline styles={styles} />
          <Button disabled={disabled} label="Pause clock" onPress={() => onAction('timer', 'pause')} outline styles={styles} />
          <Button disabled={disabled} label="Resume clock" onPress={() => onAction('timer', 'resume')} outline styles={styles} />
          <Button disabled={disabled} label="Half time" onPress={() => onAction('timer', 'half_time')} outline styles={styles} />
          <Button disabled={disabled} label="Full time" onPress={() => onAction('timer', 'full_time')} danger styles={styles} />
        </View>
        <Text style={styles.meta}>Clock: {labelize(match.timerStatus)} | {Math.floor(Number(match.timerElapsedSeconds || 0) / 60)} minutes</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Correct score</Text>
        <View style={styles.actionRow}>
          <TextInput accessibilityLabel="Home score" editable={!disabled} keyboardType="number-pad" onChangeText={setHomeScore} style={[styles.field, { minWidth: 96 }]} value={homeScore} />
          <TextInput accessibilityLabel="Away score" editable={!disabled} keyboardType="number-pad" onChangeText={setAwayScore} style={[styles.field, { minWidth: 96 }]} value={awayScore} />
        </View>
        <Button disabled={disabled} label="Save score correction" onPress={() => onAction('score', { awayScore, homeScore })} styles={styles} />
      </View>
      <GoalForm disabled={disabled} onAdd={(goal) => onAction('goal', goal)} placeholderColor={placeholderColor} styles={styles} />
      <GoalCorrectionForm disabled={disabled} events={match.events} onCorrect={(value) => onAction('correct-goal', value)} onVoid={(value) => onAction('void-goal', value)} placeholderColor={placeholderColor} styles={styles} />
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Extended match</Text>
        <View style={styles.actionRow}>
          <Button disabled={disabled} label="End normal time" onPress={() => onAction('extended', 'normal_time_complete')} outline styles={styles} />
          <Button disabled={disabled} label="Start extra time" onPress={() => onAction('extended', 'start_extra_time')} outline styles={styles} />
          <Button disabled={disabled} label="Extra time half time" onPress={() => onAction('extended', 'extra_time_half_time')} outline styles={styles} />
          <Button disabled={disabled} label="Start extra time second half" onPress={() => onAction('extended', 'start_extra_time_second_half')} outline styles={styles} />
          <Button disabled={disabled} label="End extra time" onPress={() => onAction('extended', 'complete_extra_time')} outline styles={styles} />
          <Button disabled={disabled} label="Start penalties" onPress={() => onAction('extended', 'start_penalties')} outline styles={styles} />
          <Button disabled={disabled} label="Conclude match" onPress={() => onAction('timer', 'conclude')} danger styles={styles} />
        </View>
      </View>
      <ShootoutControls disabled={disabled} match={match} onRecord={(value) => onAction('shootout', value)} onVoid={(value) => onAction('void-shootout', value)} placeholderColor={placeholderColor} styles={styles} />
      {busy ? <Text accessibilityLiveRegion="polite" style={styles.helper}>Saving Game Day change...</Text> : null}
    </View>
  )
}

export function MatchdayScreen({ activeActionId, isOffline, link, onBack, onDismiss, onOpen, onOpenLink, onScorerAction, onVolunteer, resource, selectedMatch, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const [matchSection, setMatchSection] = useState('upcoming')
  const matchGroups = useMemo(() => getParentMatchGroups(resource.items), [resource.items])
  const visibleMatches = matchGroups[matchSection] || []
  if (selectedMatch) {
    return (
      <View style={styles.stack}>
        <Button label="Back to Matchday" onPress={onBack} outline styles={styles} />
        <View style={styles.card}>
          <View style={styles.row}><Text style={styles.pill}>{labelize(selectedMatch.status)}</Text><Text style={styles.meta}>{formatDate(selectedMatch.matchDate)}</Text></View>
          <Text accessibilityRole="header" style={styles.header}>{selectedMatch.teamName} v {selectedMatch.opponent}</Text>
          {scoreVisible(selectedMatch) ? <Text style={styles.score}>{selectedMatch.homeScore} - {selectedMatch.awayScore}</Text> : null}
          <Text style={styles.body}>{selectedMatch.venueName || 'Location not shared'}</Text>
          <Text style={styles.meta}>Availability: {labelize(selectedMatch.availabilityStatus) || 'No response requested'}</Text>
          <Text style={styles.meta}>Squad: {labelize(selectedMatch.squadDecisionState) || 'Not decided'}</Text>
          {selectedMatch.confirmedTeam?.length ? <Text style={styles.meta}>Confirmed team: {selectedMatch.confirmedTeam.join(', ')}</Text> : null}
          <View style={styles.actionRow}>
            {getParentMatchCalendarUrl(selectedMatch) ? <Button label="Add to calendar" onPress={() => onOpenLink?.(getParentMatchCalendarUrl(selectedMatch), 'calendar')} outline styles={styles} /> : null}
            {getParentMatchDirectionsUrl(selectedMatch, Platform.OS) ? <Button label="Get directions" onPress={() => onOpenLink?.(getParentMatchDirectionsUrl(selectedMatch, Platform.OS), 'directions')} outline styles={styles} /> : null}
          </View>
        </View>
        {canParentRegisterScorerInterest(selectedMatch) ? (
          <View style={styles.card}><Text style={styles.cardTitle}>Volunteer scorer</Text><Text style={styles.body}>{selectedMatch.scorerRequestMessage || 'Staff are looking for a Parent scorer.'}</Text><Button disabled={isOffline} label="Register interest" onPress={() => onVolunteer(selectedMatch)} styles={styles} /></View>
        ) : null}
        {selectedMatch.isScorer ? <ScorerControls activeActionId={activeActionId} isOffline={isOffline} match={selectedMatch} onAction={(action, value) => onScorerAction(selectedMatch, action, value)} placeholderColor={colors.muted} styles={styles} /> : null}
        {selectedMatch.events?.length ? (
          <View style={styles.card}><Text style={styles.cardTitle}>Match timeline</Text>{selectedMatch.events.map((event) => <Text key={event.id} style={styles.body}>{event.minute == null ? '' : `${event.minute}' `}{labelize(event.eventType)} {event.scorerName || event.playerName || ''}</Text>)}</View>
        ) : null}
      </View>
    )
  }
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Matchday</Text><Text style={styles.helper}>Real Parent-visible fixtures and Game Day for {link?.playerName || 'your child'}.</Text></View>
      <View style={styles.actionRow}><Button label={`Coming up (${matchGroups.upcoming.length})`} onPress={() => setMatchSection('upcoming')} outline={matchSection !== 'upcoming'} styles={styles} /><Button label={`History (${matchGroups.recent.length})`} onPress={() => setMatchSection('recent')} outline={matchSection !== 'recent'} styles={styles} /></View>
      <ResourceState emptyCopy="There are no Parent-visible match cards for this child." {...resource} styles={styles} />
      {!resource.loading && resource.items.length > 0 && visibleMatches.length === 0 ? <Text style={styles.empty}>No matches are in this section.</Text> : null}
      {visibleMatches.map((match) => <MatchCard key={match.id} match={match} onDismiss={onDismiss} onOpen={onOpen} styles={styles} />)}
    </View>
  )
}

export function ResultsScreen({ link, resource, themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  const results = getParentMatchGroups(resource.items).recent.filter((match) => match.status === 'full_time')
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Results</Text><Text style={styles.helper}>Completed Parent-visible fixtures for {link?.playerName || 'your child'}.</Text></View>
      <ResourceState emptyCopy="There are no completed results for this child." error={resource.error} items={results} loading={resource.loading} styles={styles} />
      {results.map((match) => <View key={match.id} style={styles.card}><View style={styles.row}><Text style={styles.pill}>Full time</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View><Text style={styles.cardTitle}>{match.teamName} v {match.opponent}</Text><Text style={styles.score}>{match.homeScore} - {match.awayScore}</Text>{match.shootoutWinner ? <Text style={styles.meta}>Shootout: {match.homeShootoutScore} - {match.awayShootoutScore}</Text> : null}</View>)}
    </View>
  )
}

export function DevelopmentScreen({ isOffline, onDismiss, onOpen, resource, themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Development</Text><Text style={styles.helper}>Development history previously shared with this Parent link.</Text></View>
      {isOffline ? <Text style={styles.warning}>Report details are saved for reading. Opening a PDF needs a connection.</Text> : null}
      <ResourceState emptyCopy="No delivered Development reports are available for this child." {...resource} styles={styles} />
      {resource.items.map((report) => <View key={report.id} style={styles.card}><View style={styles.row}><Text style={styles.pill}>{report.deliveryLabel || 'Shared'}</Text><Text style={styles.meta}>{formatDate(report.recordDate || report.finalizedAt)}</Text></View><Text style={styles.cardTitle}>{report.form?.name || 'Development report'}</Text>{report.overallScore == null ? null : <Text style={styles.stat}>Overall score: {report.overallScore} / {report.overallMaxScore || 10}</Text>}{report.responseItems?.slice(0, 6).map((item, index) => <Text key={`${item.label}:${index}`} style={styles.body}>{item.label}: {item.displayValue}</Text>)}<Button disabled={isOffline || !report.canDownloadPdf} label={report.canDownloadPdf ? 'View or share PDF' : 'PDF not included'} onPress={() => onOpen(report)} outline styles={styles} /><Button label="Remove from this list" onPress={() => onDismiss(report)} outline styles={styles} /></View>)}
    </View>
  )
}

export function ResourcesScreen({ isOffline, onDismiss, onOpen, resource, themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Resources</Text><Text style={styles.helper}>Files and links shared for the selected child.</Text></View>
      {isOffline ? <Text style={styles.warning}>Resource details are saved for reading. Opening the item needs a connection.</Text> : null}
      <ResourceState emptyCopy="No resources are shared with this child." {...resource} styles={styles} />
      {resource.items.map((item) => <View key={item.id} style={styles.card}><Text style={styles.pill}>{labelize(item.category)}</Text><Text style={styles.cardTitle}>{item.title}</Text>{item.description || item.shareDescription ? <Text style={styles.body}>{item.description || item.shareDescription}</Text> : null}<Button disabled={isOffline} label="Open resource" onPress={() => onOpen(item)} outline styles={styles} /><Button label="Remove from this list" onPress={() => onDismiss(item)} outline styles={styles} /></View>)}
    </View>
  )
}

export function ChatScreen({ activeActionId, isOffline, link, messages, onBack, onDelete, onDismissAnnouncement, onOpenRoom, onSend, rooms, selectedRoom, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const [draft, setDraft] = useState('')
  const messageListRef = useRef(null)
  const sortedRooms = useMemo(() => prepareParentChatRooms(rooms.items), [rooms.items])
  const sortedMessages = useMemo(() => prepareParentChatMessages(messages.items), [messages.items])
  useEffect(() => {
    if (!selectedRoom) return undefined
    const handle = setTimeout(() => messageListRef.current?.scrollToEnd({ animated: false }), 30)
    return () => clearTimeout(handle)
  }, [selectedRoom, sortedMessages.length])
  if (selectedRoom) {
    return (
      <View style={styles.chatScreen}>
        <View style={styles.chatHeader}><Button label="Back to Chat rooms" onPress={onBack} outline styles={styles} /><Text accessibilityRole="header" style={styles.cardTitle}>{selectedRoom.title}</Text><Text style={styles.helper}>{getParentChatRoomContext(selectedRoom)}</Text></View>
        <FlatList
          contentContainerStyle={styles.chatListContent}
          data={sortedMessages}
          keyExtractor={(message) => String(message.id)}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={!messages.loading ? <Text style={styles.empty}>No messages in this conversation yet.</Text> : null}
          onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: false })}
          ref={messageListRef}
          renderItem={({ item: message }) => <View style={[styles.messageBubble, message.canDelete && styles.messageBubbleOwn]}><View style={styles.row}><Text style={styles.messageSender}>{message.senderName}</Text><Text style={styles.meta}>{formatDate(message.createdAt)}</Text></View><Text style={styles.body}>{message.deletedAt ? 'Message deleted' : message.body}</Text>{message.canDelete && !message.deletedAt ? <Pressable accessibilityLabel="Delete message" accessibilityRole="button" disabled={isOffline || activeActionId === `chat-delete:${message.id}`} onPress={() => onDelete(message)} style={styles.messageDelete}><Text style={styles.messageDeleteText}>{activeActionId === `chat-delete:${message.id}` ? 'Deleting...' : 'Delete'}</Text></Pressable> : null}{message.legacyMessageId && onDismissAnnouncement ? <Button label="Remove from this list" onPress={() => onDismissAnnouncement(message)} outline styles={styles} /> : null}</View>}
          style={styles.chatList}
        />
        {messages.loading ? <Text style={styles.helper}>Loading messages...</Text> : null}
        {messages.error ? <Text style={styles.error}>{messages.error}</Text> : null}
        {selectedRoom.canPost ? <View style={styles.composer}><TextInput accessibilityLabel="Parent Chat message" editable={!isOffline} multiline onChangeText={setDraft} placeholder="Message" placeholderTextColor={colors.muted} style={[styles.field, styles.composerField]} value={draft} /><Button disabled={isOffline || !normalizeText(draft) || draft.length > 2000 || activeActionId === 'chat-send'} label={activeActionId === 'chat-send' ? 'Sending...' : 'Send'} onPress={() => { void onSend(draft).then(() => setDraft('')).catch(() => {}) }} styles={styles} /></View> : null}
      </View>
    )
  }
  return (
    <View style={styles.chatScreen}>
      <View style={styles.chatHeader}><Text accessibilityRole="header" style={styles.header}>Chat</Text><Text style={styles.helper}>Conversations for {link?.playerName || 'your child'}.</Text>{isOffline ? <Text style={styles.warning}>Saved conversations remain readable. Sending and deleting need a connection.</Text> : null}</View>
      <ResourceState emptyCopy="No Parent Chat rooms are available for this child." error={rooms.error} items={sortedRooms} loading={rooms.loading} styles={styles} />
      <FlatList contentContainerStyle={styles.chatRoomContent} data={sortedRooms} keyExtractor={(room) => String(room.id)} renderItem={({ item: room }) => <Pressable accessibilityRole="button" onPress={() => onOpenRoom(room)} style={styles.card}><View style={styles.row}><Text style={styles.pill}>{labelize(room.type)}</Text>{room.unreadCount ? <Text style={styles.stat}>{room.unreadCount}</Text> : null}</View><Text style={styles.cardTitle}>{room.title}</Text>{getParentChatRoomContext(room) ? <Text style={styles.meta}>{getParentChatRoomContext(room)}</Text> : null}<Text numberOfLines={1} style={styles.body}>{room.latestMessage || 'No messages yet'}</Text>{room.latestMessageAt ? <Text style={styles.meta}>{formatDate(room.latestMessageAt)}</Text> : null}</Pressable>} style={styles.chatList} />
    </View>
  )
}

export function MoreScreen({ onOpen, themeTokens, unansweredInvites, unansweredPolls }) {
  const { styles } = usePortalStyles(themeTokens)
  const items = [
    ['invites', 'Invites', unansweredInvites ? `${unansweredInvites} need a response` : 'Attendance and volunteer requests'],
    ['results', 'Results', 'Completed fixtures'],
    ['development', 'Development', 'Reports shared with your family'],
    ['resources', 'Resources', 'Files and links'],
    ['polls', 'Polls', unansweredPolls ? `${unansweredPolls} need a response` : 'Parent polls'],
    ['settings', 'Settings', 'Account, security, display and alerts'],
  ]
  return <View style={styles.stack}><Text accessibilityRole="header" style={styles.header}>More</Text>{items.map(([key, title, copy]) => <Pressable accessibilityRole="button" key={key} onPress={() => onOpen(key)} style={styles.card}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.helper}>{copy}</Text></Pressable>)}</View>
}

export async function openExternalParentUrl(url) {
  const safeUrl = normalizeText(url)
  if (!safeUrl.startsWith('https://')) throw new Error('This item did not provide a secure access link.')
  const supported = await Linking.canOpenURL(safeUrl)
  if (!supported) throw new Error('No app is available to open this item.')
  await Linking.openURL(safeUrl)
}
