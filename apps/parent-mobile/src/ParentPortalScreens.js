import * as Crypto from 'expo-crypto'
import { oppositeMatchSide } from '../../../src/lib/matchday-goal-credit.js'
import { SCORER_EVENT_LABELS, validateScorerMatchEvent } from '../../../src/lib/matchday-scorer-event.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { BrandLoader } from '../../mobile-core/src/BrandLoader'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
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
import { getCoachMatchDayPresentation } from '../../mobile-core/src/coachMatchDayCore'
import { getMatchDayLifecycleState, getParentScorerTimerActions } from '../../../src/lib/matchday-lifecycle.js'
import { getMatchDayShirtChoiceLabel } from '../../../src/lib/matchday-model.js'
import { getMatchDayDisplayName } from '../../../src/lib/matchday-display.js'
import { useConfirmedConnectionMessage } from '../../mobile-core/src/useConfirmedConnectionIssue'
import ParentIcon from './ParentIcon'
import { formatMatchAddedTimeClock, getMatchEventTime, getMatchClockDescription } from '../../../src/lib/matchday-event-time.js'
import { captureParentScorerAction, getParentMatchTimeline, getParentScorerActionLabel, getParentScorerMatches } from './parentScorerCore'
import { getParentEventPresentation } from './parentEventPresentation'
import {
  getParentScorerInterestInvitation,
  getParentCalendarDirectionsUrl,
  getParentMatchDirectionsUrl,
  getParentMatchGroups,
  getParentMatchStatusLabel,
} from './parentExperience'
import { getParentChatRoomContext, getParentChatRoomTypeLabel, getParentInvitationCounts, getParentInvitationEventKey, getParentInvitationLockReason, getParentInvitationSections, groupParentInvitationsByEvent, isParentInvitationOptionSelected, prepareParentChatMessages, prepareParentChatRooms } from './parentPresentationCore'
import {
  getInvitationResponseOptions,
  getParentVolunteerRoleLabel,
  isParentInvitationActionable,
} from './parentPortalData'

const PARENT_CALENDAR_VIEW_KEY = 'football-player-parent-calendar-view-v1'
const VOLUNTEER_ROLE_STATUS_LABEL = 'Volunteer role status'

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
      card: { backgroundColor: 'transparent', borderBottomColor: colors.border, borderBottomWidth: 1, gap: 8, paddingHorizontal: 0, paddingVertical: 12 },
      controllerCard: { backgroundColor: 'transparent', borderBottomColor: colors.accent, borderBottomWidth: 2, gap: 12, paddingHorizontal: 0, paddingVertical: 14 },
      capturedPill: { alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderColor: colors.accent, borderRadius: 999, borderWidth: 1, color: colors.accentText, fontSize: 12, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
      developmentScoreCard: { borderColor: colors.border, borderRadius: 12, borderTopColor: colors.accent, borderTopWidth: 3, borderWidth: 1, gap: 8, padding: 12 },
      developmentScoreNumber: { color: colors.accentText, fontSize: 22, fontWeight: '900' },
      developmentScoreTrack: { backgroundColor: colors.accentSoft, borderRadius: 999, height: 7, overflow: 'hidden' },
      developmentScoreTrackFill: { backgroundColor: colors.accent, borderRadius: 999, height: '100%' },
      volunteerCard: { borderBottomColor: colors.warning },
      volunteerRole: { color: colors.warning, fontSize: 22, fontWeight: '900' },
      formationHalfway: { backgroundColor: 'rgba(255,255,255,0.72)', height: 1, left: 0, position: 'absolute', right: 0, top: '50%' },
      formationPitch: { aspectRatio: 0.68, backgroundColor: colors.pitch, borderColor: colors.pitchLine, borderRadius: 18, borderWidth: 2, overflow: 'hidden', position: 'relative', width: '100%' },
      formationEmpty: { alignSelf: 'center', backgroundColor: colors.card, borderRadius: 12, color: colors.text, fontSize: 13, fontWeight: '700', marginHorizontal: 18, marginTop: '55%', padding: 12, textAlign: 'center' },
      formationPlayer: { alignItems: 'center', backgroundColor: colors.card, borderColor: colors.accent, borderRadius: 18, borderWidth: 2, maxWidth: 100, minWidth: 66, paddingHorizontal: 6, paddingVertical: 7, position: 'absolute', transform: [{ translateX: -33 }, { translateY: -16 }] },
      formationPlayerText: { color: colors.text, fontSize: 10, fontWeight: '800' },
      cardTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
      cardLink: { color: colors.accentText, fontSize: 13, fontWeight: '900' },
      calendarEventCard: { backgroundColor: 'transparent', borderBottomColor: colors.border, borderBottomWidth: 1, gap: 0, marginBottom: 8, paddingHorizontal: 0, paddingVertical: 12 },
      eventLabel: { fontSize: 12, fontWeight: '800' },
      carpoolChoice: { alignItems: 'center', flexDirection: 'row', gap: 9 },
      carpoolIcon: { alignItems: 'center', borderRadius: 999, height: 38, justifyContent: 'center', width: 38 },
      compactCopy: { flex: 1, gap: 3, minWidth: 0 },
      compactRow: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 58 },
      gameDayHero: { borderBottomColor: colors.accent, borderBottomWidth: 1, gap: 12, paddingHorizontal: 0, paddingVertical: 14 },
      gameDayHeroLive: { borderBottomWidth: 2 },
      gameDayScore: { color: colors.text, fontSize: 42, fontVariant: ['tabular-nums'], fontWeight: '900', textAlign: 'center' },
      gameDayStat: { borderLeftColor: colors.border, borderLeftWidth: 1, flex: 1, gap: 4, minWidth: 88, paddingHorizontal: 10, paddingVertical: 4 },
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
      iconAction: { alignItems: 'center', justifyContent: 'center', minHeight: 38, minWidth: 38 },
      iconChoice: { alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent', borderRadius: 8, gap: 2, justifyContent: 'center', minHeight: 48, minWidth: 48, paddingHorizontal: 3, paddingVertical: 3 },
      iconChoiceDisabled: { opacity: 0.42 },
      iconChoiceLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', textAlign: 'center' },
      iconChoiceRow: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 2, justifyContent: 'flex-end' },
      inviteGroup: { backgroundColor: 'transparent', borderBottomColor: colors.border, borderBottomWidth: 2, gap: 0, marginBottom: 16, paddingHorizontal: 0, paddingVertical: 12 },
      inviteHeader: { alignItems: 'center', flexDirection: 'row', gap: 9, paddingBottom: 7 },
      inviteHeaderCopy: { flex: 1, gap: 3 },
      inviteMetadata: { alignItems: 'center', borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 7 },
      inviteMetadataItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
      inviteResponseLabel: { alignItems: 'center', flexDirection: 'row', flex: 1, gap: 7, minWidth: 96 },
      inviteResponseRow: { alignItems: 'stretch', borderTopColor: colors.border, borderTopWidth: 1, gap: 6, minHeight: 52, paddingVertical: 8 },
      inviteSection: { borderTopColor: colors.border, borderTopWidth: 1, gap: 5, paddingVertical: 6 },
      inviteSectionCopy: { flex: 1 },
      inviteSectionHeader: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 38 },
      inviteSectionTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
      inviteStatus: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 44 },
      inviteStatusCopy: { flex: 1, gap: 2 },
      inviteStatusLabel: { fontSize: 14, fontWeight: '900' },
      seatChoice: { alignItems: 'center', justifyContent: 'center', minHeight: 40, minWidth: 40 },
      seatChoiceText: { color: colors.muted, fontSize: 13, fontWeight: '900' },
      meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
      moreGrid: { borderBottomColor: colors.border, borderBottomWidth: 1, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 5 },
      moreItem: { alignItems: 'center', gap: 4, justifyContent: 'center', minHeight: 88, paddingHorizontal: 5, width: '33.333%' },
      moreItemCopy: { color: colors.muted, fontSize: 10, lineHeight: 14, textAlign: 'center' },
      moreItemTitle: { color: colors.text, fontSize: 12, fontWeight: '900', textAlign: 'center' },
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

function invitationResponsePresentation(invitation = {}) {
  const state = normalizeText(invitation.responseState).toLowerCase()
  if (['accepted', 'available', 'attending', 'yes'].includes(state)) return { iconKey: 'attendance.available', label: invitation.invitationType === 'match_role' ? 'Yes' : 'Attending', tone: 'success' }
  if (state === 'maybe') return { iconKey: 'attendance.maybe', label: 'Maybe', tone: 'warning' }
  if (['declined', 'no', 'not_attending', 'unavailable'].includes(state)) return { iconKey: 'attendance.unavailable', label: invitation.invitationType === 'match_role' ? 'No' : 'Not attending', tone: 'danger' }
  return { iconKey: 'attendance.maybe', label: 'Not answered', tone: 'muted' }
}

function invitationToneColor(colors, tone) {
  return ({ danger: colors.danger, success: colors.success, warning: colors.warning })[tone] || colors.muted
}

function volunteerIconKey(invitation = {}) {
  const role = normalizeText(invitation.roleType).toLowerCase().replace(/^volunteer_/, '')
  return ['linesman', 'referee', 'scorer'].includes(role) ? `role.${role}` : 'invite'
}

function IconAction({ accessibilityLabel, colors, disabled = false, iconKey, onPress, styles }) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconAction, disabled && styles.actionDisabled, pressed && { opacity: 0.72 }]}>
      <ParentIcon color={colors.accent} iconKey={iconKey} size={22} />
    </Pressable>
  )
}

function IconChoice({ accessibilityLabel, colors, disabled = false, iconKey, label, onPress, selected = false, styles, tone = 'muted' }) {
  const color = selected ? invitationToneColor(colors, tone) : colors.muted
  return (
    <Pressable accessibilityLabel={accessibilityLabel || label} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconChoice, selected && { backgroundColor: colors.accentSoft, borderBottomColor: color }, disabled && !selected && styles.iconChoiceDisabled, pressed && { opacity: 0.72 }]}>
      <ParentIcon color={color} iconKey={iconKey} size={26} />
      <Text style={[styles.iconChoiceLabel, selected && { color }]}>{label}</Text>
    </Pressable>
  )
}

function InvitationResponseControl({ activeActionId, colors, invitation, isOffline, label, onRespond, styles }) {
  const response = invitationResponsePresentation(invitation)
  const actionable = isParentInvitationActionable(invitation)
  const busy = activeActionId === `invite:${invitation.invitationId}`
  const isVolunteer = invitation.invitationType === 'match_role'
  const sectionIcon = isVolunteer ? volunteerIconKey(invitation) : getParentEventPresentation(invitation).iconKey
  const options = getInvitationResponseOptions(invitation)
  const lockReason = getParentInvitationLockReason(invitation)

  return (
    <View style={styles.inviteResponseRow}>
      <View style={styles.inviteResponseLabel}>
        <ParentIcon color={invitationToneColor(colors, response.tone)} iconKey={sectionIcon} size={21} />
        <View style={styles.inviteSectionCopy}>
          <Text style={styles.inviteSectionTitle}>{label}</Text>
          {invitation.selectionState && invitation.selectionState !== 'not_applicable' ? <Text accessibilityLabel={`${isVolunteer ? VOLUNTEER_ROLE_STATUS_LABEL : 'Squad status'}: ${labelize(invitation.selectionState)}`} numberOfLines={1} style={styles.meta}>{isVolunteer ? 'Role' : 'Squad'}: {labelize(invitation.selectionState)}</Text> : null}
          {!options.length ? <Text style={[styles.meta, { color: invitationToneColor(colors, response.tone) }]}>{response.label}</Text> : null}
          {lockReason ? <Text style={styles.warning}>{lockReason}</Text> : null}
        </View>
      </View>
      {options.length ? (
        <View accessibilityLabel={`${label} choices`} accessibilityRole="radiogroup" style={styles.iconChoiceRow}>
          {options.map((option) => {
            const selected = isParentInvitationOptionSelected(invitation, option.value)
            const tone = ['available', 'yes'].includes(option.value) ? 'success' : option.value === 'maybe' ? 'warning' : 'danger'
            const iconKey = ['available', 'yes'].includes(option.value) ? 'attendance.available' : option.value === 'maybe' ? 'attendance.maybe' : 'attendance.unavailable'
            const optionLabel = isVolunteer ? option.value === 'yes' ? 'Yes' : 'No' : option.value === 'available' ? 'Attending' : option.value === 'unavailable' ? 'Not attending' : option.label
            return <IconChoice accessibilityLabel={`${label}, ${optionLabel}`} colors={colors} disabled={isOffline || busy || !actionable} iconKey={iconKey} key={option.value} label={busy ? 'Saving' : optionLabel} onPress={() => onRespond(invitation, option.value)} selected={selected} styles={styles} tone={tone} />
          })}
        </View>
      ) : null}
    </View>
  )
}

function ResourceState({ emptyCopy, error, items, loading, styles }) {
  if (loading && items.length === 0) return <View style={{ alignItems: 'center', paddingVertical: 12 }}><BrandLoader size="large" /><Text accessibilityLiveRegion="polite" style={styles.helper}>Loading...</Text></View>
  if (error && items.length === 0) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
  if (!loading && items.length === 0) return <Text style={styles.empty}>{emptyCopy}</Text>
  return error ? <Text accessibilityRole="alert" style={styles.warning}>{error} Saved information is shown below.</Text> : null
}

function ParentCarpoolControl({ activeActionId, colors, invitation, isOffline, onTransport, styles }) {
  const [seatsOffered, setSeatsOffered] = useState(Math.max(1, Number(invitation?.transportSeatsOffered) || 1))
  const [open, setOpen] = useState(false)
  const busy = activeActionId === `transport:${invitation?.invitationId}`
  const needsLift = Boolean(invitation?.transportNeedsLift)
  const offeringLift = Boolean(invitation?.transportCanOfferLift)
  const status = needsLift ? 'Needs a lift' : offeringLift ? `Offering ${Math.max(1, Number(invitation?.transportSeatsOffered) || seatsOffered)} seat${Math.max(1, Number(invitation?.transportSeatsOffered) || seatsOffered) === 1 ? '' : 's'}` : invitation?.transportRespondedAt ? 'Not needed' : 'Optional'
  return (
    <View style={styles.inviteSection}>
      <Pressable accessibilityLabel={`Carpool, ${status}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((current) => !current)} style={styles.inviteSectionHeader}><ParentIcon color={needsLift ? colors.danger : offeringLift ? colors.success : colors.muted} iconKey="carpool.offer" size={23} /><View style={styles.inviteSectionCopy}><Text style={styles.cardTitle}>Carpool</Text><Text style={styles.meta}>{status}</Text></View><ParentIcon color={colors.accent} iconKey={open ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={22} /></Pressable>
      {open ? <View style={styles.iconChoiceRow}>
        <IconChoice colors={colors} disabled={isOffline || busy} iconKey="carpool.need" label="Need a lift" onPress={() => onTransport?.(invitation, 'needs_lift', 0)} selected={needsLift} styles={styles} tone="danger" />
        <IconChoice colors={colors} disabled={isOffline || busy} iconKey="carpool.offer" label="Offer a lift" onPress={() => onTransport?.(invitation, 'offering_lift', seatsOffered)} selected={offeringLift} styles={styles} tone="success" />
        <IconChoice colors={colors} disabled={isOffline || busy} iconKey="carpool.none" label="Not needed" onPress={() => onTransport?.(invitation, 'none', 0)} selected={!needsLift && !offeringLift && Boolean(invitation?.transportRespondedAt)} styles={styles} />
      </View> : null}
      {open && offeringLift ? (
        <View accessibilityLabel="Seats offered" style={styles.actionRow}>
          <Text style={styles.meta}>Seats</Text>
          {[1, 2, 3, 4].map((seats) => <Pressable accessibilityLabel={`${seats} seat${seats === 1 ? '' : 's'}`} accessibilityRole="radio" accessibilityState={{ checked: seatsOffered === seats }} disabled={isOffline || busy} key={seats} onPress={() => { setSeatsOffered(seats); onTransport?.(invitation, 'offering_lift', seats) }} style={styles.seatChoice}><Text style={[styles.seatChoiceText, seatsOffered === seats && { color: colors.success }]}>{seats}</Text></Pressable>)}
        </View>
      ) : null}
    </View>
  )
}

function CalendarEventCard({ activeActionId, colors, event, invitation, isOffline, onAddToCalendar, onOpenInvitation, onOpenLink, onOpenResource, onRespond, onTransport, styles }) {
  const presentation = getParentEventPresentation(event)
  const eventColor = colors[presentation.tone]
  const actionable = invitation && isParentInvitationActionable(invitation)
  const busy = invitation && activeActionId === `invite:${invitation.invitationId}`
  const directionsUrl = getParentCalendarDirectionsUrl(event, Platform.OS)
  const isMatch = event.eventType === 'match_day' || ['match_attendance', 'match_role'].includes(invitation?.invitationType)
  const arrivalTime = event.arrivalTime || invitation?.arrivalTime || ''
  const kickoffTime = event.calendarTime || invitation?.kickoffTime || invitation?.eventStart || ''
  return (
    <View style={styles.calendarEventCard}>
      <Pressable
        accessibilityHint={invitation ? 'Opens this request so you can respond' : 'Opens this Calendar item'}
        accessibilityLabel={`${event.title}${actionable ? ', response needed' : ''}`}
        accessibilityRole="button"
        disabled={!invitation}
        onPress={() => invitation && onOpenInvitation?.(invitation)}
        style={styles.compactRow}
      >
        <ParentIcon color={eventColor} iconKey={presentation.iconKey} size={32} />
        <View style={styles.compactCopy}>
          <View style={styles.row}><Text style={[styles.eventLabel, { color: eventColor }]}>{presentation.label}</Text><Text style={styles.meta}>{isMatch ? event.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(kickoffTime) : event.calendarTime || 'All day'}</Text></View>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <Text numberOfLines={1} style={styles.meta}>{[event.teamName, isMatch && arrivalTime ? `Arrive ${formatParentProductTime(arrivalTime)}` : '', event.responseState ? labelize(event.responseState) : ''].filter(Boolean).join(' | ')}</Text>
        </View>
        {invitation ? <ParentIcon color={colors.accent} iconKey="action.open" size={22} /> : null}
      </Pressable>
      {actionable ? (
        <View style={[styles.inviteSection, styles.iconChoiceRow]}>
          {getInvitationResponseOptions(invitation).map((option) => {
            const selected = isParentInvitationOptionSelected(invitation, option.value)
            const tone = ['available', 'yes'].includes(option.value) ? 'success' : option.value === 'maybe' ? 'warning' : 'danger'
            const iconKey = ['available', 'yes'].includes(option.value) ? 'attendance.available' : option.value === 'maybe' ? 'attendance.maybe' : 'attendance.unavailable'
            const label = invitation.invitationType === 'match_role' ? option.value === 'yes' ? 'Yes' : 'No' : option.value === 'available' ? 'Attending' : option.value === 'unavailable' ? 'Not attending' : option.label
            return <IconChoice colors={colors} disabled={isOffline || busy} iconKey={iconKey} key={option.value} label={busy ? 'Saving' : label} onPress={() => onRespond(invitation, option.value)} selected={selected} styles={styles} tone={tone} />
          })}
        </View>
      ) : null}
      {Array.isArray(event.resources) && event.resources.length > 0 ? <View style={styles.inviteSection}>{event.resources.map((resource) => <Pressable accessibilityLabel={`Open ${resource.title}`} accessibilityRole="button" disabled={isOffline || Boolean(activeActionId)} key={resource.id} onPress={() => onOpenResource?.(event, resource)} style={styles.inviteSectionHeader}><ParentIcon color={colors.accent} iconKey="resource" size={22} /><Text style={[styles.body, styles.inviteSectionCopy]}>{resource.title}</Text><ParentIcon color={colors.accent} iconKey="action.open" size={21} /></Pressable>)}</View> : null}
      <View style={styles.inviteSection}>
        <View style={styles.row}>
          {event.location ? <View style={[styles.inviteMetadataItem, styles.inviteSectionCopy]}><ParentIcon color={colors.warning} iconKey="location" size={21} /><Text numberOfLines={1} style={styles.meta}>{event.location}</Text></View> : <View />}
          <View style={styles.actionRow}>{event.calendarDate || event.eventDate || event.startsAt || event.eventStart ? <IconAction accessibilityLabel="Add to Google Calendar" colors={colors} disabled={Boolean(activeActionId)} iconKey="action.calendar" onPress={() => onAddToCalendar?.(event)} styles={styles} /> : null}{directionsUrl ? <IconAction accessibilityLabel="Get directions" colors={colors} iconKey="parent.directions" onPress={() => onOpenLink?.(directionsUrl, 'directions')} styles={styles} /> : null}</View>
        </View>
      </View>
      {isMatch && invitation?.invitationType === 'match_attendance' ? <ParentCarpoolControl activeActionId={activeActionId} colors={colors} invitation={invitation} isOffline={isOffline} onTransport={onTransport} styles={styles} /> : null}
    </View>
  )
}

export function CalendarScreen({ activeActionId, invitations = [], isOffline, link, onAddToCalendar, onDateSelected, onOpenInvitation, onOpenLink, onOpenResource, onRespond, onTransport, resource, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
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
        {selectedDate ? <View style={styles.section}><Text style={styles.dateHeading}>{formatCalendarDay(selectedDate)}</Text>{selectedDayEvents.length ? selectedDayEvents.map((event) => <CalendarEventCard activeActionId={activeActionId} colors={colors} event={event} invitation={invitationById.get(event.invitationId)} isOffline={isOffline} key={event.id} onAddToCalendar={onAddToCalendar} onOpenInvitation={onOpenInvitation} onOpenLink={onOpenLink} onOpenResource={onOpenResource} onRespond={onRespond} onTransport={onTransport} styles={styles} />) : <Text style={styles.empty}>No events on this date.</Text>}</View> : <Text style={styles.helper}>Tap a date to see its events.</Text>}
      </View> : null}
      {viewMode === 'agenda' && !resource.loading && activeEvents.length > 0 && visibleEvents.length === 0 ? <Text style={styles.empty}>No Calendar items match this date filter.</Text> : null}
      {viewMode === 'agenda' ? groups.map((group) => (
        <View key={group.date} style={styles.section}>
          <Text accessibilityRole="header" style={styles.dateHeading}>{group.date === 'date-tbc' ? 'Date to be confirmed' : formatCalendarDay(group.date)}</Text>
          {group.events.map((event) => <CalendarEventCard activeActionId={activeActionId} colors={colors} event={event} invitation={invitationById.get(event.invitationId)} isOffline={isOffline} key={event.id} onAddToCalendar={onAddToCalendar} onOpenInvitation={onOpenInvitation} onOpenLink={onOpenLink} onOpenResource={onOpenResource} onRespond={onRespond} onTransport={onTransport} styles={styles} />)}
        </View>
      )) : null}
    </View>
  )
}

export function InvitationsScreen({ activeActionId, isOffline, link, onAddToCalendar, onBackTarget, onOpenResource, onRespond, onTransport, resource, targetInvitationId = '', themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const sections = useMemo(() => getParentInvitationSections(resource.items), [resource.items])
  const counts = useMemo(() => getParentInvitationCounts(resource.items), [resource.items])
  const defaultSection = sections.needsResponse.length ? 'needsResponse' : 'upcoming'
  const [sectionKey, setSectionKey] = useState(null)
  const [volunteerHelpOpen, setVolunteerHelpOpen] = useState(false)
  const activeSectionKey = sectionKey || defaultSection
  const targetedInvitation = targetInvitationId
    ? resource.items.find((invitation) => invitation.invitationId === targetInvitationId) || null
    : null
  const uniqueInvitations = useMemo(() => [
    ...sections.needsResponse,
    ...sections.upcoming,
    ...sections.responded,
    ...sections.history,
  ], [sections])
  const groupedInvitations = useMemo(() => groupParentInvitationsByEvent(uniqueInvitations), [uniqueInvitations])
  const visibleEventKeys = useMemo(() => new Set((targetedInvitation ? [targetedInvitation] : sections[activeSectionKey] || []).map(getParentInvitationEventKey)), [activeSectionKey, sections, targetedInvitation])
  const visibleGroups = groupedInvitations.filter((group) => visibleEventKeys.has(group.eventKey))
  const respond = (invitation, responseState) => {
    onRespond(invitation, responseState)
  }
  return (
    <View style={styles.stack}>
      {targetedInvitation && onBackTarget ? <Button label="Back to all requests" onPress={onBackTarget} outline styles={styles} /> : null}
      <View><Text accessibilityRole="header" style={styles.header}>{targetedInvitation ? 'Respond to request' : 'Invites'}</Text><Text style={styles.helper}>{targetedInvitation ? 'Choose the icons that match your answer.' : `Compact attendance and volunteer responses for ${link?.playerName || 'your child'}.`}</Text></View>
      {isOffline ? <Text style={styles.warning}>Responses need a connection. Saved invitations remain available to read.</Text> : null}
      {!targetedInvitation ? <View style={styles.actionRow}>{[
        ['needsResponse', 'Needs response'],
        ['upcoming', 'Coming up'],
        ['responded', 'Responded'],
        ['history', 'History'],
      ].map(([key, label]) => <Button key={key} label={`${label}${counts[key] ? ` (${counts[key]})` : ''}`} onPress={() => setSectionKey(key)} outline={activeSectionKey !== key} styles={styles} />)}</View> : null}
      <ResourceState emptyCopy="There are no invitations for this child." {...resource} styles={styles} />
      {!resource.loading && resource.items.length > 0 && visibleGroups.length === 0 ? <Text style={styles.empty}>Nothing is in this section.</Text> : null}
      {visibleGroups.map((group) => {
        const matchAttendance = group.invitations.find((invitation) => invitation.invitationType === 'match_attendance') || null
        const volunteerOffers = group.invitations.filter((invitation) => invitation.invitationType === 'match_role')
        const otherInvitations = group.invitations.filter((invitation) => !['match_attendance', 'match_role'].includes(invitation.invitationType))
        const primary = matchAttendance || volunteerOffers[0] || otherInvitations[0]
        const isMatch = Boolean(matchAttendance || volunteerOffers.length)
        const presentation = getParentEventPresentation(primary)
        const kickoffTime = primary?.kickoffTime || primary?.eventStart || ''
        const resources = group.invitations.flatMap((invitation) => Array.isArray(invitation.resources) ? invitation.resources.map((resourceItem) => ({ invitation, resourceItem })) : [])
        return (
          <View key={group.eventKey} style={styles.inviteGroup}>
            <View style={styles.row}><Text style={[styles.eventLabel, { color: colors[presentation.tone] }]}>{isMatch ? 'Match & volunteer invite' : `${presentation.label} invite`}</Text><Text style={styles.meta}>{formatDateOnly(primary?.eventStart || primary?.eventDate)}</Text></View>
            <View style={styles.inviteHeader}>
              <ParentIcon color={colors[presentation.tone]} iconKey={presentation.iconKey} size={34} />
              <View style={styles.inviteHeaderCopy}><Text style={styles.cardTitle}>{group.eventTitle}</Text>{primary?.teamName ? <Text style={styles.meta}>{primary.teamName}</Text> : null}</View>
            </View>
            <View style={styles.inviteMetadata}>
              {isMatch ? <View style={styles.inviteMetadataItem}><ParentIcon color={colors.accent} iconKey="shirt" size={20} /><Text style={styles.meta}>{getMatchDayShirtChoiceLabel(primary?.shirtChoice)}</Text></View> : null}
              {isMatch && primary?.arrivalTime ? <View style={styles.inviteMetadataItem}><ParentIcon color={colors.danger} iconKey="time.arrival" size={20} /><Text style={styles.meta}>Arrive {formatParentProductTime(primary.arrivalTime)}</Text></View> : null}
              {isMatch ? <View style={styles.inviteMetadataItem}><ParentIcon color={colors.success} iconKey="time.kickoff" size={20} /><Text style={styles.meta}>Kick-off {primary?.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(kickoffTime)}</Text></View> : primary?.eventStart ? <View style={styles.inviteMetadataItem}><ParentIcon color={colors.accent} iconKey="time.arrival" size={20} /><Text style={styles.meta}>{formatParentProductTime(primary.eventStart)}</Text></View> : null}
            </View>
            {matchAttendance ? <InvitationResponseControl activeActionId={activeActionId} colors={colors} invitation={matchAttendance} isOffline={isOffline} label="Attendance" onRespond={respond} styles={styles} /> : null}
            {volunteerOffers.length ? <View style={styles.inviteSectionHeader}><ParentIcon color={colors.warning} iconKey="invite" size={20} /><Text style={[styles.inviteSectionTitle, styles.inviteSectionCopy]}>Volunteer roles</Text><IconAction accessibilityLabel="About Volunteer offers" colors={colors} iconKey="info-outline" onPress={() => setVolunteerHelpOpen((open) => !open)} styles={styles} /></View> : null}
            {volunteerHelpOpen ? <Text style={styles.helper}>This is a Parent or guardian volunteer role. It does not select your child for the squad.</Text> : null}
            {volunteerOffers.map((invitation) => <InvitationResponseControl activeActionId={activeActionId} colors={colors} invitation={invitation} isOffline={isOffline} key={invitation.invitationId} label={getParentVolunteerRoleLabel(invitation)} onRespond={respond} styles={styles} />)}
            {otherInvitations.map((invitation) => <InvitationResponseControl activeActionId={activeActionId} colors={colors} invitation={invitation} isOffline={isOffline} key={invitation.invitationId} label={invitation.invitationType === 'training_attendance' ? 'Training attendance' : 'Attendance'} onRespond={respond} styles={styles} />)}
            {resources.length ? (
              <View style={styles.inviteSection}>
                {resources.map(({ invitation, resourceItem }) => <Pressable accessibilityLabel={`Open ${resourceItem.title}`} accessibilityRole="button" disabled={isOffline || Boolean(activeActionId)} key={`${resourceItem.id}:${resourceItem.occurrenceDate}:${invitation.invitationId}`} onPress={() => onOpenResource?.(invitation, resourceItem)} style={styles.inviteSectionHeader}><ParentIcon color={colors.accent} iconKey="resource" size={22} /><Text style={[styles.body, styles.inviteSectionCopy]}>{resourceItem.title}</Text><ParentIcon color={colors.accent} iconKey="action.open" size={21} /></Pressable>)}
              </View>
            ) : null}
            {primary?.eventLocation ? <View style={styles.inviteSection}><View style={styles.inviteSectionHeader}><ParentIcon color={colors.warning} iconKey="location" size={21} /><Text numberOfLines={2} style={[styles.meta, styles.inviteSectionCopy]}>{primary.eventLocation}</Text>{(primary.eventDate || primary.eventStart) ? <IconAction accessibilityLabel="Add invite to Google Calendar" colors={colors} disabled={Boolean(activeActionId)} iconKey="action.calendar" onPress={() => onAddToCalendar?.(primary)} styles={styles} /> : null}</View></View> : (primary?.eventDate || primary?.eventStart) ? <View style={styles.inviteSection}><View style={styles.row}><Text style={styles.meta}>Add this event to Google Calendar</Text><IconAction accessibilityLabel="Add invite to Google Calendar" colors={colors} disabled={Boolean(activeActionId)} iconKey="action.calendar" onPress={() => onAddToCalendar?.(primary)} styles={styles} /></View></View> : null}
            {matchAttendance ? <ParentCarpoolControl activeActionId={activeActionId} colors={colors} invitation={matchAttendance} isOffline={isOffline} onTransport={onTransport} styles={styles} /> : null}
          </View>
        )
      })}
    </View>
  )
}

function scoreVisible(match) {
  return ['extra_time', 'full_time', 'half_time', 'live', 'penalties', 'second_half'].includes(match.status)
}

function MatchCard({ colors, match, onOpen, styles }) {
  return (
    <View style={styles.card}>
      <Pressable accessibilityHint="Opens Match Day" accessibilityRole="button" onPress={() => onOpen(match)} style={styles.compactRow}>
        <ParentIcon color={colors.text} iconKey="football" size={34} />
        <View style={styles.compactCopy}><View style={styles.row}><Text style={styles.pill}>{getParentMatchStatusLabel(match)}</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View><Text style={styles.cardTitle}>{getMatchDayDisplayName(match)}</Text><Text style={styles.meta}>{match.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(match.kickoffTime)} | {getMatchDayShirtChoiceLabel(match.shirtChoice)}</Text></View>
        {scoreVisible(match) ? <Text style={styles.score}>{match.homeScore} - {match.awayScore}</Text> : <ParentIcon color={colors.accent} iconKey="action.open" size={22} />}
      </Pressable>
      {match.arrivalTime ? <Text style={styles.meta}>Arrive {formatParentProductTime(match.arrivalTime)}</Text> : null}
    </View>
  )
}

function GoalPlayerPicker({ allowClear = false, disabled, label, onSelect, onSelectOther, otherSelected = false, players, styles, value }) {
  const [open, setOpen] = useState(false)
  const selected = players.find((player) => player.playerName === value) || null
  return (
    <View style={styles.stack}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Button
        disabled={disabled}
        expanded={open}
        label={otherSelected ? (value || 'Other assist') : selected ? `${selected.playerName}${selected.shirtNumber ? ` | Shirt ${selected.shirtNumber}` : ''}` : `Choose ${label.toLowerCase()}`}
        onPress={() => setOpen((current) => !current)}
        outline
        styles={styles}
      />
      {open ? (
        <View style={styles.card}>
          {allowClear ? <Button label="No assist" onPress={() => { onSelect(null); setOpen(false) }} outline styles={styles} /> : null}
          {onSelectOther ? <Button label="Other assist" onPress={() => { onSelectOther(); setOpen(false) }} outline={!otherSelected} selected={otherSelected} styles={styles} /> : null}
          {players.map((player) => (
            <Button
              key={player.id || `${player.playerName}:${player.shirtNumber}`}
              label={`${player.playerName}${player.shirtNumber ? ` | Shirt ${player.shirtNumber}` : ''}`}
              onPress={() => { onSelect(player); setOpen(false) }}
              selected={!otherSelected && selected?.id === player.id}
              styles={styles}
            />
          ))}
          {players.length === 0 ? <Text style={styles.helper}>No selected squad Players are available yet.</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

function getGoalDetailsError(side, scorerName, minute, isOwnGoal = false, stoppageMinute = '') {
  if ((isOwnGoal ? side === 'opponent' : side === 'club') && !normalizeText(scorerName).replace(/^Other:\s*/i, '').trim()) return 'Choose a scorer or enter their name under Other.'
  if (normalizeText(minute) && (!Number.isInteger(Number(minute)) || Number(minute) < 0)) return 'Enter a whole match minute of 0 or more.'
  if (normalizeText(stoppageMinute) && (!Number.isInteger(Number(stoppageMinute)) || Number(stoppageMinute) < 0 || Number(stoppageMinute) > 30)) return 'Enter added time from 0 to 30 minutes.'
  return ''
}

function GoalForm({ disabled, initialMinute = '', initialStoppageMinute = '', onAdd, placeholderColor, players = [], styles }) {
  const [side, setSide] = useState('club')
  const [scorerParticipantType, setScorerParticipantType] = useState('player')
  const [scorerName, setScorerName] = useState('')
  const [scorerShirtNumber, setScorerShirtNumber] = useState('')
  const [assistName, setAssistName] = useState('')
  const [assistShirtNumber, setAssistShirtNumber] = useState('')
  const [assistParticipantType, setAssistParticipantType] = useState('player')
  const [isPenaltyGoal, setIsPenaltyGoal] = useState(false)
  const [isOwnGoal, setIsOwnGoal] = useState(false)
  const [stoppageMinute, setStoppageMinute] = useState(String(initialStoppageMinute ?? ''))
  const [notes, setNotes] = useState('')
  const [minute, setMinute] = useState(String(initialMinute ?? ''))
  const [validationError, setValidationError] = useState('')
  function selectSide(nextSide) {
    if (side === nextSide) return
    setSide(nextSide)
    setScorerParticipantType('player')
    setScorerName('')
    setScorerShirtNumber('')
    setAssistParticipantType('player')
    setAssistName('')
    setAssistShirtNumber('')
    setValidationError('')
  }
  function recordGoal() {
    const error = getGoalDetailsError(side, scorerName, minute, isOwnGoal, stoppageMinute)
      || (!isOwnGoal && side === 'club' && assistParticipantType === 'other' && !normalizeText(assistName) ? 'Enter the assist name, or choose No assist.' : '')
    setValidationError(error)
    if (error) return
    onAdd({ assistName: isOwnGoal ? '' : normalizeText(assistName), assistShirtNumber: isOwnGoal ? '' : assistShirtNumber, isOwnGoal, isPenaltyGoal, minute, stoppageMinute, notes, scorerName: scorerParticipantType === 'other' ? `Other: ${normalizeText(scorerName)}` : normalizeText(scorerName), scorerShirtNumber: scorerParticipantType === 'player' ? scorerShirtNumber : '', teamSide: side })
  }
  return (
    <View style={styles.section}>
      <Text style={styles.fieldLabel}>Goal awarded to</Text>
      <View style={styles.actionRow}>
        <Button disabled={disabled} label="Our team" onPress={() => selectSide('club')} outline={side !== 'club'} styles={styles} />
        <Button disabled={disabled} label="Opponent" onPress={() => selectSide('opponent')} outline={side !== 'opponent'} styles={styles} />
      </View>
      <View style={styles.row}><Text style={styles.cardTitle}>Own goal</Text><Switch accessibilityLabel="Own goal" disabled={disabled} onValueChange={(value) => { if (value !== isOwnGoal) setSide(oppositeMatchSide(side)); setIsOwnGoal(value); setIsPenaltyGoal(false); setAssistName(''); setAssistShirtNumber(''); setValidationError('') }} value={isOwnGoal} /></View>
      {isOwnGoal ? <Text style={styles.helper}>{side === 'club' ? 'An opponent scored into their own goal. The goal counts for our team.' : 'One of our players scored into our goal. The goal counts for the opponent.'}</Text> : null}
      {(isOwnGoal ? side === 'opponent' : side === 'club') ? <>
        <Text style={styles.fieldLabel}>Scorer type</Text>
        <View style={styles.actionRow}>
          {[['player', 'Player'], ['other', 'Other']].map(([value, label]) => <Button disabled={disabled} key={value} label={label} onPress={() => { if (scorerParticipantType === value) return; setScorerParticipantType(value); setScorerName(''); setScorerShirtNumber(''); setValidationError('') }} outline={scorerParticipantType !== value} selected={scorerParticipantType === value} styles={styles} />)}
        </View>
        {scorerParticipantType === 'player'
          ? <GoalPlayerPicker disabled={disabled} label="Scorer" onSelect={(player) => { setScorerName(player?.playerName || ''); setScorerShirtNumber(player?.shirtNumber || '') }} players={players} styles={styles} value={scorerName} />
          : <TextInput accessibilityLabel={'Other participant name'} editable={!disabled} onChangeText={setScorerName} placeholder={'Other participant name'} placeholderTextColor={placeholderColor} style={styles.field} value={scorerName} />}
        {!isOwnGoal ? <GoalPlayerPicker allowClear disabled={disabled} label="Assist" onSelect={(player) => { setAssistParticipantType('player'); setAssistName(player?.playerName || ''); setAssistShirtNumber(player?.shirtNumber || '') }} onSelectOther={() => { if (assistParticipantType === 'other') return; setAssistParticipantType('other'); setAssistName(''); setAssistShirtNumber('') }} otherSelected={assistParticipantType === 'other'} players={players.filter((player) => player.playerName !== scorerName)} styles={styles} value={assistName} /> : null}
        {!isOwnGoal && assistParticipantType === 'other' ? <TextInput accessibilityLabel="Other assist name" editable={!disabled} onChangeText={setAssistName} placeholder="Other assist name" placeholderTextColor={placeholderColor} style={styles.field} value={assistName} /> : null}
      </> : <>
        <TextInput accessibilityLabel="Opponent goal scorer name" editable={!disabled} onChangeText={setScorerName} placeholder="Opponent scorer, optional" placeholderTextColor={placeholderColor} style={styles.field} value={scorerName} />
        {!isOwnGoal ? <TextInput accessibilityLabel="Opponent assist name" editable={!disabled} onChangeText={setAssistName} placeholder="Opponent assist, optional" placeholderTextColor={placeholderColor} style={styles.field} value={assistName} /> : null}
      </>}
      <TextInput accessibilityLabel="Goal minute" editable={!disabled} keyboardType="number-pad" onChangeText={setMinute} placeholder="Match minute" placeholderTextColor={placeholderColor} style={styles.field} value={minute} />
      <Text style={styles.fieldLabel}>Added time, optional</Text><TextInput accessibilityLabel="Goal added time" editable={!disabled} keyboardType="number-pad" onChangeText={setStoppageMinute} placeholder="Added minutes" placeholderTextColor={placeholderColor} style={styles.field} value={stoppageMinute} />
      <View style={styles.row}><Text style={styles.cardTitle}>Penalty</Text><Switch accessibilityLabel="Penalty goal" disabled={disabled || isOwnGoal} onValueChange={setIsPenaltyGoal} value={isPenaltyGoal} /></View>
      <TextInput accessibilityLabel="Goal notes" editable={!disabled} multiline onChangeText={setNotes} placeholder="Notes, optional" placeholderTextColor={placeholderColor} style={[styles.field, { minHeight: 88, textAlignVertical: 'top' }]} value={notes} />
      {validationError ? <Text accessibilityRole="alert" style={styles.error}>{validationError}</Text> : null}
      <Button disabled={disabled} label={disabled ? 'Saving...' : 'Record goal'} onPress={recordGoal} styles={styles} />
    </View>
  )
}

function ScorerEventForm({ disabled, capture, onAdd, players, styles, placeholderColor }) {
  const [draft, setDraft] = useState(() => ({ eventType: capture.kind, teamSide: 'club', minute: String(capture.capturedMinute ?? 0), stoppageMinute: String(capture.capturedStoppageMinute ?? ''), playerName: '', playerShirtNumber: '', playerOnName: '', playerOnShirtNumber: '', notes: '', requestId: Crypto.randomUUID() }))
  const [error, setError] = useState('')
  const update = (change) => { setDraft((prior) => ({ ...prior, ...change })); setError('') }
  const participant = (prefix, label) => draft.teamSide === 'club'
    ? <GoalPlayerPicker disabled={disabled} label={label} onSelect={(player) => update({ [`${prefix}Name`]: player?.playerName || '', [`${prefix}ShirtNumber`]: player?.shirtNumber || '' })} players={prefix === 'playerOn' ? players.filter((player) => player.playerName !== draft.playerName || String(player.shirtNumber || '') !== String(draft.playerShirtNumber || '')) : players} styles={styles} value={draft[`${prefix}Name`]} />
    : <TextInput accessibilityLabel={label} editable={!disabled} maxLength={80} onChangeText={(value) => update({ [`${prefix}Name`]: value })} placeholder={`${label}, optional`} placeholderTextColor={placeholderColor} style={styles.field} value={draft[`${prefix}Name`]} />
  return <View style={styles.section}>
    <Text style={styles.helper}>The match time was captured when you pressed the action.</Text>
    <View style={styles.actionRow}>{[['club', 'Our team'], ['opponent', 'Opponent']].map(([side, label]) => <Button key={side} disabled={disabled} label={label} selected={draft.teamSide === side} outline={draft.teamSide !== side} styles={styles} onPress={() => { if (side !== draft.teamSide) update({ teamSide: side, playerName: '', playerShirtNumber: '', playerOnName: '', playerOnShirtNumber: '' }) }} />)}</View>
    {participant('player', draft.eventType === 'substitution' ? 'Player off' : 'Player')}
    {draft.eventType === 'substitution' ? participant('playerOn', 'Player on') : null}
    <TextInput accessibilityLabel="Event minute" editable={!disabled} keyboardType="number-pad" onChangeText={(minute) => update({ minute })} placeholder="Match minute" placeholderTextColor={placeholderColor} style={styles.field} value={draft.minute} />
    <TextInput accessibilityLabel="Event added minutes" editable={!disabled} keyboardType="number-pad" onChangeText={(stoppageMinute) => update({ stoppageMinute })} placeholder="Added minutes, optional" placeholderTextColor={placeholderColor} style={styles.field} value={draft.stoppageMinute} />
    <TextInput accessibilityLabel="Event notes" editable={!disabled} maxLength={500} multiline onChangeText={(notes) => update({ notes })} placeholder="Notes, optional" placeholderTextColor={placeholderColor} style={styles.field} value={draft.notes} />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button disabled={disabled} label={`Record ${SCORER_EVENT_LABELS[draft.eventType].toLowerCase()}`} onPress={() => { try { onAdd(validateScorerMatchEvent(draft)) } catch (failure) { setError(failure.message) } }} styles={styles} />
  </View>
}

function GoalCorrectionForm({ disabled, events, match, onCorrect, placeholderColor, styles }) {
  const activeGoals = (events || []).filter((event) => event.eventType === 'goal' && !event.voidedAt)
  const [eventId, setEventId] = useState('')
  const selected = activeGoals.find((event) => event.id === eventId) || null
  const [side, setSide] = useState('club')
  const [scorerName, setScorerName] = useState('')
  const [minute, setMinute] = useState('')
  const [reason, setReason] = useState('')
  const [isOwnGoal, setIsOwnGoal] = useState(false)
  const [stoppageMinute, setStoppageMinute] = useState('')
  const [validationError, setValidationError] = useState('')
  function correctGoal() {
    const error = getGoalDetailsError(side, scorerName, minute, isOwnGoal, stoppageMinute)
    setValidationError(error)
    if (error) return
    onCorrect({ event: selected, goal: { minute, stoppageMinute, isOwnGoal, scorerName: normalizeText(scorerName), teamSide: side }, reason: normalizeText(reason) || 'Goal details corrected by parent scorer' })
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Correct a goal</Text>
      <Text style={styles.helper}>Choose a goal and update its details. To remove a goal, ask a coach.</Text>
      {activeGoals.length === 0 ? <Text style={styles.helper}>No active goal events are available.</Text> : null}
      <View style={styles.actionRow}>
        {activeGoals.map((event) => <Button disabled={disabled} key={event.id} label={`${event.minute == null ? '' : `${event.minute}' `}${event.scorerName || labelize(event.teamSide) || 'Goal'}`} onPress={() => { if (eventId === event.id) return; setEventId(event.id); setSide(event.teamSide); setScorerName(event.scorerName || ''); const time = getMatchEventTime(match, event.minute, event.matchPhase, event.stoppageMinute); setMinute(time.minute == null ? '' : String(time.minute)); setStoppageMinute(time.stoppageMinute == null ? '' : String(time.stoppageMinute)); setIsOwnGoal(event.isOwnGoal === true); setReason(''); setValidationError('') }} outline={eventId !== event.id} styles={styles} />)}
      </View>
      {selected ? (
        <>
          <Text style={styles.fieldLabel}>Goal awarded to</Text><View style={styles.actionRow}><Button disabled={disabled} label="Our team" onPress={() => setSide('club')} outline={side !== 'club'} selected={side === 'club'} styles={styles} /><Button disabled={disabled} label="Opponent" onPress={() => setSide('opponent')} outline={side !== 'opponent'} selected={side === 'opponent'} styles={styles} /></View>
          <Text style={styles.fieldLabel}>Scorer name</Text>
          <TextInput accessibilityLabel="Corrected scorer name" editable={!disabled} onChangeText={setScorerName} placeholder="Scorer name" placeholderTextColor={placeholderColor} style={styles.field} value={scorerName} />
          <Text style={styles.fieldLabel}>Match minute</Text>
          <TextInput accessibilityLabel="Corrected goal minute" editable={!disabled} keyboardType="number-pad" onChangeText={setMinute} placeholder="Minute" placeholderTextColor={placeholderColor} style={styles.field} value={minute} />
          <View style={styles.row}><Text style={styles.cardTitle}>Own goal</Text><Switch accessibilityLabel="Corrected goal is an own goal" disabled={disabled} onValueChange={(value) => { if (value !== isOwnGoal) setSide(oppositeMatchSide(side)); setIsOwnGoal(value) }} value={isOwnGoal} /></View>
          <TextInput accessibilityLabel="Corrected goal added time" editable={!disabled} keyboardType="number-pad" onChangeText={setStoppageMinute} placeholder="Added time, optional" placeholderTextColor={placeholderColor} style={styles.field} value={stoppageMinute} />
          <TextInput accessibilityLabel="Goal correction reason" editable={!disabled} onChangeText={setReason} placeholder="Reason, optional" placeholderTextColor={placeholderColor} style={styles.field} value={reason} />
          {validationError ? <Text accessibilityRole="alert" style={styles.error}>{validationError}</Text> : null}
          <View style={styles.actionRow}>
            <Button disabled={disabled} label="Save goal correction" onPress={correctGoal} styles={styles} />
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
  const [scoreReason, setScoreReason] = useState('')
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
      setScoreReason('')
      setHomeScore(String(match.homeScore || 0))
      setAwayScore(String(match.awayScore || 0))
    }
    const capture = captureParentScorerAction(match, kind, Date.now())
    setActionSheet({ ...capture, kind, title })
  }
  const runTimerAction = (action) => {
    if (action === 'start') return onAction('start')
    if (['complete_extra_time', 'extra_time_half_time', 'normal_time_complete', 'start_extra_time', 'start_extra_time_second_half', 'start_penalties'].includes(action)) return onAction('extended', action)
    return onAction('timer', action)
  }
  const submitAndClose = async (action, value) => {
    const saved = await onAction(action, value)
    if (saved !== false && saved?.saved !== false) {
      setActionError('')
      setActionSheet(null)
    } else {
      setActionError(saved?.message || 'This change was not saved. Please try again.')
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
        <Text style={styles.cardTitle}>Match scoring</Text>
        <Text style={styles.gameDayScore}>{formatMatchAddedTimeClock(match)}</Text>
        <Text style={styles.helper}>{getMatchClockDescription(match)}</Text>
        <Text style={styles.helper}>Use one action at a time. Goal details open separately so the main match screen stays clear.</Text>
        {isOffline ? <Text style={styles.warning}>Controls are unavailable offline. Connect before changing the clock, score or events.</Text> : null}
        <View style={styles.card}><View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Keep screen awake</Text><Text style={styles.meta}>{keepAwakeAvailable ? 'Optional for this live controller session. No match data is changed.' : 'Unavailable on this device.'}</Text></View><Switch accessibilityLabel="Keep screen awake" disabled={!keepAwakeAvailable} onValueChange={toggleKeepAwake} value={keepAwake} /></View></View>
        <View style={styles.actionGrid}>
          {canRecordEvents ? <View style={styles.actionGridItem}><Button disabled={disabled} label="Goal" onPress={() => openAction('goal', 'Add goal')} styles={styles} /></View> : null}
          {canRecordEvents ? Object.entries(SCORER_EVENT_LABELS).map(([kind, label]) => <View key={kind} style={styles.actionGridItem}><Button disabled={disabled} label={label} onPress={() => openAction(kind, label)} outline styles={styles} /></View>) : null}
          {timerActions.map((item) => <View key={item.action} style={styles.actionGridItem}><Button danger={['conclude', 'full_time'].includes(item.action)} disabled={disabled} label={item.label} onPress={() => { void runTimerAction(item.action) }} outline={!['conclude', 'full_time'].includes(item.action)} styles={styles} /></View>)}
          <View style={styles.actionGridItem}><Button disabled={disabled || !canRecordEvents} label="Correct score" onPress={() => openAction('score', 'Correct score')} outline styles={styles} /></View>
          {activeGoals.length ? <View style={styles.actionGridItem}><Button disabled={disabled} label="Correct goal" onPress={() => openAction('correct-goal', 'Correct or remove a goal')} outline styles={styles} /></View> : null}
          {match.currentMatchPhase === 'penalties' ? <View style={styles.actionGridItem}><Button disabled={disabled} label="Penalty shootout" onPress={() => openAction('shootout', 'Penalty shootout')} outline styles={styles} /></View> : null}
        </View>
        {busy ? <Text accessibilityLiveRegion="polite" style={styles.helper}>Saving Game Day change...</Text> : null}
      </View>
      {actionSheet?.kind === 'goal' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Add goal"><Text style={styles.body}>The match time was captured when you pressed Goal. Add the details without rushing.</Text>{actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}<GoalForm disabled={disabled} initialMinute={actionSheet.capturedMinute} initialStoppageMinute={actionSheet.capturedStoppageMinute} onAdd={(goal) => submitAndClose('goal', goal)} placeholderColor={placeholderColor} players={players} styles={styles} /></ParentMatchDayActionSheet> : null}
      {actionSheet && SCORER_EVENT_LABELS[actionSheet.kind] ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title={actionSheet.title}>{actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}<ScorerEventForm disabled={disabled} capture={actionSheet} onAdd={(event) => submitAndClose('event', event)} players={players} styles={styles} placeholderColor={placeholderColor} /></ParentMatchDayActionSheet> : null}
      {actionSheet?.kind === 'score' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Correct score"><Text style={styles.body}>Use this only when the displayed score is wrong. The correction remains in the Match Day history.</Text><View style={styles.actionRow}><TextInput accessibilityLabel="Home score" editable={!disabled} keyboardType="number-pad" onChangeText={setHomeScore} style={[styles.field, { flex: 1, minWidth: 96 }]} value={homeScore} /><TextInput accessibilityLabel="Away score" editable={!disabled} keyboardType="number-pad" onChangeText={setAwayScore} style={[styles.field, { flex: 1, minWidth: 96 }]} value={awayScore} /></View><Text style={styles.fieldLabel}>Reason, optional</Text><TextInput accessibilityLabel="Score correction reason" editable={!disabled} maxLength={240} multiline onChangeText={setScoreReason} placeholder="Why are you correcting the score?" placeholderTextColor={placeholderColor} style={[styles.field, { minHeight: 88, textAlignVertical: 'top' }]} value={scoreReason} /><Button disabled={disabled} label={busy ? 'Saving...' : 'Save score correction'} onPress={() => submitAndClose('score', { awayScore, homeScore, reason: scoreReason })} styles={styles} /></ParentMatchDayActionSheet> : null}
      {actionSheet?.kind === 'correct-goal' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Correct a goal">{actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}<GoalCorrectionForm disabled={disabled} events={match.events} match={match} onCorrect={(value) => submitAndClose('correct-goal', value)} placeholderColor={placeholderColor} styles={styles} /></ParentMatchDayActionSheet> : null}
      {actionSheet?.kind === 'shootout' ? <ParentMatchDayActionSheet busy={busy} capturedClock={actionSheet.capturedClock} onClose={() => setActionSheet(null)} styles={styles} title="Penalty shootout"><ShootoutControls disabled={disabled} match={match} onRecord={(value) => submitAndClose('shootout', value)} onVoid={(value) => submitAndClose('void-shootout', value)} placeholderColor={placeholderColor} styles={styles} /></ParentMatchDayActionSheet> : null}
    </View>
  )
}

export function MatchdayScreen({ activeActionId, invitations = [], isOffline, link, onAddToCalendar, onBack, onDismiss, onLiveRefresh, onOpen, onOpenLink, onScorerAction, onVolunteer, players = [], resource, selectedMatch, themeTokens }) {
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
    const scorerInvitation = getParentScorerInterestInvitation(selectedMatch, invitations, new Date(now))
    const timeline = getParentMatchTimeline(selectedMatch)
    const confirmedPlayerNames = new Set(selectedMatch.confirmedTeam || [])
    const scorerPlayers = players.filter((player) => confirmedPlayerNames.has(player.playerName))
    return (
      <View style={styles.stack}>
        <Button label="Back to Matchday" onPress={onBack} outline styles={styles} />
        {selectedMatch.isScorer ? <ScorerControls activeActionId={activeActionId} isOffline={isOffline} match={selectedMatch} onAction={(action, value) => onScorerAction(selectedMatch, action, value)} placeholderColor={colors.muted} players={scorerPlayers} styles={styles} /> : null}
        <View style={[styles.gameDayHero, selectedMatchIsLive && styles.gameDayHeroLive]}>
          <View style={styles.actionRow}>
            <Text style={styles.pill}>{getParentMatchStatusLabel(selectedMatch)}</Text>
            <Text style={styles.pill}>{presentation?.phaseLabel || 'Pre-match'}</Text>
            {selectedMatch.homeAway ? <Text style={styles.pill}>{labelize(selectedMatch.homeAway)}</Text> : null}
            <Text style={styles.pill}>{getMatchDayShirtChoiceLabel(selectedMatch.shirtChoice)}</Text>
            {selectedMatch.fixtureType ? <Text style={styles.pill}>{labelize(selectedMatch.fixtureType)}</Text> : null}
          </View>
          <Text accessibilityRole="header" style={styles.header}>{presentation?.displayName || getMatchDayDisplayName(selectedMatch)}</Text>
          <Text style={styles.body}>{formatDateOnly(selectedMatch.matchDate)}</Text>
          {selectedMatch.arrivalTime ? <Text style={styles.body}>Arrival: {formatParentProductTime(selectedMatch.arrivalTime)}</Text> : null}
          <Text style={styles.body}>Kick-off: {selectedMatch.kickoffTimeTbc ? 'Time TBC' : formatParentProductTime(selectedMatch.kickoffTime)}</Text>
          <Text style={styles.body}>{[selectedMatch.venueName, selectedMatch.venueAddress].filter(Boolean).join(', ') || 'Location not shared'}</Text>
          <Text style={styles.liveSync}>{selectedMatchIsLive ? 'Live sync on' : 'Fixture details'}</Text>
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>Score</Text>
            <Text accessibilityLiveRegion="polite" style={styles.gameDayScore}>{presentation?.displayScore || `${selectedMatch.homeScore || 0} - ${selectedMatch.awayScore || 0}`}</Text>
            <View style={styles.gameDayStats}>
              <View style={styles.gameDayStat}><Text style={styles.gameDayStatLabel}>Match timer</Text><Text accessibilityLiveRegion="polite" style={styles.gameDayStatValue}>{formatMatchAddedTimeClock(selectedMatch, now)}</Text></View>
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
            {selectedMatch.matchDate ? <Button label="Add to Google Calendar" onPress={() => onAddToCalendar?.(selectedMatch)} outline styles={styles} /> : null}
            {getParentMatchDirectionsUrl(selectedMatch, Platform.OS) ? <Button label="Get directions" onPress={() => onOpenLink?.(getParentMatchDirectionsUrl(selectedMatch, Platform.OS), 'directions')} outline styles={styles} /> : null}
          </View>
        </View>
        {squadOpenMatchId === selectedMatch.id ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selected squad</Text>
            <Text style={styles.helper}>Players selected by the coach for this match.</Text>
            {selectedMatch.confirmedTeam?.length
              ? selectedMatch.confirmedTeam.map((playerName, index) => <Text key={`${playerName}-${index}`} style={styles.body}>{playerName}</Text>)
              : <Text style={styles.body}>No players have been selected yet.</Text>}
          </View>
        ) : null}
        {scorerInvitation ? (
          <View style={styles.card}><Text style={styles.cardTitle}>Volunteer scorer</Text><Text style={styles.body}>{selectedMatch.scorerRequestMessage || 'Coaches are looking for a Parent scorer.'}</Text><Button disabled={isOffline || Boolean(activeActionId)} label={activeActionId === `invite:${scorerInvitation.invitationId}` ? 'Saving...' : 'Register interest'} onPress={() => onVolunteer(scorerInvitation, 'yes')} styles={styles} /></View>
        ) : null}
        {!selectedMatch.isScorer ? <View style={styles.card}><Text style={styles.cardTitle}>Parent view</Text><Text style={styles.body}>Live match updates from the club appear here. Only the assigned scorer can make Game Day changes.</Text></View> : null}

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
      {getParentScorerMatches(resource.items).map((match) => <View key={`scoring:${match.id}`} style={styles.section}><Text style={styles.cardTitle}>{getMatchDayDisplayName(match)}</Text><Button label={getParentScorerActionLabel(match)} onPress={() => onOpen(match)} styles={styles} /></View>)}
      <View style={styles.actionRow}><Button label={`Coming up (${matchGroups.upcoming.length})`} onPress={() => setMatchSection('upcoming')} outline={matchSection !== 'upcoming'} styles={styles} /><Button label={`History (${matchGroups.recent.length})`} onPress={() => setMatchSection('recent')} outline={matchSection !== 'recent'} styles={styles} /></View>
      <ResourceState emptyCopy="There are no Parent-visible match cards for this child." {...resource} styles={styles} />
      {!resource.loading && resource.items.length > 0 && visibleMatches.length === 0 ? <Text style={styles.empty}>No matches are in this section.</Text> : null}
      {visibleMatches.map((match) => <MatchCard colors={colors} key={match.id} match={match} onDismiss={onDismiss} onOpen={onOpen} styles={styles} />)}
    </View>
  )
}

export function ResultsScreen({ link, resource, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const results = getParentMatchGroups(resource.items).recent.filter((match) => match.status === 'full_time')
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Results</Text><Text style={styles.helper}>Completed Parent-visible fixtures for {link?.playerName || 'your child'}.</Text></View>
      <ResourceState emptyCopy="There are no completed results for this child." error={resource.error} items={results} loading={resource.loading} styles={styles} />
      {results.map((match) => <ParentMatchReportCard colors={colors} key={match.id} match={match} styles={styles} />)}
    </View>
  )
}

function ParentMatchReportCard({ colors, match, styles }) {
  const [expanded, setExpanded] = useState(false)
  const report = useMemo(() => buildFinalMatchReportSummary(match), [match])
  const activeEvents = getParentMatchTimeline(match)
  return (
    <View style={styles.card}>
      <Pressable accessibilityLabel={expanded ? 'Hide match report' : 'View match report'} accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={styles.compactRow}><ParentIcon color={colors.text} iconKey="football" size={34} /><View style={styles.compactCopy}><View style={styles.row}><Text style={styles.pill}>Full time</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View><Text style={styles.cardTitle}>{getMatchDayDisplayName(match)}</Text></View><Text style={styles.score}>{report.result.finalScore}</Text><ParentIcon color={colors.accent} iconKey={expanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'} size={22} /></Pressable>
      {report.result.shootoutScore ? <Text style={styles.meta}>Shootout: {report.result.shootoutScore}{report.result.shootoutWinner ? ` | ${report.result.shootoutWinner} won` : ''}</Text> : null}
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
            return <View key={event.id} style={styles.section}><View style={styles.row}><Text style={styles.body}>{presentation.minuteLabel} | {presentation.title}</Text><Text style={styles.meta}>{presentation.scoreLabel}</Text></View>{!event.timelineBoundary ? <Text style={styles.meta}>{presentation.team.name}{presentation.detail ? ` | ${presentation.detail}` : ''}</Text> : null}</View>
          })}
        </View>
      ) : null}
    </View>
  )
}

export function DevelopmentScreen({ isOffline, onDismiss, onOpen, resource, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
  const [selectedReportId, setSelectedReportId] = useState('')
  const selectedReport = resource.items.find((report) => report.id === selectedReportId) || null

  if (selectedReport) {
    return (
      <View style={styles.stack}>
        <Button label="Back to Development" onPress={() => setSelectedReportId('')} outline styles={styles} />
        <View>
          <Text accessibilityRole="header" style={styles.header}>{selectedReport.form?.name || 'Development report'}</Text>
          <Text style={styles.helper}>{formatDate(selectedReport.recordDate || selectedReport.finalizedAt)} | {selectedReport.team?.name || 'Team'}{selectedReport.author?.name ? ` | ${selectedReport.author.name}` : ''}</Text>
        </View>
        {selectedReport.overallScore == null ? null : (
          <View style={styles.controllerCard}>
            <Text style={styles.fieldLabel}>Overall assessment</Text>
            <Text style={styles.score}>{selectedReport.overallScore} / {selectedReport.overallMaxScore || 10}</Text>
          </View>
        )}
        {(selectedReport.responseItems || []).map((item) => {
          const hasNumericScore = item.numericScore !== null &&
            item.numericScore !== undefined &&
            item.numericScore !== ''
          const score = Number(item.numericScore)
          const maximum = Number(item.maxScore || selectedReport.overallMaxScore || 10)
          const scorePercent = hasNumericScore && Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0
            ? `${Math.max(0, Math.min(100, score / maximum * 100))}%`
            : '0%'
          const isScore = hasNumericScore && Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0

          return isScore ? (
            <View key={item.fieldId || item.label} style={styles.developmentScoreCard}>
              <View style={styles.row}><Text style={styles.cardTitle}>{item.label}</Text><Text style={styles.developmentScoreNumber}>{score} / {maximum}</Text></View>
              <View style={styles.developmentScoreTrack}><View style={[styles.developmentScoreTrackFill, { width: scorePercent }]} /></View>
              {item.ratingLabel ? <Text style={styles.meta}>{item.ratingLabel}</Text> : null}
            </View>
          ) : (
            <View key={item.fieldId || item.label} style={styles.card}>
              <Text style={styles.cardTitle}>{item.label}</Text>
              <Text style={styles.body}>{item.displayValue}</Text>
            </View>
          )
        })}
        {(selectedReport.sections || []).map((section) => (
          <View key={section.key || section.title} style={styles.card}>
            <Text style={styles.cardTitle}>{section.title}</Text>
            {section.body ? <Text style={styles.body}>{section.body}</Text> : null}
          </View>
        ))}
        {!selectedReport.responseItems?.length && !selectedReport.sections?.length ? <Text style={styles.helper}>No detailed Development responses were shared with this report.</Text> : null}
        <Button disabled={isOffline || !selectedReport.canDownloadPdf} label={isOffline ? 'Share PDF when online' : 'Share PDF'} onPress={() => onOpen(selectedReport)} styles={styles} />
      </View>
    )
  }

  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Development</Text><Text style={styles.helper}>Development history previously shared with this Parent link.</Text></View>
      {isOffline ? <Text style={styles.warning}>Report details are saved for reading. Sharing a PDF needs a connection.</Text> : null}
      <ResourceState emptyCopy="No delivered Development reports are available for this child." {...resource} styles={styles} />
      {resource.items.map((report) => <View key={report.id} style={styles.card}><Pressable accessibilityLabel="View Development report" accessibilityRole="button" onPress={() => setSelectedReportId(report.id)} style={styles.compactRow}><ParentIcon color={colors.accent} iconKey="development" size={30} /><View style={styles.compactCopy}><View style={styles.row}><Text style={styles.pill}>{report.deliveryLabel || 'Shared'}</Text><Text style={styles.meta}>{formatDate(report.recordDate || report.finalizedAt)}</Text></View><Text style={styles.cardTitle}>{report.form?.name || 'Development report'}</Text>{report.overallScore == null ? null : <Text style={styles.meta}>Overall {report.overallScore} / {report.overallMaxScore || 10}</Text>}</View><ParentIcon color={colors.accent} iconKey="action.open" size={22} /></Pressable><View style={styles.row}><Text style={styles.meta}>Open report</Text><IconAction accessibilityLabel="Hide Development report" colors={colors} iconKey="action.hide" onPress={() => onDismiss(report)} styles={styles} /></View></View>)}
    </View>
  )
}

export function ResourcesScreen({ formationBoard, isOffline, onCloseFormation, onDismiss, onOpen, resource, themeTokens }) {
  const { colors, styles } = usePortalStyles(themeTokens)
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
      {resource.items.map((item) => <View key={item.id} style={styles.card}><Pressable accessibilityRole="button" accessibilityState={{ disabled: isOffline }} disabled={isOffline} onPress={() => onOpen(item)} style={styles.compactRow}><ParentIcon color={colors.accent} iconKey="resource" size={30} /><View style={styles.compactCopy}><Text style={styles.pill}>{labelize(item.category)}</Text><Text style={styles.cardTitle}>{item.title}</Text></View><ParentIcon color={colors.accent} iconKey="action.open" size={22} /></Pressable><View style={styles.row}><Text numberOfLines={1} style={[styles.meta, styles.inviteSectionCopy]}>{item.description || item.shareDescription || 'Shared resource'}</Text><IconAction accessibilityLabel="Hide resource" colors={colors} iconKey="action.hide" onPress={() => onDismiss(item)} styles={styles} /></View></View>)}
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
        {messages.loading ? <View style={{ alignItems: 'center', paddingVertical: 12 }}><BrandLoader accessibilityLabel="Loading messages" /><Text style={styles.helper}>Loading messages...</Text></View> : null}
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
            <Pressable accessibilityRole="button" onPress={() => onOpenRoom(room)} style={styles.compactRow}>
              <ParentIcon color={room.unreadCount ? colors.accent : colors.muted} iconKey="message" size={30} />
              <View style={styles.compactCopy}><View style={styles.row}><Text style={styles.pill}>{getParentChatRoomTypeLabel(room.type)}</Text>{room.unreadCount ? <Text style={styles.stat}>{room.unreadCount}</Text> : null}</View><Text style={styles.cardTitle}>{room.title}</Text>{getParentChatRoomContext(room) ? <Text numberOfLines={1} style={styles.meta}>{getParentChatRoomContext(room)}</Text> : null}<Text numberOfLines={1} style={styles.body}>{room.latestMessage || 'No messages yet'}</Text></View>
              <ParentIcon color={colors.accent} iconKey="action.open" size={22} />
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
  const { colors, styles } = usePortalStyles(themeTokens)
  const items = [
    ['updates', 'notifications', 'Notifications', 'Selection, scores and club news'],
    ['invites', 'invite', 'Invites', unansweredInvites ? `${unansweredInvites} to answer` : 'Attendance and roles'],
    ['results', 'result', 'Results', 'Completed fixtures'],
    ['development', 'development', 'Development', 'Shared reports'],
    ['resources', 'resource', 'Resources', 'Files and links'],
    ['polls', 'poll', 'Polls', unansweredPolls ? `${unansweredPolls} to answer` : 'Parent polls'],
    ['settings', 'settings', 'Settings', 'Account and alerts'],
  ]
  return <View style={styles.stack}><Text accessibilityRole="header" style={styles.header}>More</Text><View style={styles.moreGrid}>{items.map(([key, iconKey, title, copy]) => <Pressable accessibilityLabel={`${title}, ${copy}`} accessibilityRole="button" key={key} onPress={() => onOpen(key)} style={({ pressed }) => [styles.moreItem, pressed && { opacity: 0.72 }]}><ParentIcon color={colors.accent} iconKey={iconKey} size={31} /><Text style={styles.moreItemTitle}>{title}</Text><Text style={styles.moreItemCopy}>{copy}</Text></Pressable>)}</View></View>
}

export async function openExternalParentUrl(url) {
  const safeUrl = normalizeText(url)
  if (!safeUrl.startsWith('https://')) throw new Error('This item did not provide a secure access link.')
  const supported = await Linking.canOpenURL(safeUrl)
  if (!supported) throw new Error('No app is available to open this item.')
  await Linking.openURL(safeUrl)
}
