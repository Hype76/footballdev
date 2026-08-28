import AsyncStorage from '@react-native-async-storage/async-storage'
import { activateKeepAwakeAsync, deactivateKeepAwake, isAvailableAsync } from 'expo-keep-awake'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { buildCompletedMatchEventPresentation, buildFinalMatchReportSummary } from '../../../src/lib/matchday-final-report.js'
import { getParentCalendarMarkerTone, getParentCalendarMonthGrid, getParentCalendarWindow, groupParentCalendarEvents, isParentCalendarEventCancelled } from '../../mobile-core/src/parentCalendarCore'
import { getNamedParentFormationPlayers, getParentFormationPitchPercent } from '../../mobile-core/src/parentFormationBoardCore'
import {
  formatParentProductDateTime,
  formatParentProductTime,
} from '../../mobile-core/src/parentDateTimeCore'
import { DEFAULT_PARENT_MOBILE_THEME } from '../../mobile-core/src/parentThemeCore'
import { captureCoachMatchDayAction, getCoachMatchDayPresentation } from '../../mobile-core/src/coachMatchDayCore'
import { getMatchDayLifecycleState, getParentScorerTimerActions } from '../../../src/lib/matchday-lifecycle.js'
import { useConfirmedConnectionMessage } from '../../mobile-core/src/useConfirmedConnectionIssue'
import {
  canParentRegisterScorerInterest,
  getParentCalendarDirectionsUrl,
  getParentMatchCalendarUrl,
  getParentMatchDirectionsUrl,
  getParentMatchGroups,
} from './parentExperience'
import { getParentChatRoomContext, getParentChatRoomTypeLabel, getParentInvitationSections, prepareParentChatMessages, prepareParentChatRooms } from './parentPresentationCore'
import {
  getInvitationResponseOptions,
  getParentInvitationDisplayState,
  getParentVolunteerRoleLabel,
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

function formatDateOnly(value, fallback = 'Date to be confirmed') {
  return formatParentProductDateTime(value, { fallback, includeTime: false, year: 'numeric' })
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
    pitch: tokens.pitch,
    pitchLine: tokens.pitchLine,
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
      actionSelected: { backgroundColor: colors.accentSoft, borderColor: colors.accent, borderWidth: 2 },
      actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
      actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
      actionGridItem: { flexBasis: '47%', flexGrow: 1 },
      actionText: { color: colors.accentForeground, fontSize: 14, fontWeight: '800' },
      actionTextOutline: { color: colors.text },
      actionTextSelected: { color: colors.accentText },
      body: { color: colors.text, fontSize: 15, lineHeight: 22 },
      card: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 18, borderWidth: 1, gap: 10, padding: 16 },
      controllerCard: { backgroundColor: colors.card, borderColor: colors.accent, borderRadius: 18, borderWidth: 2, gap: 12, padding: 16 },
      capturedPill: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderColor: colors.accent, borderRadius: 999, borderWidth: 1, color: colors.accentText, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
      volunteerCard: { borderColor: colors.warning, borderWidth: 2 },
      volunteerRole: { color: colors.warning, fontSize: 22, fontWeight: '900' },
      formationHalfway: { backgroundColor: 'rgba(255,255,255,0.72)', height: 1, left: 0, position: 'absolute', right: 0, top: '50%' },
      formationPitch: { aspectRatio: 0.68, backgroundColor: colors.pitch, borderColor: colors.pitchLine, borderRadius: 18, borderWidth: 2, overflow: 'hidden', position: 'relative', width: '100%' },
      formationEmpty: { alignSelf: 'center', backgroundColor: colors.card, borderRadius: 12, color: colors.text, fontSize: 13, fontWeight: '700', marginHorizontal: 18, marginTop: '55%', padding: 12, textAlign: 'center' },
      formationPlayer: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.accent, borderRadius: 18, borderWidth: 2, maxWidth: 100, minWidth: 66, paddingHorizontal: 6, paddingVertical: 7, position: 'absolute', transform: [{ translateX: -33 }, { translateY: -16 }] },
      formationPlayerText: { color: colors.text, fontSize: 10, fontWeight: '800' },
      cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
      gameDayHero: { backgroundColor: colors.accentSoft, borderColor: colors.accent, borderRadius: 18, borderWidth: 1, gap: 12, padding: 16 },
      gameDayHeroLive: { borderWidth: 2 },
      gameDayScore: { color: colors.text, fontSize: 42, fontVariant: ['tabular-nums'], fontWeight: '900', textAlign: 'center' },
      gameDayStat: { backgroundColor: colors.card, borderColor: colors.border, borderRadius: 12, borderWidth: 1, flex: 1, gap: 4, minWidth: 88, padding: 12 },
      gameDayStatLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase' },
      gameDayStatValue: { color: colors.text, fontSize: 18, fontVariant: ['tabular-nums'], fontWeight: '900' },
      gameDayStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
      liveSync: { alignSelf: 'flex-start', backgroundColor: colors.card, borderColor: colors.accent, borderRadius: 9, borderWidth: 1, color: colors.accentText, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 7 },
      timelineItem: { borderTopColor: colors.border, borderTopWidth: 1, gap: 3, paddingTop: 10 },
      timelineMinute: { color: colors.accentText, fontSize: 13, fontWeight: '900' },
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
      modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.62)' },
      modalCard: { backgroundColor: colors.card, borderColor: colors.border, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, gap: 12, maxHeight: '92%', padding: 18 },
      modalContent: { gap: 12, paddingBottom: 12 },
      modalHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
      modalScreen: { flex: 1, justifyContent: 'flex-end' },
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

function Button({ danger = false, disabled = false, expanded, label, onPress, outline = false, selected = false, styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected, ...(typeof expanded === 'boolean' ? { expanded } : {}) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, outline && styles.actionOutline, selected && styles.actionSelected, danger && styles.actionDanger, disabled && styles.actionDisabled, pressed && { opacity: 0.78 }]}
    >
      <Text style={[styles.actionText, outline && styles.actionTextOutline, selected && styles.actionTextSelected]}>{label}</Text>
    </Pressable>
  )
}

function ResourceState({ emptyCopy, error, items, loading, styles }) {
  if (loading && items.length === 0) return <Text accessibilityLiveRegion="polite" style={styles.helper}>Loading...</Text>
  if (error && items.length === 0) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
  if (!loading && items.length === 0) return <Text style={styles.empty}>{emptyCopy}</Text>
  return error ? <Text accessibilityRole="alert" style={styles.warning}>{error} Saved information is shown below.</Text> : null
}

function CalendarEventCard({ activeActionId, event, invitation, isOffline, onOpenInvitation, onOpenLink, onOpenResource, onRespond, styles }) {
  const actionable = invitation && isParentInvitationActionable(invitation)
  const busy = invitation && activeActionId === `invite:${invitation.invitationId}`
  const directionsUrl = getParentCalendarDirectionsUrl(event, Platform.OS)
  const isMatch = event.eventType === 'match_day' || ['match_attendance', 'match_role'].includes(invitation?.invitationType)
  const arrivalTime = event.arrivalTime || invitation?.arrivalTime || ''
  const kickoffTime = event.calendarTime || invitation?.kickoffTime || invitation?.eventStart || ''
  return (
    <View style={styles.card}>
      <Pressable
        accessibilityHint={invitation ? 'Opens this request so you can respond' : 'Opens this Calendar item'}
        accessibilityLabel={`${event.title}${actionable ? ', response needed' : ''}`}
        accessibilityRole="button"
        disabled={!invitation}
        onPress={() => invitation && onOpenInvitation?.(invitation)}
      >
        <View style={styles.row}>
          <Text style={styles.pill}>{labelize(['cancelled', 'closed', 'expired'].includes(event.status) ? event.status : event.eventType)}</Text>
          <Text style={styles.meta}>{isMatch ? `Kick-off: ${event.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(kickoffTime)}` : event.calendarTime || 'All day'}</Text>
        </View>
        <Text style={styles.cardTitle}>{event.title}</Text>
        {event.eventType === 'match_day' ? <Text style={styles.meta}>{event.shirtChoice === 'away' ? 'Away shirts' : 'Home shirts'}</Text> : null}
        {isMatch && arrivalTime ? <Text style={styles.meta}>Arrival: {formatParentProductTime(arrivalTime)}</Text> : null}
        {event.teamName ? <Text style={styles.meta}>{event.teamName}</Text> : null}
        {event.location ? <Text style={styles.meta}>{event.location}</Text> : null}
        {event.responseState ? <Text style={styles.meta}>Response: {labelize(event.responseState)}</Text> : null}
        {event.notes ? <Text style={styles.body}>{event.notes}</Text> : null}
        {invitation ? <Text style={styles.cardLink}>{actionable ? 'Open and respond' : 'Open request'}</Text> : null}
      </Pressable>
      {actionable ? (
        <View style={styles.actionRow}>
          {getInvitationResponseOptions(invitation).map((option) => (
            <Button
              disabled={isOffline || busy}
              key={option.value}
              label={busy ? 'Saving...' : option.label}
              onPress={() => onRespond(invitation, option.value)}
              outline
              selected={invitation.responseState === option.value}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
      {Array.isArray(event.resources) && event.resources.length > 0 ? (
        <View style={styles.stack}>
          <Text style={styles.meta}>Attachments</Text>
          {event.resources.map((resource) => (
            <Button
              disabled={isOffline || Boolean(activeActionId)}
              key={resource.id}
              label={activeActionId === `calendar-resource:${resource.id}` ? 'Opening...' : `Open ${resource.title}`}
              onPress={() => onOpenResource?.(event, resource)}
              outline
              styles={styles}
            />
          ))}
        </View>
      ) : null}
      {directionsUrl ? <Button label="Get directions" onPress={() => onOpenLink?.(directionsUrl, 'directions')} outline styles={styles} /> : null}
    </View>
  )
}

export function CalendarScreen({ activeActionId, invitations = [], isOffline, link, onDateSelected, onOpenInvitation, onOpenLink, onOpenResource, onRespond, resource, themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  const [viewMode, setViewMode] = useState('agenda')
  const [windowKey, setWindowKey] = useState('needs-response')
  const [monthCursor, setMonthCursor] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState('')
  const [markerTones, setMarkerTones] = useState(['match', 'training', 'response', 'event'])
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
  const filteredEvents = useMemo(
    () => activeEvents.filter((event) => markerTones.includes(getParentCalendarMarkerTone(event))),
    [activeEvents, markerTones],
  )
  const invitationById = useMemo(
    () => new Map(invitations.map((invitation) => [invitation.invitationId, invitation])),
    [invitations],
  )
  const visibleEvents = useMemo(
    () => getParentCalendarWindow(filteredEvents, windowKey),
    [filteredEvents, windowKey],
  )
  const groups = useMemo(() => groupParentCalendarEvents(visibleEvents), [visibleEvents])
  const monthDays = useMemo(() => getParentCalendarMonthGrid(filteredEvents, monthCursor), [filteredEvents, monthCursor])
  const selectedDayEvents = useMemo(() => filteredEvents.filter((event) => event.calendarDate === selectedDate), [filteredEvents, selectedDate])
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
  const toggleMarkerTone = (tone) => {
    setMarkerTones((current) => current.includes(tone)
      ? current.filter((item) => item !== tone)
      : [...current, tone])
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
        <View accessibilityLabel="Calendar filters" style={styles.monthLegend}>
          {[['match', 'Match'], ['training', 'Training'], ['response', 'Needs response'], ['event', 'Other']].map(([tone, label]) => {
            const selected = markerTones.includes(tone)
            return <Pressable accessibilityRole="button" accessibilityState={{ selected }} key={tone} onPress={() => toggleMarkerTone(tone)} style={[styles.monthLegendItem, !selected && { opacity: 0.42 }]}><View style={[styles.monthDot, ({ event: styles.monthDotEvent, match: styles.monthDotMatch, response: styles.monthDotResponse, training: styles.monthDotTraining })[tone]]} /><Text style={styles.monthLegendText}>{label}</Text></Pressable>
          })}
        </View>
        {selectedDate ? <View style={styles.section}><Text style={styles.dateHeading}>{formatCalendarDay(selectedDate)}</Text>{selectedDayEvents.length ? selectedDayEvents.map((event) => <CalendarEventCard activeActionId={activeActionId} event={event} invitation={invitationById.get(event.invitationId)} isOffline={isOffline} key={event.id} onOpenInvitation={onOpenInvitation} onOpenLink={onOpenLink} onOpenResource={onOpenResource} onRespond={onRespond} styles={styles} />) : <Text style={styles.empty}>No events on this date.</Text>}</View> : <Text style={styles.helper}>Tap a date to see its events.</Text>}
      </View> : null}
      {viewMode === 'agenda' && !resource.loading && activeEvents.length > 0 && visibleEvents.length === 0 ? <Text style={styles.empty}>No Calendar items match this date filter.</Text> : null}
      {viewMode === 'agenda' ? groups.map((group) => (
        <View key={group.date} style={styles.section}>
          <Text accessibilityRole="header" style={styles.dateHeading}>{group.date === 'date-tbc' ? 'Date to be confirmed' : formatCalendarDay(group.date)}</Text>
          {group.events.map((event) => <CalendarEventCard activeActionId={activeActionId} event={event} invitation={invitationById.get(event.invitationId)} isOffline={isOffline} key={event.id} onOpenInvitation={onOpenInvitation} onOpenLink={onOpenLink} onOpenResource={onOpenResource} onRespond={onRespond} styles={styles} />)}
        </View>
      )) : null}
    </View>
  )
}

export function InvitationsScreen({ activeActionId, isOffline, link, onBackTarget, onDismiss, onOpenResource, onRespond, resource, targetInvitationId = '', themeTokens }) {
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
        const volunteerOffer = invitation.invitationType === 'match_role'
        const volunteerRole = volunteerOffer ? getParentVolunteerRoleLabel(invitation) : ''
        const matchInvitation = ['match_attendance', 'match_role'].includes(invitation.invitationType)
        const kickoffTime = invitation.kickoffTime || invitation.eventStart || ''
        return (
          <View key={invitation.invitationId || `${invitation.sourceRecordId}:${invitation.invitationType}`} style={[styles.card, volunteerOffer && styles.volunteerCard]}>
            <View style={styles.row}><Text style={styles.pill}>{volunteerOffer ? 'Volunteer offer' : labelize(getParentInvitationDisplayState(invitation))}</Text><Text style={styles.meta}>{formatDateOnly(invitation.eventStart || invitation.eventDate)}</Text></View>
            {volunteerOffer ? <Text style={styles.volunteerRole}>{volunteerRole} offer</Text> : null}
            <Text style={styles.cardTitle}>{invitation.eventTitle}</Text>
            {!matchInvitation && invitation.eventStart ? <Text style={styles.meta}>Starts: {formatParentProductTime(invitation.eventStart)}</Text> : null}
            {matchInvitation ? <Text style={styles.meta}>Shirts: {invitation.shirtChoice === 'away' ? 'Away shirts' : 'Home shirts'}</Text> : null}
            {matchInvitation && invitation.arrivalTime ? <Text style={styles.meta}>Arrival: {formatParentProductTime(invitation.arrivalTime)}</Text> : null}
            {matchInvitation ? <Text style={styles.meta}>Kick-off: {invitation.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(kickoffTime)}</Text> : null}
            {volunteerOffer ? <Text style={styles.body}>This is a Parent or guardian volunteer role. It does not select your child for the squad.</Text> : null}
            <Text style={styles.body}>{volunteerOffer ? 'Offer status' : 'Response'}: {labelize(invitation.responseState)}</Text>
            {invitation.selectionState && invitation.selectionState !== 'not_applicable' ? <Text style={styles.meta}>{volunteerOffer ? 'Volunteer role status' : 'Squad status'}: {labelize(invitation.selectionState)}</Text> : null}
            {invitation.eventLocation ? <Text style={styles.meta}>{invitation.eventLocation}</Text> : null}
            {Array.isArray(invitation.resources) && invitation.resources.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.meta}>Attachments</Text>
                {invitation.resources.map((eventResource) => (
                  <Button
                    disabled={isOffline || Boolean(activeActionId)}
                    key={`${eventResource.id}:${eventResource.occurrenceDate}`}
                    label={activeActionId === `calendar-resource:${eventResource.id}` ? 'Opening...' : `Open ${eventResource.title}`}
                    onPress={() => onOpenResource?.(invitation, eventResource)}
                    outline
                    styles={styles}
                  />
                ))}
              </View>
            ) : null}
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
      {match.arrivalTime ? <Text style={styles.meta}>Arrival: {formatParentProductTime(match.arrivalTime)}</Text> : null}
      <Text style={styles.meta}>Kick-off: {match.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(match.kickoffTime)}</Text>
      <Text style={styles.meta}>{match.shirtChoice === 'away' ? 'Away shirts' : 'Home shirts'}</Text>
      {scoreVisible(match) ? <Text style={styles.score}>{match.homeScore} - {match.awayScore}</Text> : null}
      <Button label="Open Match Day" onPress={() => onOpen(match)} outline styles={styles} />
      {onDismiss ? <Button label="Remove from this list" onPress={() => onDismiss(match)} outline styles={styles} /> : null}
    </View>
  )
}

function GoalPlayerPicker({ allowClear = false, disabled, label, onSelect, players, styles, value }) {
  const [open, setOpen] = useState(false)
  const selected = players.find((player) => player.playerName === value) || null
  return (
    <View style={styles.stack}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Button
        disabled={disabled}
        expanded={open}
        label={selected ? `${selected.playerName}${selected.shirtNumber ? ` | Shirt ${selected.shirtNumber}` : ''}` : `Choose ${label.toLowerCase()}`}
        onPress={() => setOpen((current) => !current)}
        outline
        styles={styles}
      />
      {open ? (
        <View style={styles.card}>
          {allowClear ? <Button label="No assist" onPress={() => { onSelect(null); setOpen(false) }} outline styles={styles} /> : null}
          {players.map((player) => (
            <Button
              key={player.id || `${player.playerName}:${player.shirtNumber}`}
              label={`${player.playerName}${player.shirtNumber ? ` | Shirt ${player.shirtNumber}` : ''}`}
              onPress={() => { onSelect(player); setOpen(false) }}
              selected={selected?.id === player.id}
              styles={styles}
            />
          ))}
          {players.length === 0 ? <Text style={styles.helper}>No selected squad Players are available yet.</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

function GoalForm({ disabled, initialMinute = '', onAdd, placeholderColor, players = [], styles }) {
  const [side, setSide] = useState('club')
  const [scorerName, setScorerName] = useState('')
  const [scorerShirtNumber, setScorerShirtNumber] = useState('')
  const [assistName, setAssistName] = useState('')
  const [assistShirtNumber, setAssistShirtNumber] = useState('')
  const [isPenaltyGoal, setIsPenaltyGoal] = useState(false)
  const [notes, setNotes] = useState('')
  const [minute, setMinute] = useState(String(initialMinute ?? ''))
  return (
    <View style={styles.section}>
      <View style={styles.actionRow}>
        <Button disabled={disabled} label="Our team" onPress={() => { setSide('club'); setScorerName(''); setScorerShirtNumber(''); setAssistName(''); setAssistShirtNumber('') }} outline={side !== 'club'} styles={styles} />
        <Button disabled={disabled} label="Opponent" onPress={() => { setSide('opponent'); setScorerName(''); setScorerShirtNumber(''); setAssistName(''); setAssistShirtNumber('') }} outline={side !== 'opponent'} styles={styles} />
      </View>
      {side === 'club' ? <>
        <GoalPlayerPicker disabled={disabled} label="Scorer" onSelect={(player) => { setScorerName(player?.playerName || ''); setScorerShirtNumber(player?.shirtNumber || '') }} players={players} styles={styles} value={scorerName} />
        <GoalPlayerPicker allowClear disabled={disabled} label="Assist" onSelect={(player) => { setAssistName(player?.playerName || ''); setAssistShirtNumber(player?.shirtNumber || '') }} players={players.filter((player) => player.playerName !== scorerName)} styles={styles} value={assistName} />
      </> : <>
        <TextInput accessibilityLabel="Opponent goal scorer name" editable={!disabled} onChangeText={setScorerName} placeholder="Opponent scorer, optional" placeholderTextColor={placeholderColor} style={styles.field} value={scorerName} />
        <TextInput accessibilityLabel="Opponent assist name" editable={!disabled} onChangeText={setAssistName} placeholder="Opponent assist, optional" placeholderTextColor={placeholderColor} style={styles.field} value={assistName} />
      </>}
      <TextInput accessibilityLabel="Goal minute" editable={!disabled} keyboardType="number-pad" onChangeText={setMinute} placeholder="Match minute" placeholderTextColor={placeholderColor} style={styles.field} value={minute} />
      <View style={styles.row}><Text style={styles.cardTitle}>Penalty</Text><Switch accessibilityLabel="Penalty goal" disabled={disabled} onValueChange={setIsPenaltyGoal} value={isPenaltyGoal} /></View>
      <TextInput accessibilityLabel="Goal notes" editable={!disabled} multiline onChangeText={setNotes} placeholder="Notes, optional" placeholderTextColor={placeholderColor} style={[styles.field, { minHeight: 88, textAlignVertical: 'top' }]} value={notes} />
      <Button disabled={disabled} label={disabled ? 'Saving...' : 'Record goal'} onPress={() => onAdd({ assistName, assistShirtNumber, isPenaltyGoal, minute, notes, scorerName, scorerShirtNumber, teamSide: side })} styles={styles} />
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

function ParentMatchDayActionSheet({ busy, capturedClock, children, onClose, styles, title }) {
  return <Modal animationType="slide" onRequestClose={() => { if (!busy) onClose() }} transparent visible>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalScreen}>
      <Pressable accessibilityLabel={`Close ${title}`} disabled={busy} onPress={onClose} style={styles.modalBackdrop} />
      <View accessibilityViewIsModal style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <View style={{ flex: 1, gap: 7 }}><Text style={styles.pill}>Game mode</Text><Text accessibilityRole="header" style={styles.header}>{title}</Text>{capturedClock ? <Text style={styles.capturedPill}>Time captured at {capturedClock}</Text> : null}</View>
          <Button disabled={busy} label="Close" onPress={onClose} outline styles={styles} />
        </View>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>{children}</ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>
}

function ScorerControls({ activeActionId, isOffline, match, onAction, placeholderColor, players = [], styles }) {
  const busy = activeActionId.startsWith(`scorer:${match.id}:`)
  const [homeScore, setHomeScore] = useState(String(match.homeScore || 0))
  const [awayScore, setAwayScore] = useState(String(match.awayScore || 0))
  const [actionSheet, setActionSheet] = useState(null)
  const [actionError, setActionError] = useState('')
  const [keepAwake, setKeepAwake] = useState(false)
  const [keepAwakeAvailable, setKeepAwakeAvailable] = useState(true)
  const disabled = isOffline || busy
  const timerActions = getParentScorerTimerActions(match)
  const canRecordEvents = getMatchDayLifecycleState(match) === 'playing'
  const activeGoals = (match.events || []).filter((event) => event.eventType === 'goal' && !event.voidedAt)
  useEffect(() => {
    let mounted = true
    void isAvailableAsync().then((available) => mounted && setKeepAwakeAvailable(available)).catch(() => mounted && setKeepAwakeAvailable(false))
    return () => {
      mounted = false
      void deactivateKeepAwake('football-player-parent-game-day').catch(() => {})
    }
  }, [])
  const openAction = (kind, title) => {
    setActionError('')
    if (kind === 'score') {
      setHomeScore(String(match.homeScore || 0))
      setAwayScore(String(match.awayScore || 0))
    }
    const capture = captureCoachMatchDayAction(match, kind, Date.now())
    setActionSheet({ ...capture, kind, title })
  }
  const runTimerAction = (action) => {
    if (action === 'start') return onAction('start')
    if (['complete_extra_time', 'extra_time_half_time', 'normal_time_complete', 'start_extra_time', 'start_extra_time_second_half', 'start_penalties'].includes(action)) return onAction('extended', action)
    return onAction('timer', action)
  }
  const submitAndClose = async (action, value) => {
    const saved = await onAction(action, value)
    if (saved !== false) {
      setActionError('')
      setActionSheet(null)
    } else {
      setActionError('This change was not saved. Check your connection and try again.')
    }
  }
  const toggleKeepAwake = async (enabled) => {
    try {
      if (enabled) await activateKeepAwakeAsync('football-player-parent-game-day')
      else await deactivateKeepAwake('football-player-parent-game-day')
      setKeepAwake(enabled)
    } catch {
      setKeepAwake(false)
      setKeepAwakeAvailable(false)
    }
  }
  return (
    <View style={styles.stack}>
      <View style={styles.controllerCard}>
        <Text style={styles.pill}>Accepted Parent scorer</Text>
        <Text style={styles.cardTitle}>Live controller</Text>
        <Text style={styles.helper}>Use one action at a time. Goal details open separately so the main match screen stays clear.</Text>
        {isOffline ? <Text style={styles.warning}>Controls are unavailable offline. Connect before changing the clock, score or events.</Text> : null}
        <View style={styles.card}><View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Keep screen awake</Text><Text style={styles.meta}>{keepAwakeAvailable ? 'Optional for this live controller session. No match data is changed.' : 'Unavailable on this device.'}</Text></View><Switch accessibilityLabel="Keep screen awake" disabled={!keepAwakeAvailable} onValueChange={toggleKeepAwake} value={keepAwake} /></View></View>
        <View style={styles.actionGrid}>
          {canRecordEvents ? <View style={styles.actionGridItem}><Button disabled={disabled} label="Goal" onPress={() => openAction('goal', 'Add goal')} styles={styles} /></View> : null}
          {timerActions.map((item) => <View key={item.action} style={styles.actionGridItem}><Button danger={['conclude', 'full_time'].includes(item.action)} disabled={disabled} label={item.label} onPress={() => { void runTimerAction(item.action) }} outline={!['conclude', 'full_time'].includes(item.action)} styles={styles} /></View>)}
          <View style={styles.actionGridItem}><Button disabled={disabled || !canRecordEvents} label="Correct score" onPress={() => openAction('score', 'Correct score')} outline styles={styles} /></View>
          {activeGoals.length ? <View style={styles.actionGridItem}><Button disabled={disabled} label="Correct goal" onPress={() => openAction('correct-goal', 'Correct or remove a goal')} outline styles={styles} /></View> : null}
          {match.currentMatchPhase === 'penalties' ? <View style={styles.actionGridItem}><Button disabled={disabled} label="Penalty shootout" onPress={() => openAction('shootout', 'Penalty shootout')} outline styles={styles} /></View> : null}
        </View>
        {busy ? <Text accessibilityLiveRegion="polite" style={styles.helper}>Saving Game Day change...</Text> : null}
      </View>
      {actionSheet?.kind === 'goal' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Add goal"><Text style={styles.body}>The match time was captured when you pressed Goal. Add the details without rushing.</Text>{actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}<GoalForm disabled={disabled} initialMinute={actionSheet.capturedMinute} onAdd={(goal) => submitAndClose('goal', goal)} placeholderColor={placeholderColor} players={players} styles={styles} /></ParentMatchDayActionSheet> : null}
      {actionSheet?.kind === 'score' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Correct score"><Text style={styles.body}>Use this only when the displayed score is wrong. The correction remains in the Match Day history.</Text><View style={styles.actionRow}><TextInput accessibilityLabel="Home score" editable={!disabled} keyboardType="number-pad" onChangeText={setHomeScore} style={[styles.field, { flex: 1, minWidth: 96 }]} value={homeScore} /><TextInput accessibilityLabel="Away score" editable={!disabled} keyboardType="number-pad" onChangeText={setAwayScore} style={[styles.field, { flex: 1, minWidth: 96 }]} value={awayScore} /></View><Button disabled={disabled} label={busy ? 'Saving...' : 'Save score correction'} onPress={() => submitAndClose('score', { awayScore, homeScore })} styles={styles} /></ParentMatchDayActionSheet> : null}
      {actionSheet?.kind === 'correct-goal' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Correct or remove a goal"><GoalCorrectionForm disabled={disabled} events={match.events} onCorrect={(value) => submitAndClose('correct-goal', value)} onVoid={(value) => submitAndClose('void-goal', value)} placeholderColor={placeholderColor} styles={styles} /></ParentMatchDayActionSheet> : null}
      {actionSheet?.kind === 'shootout' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Penalty shootout"><ShootoutControls disabled={disabled} match={match} onRecord={(value) => submitAndClose('shootout', value)} onVoid={(value) => submitAndClose('void-shootout', value)} placeholderColor={placeholderColor} styles={styles} /></ParentMatchDayActionSheet> : null}
    </View>
  )
}

export function MatchdayScreen({ activeActionId, isOffline, link, onBack, onDismiss, onLiveRefresh, onOpen, onOpenLink, onScorerAction, onVolunteer, players = [], resource, selectedMatch, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const [matchSection, setMatchSection] = useState('upcoming')
  const [squadOpenMatchId, setSquadOpenMatchId] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const matchGroups = useMemo(() => getParentMatchGroups(resource.items), [resource.items])
  const visibleMatches = matchGroups[matchSection] || []
  const selectedMatchIsLive = Boolean(selectedMatch && ['extra_time', 'half_time', 'live', 'penalties', 'second_half'].includes(selectedMatch.status))
  const presentation = useMemo(
    () => selectedMatch ? getCoachMatchDayPresentation(selectedMatch, now) : null,
    [now, selectedMatch],
  )
  useEffect(() => {
    if (!selectedMatch) return undefined
    const clockId = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clockId)
  }, [selectedMatch])
  useEffect(() => {
    if (!selectedMatchIsLive || isOffline || !onLiveRefresh) return undefined
    const refreshId = setInterval(() => onLiveRefresh(), 15000)
    return () => clearInterval(refreshId)
  }, [isOffline, onLiveRefresh, selectedMatchIsLive])
  if (selectedMatch) {
    const timeline = (selectedMatch.events || []).slice().reverse()
    const confirmedPlayerNames = new Set(selectedMatch.confirmedTeam || [])
    const scorerPlayers = players.filter((player) => confirmedPlayerNames.has(player.playerName))
    return (
      <View style={styles.stack}>
        <Button label="Back to Matchday" onPress={onBack} outline styles={styles} />
        <View style={[styles.gameDayHero, selectedMatchIsLive && styles.gameDayHeroLive]}>
          <View style={styles.actionRow}>
            <Text style={styles.pill}>{labelize(selectedMatch.status)}</Text>
            <Text style={styles.pill}>{presentation?.phaseLabel || 'Pre-match'}</Text>
            {selectedMatch.homeAway ? <Text style={styles.pill}>{labelize(selectedMatch.homeAway)}</Text> : null}
            <Text style={styles.pill}>{selectedMatch.shirtChoice === 'away' ? 'Away shirts' : 'Home shirts'}</Text>
            {selectedMatch.fixtureType ? <Text style={styles.pill}>{labelize(selectedMatch.fixtureType)}</Text> : null}
          </View>
          <Text accessibilityRole="header" style={styles.header}>{presentation?.displayName || `${selectedMatch.teamName} v ${selectedMatch.opponent}`}</Text>
          <Text style={styles.body}>{formatDateOnly(selectedMatch.matchDate)}</Text>
          {selectedMatch.arrivalTime ? <Text style={styles.body}>Arrival: {formatParentProductTime(selectedMatch.arrivalTime)}</Text> : null}
          <Text style={styles.body}>Kick-off: {selectedMatch.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(selectedMatch.kickoffTime)}</Text>
          <Text style={styles.body}>{[selectedMatch.venueName, selectedMatch.venueAddress].filter(Boolean).join(', ') || 'Location not shared'}</Text>
          <Text style={styles.liveSync}>{selectedMatchIsLive ? 'Live sync on' : 'Fixture details'}</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Score</Text>
            <Text accessibilityLiveRegion="polite" style={styles.gameDayScore}>{presentation?.displayScore || `${selectedMatch.homeScore || 0} - ${selectedMatch.awayScore || 0}`}</Text>
            <View style={styles.gameDayStats}>
              <View style={styles.gameDayStat}><Text style={styles.gameDayStatLabel}>Match timer</Text><Text accessibilityLiveRegion="polite" style={styles.gameDayStatValue}>{presentation?.clock || '0:00'}</Text></View>
              <View style={styles.gameDayStat}><Text style={styles.gameDayStatLabel}>Period</Text><Text style={styles.gameDayStatValue}>{presentation?.phaseLabel || 'Pre-match'}</Text></View>
            </View>
          </View>
          {selectedMatch.notes ? <><Text style={styles.cardTitle}>Match notes</Text><Text style={styles.body}>{selectedMatch.notes}</Text></> : null}
          <Text style={styles.meta}>Availability: {labelize(selectedMatch.availabilityStatus) || 'No response requested'}</Text>
          <Text style={styles.meta}>Squad: {labelize(selectedMatch.squadDecisionState) || 'Not decided'}</Text>
          <View style={styles.actionRow}>
            <Button
              expanded={squadOpenMatchId === selectedMatch.id}
              label={squadOpenMatchId === selectedMatch.id ? 'Hide squad' : `See squad (${selectedMatch.confirmedTeam?.length || 0})`}
              onPress={() => setSquadOpenMatchId((current) => current === selectedMatch.id ? '' : selectedMatch.id)}
              outline
              styles={styles}
            />
            {getParentMatchCalendarUrl(selectedMatch) ? <Button label="Add to calendar" onPress={() => onOpenLink?.(getParentMatchCalendarUrl(selectedMatch), 'calendar')} outline styles={styles} /> : null}
            {getParentMatchDirectionsUrl(selectedMatch, Platform.OS) ? <Button label="Get directions" onPress={() => onOpenLink?.(getParentMatchDirectionsUrl(selectedMatch, Platform.OS), 'directions')} outline styles={styles} /> : null}
          </View>
        </View>
        {squadOpenMatchId === selectedMatch.id ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selected and confirmed squad</Text>
            <Text style={styles.helper}>Only Players who are both Available and Selected are shown.</Text>
            {selectedMatch.confirmedTeam?.length
              ? selectedMatch.confirmedTeam.map((playerName) => <Text key={playerName} style={styles.body}>{playerName}</Text>)
              : <Text style={styles.body}>No Available and Selected Players are confirmed yet.</Text>}
          </View>
        ) : null}
        {canParentRegisterScorerInterest(selectedMatch) ? (
          <View style={styles.card}><Text style={styles.cardTitle}>Volunteer scorer</Text><Text style={styles.body}>{selectedMatch.scorerRequestMessage || 'Coaches are looking for a Parent scorer.'}</Text><Button disabled={isOffline} label="Register interest" onPress={() => onVolunteer(selectedMatch)} styles={styles} /></View>
        ) : null}
        {!selectedMatch.isScorer ? <View style={styles.card}><Text style={styles.cardTitle}>Parent view</Text><Text style={styles.body}>Live match updates from the club appear here. Only the assigned scorer can make Game Day changes.</Text></View> : null}
        {selectedMatch.isScorer ? <ScorerControls activeActionId={activeActionId} isOffline={isOffline} match={selectedMatch} onAction={(action, value) => onScorerAction(selectedMatch, action, value)} placeholderColor={colors.muted} players={scorerPlayers} styles={styles} /> : null}
        <View style={styles.card}>
          <View style={styles.row}><Text style={styles.cardTitle}>Match Timeline</Text><Text style={styles.pill}>{selectedMatch.isScorer ? 'Scorer view' : 'Parent view'}</Text></View>
          {timeline.length === 0 ? <Text style={styles.helper}>No match events yet. Goals, cards and substitutions will appear here once recorded.</Text> : null}
          {timeline.map((event) => {
            const eventPresentation = buildCompletedMatchEventPresentation(event, selectedMatch, { includeNotes: false })
            return <View key={event.id} style={styles.timelineItem}><Text style={styles.timelineMinute}>{eventPresentation.minuteLabel}</Text><Text style={styles.body}>{eventPresentation.title}{eventPresentation.detail ? ` ${eventPresentation.detail}` : ''}</Text>{event.homeScore != null && event.awayScore != null ? <Text style={styles.meta}>{event.homeScore} - {event.awayScore}</Text> : null}</View>
          })}
        </View>
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
      {results.map((match) => <ParentMatchReportCard key={match.id} match={match} styles={styles} />)}
    </View>
  )
}

function ParentMatchReportCard({ match, styles }) {
  const [expanded, setExpanded] = useState(false)
  const report = useMemo(() => buildFinalMatchReportSummary(match), [match])
  const activeEvents = report.activeEvents.slice().reverse()
  return (
    <View style={styles.card}>
      <View style={styles.row}><Text style={styles.pill}>Full time</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View>
      <Text style={styles.cardTitle}>{match.teamName} v {match.opponent}</Text>
      <Text style={styles.score}>{report.result.finalScore}</Text>
      {report.result.shootoutScore ? <Text style={styles.meta}>Shootout: {report.result.shootoutScore}{report.result.shootoutWinner ? ` | ${report.result.shootoutWinner} won` : ''}</Text> : null}
      <Button expanded={expanded} label={expanded ? 'Hide match report' : 'View match report'} onPress={() => setExpanded((current) => !current)} outline styles={styles} />
      {expanded ? (
        <View style={styles.section}>
          <Text style={styles.cardTitle}>Match report</Text>
          <Text style={styles.stat}>Goals {report.activeGoals.length} | Cards {report.activeCards.length} | Substitutions {report.activeSubstitutions.length}</Text>
          {match.kickoffTimeTbc ? <Text style={styles.meta}>Kick-off time was not confirmed.</Text> : <Text style={styles.meta}>Kick-off {formatParentProductTime(match.kickoffTime)}</Text>}
          {match.venueName || match.venueAddress ? <Text style={styles.meta}>{[match.venueName, match.venueAddress].filter(Boolean).join(', ')}</Text> : null}
          {match.notes ? <><Text style={styles.cardTitle}>Match notes</Text><Text style={styles.body}>{match.notes}</Text></> : null}
          <Text style={styles.cardTitle}>Match timeline</Text>
          {activeEvents.length === 0 ? <Text style={styles.helper}>No match events were recorded.</Text> : null}
          {activeEvents.map((event) => {
            const presentation = buildCompletedMatchEventPresentation(event, match, { includeNotes: false })
            return <View key={event.id} style={styles.section}><View style={styles.row}><Text style={styles.body}>{presentation.minuteLabel} | {presentation.title}</Text><Text style={styles.meta}>{presentation.scoreLabel}</Text></View><Text style={styles.meta}>{presentation.team.name}{presentation.detail ? ` | ${presentation.detail}` : ''}</Text></View>
          })}
        </View>
      ) : null}
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

export function ResourcesScreen({ formationBoard, isOffline, onCloseFormation, onDismiss, onOpen, resource, themeTokens }) {
  const { styles } = usePortalStyles(themeTokens)
  if (formationBoard) {
    const placements = getNamedParentFormationPlayers(formationBoard.placements)
    const bench = getNamedParentFormationPlayers(formationBoard.bench)
    return (
      <View style={styles.stack}>
        <View><Text accessibilityRole="header" style={styles.header}>{formationBoard.title}</Text><Text style={styles.helper}>{formationBoard.gameFormat} | {formationBoard.formation}</Text></View>
        {formationBoard.description ? <Text style={styles.body}>{formationBoard.description}</Text> : null}
        <View accessibilityLabel={`${formationBoard.title} pitch`} style={styles.formationPitch}>
          <View style={styles.formationHalfway} />
          {placements.map((player, index) => (
            <View key={`${player.playerId || player.parentDisplayName}:${index}`} style={[styles.formationPlayer, { left: `${Math.max(4, Math.min(88, getParentFormationPitchPercent(player.x)))}%`, top: `${Math.max(3, Math.min(90, getParentFormationPitchPercent(player.y)))}%` }]}>
              <Text numberOfLines={1} style={styles.formationPlayerText}>{player.parentDisplayName}</Text>
            </View>
          ))}
          {!placements.length ? <Text style={styles.formationEmpty}>No named lineup has been published with this board.</Text> : null}
        </View>
        <View style={styles.card}><Text style={styles.cardTitle}>Bench</Text>{bench.length ? bench.map((player, index) => <Text key={`${player.playerId || player.parentDisplayName}:bench:${index}`} style={styles.body}>{player.parentDisplayName}</Text>) : <Text style={styles.helper}>No named Players are on the Bench.</Text>}</View>
        {formationBoard.notes ? <View style={styles.card}><Text style={styles.cardTitle}>Coach notes</Text><Text style={styles.body}>{formationBoard.notes}</Text></View> : null}
        <Button label="Back to Resources" onPress={onCloseFormation} outline styles={styles} />
      </View>
    )
  }
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Resources</Text><Text style={styles.helper}>Files and links shared for the selected child.</Text></View>
      {isOffline ? <Text style={styles.warning}>Resource details are saved for reading. Opening the item needs a connection.</Text> : null}
      <ResourceState emptyCopy="No resources are shared with this child." {...resource} styles={styles} />
      {resource.items.map((item) => <View key={item.id} style={styles.card}><Text style={styles.pill}>{labelize(item.category)}</Text><Text style={styles.cardTitle}>{item.title}</Text>{item.description || item.shareDescription ? <Text style={styles.body}>{item.description || item.shareDescription}</Text> : null}<Button disabled={isOffline} label="Open resource" onPress={() => onOpen(item)} outline styles={styles} /><Button label="Remove from this list" onPress={() => onDismiss(item)} outline styles={styles} /></View>)}
    </View>
  )
}

export function ChatScreen({ activeActionId, isOffline, link, messages, onBack, onDelete, onDismissAnnouncement, onOpenRoom, onSend, onToggleRoomNotifications, rooms, selectedRoom, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const [draft, setDraft] = useState('')
  const composerRef = useRef(null)
  const messageListRef = useRef(null)
  const sortedRooms = useMemo(() => prepareParentChatRooms(rooms.items), [rooms.items])
  const sortedMessages = useMemo(() => prepareParentChatMessages(messages.items), [messages.items])
  const visibleMessageError = useConfirmedConnectionMessage(messages.error)
  const displayedSelectedRoom = useMemo(() => selectedRoom ? prepareParentChatRooms([selectedRoom])[0] : null, [selectedRoom])
  useEffect(() => {
    if (!selectedRoom) return undefined
    const handle = setTimeout(() => messageListRef.current?.scrollToEnd({ animated: false }), 30)
    return () => clearTimeout(handle)
  }, [selectedRoom, sortedMessages.length])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background') composerRef.current?.blur()
    })
    return () => subscription.remove()
  }, [])
  if (selectedRoom) {
    return (
      <View style={styles.chatScreen}>
        <View style={styles.chatHeader}><Button label="Back to Chat rooms" onPress={onBack} outline styles={styles} /><Text accessibilityRole="header" style={styles.cardTitle}>{displayedSelectedRoom.title}</Text><Text style={styles.helper}>{getParentChatRoomContext(displayedSelectedRoom)}</Text></View>
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
        {visibleMessageError ? <Text style={styles.error}>{visibleMessageError}</Text> : null}
        {selectedRoom.canPost ? <View style={styles.composer}><TextInput accessibilityLabel="Parent Chat message" editable={!isOffline} multiline onChangeText={setDraft} placeholder="Message" placeholderTextColor={colors.muted} ref={composerRef} style={[styles.field, styles.composerField]} value={draft} /><Button disabled={isOffline || !normalizeText(draft) || draft.length > 2000 || activeActionId === 'chat-send'} label={activeActionId === 'chat-send' ? 'Sending...' : 'Send'} onPress={() => { void onSend(draft).then(() => setDraft('')).catch(() => {}) }} styles={styles} /></View> : null}
      </View>
    )
  }
  return (
    <View style={styles.chatScreen}>
      <View style={styles.chatHeader}><Text accessibilityRole="header" style={styles.header}>Chat</Text><Text style={styles.helper}>Conversations for {link?.playerName || 'your child'}.</Text>{isOffline ? <Text style={styles.warning}>Saved conversations remain readable. Sending and deleting need a connection.</Text> : null}</View>
      <ResourceState emptyCopy="No Parent Chat rooms are available for this child." error={rooms.error} items={sortedRooms} loading={rooms.loading} styles={styles} />
      <FlatList
        contentContainerStyle={styles.chatRoomContent}
        data={sortedRooms}
        keyExtractor={(room) => String(room.id)}
        renderItem={({ item: room }) => (
          <View style={styles.card}>
            <Pressable accessibilityRole="button" onPress={() => onOpenRoom(room)}>
              <View style={styles.row}><Text style={styles.pill}>{getParentChatRoomTypeLabel(room.type)}</Text>{room.unreadCount ? <Text style={styles.stat}>{room.unreadCount}</Text> : null}</View>
              <Text style={styles.cardTitle}>{room.title}</Text>
              {getParentChatRoomContext(room) ? <Text style={styles.meta}>{getParentChatRoomContext(room)}</Text> : null}
              <Text numberOfLines={1} style={styles.body}>{room.latestMessage || 'No messages yet'}</Text>
              {room.latestMessageAt ? <Text style={styles.meta}>{formatDate(room.latestMessageAt)}</Text> : null}
            </Pressable>
            <View style={styles.row}>
              <View><Text style={styles.body}>Do not disturb</Text><Text style={styles.meta}>{room.notificationsMuted ? 'Notifications muted for this room' : 'Notifications on for this room'}</Text></View>
              <Switch
                accessibilityLabel={`Do not disturb for ${room.title}`}
                disabled={isOffline || Boolean(activeActionId)}
                onValueChange={(value) => onToggleRoomNotifications(room, value)}
                trackColor={{ false: colors.border, true: colors.accent }}
                value={room.notificationsMuted === true}
              />
            </View>
          </View>
        )}
        style={styles.chatList}
      />
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
