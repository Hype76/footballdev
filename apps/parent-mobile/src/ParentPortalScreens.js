import { useMemo, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { getInvitationResponseOptions } from './parentPortalData'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function labelize(value) {
  const text = normalizeText(value).replaceAll('_', ' ')
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : ''
}

function formatDate(value, fallback = 'Date to be confirmed') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: value.includes?.('T') ? '2-digit' : undefined, minute: value.includes?.('T') ? '2-digit' : undefined })
}

function colorsFor(theme) {
  return theme === 'light'
    ? { accent: '#0d9488', background: '#f3f7f6', border: '#cbd8d5', card: '#ffffff', danger: '#b42318', muted: '#536461', text: '#132522', warning: '#8a5800' }
    : { accent: '#39d6bf', background: '#061412', border: '#24423d', card: '#10231f', danger: '#ff8f84', muted: '#9fb8b3', text: '#f3fbf9', warning: '#f2c96d' }
}

function usePortalStyles(theme) {
  return useMemo(() => {
    const colors = colorsFor(theme)
    return { colors, styles: StyleSheet.create({
      action: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 12, minHeight: 46, justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
      actionDanger: { backgroundColor: colors.danger },
      actionDisabled: { opacity: 0.45 },
      actionOutline: { backgroundColor: 'transparent', borderColor: colors.border, borderWidth: 1 },
      actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
      actionText: { color: theme === 'light' ? '#ffffff' : '#041411', fontSize: 14, fontWeight: '800' },
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
      pill: { alignSelf: 'flex-start', backgroundColor: theme === 'light' ? '#e1f5f1' : '#183a34', borderRadius: 999, color: colors.accent, fontSize: 12, fontWeight: '800', overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5 },
      row: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
      score: { color: colors.text, fontSize: 32, fontWeight: '900', textAlign: 'center' },
      section: { gap: 12 },
      stack: { gap: 14 },
      stat: { color: colors.text, fontSize: 16, fontWeight: '700' },
      warning: { color: colors.warning, fontSize: 14, lineHeight: 20 },
    }) }
  }, [theme])
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

export function CalendarScreen({ link, resource, theme }) {
  const { styles } = usePortalStyles(theme)
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Calendar</Text><Text style={styles.helper}>Training, matches and club events for {link?.playerName || 'your child'}.</Text></View>
      <ResourceState emptyCopy="There are no shared calendar events for this child." {...resource} styles={styles} />
      {resource.items.map((event) => (
        <View key={event.id} style={styles.card}>
          <View style={styles.row}><Text style={styles.pill}>{labelize(event.status === 'cancelled' ? 'cancelled' : event.eventType)}</Text><Text style={styles.meta}>{formatDate(event.startsAt)}</Text></View>
          <Text style={styles.cardTitle}>{event.title}</Text>
          {event.location ? <Text style={styles.meta}>{event.location}</Text> : null}
          {event.notes ? <Text style={styles.body}>{event.notes}</Text> : null}
        </View>
      ))}
    </View>
  )
}

export function InvitationsScreen({ activeActionId, isOffline, link, onRespond, resource, theme }) {
  const { styles } = usePortalStyles(theme)
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Invites</Text><Text style={styles.helper}>Attendance and volunteer responses for {link?.playerName || 'your child'}.</Text></View>
      {isOffline ? <Text style={styles.warning}>Responses need a connection. Saved invitations remain available to read.</Text> : null}
      <ResourceState emptyCopy="There are no invitations for this child." {...resource} styles={styles} />
      {resource.items.map((invitation) => {
        const options = getInvitationResponseOptions(invitation)
        const busy = activeActionId === `invite:${invitation.invitationId}`
        return (
          <View key={invitation.invitationId || `${invitation.sourceRecordId}:${invitation.invitationType}`} style={styles.card}>
            <View style={styles.row}><Text style={styles.pill}>{labelize(invitation.invitationType)}</Text><Text style={styles.meta}>{formatDate(invitation.eventStart || invitation.eventDate)}</Text></View>
            <Text style={styles.cardTitle}>{invitation.eventTitle}</Text>
            <Text style={styles.body}>{labelize(invitation.responseState)}</Text>
            {invitation.selectionState && invitation.selectionState !== 'not_applicable' ? <Text style={styles.meta}>Squad or role status: {labelize(invitation.selectionState)}</Text> : null}
            {invitation.eventLocation ? <Text style={styles.meta}>{invitation.eventLocation}</Text> : null}
            {invitation.lockReason ? <Text style={styles.warning}>{invitation.lockReason}</Text> : null}
            {invitation.canRespond || invitation.canChangeResponse ? (
              <View style={styles.actionRow}>
                {options.map((option) => <Button disabled={isOffline || busy} key={option.value} label={busy ? 'Saving...' : option.label} onPress={() => onRespond(invitation, option.value)} outline styles={styles} />)}
              </View>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function scoreVisible(match) {
  return ['extra_time', 'full_time', 'half_time', 'live', 'penalties', 'second_half'].includes(match.status)
}

function MatchCard({ match, onOpen, styles }) {
  return (
    <Pressable accessibilityRole="button" onPress={() => onOpen(match)} style={styles.card}>
      <View style={styles.row}><Text style={styles.pill}>{labelize(match.status)}</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View>
      <Text style={styles.cardTitle}>{match.teamName || 'Team'} v {match.opponent || 'Opponent'}</Text>
      <Text style={styles.meta}>{match.kickoffTimeTbc ? 'Kick-off time to be confirmed' : normalizeText(match.kickoffTime).slice(0, 5) || 'Time to be confirmed'}</Text>
      {scoreVisible(match) ? <Text style={styles.score}>{match.homeScore} - {match.awayScore}</Text> : null}
      <Text style={styles.helper}>Open Match Day</Text>
    </Pressable>
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

export function MatchdayScreen({ activeActionId, isOffline, link, onBack, onOpen, onScorerAction, onVolunteer, resource, selectedMatch, theme }) {
  const { colors, styles } = usePortalStyles(theme)
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
        </View>
        {selectedMatch.requestScorer && !selectedMatch.isScorer ? (
          <View style={styles.card}><Text style={styles.cardTitle}>Volunteer scorer</Text><Text style={styles.body}>{selectedMatch.scorerRequestMessage || 'Staff are looking for a Parent scorer.'}</Text><Button disabled={isOffline || selectedMatch.hasInterest} label={selectedMatch.hasInterest ? 'Interest registered' : 'Register interest'} onPress={() => onVolunteer(selectedMatch)} styles={styles} /></View>
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
      <ResourceState emptyCopy="There are no Parent-visible match cards for this child." {...resource} styles={styles} />
      {resource.items.map((match) => <MatchCard key={match.id} match={match} onOpen={onOpen} styles={styles} />)}
    </View>
  )
}

export function ResultsScreen({ link, resource, theme }) {
  const { styles } = usePortalStyles(theme)
  const results = resource.items.filter((match) => match.status === 'full_time')
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Results</Text><Text style={styles.helper}>Completed Parent-visible fixtures for {link?.playerName || 'your child'}.</Text></View>
      <ResourceState emptyCopy="There are no completed results for this child." error={resource.error} items={results} loading={resource.loading} styles={styles} />
      {results.map((match) => <View key={match.id} style={styles.card}><View style={styles.row}><Text style={styles.pill}>Full time</Text><Text style={styles.meta}>{formatDate(match.matchDate)}</Text></View><Text style={styles.cardTitle}>{match.teamName} v {match.opponent}</Text><Text style={styles.score}>{match.homeScore} - {match.awayScore}</Text>{match.shootoutWinner ? <Text style={styles.meta}>Shootout: {match.homeShootoutScore} - {match.awayShootoutScore}</Text> : null}</View>)}
    </View>
  )
}

export function DevelopmentScreen({ isOffline, onOpen, resource, theme }) {
  const { styles } = usePortalStyles(theme)
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Development</Text><Text style={styles.helper}>Development history previously shared with this Parent link.</Text></View>
      {isOffline ? <Text style={styles.warning}>Report details are saved for reading. Opening a PDF needs a connection.</Text> : null}
      <ResourceState emptyCopy="No delivered Development reports are available for this child." {...resource} styles={styles} />
      {resource.items.map((report) => <View key={report.id} style={styles.card}><View style={styles.row}><Text style={styles.pill}>{report.deliveryLabel || 'Shared'}</Text><Text style={styles.meta}>{formatDate(report.recordDate || report.finalizedAt)}</Text></View><Text style={styles.cardTitle}>{report.form?.name || 'Development report'}</Text>{report.overallScore == null ? null : <Text style={styles.stat}>Overall score: {report.overallScore} / {report.overallMaxScore || 10}</Text>}{report.responseItems?.slice(0, 6).map((item, index) => <Text key={`${item.label}:${index}`} style={styles.body}>{item.label}: {item.displayValue}</Text>)}<Button disabled={isOffline || !report.canDownloadPdf} label={report.canDownloadPdf ? 'Open PDF' : 'PDF not included'} onPress={() => onOpen(report)} outline styles={styles} /></View>)}
    </View>
  )
}

export function ResourcesScreen({ isOffline, onOpen, resource, theme }) {
  const { styles } = usePortalStyles(theme)
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Resources</Text><Text style={styles.helper}>Files and links shared for the selected child.</Text></View>
      {isOffline ? <Text style={styles.warning}>Resource details are saved for reading. Opening the item needs a connection.</Text> : null}
      <ResourceState emptyCopy="No resources are shared with this child." {...resource} styles={styles} />
      {resource.items.map((item) => <View key={item.id} style={styles.card}><Text style={styles.pill}>{labelize(item.category)}</Text><Text style={styles.cardTitle}>{item.title}</Text>{item.description || item.shareDescription ? <Text style={styles.body}>{item.description || item.shareDescription}</Text> : null}<Button disabled={isOffline} label="Open resource" onPress={() => onOpen(item)} outline styles={styles} /></View>)}
    </View>
  )
}

export function ChatScreen({ activeActionId, isOffline, link, messages, onBack, onDelete, onOpenRoom, onSend, rooms, selectedRoom, theme }) {
  const { colors, styles } = usePortalStyles(theme)
  const [draft, setDraft] = useState('')
  if (selectedRoom) {
    return (
      <View style={styles.stack}>
        <Button label="Back to Chat rooms" onPress={onBack} outline styles={styles} />
        <View><Text accessibilityRole="header" style={styles.header}>{selectedRoom.title}</Text><Text style={styles.helper}>{selectedRoom.teamName || selectedRoom.clubName}</Text></View>
        {messages.loading ? <Text style={styles.helper}>Loading messages...</Text> : null}
        {messages.error ? <Text style={styles.error}>{messages.error}</Text> : null}
        {!messages.loading && messages.items.length === 0 ? <Text style={styles.empty}>No messages in this room yet.</Text> : null}
        {messages.items.map((message) => <View key={message.id} style={styles.card}><View style={styles.row}><Text style={styles.pill}>{message.senderName}</Text><Text style={styles.meta}>{formatDate(message.createdAt)}</Text></View><Text style={styles.body}>{message.deletedAt ? 'Message deleted' : message.body}</Text>{message.canDelete && !message.deletedAt ? <Button danger disabled={isOffline || activeActionId === `chat-delete:${message.id}`} label="Delete message" onPress={() => onDelete(message)} outline styles={styles} /> : null}</View>)}
        {selectedRoom.canPost ? <View style={styles.card}><Text style={styles.fieldLabel}>New message</Text><TextInput accessibilityLabel="Parent Chat message" editable={!isOffline} multiline onChangeText={setDraft} placeholder="Write a message" placeholderTextColor={colors.muted} style={[styles.field, { minHeight: 100, textAlignVertical: 'top' }]} value={draft} /><Text style={styles.helper}>{draft.length} / 2000</Text><Button disabled={isOffline || !normalizeText(draft) || draft.length > 2000 || activeActionId === 'chat-send'} label={activeActionId === 'chat-send' ? 'Sending...' : 'Send message'} onPress={() => onSend(draft).then(() => setDraft(''))} styles={styles} /></View> : null}
      </View>
    )
  }
  return (
    <View style={styles.stack}>
      <View><Text accessibilityRole="header" style={styles.header}>Parent Chat</Text><Text style={styles.helper}>Dedicated Parent and staff Chat for {link?.playerName || 'your child'}.</Text></View>
      {isOffline ? <Text style={styles.warning}>Saved rooms remain readable. Sending and deleting need a connection.</Text> : null}
      <ResourceState emptyCopy="No Parent Chat rooms are available for this child." {...rooms} styles={styles} />
      {rooms.items.map((room) => <Pressable accessibilityRole="button" key={room.id} onPress={() => onOpenRoom(room)} style={styles.card}><View style={styles.row}><Text style={styles.pill}>{labelize(room.type)}</Text>{room.unreadCount ? <Text style={styles.stat}>{room.unreadCount} unread</Text> : null}</View><Text style={styles.cardTitle}>{room.title}</Text><Text numberOfLines={2} style={styles.body}>{room.latestMessage || 'Open this room'}</Text></Pressable>)}
    </View>
  )
}

export function MoreScreen({ onOpen, theme, unreadMessages, unansweredInvites, unansweredPolls }) {
  const { styles } = usePortalStyles(theme)
  const items = [
    ['invites', 'Invites', unansweredInvites ? `${unansweredInvites} need a response` : 'Attendance and volunteer requests'],
    ['results', 'Results', 'Completed fixtures'],
    ['development', 'Development', 'Reports shared with your family'],
    ['resources', 'Resources', 'Files and links'],
    ['messages', 'Messages', unreadMessages ? `${unreadMessages} unread` : 'Club email updates'],
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
