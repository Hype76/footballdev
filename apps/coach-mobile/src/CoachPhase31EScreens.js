import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  createCoachExternalResource,
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
  saveCoachDevelopmentDraft,
  sendCoachChatMessage,
  setCoachPollStatus,
} from '../../mobile-core/src/coachPhase31EData'
import {
  COACH_PHASE_31E_BACKEND_DELTAS,
  COACH_PHASE_31E_COMMUNICATION_POLICY,
  getCoachPhase31EOfflinePolicy,
  isSyntheticCoachTarget,
  summarizeCoachInvites,
  summarizeCoachPoll,
} from '../../mobile-core/src/coachPhase31ECore'
import { readCoachOfflineResources, saveCoachOfflineResources } from './offline'

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
    panel: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: 18, borderWidth: 1, gap: 8, padding: 14 },
    panelSelected: { borderColor: palette.accent, borderWidth: 2 },
    title: { color: palette.text, fontSize: 26, fontWeight: '900' },
    heading: { color: palette.text, fontSize: 17, fontWeight: '900' },
    body: { color: palette.textMuted, fontSize: 14, lineHeight: 20 },
    label: { color: palette.text, fontSize: 13, fontWeight: '800' },
    status: { color: palette.accent, fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
    input: { backgroundColor: palette.input, borderColor: palette.border, borderRadius: 12, borderWidth: 1, color: palette.text, fontSize: 16, minHeight: 48, paddingHorizontal: 12, paddingVertical: 10 },
    inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
    primary: { alignItems: 'center', backgroundColor: palette.accent, borderRadius: 12, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    primaryText: { color: palette.onAccent, fontSize: 14, fontWeight: '900' },
    secondary: { alignItems: 'center', backgroundColor: palette.surfaceRaised, borderColor: palette.border, borderRadius: 12, borderWidth: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10 },
    secondaryText: { color: palette.text, fontSize: 14, fontWeight: '800' },
    danger: { color: palette.danger || palette.text, fontSize: 14, fontWeight: '800' },
    disabled: { opacity: 0.48 },
    divider: { backgroundColor: palette.border, height: 1 },
  })
}

function Button({ disabled = false, label, onPress, secondary = false, styles }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[secondary ? styles.secondary : styles.primary, disabled && styles.disabled]}>
      <Text style={secondary ? styles.secondaryText : styles.primaryText}>{label}</Text>
    </Pressable>
  )
}

function Empty({ copy, styles }) {
  return <View style={styles.panel}><Text style={styles.body}>{copy}</Text></View>
}

export function CoachPhase31EScreen({ domain, context, palette, user }) {
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
    try {
      const next = await loader(user)
      setData(next)
      setStale(false)
      await saveCoachOfflineResources(user.id, context.id, { [`phase31e:${domain}`]: next })
    } catch (loadError) {
      const cached = await readCoachOfflineResources(user.id, context.id).catch(() => null)
      const offlineValue = cached?.resources?.[`phase31e:${domain}`]
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
  }, [context.id, domain, offlinePolicy.cache, user])

  useEffect(() => { void load() }, [load])

  const common = { data, load, notice, setNotice, stale, styles, user }
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
        <Text style={styles.body}>Real email {COACH_PHASE_31E_COMMUNICATION_POLICY.realEmail}. Real push {COACH_PHASE_31E_COMMUNICATION_POLICY.realPush}. SMS {COACH_PHASE_31E_COMMUNICATION_POLICY.sms}. Unsafe offline replay is disabled.</Text>
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
  const [title, setTitle] = useState('FP TEST resource')
  const [url, setUrl] = useState('https://example.com/fp-test-resource')
  const open = async (resource) => {
    try { await Linking.openURL(await getCoachResourceAccessUrl(user, resource)) } catch (error) { setNotice(error.message) }
  }
  const create = async () => {
    try { await createCoachExternalResource(user, { title, externalUrl: url, category: 'general' }); setNotice('Synthetic external Resource created.'); await load() } catch (error) { setNotice(error.message) }
  }
  return (
    <View style={styles.stack}>
      {data.length ? data.map((resource) => <Pressable accessibilityRole="button" key={resource.id} onPress={() => void open(resource)} style={styles.panel}><Text style={styles.heading}>{resource.title}</Text><Text style={styles.body}>{resource.category} | {resource.type} | {resource.links.length} assignments</Text><Text style={styles.body}>{resource.description || 'No description'}</Text></Pressable>) : <Empty copy="No active Team Resources are available." styles={styles} />}
      <View style={styles.panel}><Text style={styles.heading}>Add secure external link</Text><TextInput accessibilityLabel="Resource title" onChangeText={setTitle} style={styles.input} value={title} /><TextInput accessibilityLabel="HTTPS Resource URL" autoCapitalize="none" keyboardType="url" onChangeText={setUrl} style={styles.input} value={url} /><Button disabled={stale || Number(user.roleRank || 0) < 50} label="Create FP TEST Resource" onPress={create} styles={styles} /><Text style={styles.body}>File upload, bulk governance, archive, and retention stay in the web workflow.</Text></View>
    </View>
  )
}

function ChatDomain({ data, setNotice, stale, styles, user }) {
  const rooms = [...(data.staff || []), ...(data.parent || [])]
  const [roomId, setRoomId] = useState(rooms[0]?.id || '')
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const room = rooms.find((item) => item.id === roomId)
  const open = async (nextRoom) => {
    setRoomId(nextRoom.id)
    try { const next = await getCoachChatMessages(user, nextRoom); setMessages(next); await markCoachChatRead(user, nextRoom) } catch (error) { setNotice(error.message) }
  }
  const send = async () => {
    try { setMessages(await sendCoachChatMessage(user, room, body)); setBody(''); setNotice('Synthetic Chat message saved inside FP TEST only.') } catch (error) { setNotice(error.message) }
  }
  if (!rooms.length) return <Empty copy="No Staff Chat or Parent Chat membership is available in this Team." styles={styles} />
  return (
    <View style={styles.stack}>
      <View style={styles.row}>{rooms.map((item) => <Button key={`${item.kind}:${item.id}`} label={`${item.kind === 'staff' ? 'Staff' : 'Parent'} | ${item.title}`} onPress={() => void open(item)} secondary={item.id !== roomId} styles={styles} />)}</View>
      <View style={styles.panel}><Text style={styles.heading}>{room?.title}</Text><Text style={styles.body}>{room?.kind === 'staff' ? 'Staff-only membership authority' : 'Parent Chat staff authority'} | {room?.unreadCount || 0} unread</Text>{messages.length ? messages.map((message) => <View key={message.id} style={styles.stack}><Text style={styles.label}>{message.senderName}</Text><Text style={styles.body}>{message.deletedAt ? 'Message deleted.' : message.body}</Text></View>) : <Text style={styles.body}>No messages loaded yet.</Text>}<TextInput accessibilityLabel="Chat message" multiline onChangeText={setBody} style={[styles.input, styles.inputMultiline]} value={body} /><Button disabled={stale || !room?.canPost || !isSyntheticCoachTarget(room?.title)} label="Send to FP TEST channel" onPress={send} styles={styles} /><Text style={styles.body}>Sending is online-only and restricted to rooms marked FP TEST. No customer delivery is permitted.</Text></View>
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

function PollsDomain({ data, load, setNotice, stale, styles, user }) {
  const [selectedId, setSelectedId] = useState(data[0]?.id || '')
  const selected = data.find((poll) => poll.id === selectedId)
  const create = async () => {
    try { await createCoachPoll(user, { title: `FP TEST availability ${Date.now()}`, audience: 'staff', options: [{ label: 'Available' }, { label: 'Unavailable' }], anonymous: true }); setNotice('Synthetic Poll created without external delivery.'); await load() } catch (error) { setNotice(error.message) }
  }
  const close = () => Alert.alert('Close this Poll?', 'Responses remain in the canonical history.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Close', onPress: async () => { try { await setCoachPollStatus(user, selected, 'closed'); setNotice('Poll closed.'); await load() } catch (error) { setNotice(error.message) } } }])
  return (
    <View style={styles.stack}>
      {data.length ? data.map((poll) => <Pressable accessibilityRole="button" key={poll.id} onPress={() => setSelectedId(poll.id)} style={[styles.panel, poll.id === selectedId && styles.panelSelected]}><Text style={styles.heading}>{poll.title}</Text><Text style={styles.body}>{poll.audience} | {poll.status} | {poll.anonymous ? 'Anonymous' : 'Named responses'}</Text>{summarizeCoachPoll(poll).map((option) => <Text key={option.id} style={styles.body}>{option.label}: {option.count}</Text>)}</Pressable>) : <Empty copy="No Team or Club Polls are available." styles={styles} />}
      <View style={styles.row}><Button disabled={stale || Number(user.roleRank || 0) < 50} label="Create FP TEST Poll" onPress={create} styles={styles} /><Button disabled={stale || !selected || selected.status === 'closed' || Number(user.roleRank || 0) < 50} label="Close selected Poll" onPress={close} secondary styles={styles} /></View>
    </View>
  )
}

function InvitesDomain({ data, setNotice, stale, styles, user }) {
  const [selectedId, setSelectedId] = useState(data.all?.[0]?.id || '')
  const selected = data.all?.find((invite) => invite.id === selectedId)
  const summary = summarizeCoachInvites(data.all)
  const record = async (action) => {
    try { await recordCoachInviteIntent(user, selected, action); setNotice(`${action} intent recorded. External delivery remains disabled.`) } catch (error) { setNotice(error.message) }
  }
  return (
    <View style={styles.stack}>
      <View style={styles.panel}><Text style={styles.heading}>Response overview</Text><Text style={styles.body}>Awaiting {summary.awaiting} | Available {summary.available} | Unavailable {summary.unavailable} | Maybe {summary.maybe} | Selected {summary.selected} | Not selected {summary.notSelected} | Stale {summary.stale}</Text></View>
      {(data.all || []).length ? data.all.map((invite) => <Pressable accessibilityRole="button" key={`${invite.kind}:${invite.id}`} onPress={() => setSelectedId(invite.id)} style={[styles.panel, invite.id === selectedId && styles.panelSelected]}><Text style={styles.heading}>{invite.title}</Text><Text style={styles.body}>{invite.kind} | {invite.playerName} | {invite.status}</Text></Pressable>) : <Empty copy="No Match, training, or Calendar invitation responses are available." styles={styles} />}
      <View style={styles.row}><Button disabled={stale || !selected || selected.stale || selected.cancelled || Number(user.roleRank || 0) < 50} label="Record resend intent" onPress={() => void record('resend')} styles={styles} /><Button disabled={stale || !selected || selected.stale || selected.cancelled || Number(user.roleRank || 0) < 50} label="Record close intent" onPress={() => void record('close')} secondary styles={styles} /></View>
      <Text style={styles.body}>Intent proof only. No email, push, SMS, schedule, or real customer communication is generated.</Text>
    </View>
  )
}
