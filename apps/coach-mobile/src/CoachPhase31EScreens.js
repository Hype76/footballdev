import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { peekMobileResource, readMobileResource } from '../../mobile-core/src/mobileResourceCache'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Alert, AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  createCoachExternalResource,
  createCoachMatchAvailabilityRequests,
  createCoachPoll,
  deleteCoachPoll,
  finalizeCoachDevelopmentRecord,
  getCoachChatMessages,
  getCoachChatRooms,
  getCoachDevelopmentWorkspace,
  getCoachInvitesAndAvailability,
  getCoachMessages,
  getCoachPolls,
  getCoachResourceAccessUrl,
  getCoachResources,
  markCoachChatRead,
  previewCoachInviteRemoval,
  recordCoachInviteIntent,
  removeCoachInviteFromEvent,
  removeCoachResourceSharing,
  saveCoachDevelopmentDraft,
  sendCoachChatMessage,
  setCoachResourceSharing,
  setCoachPollStatus,
  setCoachInviteAvailabilityOnBehalf,
  subscribeToCoachChatRoom,
  submitCoachPollVote,
} from '../../mobile-core/src/coachPhase31EData'
import { getMobileChatMessagesFingerprint } from '../../mobile-core/src/mobileChatCore'
import {
  COACH_PHASE_31E_BACKEND_DELTAS,
  buildCoachChatRoomSections,
  canResendSelectedCoachInvites,
  collapseCoachInvitesByPlayer,
  getCoachInviteDeliveryLabel,
  getCoachInviteDeliveryProgress,
  getCoachInviteStatusLabel,
  getCoachChatModalTopInset,
  getCoachPlayersWithoutAvailabilityRequest,
  getSelectedCoachInvites,
  getCoachPhase31EOfflinePolicy,
  getCoachChatRoomDisplay,
  getCoachResourceErrorMessage,
  hasUsableCoachPhase31ECache,
  isCoachMatchAvailabilityRequestCreationApplied,
  isSyntheticCoachTarget,
  resolveCoachDevelopmentForm,
  sanitizeCoachChatOfflineValue,
  summarizeCoachInvites,
  summarizeCoachPoll,
  toggleCoachInvitePlayerSelection,
} from '../../mobile-core/src/coachPhase31ECore'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { getCoachPlayerList } from '../../mobile-core/src/coachPlayersData'
import { useConfirmedConnectionIssue, useConfirmedConnectionMessage } from '../../mobile-core/src/useConfirmedConnectionIssue'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'
import { getCoachFriendlyError } from './coachFriendlyErrors'
import { expiryDurationToIso } from '../../../src/lib/expiry-duration.js'
import { formatParentProductDateTime } from '../../mobile-core/src/parentDateTimeCore'

function formatCoachChatDateTime(value) {
  return formatParentProductDateTime(value, {
    fallback: 'Date not available',
    year: 'numeric',
  })
}

const config = getMobileRuntimeConfig('coach')

const LOADERS = {
  development: getCoachDevelopmentWorkspace,
  resources: getCoachResources,
  chat: getCoachChatRooms,
  messages: getCoachMessages,
  polls: getCoachPolls,
  invites: getCoachInvitesAndAvailability,
}

const TITLES = {
  development: 'Development', resources: 'Resources', chat: 'Chat', messages: 'Messages', polls: 'Polls', invites: 'Invites and availability',
}

function phaseStyles(palette) {
  return StyleSheet.create({
    stack: { gap: 12 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chatRoomCard: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 5, padding: 14 },
    chatRoomContext: { color: palette.textMuted, fontSize: 12, lineHeight: 17 },
    chatRoomSection: { gap: 8, paddingTop: 4 },
    chatRoomSectionHeader: { alignItems: 'baseline', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
    chatRoomSectionCount: { color: palette.textMuted, fontSize: 12, fontWeight: '800' },
    chatModal: { backgroundColor: palette.background, flex: 1 },
    chatModalHeader: { borderBottomColor: palette.border, borderBottomWidth: 1, gap: 5, paddingBottom: 14, paddingHorizontal: 14, paddingTop: 14 },
    chatMessageList: { flex: 1 },
    chatMessageListContent: { flexGrow: 1, gap: 8, justifyContent: 'flex-end', padding: 14 },
    chatComposer: { alignItems: 'flex-end', backgroundColor: palette.surface, borderTopColor: palette.border, borderTopWidth: 1, flexDirection: 'row', gap: 8, padding: 10 },
    chatComposerInput: { flex: 1, maxHeight: 110, minHeight: 48 },
    messageBubble: { alignSelf: 'flex-start', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 16, borderWidth: 1, gap: 4, maxWidth: '88%', padding: 11 },
    messageBubbleOwn: { alignSelf: 'flex-end', backgroundColor: palette.selected, borderColor: palette.accent },
    messageHeader: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
    messageTime: { color: palette.textMuted, fontSize: 11, lineHeight: 16 },
    confirmationScreen: { flex: 1, justifyContent: 'center', padding: 20 },
    confirmationBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.72)' },
    confirmationCard: { backgroundColor: palette.surfaceRaised, borderColor: palette.danger, borderRadius: 18, borderWidth: 1, gap: 12, padding: 18 },
    confirmationError: { color: palette.danger, fontSize: 14, fontWeight: '800', lineHeight: 20 },
    confirmationActions: { flexDirection: 'row', gap: 10 },
    confirmationAction: { flex: 1 },
    formChoice: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 64, paddingHorizontal: 14, paddingVertical: 10 },
    formChoiceSelected: { borderColor: palette.accent, borderWidth: 2 },
    formChoiceCopy: { flex: 1, gap: 3 },
    formChoiceAction: { color: palette.accent, fontSize: 13, fontWeight: '900' },
    panel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 8, padding: 14 },
    panelSelected: { borderColor: palette.accent, borderWidth: 2 },
    title: { color: palette.textPrimary, fontSize: 26, fontWeight: '900' },
    heading: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    helper: { color: palette.textSecondary, fontSize: 12, lineHeight: 17 },
    availabilityRow: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between', minHeight: 36, paddingHorizontal: 8, paddingVertical: 5 },
    availabilityPlayer: { flex: 1, gap: 2 },
    availabilityPlayerName: { alignItems: 'center', flexDirection: 'row', gap: 7 },
    carpoolNeed: { color: palette.danger },
    carpoolOffer: { color: palette.accent },
    availabilitySelected: { color: palette.accent, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
    availabilityStatus: { fontSize: 13, fontWeight: '900', textTransform: 'capitalize' },
    availabilityAvailable: { color: palette.success },
    availabilityUnavailable: { color: palette.danger },
    availabilityMaybe: { color: palette.warning },
    availabilityAwaiting: { color: palette.textMuted },
    availabilityDelivery: { color: palette.textMuted, fontSize: 11, lineHeight: 16, textAlign: 'right' },
    availabilityDeliveryActive: { color: palette.success },
    availabilityDeliveryItem: { color: palette.textMuted, fontSize: 10, fontWeight: '900' },
    availabilityDeliveryTicks: { flexDirection: 'row', gap: 7, justifyContent: 'flex-end', marginTop: 2 },
    label: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    status: { color: palette.accent, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 16, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
    primary: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    primaryText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    secondaryText: { color: palette.textPrimary, fontSize: 14, fontWeight: '800' },
    destructive: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.danger, borderRadius: 12, borderWidth: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    destructiveText: { color: palette.danger, fontSize: 14, fontWeight: '900' },
    danger: { color: palette.danger, fontSize: 14, fontWeight: '800' },
    disabled: { opacity: 0.48 },
    divider: { backgroundColor: palette.border, height: 1 },
  })
}

function availabilityStatusStyle(status, styles) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'available') return styles.availabilityAvailable
  if (normalized === 'unavailable') return styles.availabilityUnavailable
  if (normalized === 'maybe') return styles.availabilityMaybe
  return styles.availabilityAwaiting
}

function InviteDeliveryTicks({ invite, styles }) {
  const progress = getCoachInviteDeliveryProgress(invite)
  const label = `Sent ${progress.sent ? 'yes' : 'no'}, delivered ${progress.delivered ? 'yes' : 'no'}, seen ${progress.seen ? 'yes' : 'no'}`

  return <View accessibilityLabel={label} style={styles.availabilityDeliveryTicks}>
    {[
      ['Sent', progress.sent],
      ['Delivered', progress.delivered],
      ['Seen', progress.seen],
    ].map(([name, active]) => <Text key={name} style={[styles.availabilityDeliveryItem, active && styles.availabilityDeliveryActive]}>✓ {name}</Text>)}
  </View>
}

function InviteCarpoolIcon({ invite, styles }) {
  if (invite.kind !== 'match' || (!invite.transportNeedsLift && !invite.transportCanOfferLift)) return null
  const needsLift = invite.transportNeedsLift === true
  const label = needsLift
    ? 'Needs a lift'
    : `Offering ${Math.max(1, Number(invite.transportSeatsOffered) || 1)} carpool seat${Math.max(1, Number(invite.transportSeatsOffered) || 1) === 1 ? '' : 's'}`
  return <MaterialIcons accessibilityLabel={label} name="directions-car" size={20} style={needsLift ? styles.carpoolNeed : styles.carpoolOffer} />
}

function Button({ destructive = false, disabled = false, label, onPress, secondary = false, styles }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[destructive ? styles.destructive : secondary ? styles.secondary : styles.primary, disabled && styles.disabled]}>
      <Text style={destructive ? styles.destructiveText : secondary ? styles.secondaryText : styles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function Empty({ copy, styles }) {
  return <View style={styles.panel}><Text style={styles.body}>{copy}</Text></View>
}

export function CoachPhase31EScreen({ chatNotificationTarget, domain, context, onChatNotificationTargetHandled, onNavigate, palette, reloadHome, user }) {
  const styles = useMemo(() => phaseStyles(palette), [palette])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [stale, setStale] = useState(false)
  const confirmedStale = useConfirmedConnectionIssue(stale)
  const visibleError = useConfirmedConnectionMessage(error)
  const offlinePolicy = getCoachPhase31EOfflinePolicy(domain)

  const load = useCallback(async ({ silent = false, reuseFresh = false } = {}) => {
    const loader = LOADERS[domain]
    if (!loader) return
    const memoryKey = `coach:phase31e:${domain}`
    const recent = reuseFresh ? peekMobileResource(user, memoryKey) : undefined
    if (recent !== undefined) {
      setData(recent); setStale(false); setLoading(false); setError('')
      return
    }
    if (!silent) {
      setLoading(true)
      setError('')
      setNotice('')
      if (domain === 'chat') setData(null)
    }
    const cached = await readCoachOfflineResources(user.id, context).catch(() => null)
    const savedValue = cached?.resources?.[`phase31e:${domain}`]
    const cachedValue = domain === 'chat' ? sanitizeCoachChatOfflineValue(savedValue) : savedValue
    const hasCachedValue = offlinePolicy.cache && hasUsableCoachPhase31ECache(domain, savedValue, cachedValue)
    if (hasCachedValue) {
      setData(cachedValue)
      setStale(true)
      setLoading(false)
    }
    try {
      const next = await readMobileResource(user, memoryKey, () => loader(user), { force: !reuseFresh })
      setData(next)
      setStale(false)
      const offlineValue = domain === 'chat' ? sanitizeCoachChatOfflineValue(next) : next
      await saveCoachOfflineResources(user.id, context, { [`phase31e:${domain}`]: offlineValue })
    } catch (loadError) {
      if (!silent && !hasCachedValue) setError(getCoachFriendlyError(loadError, `${TITLES[domain]} could not be loaded.`))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [context, domain, offlinePolicy.cache, user])

  useEffect(() => { void load({ reuseFresh: true }) }, [load])

  useEffect(() => {
    if (domain !== 'polls') return undefined
    const refreshResults = () => void load({ silent: true })
    const interval = setInterval(refreshResults, 15000)
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshResults()
    })
    return () => {
      clearInterval(interval)
      subscription.remove()
    }
  }, [domain, load])

  const common = { chatNotificationTarget, data, load, notice, onChatNotificationTargetHandled, onNavigate, placeholderColor: palette.textSecondary, reloadHome, setNotice, stale, styles, user }
  return (
    <View style={styles.stack}>
      {domain !== 'chat' ? <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>{TITLES[domain]}</Text>
        <Text style={styles.body}>{context.teamName || context.clubName} | {context.roleLabel}</Text>
        {confirmedStale ? <Text accessibilityLabel="Offline stale data" style={styles.status}>Offline and read-only</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
      </View> : notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
      {loading ? <Empty copy={`Loading ${TITLES[domain]}...`} styles={styles} /> : null}
      {!loading && error && !visibleError ? <Empty copy="Checking for the latest information..." styles={styles} /> : null}
      {visibleError ? <View style={styles.panel}><Text accessibilityLiveRegion="assertive" style={styles.danger}>{visibleError}</Text><Button label="Try again" onPress={load} styles={styles} /></View> : null}
      {!loading && !error && domain === 'development' ? <DevelopmentDomain {...common} /> : null}
      {!loading && !error && domain === 'resources' ? <ResourcesDomain {...common} /> : null}
      {!loading && !error && domain === 'chat' ? <ChatDomain {...common} /> : null}
      {!loading && !error && domain === 'messages' ? <MessagesDomain {...common} /> : null}
      {!loading && !error && domain === 'polls' ? <PollsDomain {...common} /> : null}
      {!loading && !error && domain === 'invites' ? <InvitesDomain {...common} /> : null}
    </View>
  )
}

function DevelopmentDomain({ data, load, setNotice, stale, styles, user }) {
  const [playerId, setPlayerId] = useState(data.players?.[0]?.id || '')
  const [formId, setFormId] = useState(data.forms?.[0]?.id || '')
  const [values, setValues] = useState({})
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState(null)
  const player = data.players?.find((item) => item.id === playerId) || data.players?.[0]
  const activePlayerId = player?.id || ''
  const form = resolveCoachDevelopmentForm(data.forms, formId)
  const activeFormId = form?.id || ''
  const records = data.records?.filter((record) => !activePlayerId || record.playerId === activePlayerId) || []

  const selectDevelopmentForm = (nextForm) => {
    if (!nextForm?.id || nextForm.id === activeFormId) return
    setFormId(nextForm.id)
    setValues({})
    setNotes('')
    setDraft(null)
    setNotice(`${nextForm.name} selected. The form fields have been updated.`)
  }

  const saveDraft = async () => {
    try {
      const result = await saveCoachDevelopmentDraft(user, { draftId: draft?.id, form, player, values, clientSaveVersion: draft?.clientSaveVersion || 0 })
      setDraft(result)
      setNotice('Private Development draft saved with server version control.')
    } catch (error) { setNotice(getCoachFriendlyError(error)) }
  }
  const finalise = () => Alert.alert('Finalise and share this Development record?', 'The final record will be available to authorised linked Parents. It cannot be edited from this mobile workflow.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Finalise and share', onPress: async () => {
      try {
        const result = await finalizeCoachDevelopmentRecord(user, { draftId: draft?.id, form, player, values, notes, shareWithParent: true })
        setNotice(`Development record finalised and shared with ${result.sharedRecipientCount} authorised Parent${result.sharedRecipientCount === 1 ? '' : 's'}.`)
        setValues({})
        setNotes('')
        setDraft(null)
        await load()
      } catch (error) { setNotice(getCoachFriendlyError(error)) }
    } },
  ])

  if (!data.players?.length || !data.forms?.length) return <Empty copy="No active Player and dynamic Development form combination is available in this Team." styles={styles} />
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <Text style={styles.heading}>Player</Text>
        <View style={styles.row}>{data.players.map((item) => <Button key={item.id} label={item.playerName} onPress={() => setPlayerId(item.id)} secondary={item.id !== activePlayerId} styles={styles} />)}</View>
        <Text style={styles.heading}>Choose form</Text>
        <Text style={styles.body}>Choose one form. Its fields will appear immediately below.</Text>
        <View style={styles.stack}>{data.forms.map((item) => {
          const selected = item.id === activeFormId
          return (
            <Pressable
              accessibilityLabel={`${item.name}. ${selected ? 'Selected form' : 'Choose this form'}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={item.id}
              onPress={() => selectDevelopmentForm(item)}
              style={[styles.formChoice, selected && styles.formChoiceSelected]}
            >
              <View style={styles.formChoiceCopy}>
                <Text style={styles.label}>{item.name}</Text>
                <Text style={styles.body}>{selected ? 'Selected form' : `${item.fields.length} fields`}</Text>
              </View>
              <Text style={styles.formChoiceAction}>{selected ? 'Selected' : 'Choose'}</Text>
            </Pressable>
          )
        })}</View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>{form?.name}</Text>
        <Text style={styles.body}>{form?.ageGroup ? `Configured age group: ${form.ageGroup}.` : 'Uses the current canonical Team form configuration.'}</Text>
        {(form?.fields || []).filter((field) => Number(user.roleRank || 0) >= field.roleRank).map((field) => (
          <View key={field.id} style={styles.stack}>
            <Text style={styles.label}>{field.label}{field.required ? ' (required)' : ''}{field.staffPrivate ? ' | Coach private' : field.parentVisible ? ' | Parent-shareable' : ''}</Text>
            {field.type === 'boolean' || field.type === 'checkbox' ? (
              <Button label={values[field.id] ? 'Yes' : 'No'} onPress={() => setValues((current) => ({ ...current, [field.id]: !current[field.id] }))} secondary styles={styles} />
            ) : field.options.length ? (
              <View style={styles.row}>{field.options.map((option) => <Button key={option.id} label={option.label} onPress={() => setValues((current) => ({ ...current, [field.id]: option.value }))} secondary={values[field.id] !== option.value} styles={styles} />)}</View>
            ) : (
              <TextInput accessibilityLabel={field.label} keyboardType={['number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type) ? 'numeric' : 'default'} multiline={field.type === 'textarea'} onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))} style={[styles.input, field.type === 'textarea' && styles.inputMultiline]} value={String(values[field.id] ?? '')} />
            )}
          </View>
        ))}
        <Text style={styles.label}>Coach summary note</Text>
        <TextInput accessibilityLabel="Coach summary note" multiline onChangeText={setNotes} style={[styles.input, styles.inputMultiline]} value={notes} />
        <View style={styles.row}><Button disabled={stale} label="Save private draft" onPress={saveDraft} secondary styles={styles} /><Button disabled={stale} label="Finalise and share" onPress={finalise} styles={styles} /></View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>Development history</Text>
        {records.length ? records.slice(0, 10).map((record) => <Text key={record.id} style={styles.body}>{record.date || 'No date'} | {record.status} | {record.formName || 'Development record'} | {record.averageScore ?? 'No score'}</Text>) : <Text style={styles.body}>No Development history for this Player.</Text>}
      </View>
    </View>
  )
}

function ResourcesDomain({ data, load, setNotice, stale, styles, user }) {
  const [assigning, setAssigning] = useState(false)
  const [parentVisible, setParentVisible] = useState(true)
  const [players, setPlayers] = useState([])
  const [title, setTitle] = useState(config.isProduction ? '' : 'FP TEST resource')
  const [url, setUrl] = useState(config.isProduction ? '' : 'https://example.com/fp-test-resource')
  const [selectedId, setSelectedId] = useState(data[0]?.id || '')
  const selected = data.find((resource) => resource.id === selectedId)
  useEffect(() => {
    let active = true
    setPlayers([])
    getCoachPlayerList(user)
      .then((rows) => { if (active) setPlayers(rows) })
      .catch((error) => { if (active) setNotice(getCoachFriendlyError(error)) })
    return () => { active = false }
  }, [setNotice, user])
  const open = async (resource) => {
    try {
      const accessUrl = await getCoachResourceAccessUrl(user, resource)
      if (!await Linking.canOpenURL(accessUrl)) throw new Error('This Resource link is not supported on this device.')
      await Linking.openURL(accessUrl)
      setNotice('Resource opened.')
    } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
  }
  const create = async () => {
    try { await createCoachExternalResource(user, { title, externalUrl: url, category: 'general' }); setNotice(config.isProduction ? 'External Resource created.' : 'Synthetic external Resource created.'); await load() } catch (error) { setNotice(getCoachFriendlyError(error)) }
  }
  const shareWithTeam = async () => {
    try { await setCoachResourceSharing(user, selected, [{ linkedId: user.activeTeamId, linkedType: 'team', teamId: user.activeTeamId }], config.isProduction ? 'Shared from Football Player Coach' : 'Shared from Coach mobile FP TEST'); setNotice(config.isProduction ? 'Resource shared with the active Team.' : 'Resource shared with the active FP TEST Team.'); await load() } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
  }
  const removeSharing = async (linkId) => {
    try { await removeCoachResourceSharing(user, selected, linkId); setNotice('Resource assignment removed.'); await load() } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
  }
  const togglePlayerSharing = async (player) => {
    const existingLink = selected?.links.find((link) => link.linkedType === 'player' && link.linkedId === player.id)
    setAssigning(true)
    try {
      if (existingLink) {
        await removeCoachResourceSharing(user, selected, existingLink.id)
        setNotice(`Resource removed from ${player.playerName}.`)
      } else {
        await setCoachResourceSharing(user, selected, [{ linkedId: player.id, linkedType: 'player', parentVisible, teamId: user.activeTeamId }], 'Shared from Football Player Coach')
        setNotice(`Resource assigned to ${player.playerName}.`)
      }
      await load()
    } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
    finally { setAssigning(false) }
  }
  const assignAllPlayers = async () => {
    const assignedPlayerIds = new Set(selected?.links.filter((link) => link.linkedType === 'player').map((link) => link.linkedId) || [])
    const unassignedPlayers = players.filter((player) => !assignedPlayerIds.has(player.id))
    if (!selected || unassignedPlayers.length === 0) {
      setNotice('This Resource is already assigned to every active Player.')
      return
    }
    setAssigning(true)
    try {
      await setCoachResourceSharing(user, selected, unassignedPlayers.map((player) => ({
        linkedId: player.id,
        linkedType: 'player',
        parentVisible,
        teamId: user.activeTeamId,
      })), 'Shared from Football Player Coach')
      setNotice(`Resource assigned to ${unassignedPlayers.length} Player${unassignedPlayers.length === 1 ? '' : 's'}.`)
      await load()
    } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
    finally { setAssigning(false) }
  }
  return (
    <View style={styles.stack}>
      {data.length ? data.map((resource) => <Pressable accessibilityRole="button" accessibilityState={{ selected: resource.id === selectedId }} key={resource.id} onPress={() => setSelectedId(resource.id)} style={[styles.panel, resource.id === selectedId && styles.panelSelected]}><Text style={styles.heading}>{resource.title}</Text><Text style={styles.body}>{user.activeTeamName || resource.teamName || 'Active Team'} only | {resource.category} | {resource.type}</Text><Text style={styles.body}>{resource.description || 'No description'}</Text><Button label="Open Resource" onPress={() => void open(resource)} styles={styles} /></Pressable>) : <Empty copy="No active Team Resources are available." styles={styles} />}
      {selected ? <View style={styles.panel}>
        <Text style={styles.heading}>Assign selected Resource</Text>
        {selected.isFormationBoard ? <Text style={styles.body}>This Formation Board is already a Team Resource. Choose individual Players to share it with their families.</Text> : <Button disabled={stale || assigning || Number(user.roleRank || 0) < 50} label="Share with active Team" onPress={shareWithTeam} secondary styles={styles} />}
        <View style={styles.row}><Text style={styles.label}>Visible to the Player's family</Text><Switch accessibilityLabel="Visible to the Player's family" disabled={stale || assigning} onValueChange={setParentVisible} value={parentVisible} /></View>
        {players.length ? <Button disabled={stale || assigning || Number(user.roleRank || 0) < 50 || players.every((player) => selected.links.some((link) => link.linkedType === 'player' && link.linkedId === player.id))} label={assigning ? 'Assigning Players...' : 'Assign to all Players'} onPress={() => void assignAllPlayers()} secondary styles={styles} /> : null}
        {players.length ? players.map((player) => {
          const assigned = selected.links.some((link) => link.linkedType === 'player' && link.linkedId === player.id)
          return <Button disabled={stale || assigning || Number(user.roleRank || 0) < 50} key={player.id} label={`${assigned ? 'Remove from' : 'Assign to'} ${player.playerName}`} onPress={() => void togglePlayerSharing(player)} secondary={!assigned} styles={styles} />
        }) : <Text style={styles.body}>No active Players are available in this Team.</Text>}
        {selected.links.filter((link) => link.linkedType !== 'player').map((link) => <View key={link.id} style={styles.stack}><Text style={styles.body}>{link.linkedType} | {link.parentVisible ? 'Parent shared' : 'Coaches only'} | {link.shareDescription || 'No description'}</Text><Button disabled={stale || assigning || Number(user.roleRank || 0) < 50} label="Remove assignment" onPress={() => void removeSharing(link.id)} secondary styles={styles} /></View>)}
      </View> : null}
      <View style={styles.panel}><Text style={styles.heading}>Add secure external link</Text><TextInput accessibilityLabel="Resource title" onChangeText={setTitle} style={styles.input} value={title} /><TextInput accessibilityLabel="HTTPS Resource URL" autoCapitalize="none" keyboardType="url" onChangeText={setUrl} style={styles.input} value={url} /><Button disabled={stale || Number(user.roleRank || 0) < 50} label={config.isProduction ? 'Create Resource' : 'Create FP TEST Resource'} onPress={create} styles={styles} /><Text style={styles.body}>File upload, bulk governance, archive, and retention stay in the web workflow.</Text></View>
    </View>
  )
}

function ChatDomain({ chatNotificationTarget, data, load, notice, onChatNotificationTargetHandled, placeholderColor, reloadHome, setNotice, stale, styles, user }) {
  const safeAreaInsets = useSafeAreaInsets()
  const chatModalTopInset = getCoachChatModalTopInset({ platform: Platform.OS, safeAreaTop: safeAreaInsets.top })
  const roomSections = useMemo(() => buildCoachChatRoomSections([...(data.staff || []), ...(data.parent || [])]), [data])
  const rooms = useMemo(() => roomSections.flatMap((section) => [...section.activeRooms, ...section.emptyRooms]), [roomSections])
  const [roomId, setRoomId] = useState('')
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [markingAllRead, setMarkingAllRead] = useState(false)
  const [expandedEmptySections, setExpandedEmptySections] = useState({})
  const messageListRef = useRef(null)
  const activeRoomIdRef = useRef('')
  const messagesRef = useRef([])
  const roomRefreshRef = useRef(false)
  const activeRoomId = rooms.some((item) => item.id === roomId) ? roomId : ''
  const room = rooms.find((item) => item.id === activeRoomId)
  activeRoomIdRef.current = activeRoomId
  messagesRef.current = messages
  const unreadRooms = rooms.filter((item) => Number(item.unreadCount || 0) > 0)
  const open = useCallback(async (nextRoom) => {
    setMessages([])
    setBody('')
    setRoomId(nextRoom.id)
    activeRoomIdRef.current = nextRoom.id
    setNotice('Loading current room history...')
    try {
      const next = await getCoachChatMessages(user, nextRoom)
      setMessages(next)
      await markCoachChatRead(user, nextRoom)
      await Promise.all([load({ silent: true }), reloadHome({ refresh: true, chatOnly: true })])
      setNotice('')
    } catch (error) { setMessages([]); setNotice(getCoachFriendlyError(error)) }
  }, [load, reloadHome, setNotice, user])
  useEffect(() => {
    const targetId = String(chatNotificationTarget?.id || '').trim()
    if (!targetId || chatNotificationTarget?.contextId !== user.activeCoachContextId) return
    const targetRoom = rooms.find((item) => item.id === targetId && (!chatNotificationTarget.kind || item.kind === chatNotificationTarget.kind))
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      onChatNotificationTargetHandled()
      if (!targetRoom) {
        setMessages([])
        setBody('')
        setNotice('This Coach Chat is stale or no longer authorised.')
        return
      }
      void open(targetRoom)
    })
    return () => { cancelled = true }
  }, [chatNotificationTarget, onChatNotificationTargetHandled, open, rooms, setNotice, user.activeCoachContextId])
  useEffect(() => {
    if (!room?.id) return undefined
    let disposed = false
    const refreshOpenRoom = async () => {
      if (disposed || roomRefreshRef.current || AppState.currentState !== 'active') return
      roomRefreshRef.current = true
      try {
        const next = await getCoachChatMessages(user, room)
        if (disposed || activeRoomIdRef.current !== room.id) return
        if (getMobileChatMessagesFingerprint(next) === getMobileChatMessagesFingerprint(messagesRef.current)) return
        setMessages(next)
        messagesRef.current = next
        await markCoachChatRead(user, room)
        await Promise.all([load({ silent: true }), reloadHome({ refresh: true, chatOnly: true })])
      } catch {
        // The secured fallback refresh will try again without disrupting the open composer.
      } finally {
        roomRefreshRef.current = false
      }
    }
    const unsubscribe = subscribeToCoachChatRoom(user, room, { onChange: refreshOpenRoom })
    const interval = setInterval(() => void refreshOpenRoom(), 15000)
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refreshOpenRoom()
    })
    return () => {
      disposed = true
      clearInterval(interval)
      appStateSubscription.remove()
      unsubscribe()
    }
  }, [load, reloadHome, room, user])
  const send = async () => {
    setSending(true)
    try { setMessages(await sendCoachChatMessage(user, room, body)); setBody(''); setNotice('') } catch (error) { setNotice(getCoachFriendlyError(error)) }
    finally { setSending(false) }
  }
  const markAllRead = async () => {
    if (!unreadRooms.length || markingAllRead) return
    setMarkingAllRead(true)
    setNotice('Marking all Chat conversations as read...')
    const results = await Promise.allSettled(unreadRooms.map((item) => markCoachChatRead(user, item)))
    const failedCount = results.filter((result) => result.status === 'rejected').length
    await Promise.all([load({ silent: true }), reloadHome({ refresh: true, chatOnly: true })])
    setNotice(failedCount ? `${failedCount} Chat conversation${failedCount === 1 ? '' : 's'} could not be marked as read.` : 'All Chat conversations are marked as read.')
    setMarkingAllRead(false)
  }
  useEffect(() => {
    if (!room) return undefined
    const handle = setTimeout(() => messageListRef.current?.scrollToEnd({ animated: false }), 30)
    return () => clearTimeout(handle)
  }, [messages.length, room])
  if (!rooms.length) return <View style={styles.panel}><Text style={styles.body}>No Coach Chat or Parent Chat conversation is currently available for this Team.</Text><Button label="Refresh Chat" onPress={load} styles={styles} /></View>
  if (!room) {
    return (
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.title}>Chat</Text>
        <Text style={styles.body}>{rooms.length} conversation{rooms.length === 1 ? '' : 's'} for this Team.</Text>
        {unreadRooms.length ? <Button disabled={markingAllRead || stale} label={markingAllRead ? 'Marking all as read...' : `Mark all as read (${unreadRooms.length})`} onPress={() => void markAllRead()} secondary styles={styles} /> : null}
        {roomSections.map((section) => {
          const expanded = expandedEmptySections[section.key] === true
          const visibleRooms = expanded ? [...section.activeRooms, ...section.emptyRooms] : section.activeRooms
          return (
            <View key={section.key} style={styles.chatRoomSection}>
              <View style={styles.chatRoomSectionHeader}>
                <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
                <Text style={styles.chatRoomSectionCount}>{section.total}</Text>
              </View>
              {visibleRooms.map((item) => {
                const display = getCoachChatRoomDisplay(item)
                return (
                  <Pressable accessibilityRole="button" key={`${item.kind}:${item.id}`} onPress={() => void open(item)} style={styles.chatRoomCard}>
                    <View style={styles.row}><Text style={styles.status}>{section.title}</Text>{item.unreadCount ? <Text style={styles.status}>{item.unreadCount} unread</Text> : null}</View>
                    <Text style={styles.heading}>{display.title}</Text>
                    {display.context ? <Text style={styles.chatRoomContext}>{display.context}</Text> : null}
                    <Text numberOfLines={1} style={styles.body}>{item.latestMessage || 'No messages yet'}</Text>
                  </Pressable>
                )
              })}
              {section.emptyRooms.length ? (
                <Button
                  label={expanded ? `Hide ${section.emptyRooms.length} with no messages` : `Show ${section.emptyRooms.length} with no messages`}
                  onPress={() => setExpandedEmptySections((current) => ({ ...current, [section.key]: !expanded }))}
                  secondary
                  styles={styles}
                />
              ) : null}
            </View>
          )
        })}
      </View>
    )
  }
  const display = getCoachChatRoomDisplay(room)
  return (
    <Modal animationType="slide" onRequestClose={() => { activeRoomIdRef.current = ''; setRoomId(''); setMessages([]); setBody(''); setNotice('') }} visible>
      <SafeAreaView edges={['right', 'bottom', 'left']} style={styles.chatModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.chatModal}>
          <View style={[styles.chatModalHeader, { paddingTop: chatModalTopInset + 14 }]}>
            <Button label="Back to conversations" onPress={() => { activeRoomIdRef.current = ''; setRoomId(''); setMessages([]); setBody(''); setNotice('') }} secondary styles={styles} />
            <Text accessibilityRole="header" style={styles.heading}>{display.title}</Text>
            {display.context ? <Text style={styles.chatRoomContext}>{display.context}</Text> : null}
            {notice ? <Text accessibilityLiveRegion="assertive" style={styles.danger}>{notice}</Text> : null}
          </View>
          <FlatList
            contentContainerStyle={styles.chatMessageListContent}
            data={messages}
            keyExtractor={(message) => String(message.id)}
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.body}>No messages in this conversation yet.</Text>}
            onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: false })}
            ref={messageListRef}
            renderItem={({ item: message }) => <View style={[styles.messageBubble, message.senderId === user.id && styles.messageBubbleOwn]}><View style={styles.messageHeader}><Text style={styles.label}>{message.senderName}</Text><Text style={styles.messageTime}>{formatCoachChatDateTime(message.createdAt)}</Text></View><Text style={styles.body}>{message.deletedAt ? 'Message deleted.' : message.body}</Text></View>}
            style={styles.chatMessageList}
          />
          <View style={styles.chatComposer}>
            <TextInput accessibilityLabel="Chat message" editable={!sending && !stale && room.canPost} multiline onChangeText={setBody} placeholder="Message" placeholderTextColor={placeholderColor} style={[styles.input, styles.chatComposerInput]} value={body} />
            <Button disabled={sending || stale || !room.canPost || !body.trim() || (!config.isProduction && !isSyntheticCoachTarget(room.title))} label={sending ? 'Sending...' : config.isProduction ? 'Send' : 'Send to FP TEST channel'} onPress={send} styles={styles} />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function MessagesDomain({ data, styles }) {
  const messageDelta = COACH_PHASE_31E_BACKEND_DELTAS.find((item) => item.capability === 'Standalone Coach Messages inbox')
  return (
    <View style={styles.stack}>
      {data.length ? data.map((message) => <View key={message.id} style={styles.panel}><Text style={styles.heading}>{message.subject}</Text><Text style={styles.body}>{message.channel || 'system'} | {message.status} | {message.createdAt || 'No date'}</Text><Text style={styles.body}>{message.body || message.action || 'Recorded communication event'}</Text></View>) : <Empty copy="No Team communication history is available." styles={styles} />}
      <View style={styles.panel}><Text style={styles.heading}>Current product boundary</Text><Text style={styles.body}>{messageDelta?.authority}. Compose remains inside the canonical domain workflow, so this screen does not invent a second sending system.</Text></View>
    </View>
  )
}

function PollsDomain({ data, load, placeholderColor, setNotice, stale, styles, user }) {
  const [selectedId, setSelectedId] = useState('')
  const [createFormOpen, setCreateFormOpen] = useState(false)
  const [allowMultiple, setAllowMultiple] = useState(true)
  const [allowVoteChanges, setAllowVoteChanges] = useState(true)
  const [anonymous, setAnonymous] = useState(false)
  const [audience, setAudience] = useState('parents')
  const [creating, setCreating] = useState(false)
  const [expiryDuration, setExpiryDuration] = useState('')
  const [description, setDescription] = useState('')
  const [maxChoices, setMaxChoices] = useState('')
  const [notifyResultsOnClose, setNotifyResultsOnClose] = useState(false)
  const [options, setOptions] = useState(['', ''])
  const [title, setTitle] = useState('')
  const [votingOptionId, setVotingOptionId] = useState('')
  const [showArchive, setShowArchive] = useState(false)
  const selected = data.find((poll) => poll.id === selectedId)
  const archivedCount = data.filter((poll) => poll.status === 'closed').length
  const visiblePolls = showArchive ? data : data.filter((poll) => poll.status !== 'closed')
  const create = async () => {
    const pollOptions = options.map((label, index) => ({ id: `option-${index + 1}`, label: label.trim() })).filter((option) => option.label)
    if (!title.trim() || pollOptions.length < 2) {
      setNotice('Add a Poll title and at least two options.')
      return
    }
    setCreating(true)
    try {
      const closesAt = expiryDurationToIso(expiryDuration, { allowBlank: true })
      await createCoachPoll(user, {
        allowMultiple,
        allowVoteChanges,
        anonymous,
        audience,
        closesAt,
        description,
        maxChoices: allowMultiple ? Number(maxChoices || 0) || null : null,
        notifyResultsOnClose: audience === 'parents' && notifyResultsOnClose,
        options: pollOptions,
        title: title.trim(),
      })
      setTitle('')
      setDescription('')
      setExpiryDuration('')
      setOptions(['', ''])
      setMaxChoices('')
      setNotifyResultsOnClose(false)
      setCreateFormOpen(false)
      await load()
      setNotice(audience === 'parents'
        ? 'Poll created. Parent app notifications are queued using each family\'s communication preference.'
        : 'Coach Poll created.')
    } catch (error) { setNotice(getCoachFriendlyError(error)) }
    finally { setCreating(false) }
  }
  const archive = async () => {
    try {
      await setCoachPollStatus(user, selected, 'closed')
      setSelectedId('')
      setNotice(selected?.notifyResultsOnClose
        ? 'Poll archived. Final results are queued using each Parent communication preference.'
        : 'Poll archived.')
      await load()
    } catch (error) { setNotice(getCoachFriendlyError(error)) }
  }
  const close = () => Alert.alert('Archive this Poll?', 'Responses remain in the canonical history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive', onPress: () => void archive() },
    ])
  const reopen = async () => { try { await setCoachPollStatus(user, selected, 'open'); setNotice('Poll reopened.'); await load() } catch (error) { setNotice(getCoachFriendlyError(error)) } }
  const remove = () => Alert.alert('Delete this archived Poll?', 'This is available only when the Poll has no votes and is not linked to Matchday history.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        await deleteCoachPoll(user, selected)
        setSelectedId('')
        setNotice('Poll deleted.')
        await load()
      } catch (error) { setNotice(getCoachFriendlyError(error)) }
    } },
  ])
  const vote = async (poll, optionId) => {
    setVotingOptionId(`${poll.id}:${optionId}`)
    try {
      await submitCoachPollVote(user, poll, optionId)
      await load()
      setNotice('Your Poll response has been saved.')
    } catch (error) { setNotice(getCoachFriendlyError(error)) }
    finally { setVotingOptionId('') }
  }
  return (
    <View style={styles.stack}>
      <View style={styles.row}>
        <Button disabled={stale} label="Refresh results" onPress={() => void load({ silent: true })} secondary styles={styles} />
        <Button disabled={stale} label={createFormOpen ? 'Close form' : 'Create Poll'} onPress={() => setCreateFormOpen((current) => !current)} secondary={!createFormOpen} styles={styles} />
        {archivedCount ? <Button label={showArchive ? 'Hide archive' : `Show archive (${archivedCount})`} onPress={() => setShowArchive((current) => !current)} secondary styles={styles} /> : null}
      </View>
      {createFormOpen ? <View style={styles.panel}>
        <Text style={styles.heading}>Create Poll</Text>
        <Text style={styles.body}>Create a question for Parents or Coaches.</Text>
        <Text style={styles.label}>Question</Text>
        <TextInput accessibilityLabel="Poll question" onChangeText={setTitle} placeholder="Poll question" placeholderTextColor={placeholderColor} style={styles.input} value={title} />
        <Text style={styles.label}>Description, optional</Text>
        <TextInput accessibilityLabel="Poll description" multiline onChangeText={setDescription} placeholder="Helpful details" placeholderTextColor={placeholderColor} style={[styles.input, styles.inputMultiline]} value={description} />
        <Text style={styles.label}>Poll expiry (DD:HH:MM), optional</Text>
        <TextInput accessibilityLabel="Poll expiry DD:HH:MM" autoCapitalize="none" onChangeText={setExpiryDuration} placeholder="Example: 02:06:30" placeholderTextColor={placeholderColor} style={styles.input} value={expiryDuration} />
        <Text style={styles.body}>Days, hours, minutes. Leave blank to keep the Poll open until a Coach archives it.</Text>
        <Text style={styles.label}>Audience</Text>
        <View style={styles.row}><Button label="Parents" onPress={() => setAudience('parents')} secondary={audience !== 'parents'} styles={styles} /><Button label="Coaches" onPress={() => setAudience('staff')} secondary={audience !== 'staff'} styles={styles} /></View>
        <Text style={styles.label}>Options</Text>
        {options.map((option, index) => <View key={index} style={styles.row}><TextInput accessibilityLabel={`Poll option ${index + 1}`} onChangeText={(value) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder={`Option ${index + 1}`} placeholderTextColor={placeholderColor} style={[styles.input, { flex: 1 }]} value={option} />{options.length > 2 ? <Button label="Remove" onPress={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} secondary styles={styles} /> : null}</View>)}
        {options.length < 8 ? <Button label="Add option" onPress={() => setOptions((current) => [...current, ''])} secondary styles={styles} /> : null}
        <View style={styles.row}><Text style={styles.label}>Allow more than one answer</Text><Switch accessibilityLabel="Allow more than one answer" onValueChange={setAllowMultiple} value={allowMultiple} /></View>
        {allowMultiple ? <><Text style={styles.label}>Maximum choices, optional</Text><TextInput accessibilityLabel="Maximum Poll choices" keyboardType="number-pad" onChangeText={setMaxChoices} placeholder="Leave blank for unlimited" placeholderTextColor={placeholderColor} style={styles.input} value={maxChoices} /><Text style={styles.body}>{maxChoices ? `Parents can choose up to ${maxChoices} answers.` : 'Parents can choose any number of answers and tap again to remove one.'}</Text></> : null}
        <View style={styles.row}><Text style={styles.label}>Allow answer changes</Text><Switch accessibilityLabel="Allow Poll answer changes" onValueChange={setAllowVoteChanges} value={allowVoteChanges} /></View>
        <View style={styles.row}><Text style={styles.label}>Hide voter names</Text><Switch accessibilityLabel="Hide Poll voter names" onValueChange={setAnonymous} value={anonymous} /></View>
        {audience === 'parents' ? <View style={styles.row}><View style={{ flex: 1 }}><Text style={styles.label}>Send final results</Text><Text style={styles.body}>Send the ranked result when this Poll closes, reaches its deadline, or everyone has replied.</Text></View><Switch accessibilityLabel="Send final Poll results" onValueChange={setNotifyResultsOnClose} value={notifyResultsOnClose} /></View> : null}
        <Button disabled={stale || creating || Number(user.roleRank || 0) < 50 || !title.trim() || options.filter((option) => option.trim()).length < 2} label={creating ? 'Creating Poll...' : 'Create Poll'} onPress={() => void create()} styles={styles} />
      </View> : null}
      {visiblePolls.length ? visiblePolls.map((poll) => {
        const currentOptionIds = poll.currentOptionIds || []
        const expanded = poll.id === selectedId
        const rankedOptions = summarizeCoachPoll(poll)
        const totalVotes = rankedOptions.reduce((sum, option) => sum + option.count, 0)
        return (
          <View key={poll.id} style={[styles.panel, expanded && styles.panelSelected]}>
            <Pressable accessibilityRole="button" onPress={() => setSelectedId(expanded ? '' : poll.id)}>
              <Text style={styles.heading}>{poll.title}</Text>
              <Text style={styles.body}>{poll.status} | {totalVotes} vote{totalVotes === 1 ? '' : 's'} | {expanded ? 'Hide results' : 'View results'}</Text>
            </Pressable>
            {expanded ? <>
              <Text style={styles.body}>{poll.audience === 'staff' ? 'Coaches' : 'Parents'} | {poll.anonymous ? 'Anonymous' : 'Named responses'} | {poll.allowMultiple ? poll.maxChoices ? `Up to ${poll.maxChoices}` : 'Unlimited choices' : 'One choice'}</Text>
              {poll.notifyResultsOnClose ? <Text style={styles.body}>{poll.resultsNotifiedAt ? 'Final results sent' : 'Final results will be sent automatically'}</Text> : null}
              {rankedOptions.map((option) => {
                const chosen = currentOptionIds.includes(option.id)
                const atLimit = poll.allowMultiple && Number(poll.maxChoices || 0) > 0 && currentOptionIds.length >= Number(poll.maxChoices) && !chosen
                const lockedChoice = chosen && poll.allowVoteChanges !== true
                const lockedSingleChoice = !poll.allowMultiple && currentOptionIds.length > 0 && poll.allowVoteChanges !== true
                return <View key={option.id} style={styles.row}><Text style={styles.body}>{option.rank}. {option.label}: {option.count}</Text>{poll.audience === 'staff' && poll.status === 'open' ? <Button disabled={stale || Boolean(votingOptionId) || atLimit || lockedChoice || lockedSingleChoice} label={votingOptionId === `${poll.id}:${option.id}` ? 'Saving...' : chosen ? lockedChoice ? 'Saved' : 'Remove my answer' : 'Choose'} onPress={() => void vote(poll, option.id)} secondary={!chosen} styles={styles} /> : null}</View>
              })}
              {poll.closesAt ? <Text style={styles.body}>Deadline: {new Date(poll.closesAt).toLocaleString()}</Text> : null}
              <View style={styles.row}><Button disabled={stale || poll.status === 'closed' || Number(user.roleRank || 0) < 50} label="Archive Poll" onPress={close} secondary styles={styles} /><Button disabled={stale || poll.status !== 'closed' || Number(user.roleRank || 0) < 50} label="Restore Poll" onPress={() => void reopen()} secondary styles={styles} />{poll.status === 'closed' && totalVotes === 0 ? <Button disabled={stale || Number(user.roleRank || 0) < 50} label="Delete Poll" onPress={remove} secondary styles={styles} /> : null}</View>
            </> : null}
          </View>
        )
      }) : <Empty copy={showArchive ? 'No archived Polls are available.' : 'No open Team or Club Polls are available.'} styles={styles} />}
    </View>
  )
}

function InvitesDomain({ data, load, onNavigate, reloadHome, setNotice, stale, styles, user }) {
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([])
  const [requestPanelOpen, setRequestPanelOpen] = useState(false)
  const [bulkAction, setBulkAction] = useState('')
  const [removalConfirmation, setRemovalConfirmation] = useState(null)
  const today = new Date().toISOString().slice(0, 10)
  const trainingGroups = [...(data.training || [])
    .filter((invite) => !invite.cancelled && !invite.stale)
    .filter((invite) => !invite.occurrenceDate || invite.occurrenceDate >= today)
    .reduce((groups, invite) => {
      const key = `${invite.eventId}:${invite.occurrenceDate || 'date-to-be-confirmed'}`
      const group = groups.get(key) || { key, eventId: invite.eventId, occurrenceDate: invite.occurrenceDate, title: invite.title, invites: [] }
      group.invites.push(invite)
      groups.set(key, group)
      return groups
    }, new Map()).values()]
    .sort((left, right) => String(left.occurrenceDate || '9999').localeCompare(String(right.occurrenceDate || '9999')))
    .slice(0, 20)
  const openMatches = (data.matches || [])
    .filter((match) => match.teamId === user.activeTeamId && ['scheduled', 'scorer_request'].includes(match.status))
    .filter((match) => !match.matchDate || String(match.matchDate).slice(0, 10) >= today)
    .sort((left, right) => String(left.matchDate || '9999').localeCompare(String(right.matchDate || '9999')))
    .slice(0, 20)
  const [matchId, setMatchId] = useState('')
  const [trainingKey, setTrainingKey] = useState('')
  const [playerIds, setPlayerIds] = useState([])
  const [creating, setCreating] = useState(false)
  const [uncertainAttempt, setUncertainAttempt] = useState(null)
  const selectedMatch = openMatches.find((match) => match.id === matchId)
  const selectedMatchInvites = [...collapseCoachInvitesByPlayer((data.match || [])
    .filter((invite) => invite.eventId === matchId && !invite.cancelled && !invite.stale))]
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
  const selectedTrainingInvites = [...collapseCoachInvitesByPlayer(trainingGroups.find((group) => group.key === trainingKey)?.invites || [])]
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
  const activeInvites = matchId ? selectedMatchInvites : selectedTrainingInvites
  const selectedInvites = getSelectedCoachInvites(activeInvites, selectedPlayerIds)
  const selectedAvailabilityInvite = selectedInvites.length === 1 && ['match', 'training'].includes(selectedInvites[0]?.kind)
    ? selectedInvites[0]
    : null
  const availablePlayers = getCoachPlayersWithoutAvailabilityRequest(data.players, data.match, matchId)
  const matchRequestPlayerCount = selectedMatchInvites.length
  const selectedCanBeResent = canResendSelectedCoachInvites(selectedInvites)
  const selectionDisabled = stale || Boolean(bulkAction)
  const toggleSelection = (playerId) => setSelectedPlayerIds((current) => toggleCoachInvitePlayerSelection(current, playerId))
  const refreshAfterBulkAction = async () => {
    await load()
    await reloadHome?.({ refresh: true })
  }
  const recordSelectedResends = async (invites) => {
    setBulkAction('resend')
    const results = await Promise.allSettled(invites.map((invite) => recordCoachInviteIntent(user, invite, 'resend')))
    const successful = results.filter((result) => result.status === 'fulfilled')
    const failedPlayerIds = results.flatMap((result, index) => result.status === 'rejected' ? [invites[index].playerId] : [])
    const recipientCount = successful.reduce((total, result) => total + Number(result.value?.recipientCount || 0), 0)
    setSelectedPlayerIds(failedPlayerIds)
    const resultNotice = failedPlayerIds.length
      ? `${successful.length} of ${invites.length} Player Invitation${invites.length === 1 ? '' : 's'} resent. ${failedPlayerIds.length} failed and remain selected so you can review them.`
      : config.isProduction
        ? `${invites.length} Player Invitation${invites.length === 1 ? '' : 's'} resent to ${recipientCount} server-resolved recipient${recipientCount === 1 ? '' : 's'}.`
        : `${invites.length} resend intent${invites.length === 1 ? '' : 's'} recorded. External delivery remains disabled.`
    try { await refreshAfterBulkAction(); setNotice(resultNotice) } catch (error) { setNotice(`${failedPlayerIds.length ? `${successful.length} of ${invites.length} Invitations were resent. ` : 'Invitations were resent. '}The latest availability could not be refreshed: ${getCoachFriendlyError(error)}`) }
    finally { setBulkAction('') }
  }
  const resend = () => {
    const invites = [...selectedInvites]
    if (!config.isProduction) return void recordSelectedResends(invites)
    Alert.alert(`Resend ${invites.length} Invitation${invites.length === 1 ? '' : 's'}?`, 'This queues the approved Invitations to each Player\'s server-resolved eligible contacts. Existing response identity and any saved response are preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resend', onPress: () => void recordSelectedResends(invites) },
    ])
  }
  const commitSelectedRemovals = async (invites, confirmInProgress) => {
    setBulkAction('remove')
    const results = await Promise.allSettled(invites.map((invite) => removeCoachInviteFromEvent(user, invite, { confirmInProgress })))
    const successful = results.filter((result) => result.status === 'fulfilled')
    const failedPlayerIds = results.flatMap((result, index) => result.status === 'rejected' ? [invites[index].playerId] : [])
    setSelectedPlayerIds(failedPlayerIds)
    const resultNotice = failedPlayerIds.length
      ? `${successful.length} of ${invites.length} Players removed from the event. ${failedPlayerIds.length} failed and remain selected so you can review them.`
      : `${invites.length} Player${invites.length === 1 ? '' : 's'} removed from the event. Team membership, Player records, and previous response history were preserved. No removal notification was sent.`
    try { await refreshAfterBulkAction(); setNotice(resultNotice) } catch (error) { setNotice(`${successful.length} of ${invites.length} Players were removed. The latest availability could not be refreshed: ${getCoachFriendlyError(error)}`) }
    finally { setBulkAction('') }
  }
  const openRemovalConfirmation = () => {
    const invites = [...selectedInvites]
    if (!invites.length) return
    setRemovalConfirmation({ error: '', invites, previewed: false, requiresInProgressConfirmation: false })
  }
  const confirmSelectedRemoval = async () => {
    const confirmation = removalConfirmation
    if (!confirmation || bulkAction) return
    const invites = [...confirmation.invites]
    if (confirmation.previewed) {
      setRemovalConfirmation(null)
      await commitSelectedRemovals(invites, confirmation.requiresInProgressConfirmation)
      return
    }
    setBulkAction('preview')
    const previews = await Promise.allSettled(invites.map((invite) => previewCoachInviteRemoval(user, invite)))
    const failed = previews.filter((result) => result.status === 'rejected')
    if (failed.length) {
      const error = `Removal was not started because ${failed.length} of ${invites.length} selected Players could not be verified. ${getCoachFriendlyError(failed[0].reason)}`
      setRemovalConfirmation((current) => current ? { ...current, error } : current)
      setBulkAction('')
      return
    }
    const requiresInProgressConfirmation = previews.some((result) => result.value.requiresInProgressConfirmation)
    if (requiresInProgressConfirmation) {
      setRemovalConfirmation((current) => current ? { ...current, error: '', previewed: true, requiresInProgressConfirmation: true } : current)
      setBulkAction('')
      return
    }
    setRemovalConfirmation(null)
    await commitSelectedRemovals(invites, false)
  }
  const createRequests = async () => {
    const attempt = { matchId: selectedMatch?.id || '', playerIds: [...playerIds] }
    setCreating(true)
    setUncertainAttempt(null)
    try {
      const result = await createCoachMatchAvailabilityRequests(user, selectedMatch, playerIds)
      const selectedCount = Number(result.selectedPlayerCount || playerIds.length)
      const createdCount = Number(result.createdPlayerCount || 0)
      const existingCount = Number(result.existingPlayerCount || 0)
      const missingCount = Number(result.missingContactCount || 0)
      setNotice(result.complete
        ? `${createdCount} of ${selectedCount} Player request${selectedCount === 1 ? '' : 's'} created. ${existingCount} already existed. ${result.queuedCount} recipient message${result.queuedCount === 1 ? '' : 's'} queued. App delivery follows each Parent's communication choice.`
        : `${createdCount} of ${selectedCount} Player request${selectedCount === 1 ? '' : 's'} created. ${existingCount} already existed. ${missingCount} Player${missingCount === 1 ? ' has' : 's have'} no eligible Parent or Adult Player contact, so no invitation was sent for ${missingCount === 1 ? 'that Player' : 'those Players'}.`)
      setPlayerIds([])
      await load()
    } catch (error) {
      try {
        const current = await getCoachInvitesAndAvailability(user)
        if (isCoachMatchAvailabilityRequestCreationApplied(current, attempt.matchId, attempt.playerIds)) {
          setNotice('The server confirmed that all selected Match availability requests were created. No retry is needed.')
          setPlayerIds([])
        } else {
          setNotice(`${getCoachFriendlyError(error, 'The request could not be completed.')} Review current invitations before retrying.`)
        }
        await load()
      } catch {
        setUncertainAttempt(attempt)
        setNotice(`${getCoachFriendlyError(error, 'The request could not be completed.')} Check the current invitations before retrying.`)
      }
    } finally { setCreating(false) }
  }
  const reconcile = async () => {
    if (!uncertainAttempt) return
    setCreating(true)
    try {
      const current = await getCoachInvitesAndAvailability(user)
      const applied = isCoachMatchAvailabilityRequestCreationApplied(current, uncertainAttempt.matchId, uncertainAttempt.playerIds)
      setNotice(applied ? 'The server confirmed that all selected Match availability requests were created. No retry is needed.' : 'The server confirmed that the complete request set was not created. Review current invitations before retrying.')
      if (applied) setPlayerIds([])
      setUncertainAttempt(null)
      await load()
    } catch (error) { setNotice(`${getCoachFriendlyError(error, 'The request could not be completed.')} Check the current invitations before retrying.`) }
    finally { setCreating(false) }
  }
  const confirmCreate = () => Alert.alert('Send Match availability requests?', `This creates ${playerIds.length} Player request${playerIds.length === 1 ? '' : 's'}. Email and app delivery follow each Parent's saved communication choice. Existing request identity is reused.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Create requests', onPress: () => void createRequests() },
  ])
  const recordAvailabilityOnBehalf = async (availabilityStatus) => {
    const invite = selectedAvailabilityInvite
    if (!invite || bulkAction) return
    setBulkAction(availabilityStatus)
    try {
      const result = await setCoachInviteAvailabilityOnBehalf(user, invite, availabilityStatus)
      setSelectedPlayerIds([])
      await refreshAfterBulkAction()
      const label = availabilityStatus === 'available' ? 'Available' : 'Unavailable'
      setNotice(result.changed
        ? `${invite.playerName} is now ${label}. This was recorded as you acting on behalf. Squad selection is unchanged.`
        : `${invite.playerName} is already ${label}. Squad selection is unchanged.`)
    } catch (error) {
      setNotice(getCoachFriendlyError(error, 'The Player availability response could not be recorded.'))
    } finally {
      setBulkAction('')
    }
  }
  const confirmAvailabilityOnBehalf = (availabilityStatus) => {
    const invite = selectedAvailabilityInvite
    if (!invite) return
    const available = availabilityStatus === 'available'
    Alert.alert(
      available ? 'Accept on behalf of player?' : 'Mark player unavailable?',
      `This records ${available ? 'Available' : 'Unavailable'} by you as authorised Team staff. It does not sign in as or impersonate the Parent or Player. Squad selection is unchanged.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: available ? 'Accept on behalf' : 'Mark unavailable', style: available ? 'default' : 'destructive', onPress: () => void recordAvailabilityOnBehalf(availabilityStatus) },
      ],
    )
  }
  const renderSelectedInviteActions = () => selectedInvites.length ? (
    <View style={styles.stack}>
      <Text style={styles.body}>{selectedInvites.length} Player{selectedInvites.length === 1 ? '' : 's'} selected.</Text>
      {selectedAvailabilityInvite ? <View style={styles.row}>
        <Button disabled={selectionDisabled || selectedAvailabilityInvite.status === 'available' || Number(user.roleRank || 0) < 20} label={bulkAction === 'available' ? 'Recording Available...' : 'Accept on behalf of player'} onPress={() => confirmAvailabilityOnBehalf('available')} styles={styles} />
        <Button destructive disabled={selectionDisabled || selectedAvailabilityInvite.status === 'unavailable' || Number(user.roleRank || 0) < 20} label={bulkAction === 'unavailable' ? 'Recording Unavailable...' : 'Mark unavailable'} onPress={() => confirmAvailabilityOnBehalf('unavailable')} styles={styles} />
      </View> : <Text style={styles.body}>Select one Player to record availability on their behalf.</Text>}
      <Button disabled={!selectedCanBeResent || selectionDisabled || Number(user.roleRank || 0) < 50} label={bulkAction === 'resend' ? 'Resending Invitations...' : `Resend ${selectedInvites.length} invite${selectedInvites.length === 1 ? '' : 's'}`} onPress={resend} secondary styles={styles} />
      <Button destructive disabled={selectionDisabled || Number(user.roleRank || 0) < 20} label={bulkAction === 'remove' ? 'Removing Players...' : `Remove ${selectedInvites.length} from event`} onPress={openRemovalConfirmation} styles={styles} />
      {!selectedCanBeResent ? <Text style={styles.body}>Resend is available only when every selected Player is awaiting a response.</Text> : null}
    </View>
  ) : null
  return (
    <View style={styles.stack}>
      <Text style={styles.body}>Choose an upcoming Match or Training session to see its availability.</Text>
      {trainingGroups.map((group) => {
        const trainingInvites = collapseCoachInvitesByPlayer(group.invites)
        const trainingSummary = summarizeCoachInvites(trainingInvites)
        const expanded = group.key === trainingKey
        return (
          <View key={group.key} style={[styles.panel, expanded && styles.panelSelected]}>
            <Pressable accessibilityRole="button" onPress={() => { setTrainingKey(expanded ? '' : group.key); setMatchId(''); setSelectedPlayerIds([]); setRequestPanelOpen(false); setPlayerIds([]) }}>
              <Text style={styles.heading}>{group.title || 'Training'}</Text>
              <Text style={styles.body}>Training | {group.occurrenceDate || 'Date to be confirmed'} | Attending {trainingSummary.attending} | Awaiting response {trainingSummary.awaitingResponse}</Text>
              <Text style={styles.body}>{expanded ? 'Hide availability' : 'Open availability'}</Text>
            </Pressable>
            {expanded ? <>
              <Text style={styles.label}>Attending {trainingSummary.attending} | Maybe {trainingSummary.maybe} | Awaiting response {trainingSummary.awaitingResponse} | Not attending {trainingSummary.notAttending} | Invitation not sent {trainingSummary.invitationNotSent} | Delivery issue {trainingSummary.deliveryIssue}</Text>
              {selectedTrainingInvites.map((invite) => {
                const selected = selectedPlayerIds.includes(invite.playerId)
                return <Pressable accessibilityLabel={`${invite.playerName}, ${getCoachInviteStatusLabel(invite.status, invite.kind)}, send ${getCoachInviteDeliveryLabel(invite.deliveryStatus)}`} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: selectionDisabled }} disabled={selectionDisabled} key={invite.id} onPress={() => toggleSelection(invite.playerId)} style={[styles.availabilityRow, selected && styles.formChoiceSelected]}>
                  <View style={styles.availabilityPlayer}><View style={styles.availabilityPlayerName}><Text style={styles.body}>{invite.playerName}</Text><InviteCarpoolIcon invite={invite} styles={styles} /></View>{selected ? <Text style={styles.availabilitySelected}>Selected</Text> : null}</View>
                  <View><Text style={[styles.availabilityStatus, availabilityStatusStyle(invite.status, styles)]}>{getCoachInviteStatusLabel(invite.status, invite.kind)}</Text><InviteDeliveryTicks invite={invite} styles={styles} /></View>
                </Pressable>
              })}
              {renderSelectedInviteActions()}
              <Button label="Open Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} />
            </> : null}
          </View>
        )
      })}
      {openMatches.length ? openMatches.map((match) => {
        const matchInvites = collapseCoachInvitesByPlayer((data.match || []).filter((invite) => invite.eventId === match.id && !invite.cancelled && !invite.stale))
        const matchSummary = summarizeCoachInvites(matchInvites)
        const expanded = match.id === matchId
        return (
          <View key={match.id} style={[styles.panel, expanded && styles.panelSelected]}>
            <Pressable accessibilityRole="button" onPress={() => { setMatchId(expanded ? '' : match.id); setTrainingKey(''); setSelectedPlayerIds([]); setRequestPanelOpen(false); setPlayerIds([]) }}>
              <Text style={styles.heading}>{match.opponent || 'Opponent to be confirmed'}</Text>
              <Text style={styles.body}>{match.matchDate || 'Date to be confirmed'} | Available {matchSummary.available} | Awaiting {matchSummary.awaiting}</Text>
              <Text style={styles.body}>{expanded ? 'Hide availability' : 'Open availability'}</Text>
            </Pressable>
            {expanded ? <>
              <Text style={styles.label}>Available {matchSummary.available} | Not available {matchSummary.unavailable} | Maybe {matchSummary.maybe} | Awaiting {matchSummary.awaiting}</Text>
              <Text style={styles.body}>{matchRequestPlayerCount} Player{matchRequestPlayerCount === 1 ? '' : 's'} shown below already {matchRequestPlayerCount === 1 ? 'has' : 'have'} an availability request. {availablePlayers.length} current Team Player{availablePlayers.length === 1 ? '' : 's'} {availablePlayers.length === 1 ? 'has' : 'have'} no request.</Text>
              {selectedMatchInvites.length ? selectedMatchInvites.map((invite) => {
                const selected = selectedPlayerIds.includes(invite.playerId)
                return <Pressable accessibilityLabel={`${invite.playerName}, ${getCoachInviteStatusLabel(invite.status, invite.kind)}, send ${getCoachInviteDeliveryLabel(invite.deliveryStatus)}`} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: selectionDisabled }} disabled={selectionDisabled} key={invite.id} onPress={() => toggleSelection(invite.playerId)} style={[styles.availabilityRow, selected && styles.formChoiceSelected]}>
                  <View style={styles.availabilityPlayer}><View style={styles.availabilityPlayerName}><Text style={styles.body}>{invite.playerName}</Text><InviteCarpoolIcon invite={invite} styles={styles} /></View>{selected ? <Text style={styles.availabilitySelected}>Selected</Text> : null}</View>
                  <View><Text style={[styles.availabilityStatus, availabilityStatusStyle(invite.status, styles)]}>{getCoachInviteStatusLabel(invite.status, invite.kind)}</Text><InviteDeliveryTicks invite={invite} styles={styles} /></View>
                </Pressable>
              }) : <Text style={styles.body}>No availability requests have been sent for this fixture.</Text>}
              {selectedMatchInvites.length ? <Text style={styles.helper}>Sent and Delivered show provider progress. Seen turns green only after a Parent or Player response is recorded.</Text> : null}
              {renderSelectedInviteActions()}
              {availablePlayers.length ? <Button label={requestPanelOpen ? 'Hide request setup' : `Choose ${availablePlayers.length} Team Players with no request`} onPress={() => setRequestPanelOpen((current) => { const next = !current; setPlayerIds(next ? availablePlayers.map((player) => player.id) : []); return next })} secondary styles={styles} /> : <Text style={styles.body}>Every current Team Player already has an availability request for this fixture.</Text>}
              {requestPanelOpen ? <View style={styles.stack}>
                <Text style={styles.heading}>Create availability requests</Text>
                <Text style={styles.body}>{availablePlayers.length} Team Player{availablePlayers.length === 1 ? '' : 's'} currently {availablePlayers.length === 1 ? 'has' : 'have'} no request for this fixture. {playerIds.length} selected to receive one. Players who already have a request or response are excluded and cannot be resent from this action.</Text>
                {availablePlayers.length ? <>
                  <Button label={playerIds.length === availablePlayers.length ? 'Clear selection' : 'Select all'} onPress={() => setPlayerIds(playerIds.length === availablePlayers.length ? [] : availablePlayers.map((player) => player.id))} secondary styles={styles} />
                  <View style={styles.row}>{availablePlayers.map((player) => { const selectedPlayer = playerIds.includes(player.id); return <Button key={player.id} label={player.playerName} onPress={() => setPlayerIds((current) => selectedPlayer ? current.filter((id) => id !== player.id) : [...current, player.id])} secondary={!selectedPlayer} styles={styles} /> })}</View>
                  <Button disabled={stale || creating || Boolean(uncertainAttempt) || playerIds.length === 0 || Number(user.roleRank || 0) < 20} label={`Review and send ${playerIds.length} request${playerIds.length === 1 ? '' : 's'}`} onPress={confirmCreate} styles={styles} />
                </> : <Text style={styles.body}>Every active Player already has a request.</Text>}
                {uncertainAttempt ? <Button disabled={creating || stale} label="Reconcile last request" onPress={() => void reconcile()} secondary styles={styles} /> : null}
              </View> : null}
              <View style={styles.row}><Button label="Open Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} /><Button label="Open Match Day" onPress={() => onNavigate('matchday')} secondary styles={styles} /></View>
            </> : null}
          </View>
        )
      }) : trainingGroups.length ? null : <Empty copy="No upcoming Match or Training availability request is available." styles={styles} />}
      <Modal animationType="fade" onRequestClose={() => setRemovalConfirmation(null)} transparent visible={Boolean(removalConfirmation)}>
        <View accessibilityViewIsModal style={styles.confirmationScreen}>
          <Pressable accessibilityLabel="Cancel Player removal" accessibilityRole="button" onPress={() => setRemovalConfirmation(null)} style={styles.confirmationBackdrop} />
          <View accessibilityLiveRegion="assertive" style={styles.confirmationCard}>
            <Text style={styles.heading}>Remove {removalConfirmation?.invites.length || 0} Player{removalConfirmation?.invites.length === 1 ? '' : 's'} from event?</Text>
            <Text style={styles.body}>Team membership and Player records stay unchanged. Previous response and delivery history is preserved. No removal notification will be sent.{removalConfirmation?.invites[0]?.kind === 'training' ? ' For Training, only the selected session is affected.' : ''}{removalConfirmation?.requiresInProgressConfirmation ? ' This event is in progress, but recorded Match or attendance history will remain.' : ''}</Text>
            {removalConfirmation?.error ? <Text accessibilityLiveRegion="assertive" style={styles.confirmationError}>{removalConfirmation.error}</Text> : null}
            <View style={styles.confirmationActions}>
              <View style={styles.confirmationAction}><Button disabled={Boolean(bulkAction)} label="Cancel" onPress={() => setRemovalConfirmation(null)} secondary styles={styles} /></View>
              <View style={styles.confirmationAction}><Button destructive disabled={Boolean(bulkAction)} label={bulkAction === 'preview' ? 'Checking...' : removalConfirmation?.previewed ? 'Confirm removal' : 'Remove from event'} onPress={() => void confirmSelectedRemoval()} styles={styles} /></View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}
