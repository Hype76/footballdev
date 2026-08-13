import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import {
  createCoachExternalResource,
  createCoachMatchAvailabilityRequests,
  createCoachPoll,
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
  recordCoachInviteIntent,
  removeCoachResourceSharing,
  saveCoachDevelopmentDraft,
  sendCoachChatMessage,
  setCoachResourceSharing,
  setCoachPollStatus,
  submitCoachPollVote,
} from '../../mobile-core/src/coachPhase31EData'
import {
  COACH_PHASE_31E_BACKEND_DELTAS,
  COACH_PHASE_31E_COMMUNICATION_POLICY,
  getCoachPhase31EOfflinePolicy,
  getCoachResourceErrorMessage,
  isCoachMatchAvailabilityRequestCreationApplied,
  isSyntheticCoachTarget,
  sanitizeCoachChatOfflineValue,
  summarizeCoachInvites,
  summarizeCoachPoll,
} from '../../mobile-core/src/coachPhase31ECore'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

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
    roomSelector: { gap: 8, paddingRight: 12 },
    panel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 8, padding: 14 },
    panelSelected: { borderColor: palette.accent, borderWidth: 2 },
    title: { color: palette.textPrimary, fontSize: 26, fontWeight: '900' },
    heading: { color: palette.textPrimary, fontSize: 17, fontWeight: '900' },
    body: { color: palette.textSecondary, fontSize: 14, lineHeight: 20 },
    label: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
    status: { color: palette.accent, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
    input: { backgroundColor: palette.background, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.textPrimary, fontSize: 16, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
    primary: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    primaryText: { color: palette.accentForeground, fontSize: 14, fontWeight: '900' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    secondaryText: { color: palette.textPrimary, fontSize: 14, fontWeight: '800' },
    danger: { color: palette.danger, fontSize: 14, fontWeight: '800' },
    disabled: { opacity: 0.48 },
    divider: { backgroundColor: palette.border, height: 1 },
  })
}

function Button({ disabled = false, label, onPress, secondary = false, styles }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[secondary ? styles.secondary : styles.primary, disabled && styles.disabled]}>
      <Text style={secondary ? styles.secondaryText : styles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function Empty({ copy, styles }) {
  return <View style={styles.panel}><Text style={styles.body}>{copy}</Text></View>
}

export function CoachPhase31EScreen({ chatNotificationTarget, domain, context, onChatNotificationTargetHandled, onNavigate, palette, user }) {
  const styles = useMemo(() => phaseStyles(palette), [palette])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [stale, setStale] = useState(false)
  const offlinePolicy = getCoachPhase31EOfflinePolicy(domain)

  const load = useCallback(async () => {
    const loader = LOADERS[domain]
    if (!loader) return
    setLoading(true)
    setError('')
    setNotice('')
    if (domain === 'chat') setData(null)
    try {
      const next = await loader(user)
      setData(next)
      setStale(false)
      const offlineValue = domain === 'chat' ? sanitizeCoachChatOfflineValue(next) : next
      await saveCoachOfflineResources(user.id, context, { [`phase31e:${domain}`]: offlineValue })
    } catch (loadError) {
      const cached = await readCoachOfflineResources(user.id, context).catch(() => null)
      const savedValue = cached?.resources?.[`phase31e:${domain}`]
      const offlineValue = domain === 'chat' ? sanitizeCoachChatOfflineValue(savedValue) : savedValue
      if (offlinePolicy.cache && offlineValue) {
        setData(offlineValue)
        setStale(true)
        setNotice('Showing encrypted offline data. Changes require a connection.')
      } else {
        setError(loadError?.message || `${TITLES[domain]} could not be loaded.`)
      }
    } finally {
      setLoading(false)
    }
  }, [context, domain, offlinePolicy.cache, user])

  useEffect(() => { void load() }, [load])

  const common = { chatNotificationTarget, data, load, notice, onChatNotificationTargetHandled, onNavigate, placeholderColor: palette.textSecondary, setNotice, stale, styles, user }
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.title}>{TITLES[domain]}</Text>
        <Text style={styles.body}>{context.teamName || context.clubName} | {context.roleLabel}</Text>
        {stale ? <Text accessibilityLabel="Offline stale data" style={styles.status}>Offline and read-only</Text> : null}
        {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
      </View>
      {loading ? <Empty copy={`Loading ${TITLES[domain]}...`} styles={styles} /> : null}
      {error ? <View style={styles.panel}><Text accessibilityLiveRegion="assertive" style={styles.danger}>{error}</Text><Button label="Try again" onPress={load} styles={styles} /></View> : null}
      {!loading && !error && domain === 'development' ? <DevelopmentDomain {...common} /> : null}
      {!loading && !error && domain === 'resources' ? <ResourcesDomain {...common} /> : null}
      {!loading && !error && domain === 'chat' ? <ChatDomain {...common} /> : null}
      {!loading && !error && domain === 'messages' ? <MessagesDomain {...common} /> : null}
      {!loading && !error && domain === 'polls' ? <PollsDomain {...common} /> : null}
      {!loading && !error && domain === 'invites' ? <InvitesDomain {...common} /> : null}
      <View style={styles.panel}>
        <Text style={styles.heading}>Safety boundary</Text>
        <Text style={styles.body}>{config.isProduction ? 'Production mutations are online-only and use canonical server authority. Recipient communication requires an explicit confirmed action. Unsafe offline replay is disabled.' : `Real email ${COACH_PHASE_31E_COMMUNICATION_POLICY.realEmail}. Real push ${COACH_PHASE_31E_COMMUNICATION_POLICY.realPush}. SMS ${COACH_PHASE_31E_COMMUNICATION_POLICY.sms}. Unsafe offline replay is disabled.`}</Text>
      </View>
    </View>
  )
}

function DevelopmentDomain({ data, load, setNotice, stale, styles, user }) {
  const [playerId, setPlayerId] = useState(data.players?.[0]?.id || '')
  const [formId, setFormId] = useState(data.forms?.[0]?.id || '')
  const [values, setValues] = useState({})
  const [notes, setNotes] = useState('')
  const [draft, setDraft] = useState(null)
  const player = data.players?.find((item) => item.id === playerId)
  const form = data.forms?.find((item) => item.id === formId)
  const records = data.records?.filter((record) => !playerId || record.playerId === playerId) || []

  const saveDraft = async () => {
    try {
      const result = await saveCoachDevelopmentDraft(user, { draftId: draft?.id, form, player, values, clientSaveVersion: draft?.clientSaveVersion || 0 })
      setDraft(result)
      setNotice('Private Development draft saved with server version control.')
    } catch (error) { setNotice(error.message) }
  }
  const finalise = () => Alert.alert('Finalise Development record?', 'Final records cannot be edited from this mobile workflow.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Finalise', onPress: async () => {
      try {
        await finalizeCoachDevelopmentRecord(user, { draftId: draft?.id, form, player, values, notes, shareWithParent: false })
        setNotice('Development record finalised. Parent sharing remains off.')
        setValues({})
        setNotes('')
        setDraft(null)
        await load()
      } catch (error) { setNotice(error.message) }
    } },
  ])

  if (!data.players?.length || !data.forms?.length) return <Empty copy="No active Player and dynamic Development form combination is available in this Team." styles={styles} />
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <Text style={styles.heading}>Player</Text>
        <View style={styles.row}>{data.players.map((item) => <Button key={item.id} label={item.playerName} onPress={() => setPlayerId(item.id)} secondary={item.id !== playerId} styles={styles} />)}</View>
        <Text style={styles.heading}>Form</Text>
        <View style={styles.row}>{data.forms.map((item) => <Button key={item.id} label={item.name} onPress={() => setFormId(item.id)} secondary={item.id !== formId} styles={styles} />)}</View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>{form?.name}</Text>
        <Text style={styles.body}>{form?.ageGroup ? `Configured age group: ${form.ageGroup}.` : 'Uses the current canonical Team form configuration.'}</Text>
        {(form?.fields || []).filter((field) => Number(user.roleRank || 0) >= field.roleRank).map((field) => (
          <View key={field.id} style={styles.stack}>
            <Text style={styles.label}>{field.label}{field.required ? ' (required)' : ''}{field.staffPrivate ? ' | Staff private' : field.parentVisible ? ' | Parent-shareable' : ''}</Text>
            {field.type === 'boolean' || field.type === 'checkbox' ? (
              <Button label={values[field.id] ? 'Yes' : 'No'} onPress={() => setValues((current) => ({ ...current, [field.id]: !current[field.id] }))} secondary styles={styles} />
            ) : field.options.length ? (
              <View style={styles.row}>{field.options.map((option) => <Button key={option.id} label={option.label} onPress={() => setValues((current) => ({ ...current, [field.id]: option.value }))} secondary={values[field.id] !== option.value} styles={styles} />)}</View>
            ) : (
              <TextInput accessibilityLabel={field.label} keyboardType={['number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type) ? 'numeric' : 'default'} multiline={field.type === 'textarea'} onChangeText={(value) => setValues((current) => ({ ...current, [field.id]: value }))} style={[styles.input, field.type === 'textarea' && styles.inputMultiline]} value={String(values[field.id] ?? '')} />
            )}
          </View>
        ))}
        <Text style={styles.label}>Staff summary note</Text>
        <TextInput accessibilityLabel="Staff summary note" multiline onChangeText={setNotes} style={[styles.input, styles.inputMultiline]} value={notes} />
        <View style={styles.row}><Button disabled={stale} label="Save private draft" onPress={saveDraft} secondary styles={styles} /><Button disabled={stale} label="Finalise" onPress={finalise} styles={styles} /></View>
      </View>
      <View style={styles.panel}>
        <Text style={styles.heading}>Development history</Text>
        {records.length ? records.slice(0, 10).map((record) => <Text key={record.id} style={styles.body}>{record.date || 'No date'} | {record.status} | {record.formName || 'Development record'} | {record.averageScore ?? 'No score'}</Text>) : <Text style={styles.body}>No Development history for this Player.</Text>}
      </View>
    </View>
  )
}

function ResourcesDomain({ data, load, setNotice, stale, styles, user }) {
  const [title, setTitle] = useState(config.isProduction ? '' : 'FP TEST resource')
  const [url, setUrl] = useState(config.isProduction ? '' : 'https://example.com/fp-test-resource')
  const [selectedId, setSelectedId] = useState(data[0]?.id || '')
  const selected = data.find((resource) => resource.id === selectedId)
  const open = async (resource) => {
    try {
      const accessUrl = await getCoachResourceAccessUrl(user, resource)
      if (!await Linking.canOpenURL(accessUrl)) throw new Error('This Resource link is not supported on this device.')
      await Linking.openURL(accessUrl)
      setNotice('Resource opened.')
    } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
  }
  const create = async () => {
    try { await createCoachExternalResource(user, { title, externalUrl: url, category: 'general' }); setNotice(config.isProduction ? 'External Resource created.' : 'Synthetic external Resource created.'); await load() } catch (error) { setNotice(error.message) }
  }
  const shareWithTeam = async () => {
    try { await setCoachResourceSharing(user, selected, [{ linkedId: user.activeTeamId, linkedType: 'team', teamId: user.activeTeamId }], config.isProduction ? 'Shared from Football Player Coach' : 'Shared from Coach mobile FP TEST'); setNotice(config.isProduction ? 'Resource shared with the active Team.' : 'Resource shared with the active FP TEST Team.'); await load() } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
  }
  const removeSharing = async (linkId) => {
    try { await removeCoachResourceSharing(user, selected, linkId); setNotice('Resource assignment removed.'); await load() } catch (error) { setNotice(getCoachResourceErrorMessage(error)) }
  }
  return (
    <View style={styles.stack}>
      {data.length ? data.map((resource) => <Pressable accessibilityRole="button" accessibilityState={{ selected: resource.id === selectedId }} key={resource.id} onPress={() => setSelectedId(resource.id)} style={[styles.panel, resource.id === selectedId && styles.panelSelected]}><Text style={styles.heading}>{resource.title}</Text><Text style={styles.body}>{user.activeTeamName || resource.teamName || 'Active Team'} only | {resource.category} | {resource.type}</Text><Text style={styles.body}>{resource.description || 'No description'}</Text><Button label="Open Resource" onPress={() => void open(resource)} styles={styles} /></Pressable>) : <Empty copy="No active Team Resources are available." styles={styles} />}
      {selected && !selected.isFormationBoard ? <View style={styles.panel}><Text style={styles.heading}>Manage selected Resource</Text><Button disabled={stale || Number(user.roleRank || 0) < 50} label="Share with active Team" onPress={shareWithTeam} secondary styles={styles} />{selected.links.map((link) => <View key={link.id} style={styles.stack}><Text style={styles.body}>{link.linkedType} | {link.parentVisible ? 'Parent shared' : 'Staff only'} | {link.shareDescription || 'No description'}</Text><Button disabled={stale || Number(user.roleRank || 0) < 50} label="Remove assignment" onPress={() => void removeSharing(link.id)} secondary styles={styles} /></View>)}</View> : null}
      <View style={styles.panel}><Text style={styles.heading}>Add secure external link</Text><TextInput accessibilityLabel="Resource title" onChangeText={setTitle} style={styles.input} value={title} /><TextInput accessibilityLabel="HTTPS Resource URL" autoCapitalize="none" keyboardType="url" onChangeText={setUrl} style={styles.input} value={url} /><Button disabled={stale || Number(user.roleRank || 0) < 50} label={config.isProduction ? 'Create Resource' : 'Create FP TEST Resource'} onPress={create} styles={styles} /><Text style={styles.body}>File upload, bulk governance, archive, and retention stay in the web workflow.</Text></View>
    </View>
  )
}

function ChatDomain({ chatNotificationTarget, data, onChatNotificationTargetHandled, onNavigate, setNotice, stale, styles, user }) {
  const rooms = useMemo(() => [...(data.staff || []), ...(data.parent || [])], [data])
  const [roomId, setRoomId] = useState(rooms[0]?.id || '')
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const activeRoomId = rooms.some((item) => item.id === roomId) ? roomId : rooms[0]?.id || ''
  const room = rooms.find((item) => item.id === activeRoomId)
  const open = useCallback(async (nextRoom) => {
    setMessages([])
    setBody('')
    setRoomId(nextRoom.id)
    setNotice('Loading current room history...')
    try { const next = await getCoachChatMessages(user, nextRoom); setMessages(next); await markCoachChatRead(user, nextRoom); setNotice('') } catch (error) { setMessages([]); setNotice(error.message) }
  }, [setNotice, user])
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
  const send = async () => {
    try { setMessages(await sendCoachChatMessage(user, room, body)); setBody(''); setNotice(config.isProduction ? 'Message sent through the canonical Chat.' : 'Synthetic Chat message saved inside FP TEST only.') } catch (error) { setNotice(error.message) }
  }
  if (!rooms.length) return <Empty copy="No Staff Chat or Parent Chat membership is available in this Team." styles={styles} />
  return (
    <View style={styles.stack}>
      <View style={styles.row}><Button label="Team Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} /><Button label="Match Day" onPress={() => onNavigate('matchday')} secondary styles={styles} /></View>
      <View style={styles.stack}>
        <Text style={styles.label}>Choose conversation</Text>
        <Text style={styles.body}>{rooms.length} authorised conversation{rooms.length === 1 ? '' : 's'}</Text>
        <ScrollView contentContainerStyle={styles.roomSelector} horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
          {rooms.map((item) => <Button key={`${item.kind}:${item.id}`} label={`${item.kind === 'staff' ? 'Staff' : 'Parent'} | ${item.title}`} onPress={() => void open(item)} secondary={item.id !== activeRoomId} styles={styles} />)}
        </ScrollView>
      </View>
      <View style={styles.panel}><Text style={styles.heading}>{room?.title}</Text><Text style={styles.body}>{room?.kind === 'staff' ? 'Staff-only membership authority' : 'Parent Chat staff authority'} | {room?.unreadCount || 0} unread</Text>{messages.length ? messages.map((message) => <View key={message.id} style={styles.stack}><Text style={styles.label}>{message.senderName}</Text><Text style={styles.body}>{message.deletedAt ? 'Message deleted.' : message.body}</Text></View>) : <Text style={styles.body}>No messages loaded yet.</Text>}<TextInput accessibilityLabel="Chat message" multiline onChangeText={setBody} style={[styles.input, styles.inputMultiline]} value={body} /><Button disabled={stale || !room?.canPost || (!config.isProduction && !isSyntheticCoachTarget(room?.title))} label={config.isProduction ? 'Send message' : 'Send to FP TEST channel'} onPress={send} styles={styles} /><Text style={styles.body}>{config.isProduction ? 'Sending is online-only and the server revalidates current room membership.' : 'Sending is online-only and restricted to rooms marked FP TEST. No customer delivery is permitted.'}</Text></View>
    </View>
  )
}

function MessagesDomain({ data, styles }) {
  const messageDelta = COACH_PHASE_31E_BACKEND_DELTAS.find((item) => item.capability === 'Standalone staff Messages inbox')
  return (
    <View style={styles.stack}>
      {data.length ? data.map((message) => <View key={message.id} style={styles.panel}><Text style={styles.heading}>{message.subject}</Text><Text style={styles.body}>{message.channel || 'system'} | {message.status} | {message.createdAt || 'No date'}</Text><Text style={styles.body}>{message.body || message.action || 'Recorded communication event'}</Text></View>) : <Empty copy="No Team communication history is available." styles={styles} />}
      <View style={styles.panel}><Text style={styles.heading}>Current product boundary</Text><Text style={styles.body}>{messageDelta?.authority}. Compose remains inside the canonical domain workflow, so this screen does not invent a second sending system.</Text></View>
    </View>
  )
}

function PollsDomain({ data, load, placeholderColor, setNotice, stale, styles, user }) {
  const [selectedId, setSelectedId] = useState(data[0]?.id || '')
  const [allowMultiple, setAllowMultiple] = useState(true)
  const [allowVoteChanges, setAllowVoteChanges] = useState(true)
  const [anonymous, setAnonymous] = useState(false)
  const [audience, setAudience] = useState('parents')
  const [creating, setCreating] = useState(false)
  const [description, setDescription] = useState('')
  const [maxChoices, setMaxChoices] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [title, setTitle] = useState('')
  const [votingOptionId, setVotingOptionId] = useState('')
  const selected = data.find((poll) => poll.id === selectedId)
  const create = async () => {
    const pollOptions = options.map((label, index) => ({ id: `option-${index + 1}`, label: label.trim() })).filter((option) => option.label)
    if (!title.trim() || pollOptions.length < 2) {
      setNotice('Add a Poll title and at least two options.')
      return
    }
    setCreating(true)
    try {
      await createCoachPoll(user, {
        allowMultiple,
        allowVoteChanges,
        anonymous,
        audience,
        description,
        maxChoices: allowMultiple ? Number(maxChoices || 0) || null : null,
        options: pollOptions,
        title: title.trim(),
      })
      setTitle('')
      setDescription('')
      setOptions(['', ''])
      setMaxChoices('')
      await load()
      setNotice('Poll created. No notification or message was sent automatically.')
    } catch (error) { setNotice(error.message) }
    finally { setCreating(false) }
  }
  const close = () => Alert.alert('Close this Poll?', 'Responses remain in the canonical history.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Close', onPress: async () => { try { await setCoachPollStatus(user, selected, 'closed'); setNotice('Poll closed.'); await load() } catch (error) { setNotice(error.message) } } }])
  const reopen = async () => { try { await setCoachPollStatus(user, selected, 'open'); setNotice('Poll reopened.'); await load() } catch (error) { setNotice(error.message) } }
  const vote = async (poll, optionId) => {
    setVotingOptionId(`${poll.id}:${optionId}`)
    try {
      await submitCoachPollVote(user, poll, optionId)
      await load()
      setNotice('Your Poll response has been saved.')
    } catch (error) { setNotice(error.message) }
    finally { setVotingOptionId('') }
  }
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <Text style={styles.heading}>Create Poll</Text>
        <Text style={styles.body}>Create the exact question and options Parents or staff will answer. Creating a Poll does not send a notification automatically.</Text>
        <Text style={styles.label}>Question</Text>
        <TextInput accessibilityLabel="Poll question" onChangeText={setTitle} placeholder="Poll question" placeholderTextColor={placeholderColor} style={styles.input} value={title} />
        <Text style={styles.label}>Description, optional</Text>
        <TextInput accessibilityLabel="Poll description" multiline onChangeText={setDescription} placeholder="Helpful details" placeholderTextColor={placeholderColor} style={[styles.input, styles.inputMultiline]} value={description} />
        <Text style={styles.label}>Audience</Text>
        <View style={styles.row}><Button label="Parents" onPress={() => setAudience('parents')} secondary={audience !== 'parents'} styles={styles} /><Button label="Staff" onPress={() => setAudience('staff')} secondary={audience !== 'staff'} styles={styles} /></View>
        <Text style={styles.label}>Options</Text>
        {options.map((option, index) => <View key={index} style={styles.row}><TextInput accessibilityLabel={`Poll option ${index + 1}`} onChangeText={(value) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))} placeholder={`Option ${index + 1}`} placeholderTextColor={placeholderColor} style={[styles.input, { flex: 1 }]} value={option} />{options.length > 2 ? <Button label="Remove" onPress={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))} secondary styles={styles} /> : null}</View>)}
        {options.length < 8 ? <Button label="Add option" onPress={() => setOptions((current) => [...current, ''])} secondary styles={styles} /> : null}
        <View style={styles.row}><Text style={styles.label}>Allow more than one answer</Text><Switch accessibilityLabel="Allow more than one answer" onValueChange={setAllowMultiple} value={allowMultiple} /></View>
        {allowMultiple ? <><Text style={styles.label}>Maximum choices, optional</Text><TextInput accessibilityLabel="Maximum Poll choices" keyboardType="number-pad" onChangeText={setMaxChoices} placeholder="Leave blank for unlimited" placeholderTextColor={placeholderColor} style={styles.input} value={maxChoices} /><Text style={styles.body}>{maxChoices ? `Parents can choose up to ${maxChoices} answers.` : 'Parents can choose any number of answers and tap again to remove one.'}</Text></> : null}
        <View style={styles.row}><Text style={styles.label}>Allow answer changes</Text><Switch accessibilityLabel="Allow Poll answer changes" onValueChange={setAllowVoteChanges} value={allowVoteChanges} /></View>
        <View style={styles.row}><Text style={styles.label}>Hide voter names</Text><Switch accessibilityLabel="Hide Poll voter names" onValueChange={setAnonymous} value={anonymous} /></View>
        <Button disabled={stale || creating || Number(user.roleRank || 0) < 50 || !title.trim() || options.filter((option) => option.trim()).length < 2} label={creating ? 'Creating Poll...' : 'Create Poll'} onPress={() => void create()} styles={styles} />
      </View>
      {data.length ? data.map((poll) => {
        const currentOptionIds = poll.currentOptionIds || []
        return <Pressable accessibilityRole="button" key={poll.id} onPress={() => setSelectedId(poll.id)} style={[styles.panel, poll.id === selectedId && styles.panelSelected]}><Text style={styles.heading}>{poll.title}</Text><Text style={styles.body}>{poll.audience} | {poll.status} | {poll.anonymous ? 'Anonymous' : 'Named responses'} | {poll.allowMultiple ? poll.maxChoices ? `Up to ${poll.maxChoices}` : 'Unlimited choices' : 'One choice'}</Text>{summarizeCoachPoll(poll).map((option) => { const chosen = currentOptionIds.includes(option.id); const atLimit = poll.allowMultiple && Number(poll.maxChoices || 0) > 0 && currentOptionIds.length >= Number(poll.maxChoices) && !chosen; return <View key={option.id} style={styles.row}><Text style={styles.body}>{option.label}: {option.count}</Text>{poll.audience === 'staff' && poll.status === 'open' ? <Button disabled={stale || Boolean(votingOptionId) || atLimit || (currentOptionIds.length > 0 && poll.allowVoteChanges !== true)} label={votingOptionId === `${poll.id}:${option.id}` ? 'Saving...' : chosen ? 'Remove my answer' : 'Choose'} onPress={() => void vote(poll, option.id)} secondary={!chosen} styles={styles} /> : null}</View>})}</Pressable>
      }) : <Empty copy="No Team or Club Polls are available." styles={styles} />}
      <View style={styles.row}><Button disabled={stale || !selected || selected.status === 'closed' || Number(user.roleRank || 0) < 50} label="Close selected Poll" onPress={close} secondary styles={styles} /><Button disabled={stale || !selected || selected.status !== 'closed' || Number(user.roleRank || 0) < 50} label="Reopen selected Poll" onPress={() => void reopen()} secondary styles={styles} /></View>
    </View>
  )
}

function InvitesDomain({ data, load, onNavigate, setNotice, stale, styles, user }) {
  const [selectedId, setSelectedId] = useState(data.all?.[0]?.id || '')
  const openMatches = (data.matches || []).filter((match) => match.teamId === user.activeTeamId && ['scheduled', 'scorer_request'].includes(match.status))
  const [matchId, setMatchId] = useState(openMatches[0]?.id || '')
  const [playerIds, setPlayerIds] = useState([])
  const [creating, setCreating] = useState(false)
  const [uncertainAttempt, setUncertainAttempt] = useState(null)
  const selected = data.all?.find((invite) => invite.id === selectedId)
  const selectedMatch = openMatches.find((match) => match.id === matchId)
  const summary = summarizeCoachInvites(data.all)
  const record = async (action) => {
    try {
      const result = await recordCoachInviteIntent(user, selected, action)
      setNotice(config.isProduction ? `Invitation resent to ${result.recipientCount} server-resolved recipient${result.recipientCount === 1 ? '' : 's'}.` : `${action} intent recorded. External delivery remains disabled.`)
    } catch (error) { setNotice(error.message) }
  }
  const resend = () => {
    if (!config.isProduction) return void record('resend')
    Alert.alert('Resend this Invitation?', 'This queues the approved Invitation to the server-resolved eligible contacts. The existing response identity and any saved response are preserved.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resend', onPress: () => void record('resend') },
    ])
  }
  const createRequests = async () => {
    const attempt = { matchId: selectedMatch?.id || '', playerIds: [...playerIds] }
    setCreating(true)
    setUncertainAttempt(null)
    try {
      const result = await createCoachMatchAvailabilityRequests(user, selectedMatch, playerIds)
      setNotice(`Match availability requests created. Queued ${result.queuedCount}; duplicates ${result.duplicateCount}; missing contacts ${result.missingContactCount}.`)
      setPlayerIds([])
      await load()
    } catch (error) {
      try {
        const current = await getCoachInvitesAndAvailability(user)
        if (isCoachMatchAvailabilityRequestCreationApplied(current, attempt.matchId, attempt.playerIds)) {
          setNotice('The server confirmed that all selected Match availability requests were created. No retry is needed.')
          setPlayerIds([])
        } else {
          setNotice(`${error.message} The server confirmed that the complete request set was not created. Review current invitations before retrying.`)
        }
        await load()
      } catch {
        setUncertainAttempt(attempt)
        setNotice(`${error.message} The result is uncertain. Reconcile with the server before retrying.`)
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
    } catch (error) { setNotice(`${error.message} The result remains uncertain, so retry is still blocked.`) }
    finally { setCreating(false) }
  }
  const confirmCreate = () => Alert.alert('Create Match availability requests?', 'This uses the canonical Match workflow and may queue Parent email for the selected Players. Existing request identity is reused where the server supports it.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Create requests', onPress: () => void createRequests() },
  ])
  return (
    <View style={styles.stack}>
      <View style={styles.panel}><Text style={styles.heading}>Create Match availability requests</Text><Text style={styles.body}>Choose an open Match Day fixture and Players. The canonical production workflow creates the requests Parents see and controls any communication queue.</Text><View style={styles.row}>{openMatches.map((match) => <Button key={match.id} label={`${match.opponent} | ${match.matchDate || 'Date TBC'}`} onPress={() => setMatchId(match.id)} secondary={match.id !== matchId} styles={styles} />)}</View><View style={styles.row}>{(data.players || []).map((player) => { const selectedPlayer = playerIds.includes(player.id); return <Button key={player.id} label={player.playerName} onPress={() => setPlayerIds((current) => selectedPlayer ? current.filter((id) => id !== player.id) : [...current, player.id])} secondary={!selectedPlayer} styles={styles} /> })}</View>{openMatches.length === 0 ? <Text style={styles.body}>No open Match Day fixture is available.</Text> : null}<Button disabled={stale || creating || Boolean(uncertainAttempt) || !selectedMatch || playerIds.length === 0 || Number(user.roleRank || 0) < 20} label="Review and create requests" onPress={confirmCreate} styles={styles} />{uncertainAttempt ? <Button disabled={creating || stale} label="Reconcile last request" onPress={() => void reconcile()} secondary styles={styles} /> : null}</View>
      <View style={styles.panel}><Text style={styles.heading}>Response overview</Text><Text style={styles.body}>Awaiting {summary.awaiting} | Available {summary.available} | Unavailable {summary.unavailable} | Maybe {summary.maybe} | Selected {summary.selected} | Not selected {summary.notSelected} | Stale {summary.stale}</Text></View>
      {(data.all || []).length ? data.all.map((invite) => <Pressable accessibilityRole="button" key={`${invite.kind}:${invite.id}`} onPress={() => setSelectedId(invite.id)} style={[styles.panel, invite.id === selectedId && styles.panelSelected]}><Text style={styles.heading}>{invite.title}</Text><Text style={styles.body}>{invite.kind} | {invite.playerName} | {invite.status}</Text></Pressable>) : <Empty copy="No Match, training, or Calendar invitation responses are available." styles={styles} />}
      <View style={styles.row}><Button disabled={stale || !selected || selected.stale || selected.cancelled || Number(user.roleRank || 0) < 50} label={config.isProduction ? 'Resend Invitation' : 'Record resend intent'} onPress={resend} styles={styles} />{config.isProduction ? null : <Button disabled={stale || !selected || selected.stale || selected.cancelled || Number(user.roleRank || 0) < 50} label="Record close intent" onPress={() => void record('close')} secondary styles={styles} />}</View>
      <View style={styles.row}><Button label="Open Calendar" onPress={() => onNavigate('calendar')} secondary styles={styles} />{selected?.kind === 'match' ? <Button label="Open Match Day" onPress={() => onNavigate('matchday')} secondary styles={styles} /> : null}{selected?.kind === 'training' ? <Button label="Open Sessions" onPress={() => onNavigate('sessions')} secondary styles={styles} /> : null}</View>
      <Text style={styles.body}>{config.isProduction ? 'Resend is online-only, explicitly confirmed, recipient-scoped, and handled by the canonical production Invitation service. Close or cancel remains in the authoritative web workflow.' : 'Intent proof only. No email, push, SMS, schedule, or real customer communication is generated.'}</Text>
    </View>
  )
}
