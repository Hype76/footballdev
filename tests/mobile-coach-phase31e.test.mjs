import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  COACH_PHASE_31E_BACKEND_DELTAS,
  COACH_PHASE_31E_COMMUNICATION_POLICY,
  COACH_PHASE_31E_DOMAINS,
  assertSyntheticCoachCommunicationTarget,
  collapseCoachInvitesByPlayer,
  getCoachInviteDeliveryLabel,
  getCoachInviteStatusLabel,
  getCoachPlayersWithoutAvailabilityRequest,
  getCoachResourceErrorMessage,
  getCoachPhase31EOfflinePolicy,
  getCoachPhase31EAccess,
  isSyntheticCoachTarget,
  normalizeCoachChatMessage,
  normalizeCoachChatRoom,
  normalizeCoachDevelopmentField,
  normalizeCoachDevelopmentForm,
  normalizeCoachInvite,
  normalizeCoachMessage,
  normalizeCoachPoll,
  normalizeCoachResource,
  resolveCoachDevelopmentForm,
  splitCoachDevelopmentVisibility,
  summarizeCoachInvites,
  summarizeCoachPoll,
  validateCoachDevelopmentValues,
  validateCoachResourceUrl,
} from '../apps/mobile-core/src/coachPhase31ECore.js'

const form = normalizeCoachDevelopmentForm({
  id: 'form-1',
  name: 'FP TEST U12 Development',
  age_group: 'U12',
  fields: [
    { id: 'score', label: 'Technical', type: 'score_1_10', required: true, parent_visible: true, order_index: 1 },
    { id: 'note', label: 'Staff note', type: 'textarea', staff_private: true, order_index: 2 },
    { id: 'decision', label: 'Decision', type: 'select', options: [{ id: 'a', label: 'Continue', value: 'continue' }, { id: 'b', label: 'Review', value: 'review' }], order_index: 3 },
    { id: 'flag', label: 'Ready', type: 'boolean', order_index: 4 },
  ],
})

test('Phase 31E keeps all six product domains distinct', () => {
  assert.deepEqual(COACH_PHASE_31E_DOMAINS, ['development', 'resources', 'chat', 'messages', 'polls', 'invites'])
})

test('communication policy disables every external delivery channel', () => {
  assert.equal(COACH_PHASE_31E_COMMUNICATION_POLICY.communications, 'disabled')
  assert.equal(COACH_PHASE_31E_COMMUNICATION_POLICY.schedules, 'disabled')
  assert.equal(COACH_PHASE_31E_COMMUNICATION_POLICY.realEmail, 0)
  assert.equal(COACH_PHASE_31E_COMMUNICATION_POLICY.realPush, 0)
  assert.equal(COACH_PHASE_31E_COMMUNICATION_POLICY.sms, 0)
  assert.equal(COACH_PHASE_31E_COMMUNICATION_POLICY.realCustomerChat, 0)
})

test('backend deltas cover A through E without claiming a standalone Coach inbox', () => {
  assert.deepEqual([...new Set(COACH_PHASE_31E_BACKEND_DELTAS.map((item) => item.category))].sort(), ['A', 'B', 'C', 'D', 'E'])
  assert.equal(COACH_PHASE_31E_BACKEND_DELTAS.some((item) => item.category === 'C' && /Standalone Coach Messages/.test(item.capability)), true)
  assert.equal(COACH_PHASE_31E_BACKEND_DELTAS.some((item) => item.category === 'D' && /PDF/.test(item.capability)), true)
})

test('dynamic Development fields preserve supported structured types and visibility', () => {
  assert.equal(form.ageGroup, 'U12')
  assert.deepEqual(form.fields.map((field) => field.type), ['score_1_10', 'textarea', 'select', 'boolean'])
  assert.equal(form.fields[0].parentVisible, true)
  assert.equal(form.fields[1].staffPrivate, true)
})

test('platform starter Development forms preserve safe submission provenance', () => {
  const starter = normalizeCoachDevelopmentForm({
    id: 'platform-starter:foundation:2',
    installed_form_id: 'installed-form-id',
    is_platform_template: true,
    template_key: 'foundation',
    fields: [{ id: 'score', label: 'Score', type: 'score_1_10' }],
  })
  assert.equal(starter.isPlatformTemplate, true)
  assert.equal(starter.installedFormId, 'installed-form-id')
  assert.equal(starter.templateKey, 'foundation')
})

test('Development form selection resolves every distinct form and falls back safely', () => {
  const forms = [
    normalizeCoachDevelopmentForm({ id: 'goalkeeping', name: 'Goal Keeping Coach', fields: [{ id: 'distribution', label: 'Distribution' }] }),
    normalizeCoachDevelopmentForm({ id: 'in-depth', name: 'In depth form', fields: [{ id: 'technical', label: 'Technical' }] }),
    normalizeCoachDevelopmentForm({ id: 'foundation', name: 'Foundation Review', fields: [{ id: 'handling', label: 'Handling' }] }),
  ]
  assert.equal(resolveCoachDevelopmentForm(forms, 'in-depth')?.name, 'In depth form')
  assert.equal(resolveCoachDevelopmentForm(forms, 'foundation')?.fields[0]?.id, 'handling')
  assert.equal(resolveCoachDevelopmentForm(forms, 'missing')?.id, 'goalkeeping')
  assert.equal(resolveCoachDevelopmentForm([], 'missing'), null)
})

test('unknown Development field types fail closed to plain text instead of inventing widgets', () => {
  assert.equal(normalizeCoachDevelopmentField({ type: 'mobile_magic' }).type, 'text')
})

test('required Development fields and rating range are validated', () => {
  assert.match(validateCoachDevelopmentValues(form, {}).errors[0], /Technical is required/)
  assert.match(validateCoachDevelopmentValues(form, { score: 11 }).errors[0], /between 0 and 10/)
  assert.equal(validateCoachDevelopmentValues(form, { score: 8, decision: 'continue', flag: true }).valid, true)
})

test('dynamic option values must come from canonical form schema', () => {
  assert.match(validateCoachDevelopmentValues(form, { score: 8, decision: 'invented' }).errors[0], /unsupported option/)
})

test('Development private and Parent-shareable fields are separated', () => {
  const split = splitCoachDevelopmentVisibility(form, { score: 7, note: 'Private', decision: 'continue' })
  assert.deepEqual(split.parentShared, { score: 7 })
  assert.deepEqual(split.staffPrivate, { note: 'Private', decision: 'continue' })
})

test('role-restricted Development fields are not validated for lower roles', () => {
  const restricted = normalizeCoachDevelopmentForm({ id: 'f', fields: [{ id: 'admin', label: 'Admin', type: 'text', required: true, minimum_role_rank: 80 }] })
  assert.equal(validateCoachDevelopmentValues(restricted, {}, 30).valid, true)
  assert.equal(validateCoachDevelopmentValues(restricted, {}, 90).valid, false)
})

test('Resource normalization keeps canonical scope and active links', () => {
  const resource = normalizeCoachResource({ id: 'r1', club_id: 'c1', team_id: 't1', title: 'Guide', resource_library_links: [{ id: 'l1', linked_type: 'player', linked_id: 'p1', parent_visible: true }, { id: 'l2', removed_at: 'now' }] })
  assert.equal(resource.teamId, 't1')
  assert.equal(resource.links.length, 1)
  assert.equal(resource.links[0].parentVisible, true)
})

test('Formation Board Resources are identified and assignment errors are translated for staff', () => {
  const resource = normalizeCoachResource({
    external_url: 'https://footballplayer.online/resources/formation-boards?board=board-1',
    mime_type: 'application/vnd.footballplayer.formation-board+json',
  })
  assert.equal(resource.isFormationBoard, true)
  assert.equal(
    getCoachResourceErrorMessage(new Error('formation_board_resource_assignment_forbidden')),
    'Published Formation Boards are already Team Resources and cannot be assigned again.',
  )
})

test('Resource URLs require HTTPS and reject embedded credentials', () => {
  assert.equal(validateCoachResourceUrl('https://example.com/file').safe, true)
  assert.equal(validateCoachResourceUrl('http://example.com/file').safe, false)
  assert.equal(validateCoachResourceUrl('https://user:pass@example.com/file').safe, false)
  assert.equal(validateCoachResourceUrl('not a url').safe, false)
})

test('Staff and Parent Chat rooms retain distinct kinds and scopes', () => {
  const staff = normalizeCoachChatRoom({ id: 's', type: 'team_staff', team_id: 't', staff_chat_members: [{ user_id: 'u' }] }, 'staff')
  const parent = normalizeCoachChatRoom({ id: 'p', room_type: 'parent_staff', team_id: 't' }, 'parent')
  assert.equal(staff.kind, 'staff')
  assert.equal(parent.kind, 'parent')
  assert.equal(staff.members[0].userId, 'u')
})

test('deleted Chat messages preserve audit history without body substitution', () => {
  const message = normalizeCoachChatMessage({ id: 'm', body: 'Original', deleted_at: '2026-08-09T12:00:00Z' })
  assert.equal(message.deletedAt, '2026-08-09T12:00:00Z')
  assert.equal(message.body, 'Original')
})

test('synthetic communication guard accepts only FP TEST targets', () => {
  assert.equal(isSyntheticCoachTarget('FP TEST staff'), true)
  assert.equal(isSyntheticCoachTarget('Real customer'), false)
  assert.doesNotThrow(() => assertSyntheticCoachCommunicationTarget({ title: 'FP TEST parents' }))
  assert.throws(() => assertSyntheticCoachCommunicationTarget({ title: 'Parents' }), /Only synthetic FP TEST/)
})

test('Messages remain communication history records rather than fabricated inbox rows', () => {
  const message = normalizeCoachMessage({ id: 'log-1', channel: 'email', action: 'queued', metadata: { subject: 'Update', status: 'suppressed' } })
  assert.equal(message.subject, 'Update')
  assert.equal(message.status, 'suppressed')
  assert.equal(message.action, 'queued')
})

test('anonymous Polls redact voter identity in normalized mobile data', () => {
  const poll = normalizeCoachPoll({ id: 'poll', hide_votes: true, options: ['Yes', 'No'], poll_votes: [{ option_id: 'option-1', voter_name: 'Parent', voter_email: 'parent@example.com' }] })
  assert.equal(poll.anonymous, true)
  assert.equal(poll.votes[0].voterName, '')
  assert.equal(poll.votes[0].voterEmail, '')
})

test('Poll summary reports option totals without restoring anonymous identity', () => {
  const poll = normalizeCoachPoll({ options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }], poll_votes: [{ option_id: 'yes' }, { option_id: 'yes' }, { option_id: 'no' }] })
  assert.deepEqual(summarizeCoachPoll(poll).map((option) => option.count), [2, 1])
})

test('Invite normalization preserves distinct statuses and stale protection', () => {
  assert.equal(normalizeCoachInvite({ status: 'not_selected' }, 'match').status, 'not_selected')
  assert.equal(normalizeCoachInvite({ response_state: 'maybe' }, 'calendar').status, 'maybe')
  assert.equal(normalizeCoachInvite({ deleted_at: 'now' }, 'training').status, 'stale')
  assert.equal(normalizeCoachInvite({ cancelled_at: 'now' }, 'calendar').status, 'cancelled')
  assert.equal(normalizeCoachInvite({ calendar_event_id: 'calendar-1', match_day_id: 'match-1' }, 'match').eventId, 'match-1')
  assert.equal(normalizeCoachInvite({ calendar_event_id: 'calendar-1', match_day_id: 'match-1' }, 'training').eventId, 'calendar-1')
  assert.equal(normalizeCoachInvite({ email_sent_at: '2026-08-23T09:00:00Z' }, 'training').sentAt, '2026-08-23T09:00:00Z')
  assert.equal(normalizeCoachInvite({ invited_at: '2026-08-23T09:01:00Z' }, 'calendar').sentAt, '2026-08-23T09:01:00Z')
  assert.equal(normalizeCoachInvite({ status: 'responded', availability_status: 'available' }, 'training').status, 'available')
  assert.equal(normalizeCoachInvite({ status: 'responded', response: 'unavailable' }, 'training').status, 'unavailable')
  assert.equal(getCoachInviteStatusLabel('available'), 'Available')
  assert.equal(getCoachInviteStatusLabel('unavailable'), 'Not available')
  assert.equal(getCoachInviteStatusLabel('available', 'training'), 'Attending')
  assert.equal(getCoachInviteStatusLabel('unavailable', 'training'), 'Not attending')
  assert.equal(getCoachInviteStatusLabel('maybe'), 'Maybe')
  assert.equal(getCoachInviteStatusLabel('pending'), 'Awaiting response')
  assert.equal(getCoachInviteDeliveryLabel('delivered'), 'Delivered')
  assert.equal(getCoachInviteDeliveryLabel('delivery_issue'), 'Delivery issue')
})

test('Invite summary does not merge selected, not selected, maybe, or stale meaning', () => {
  const rows = ['pending', 'available', 'unavailable', 'maybe', 'selected', 'not_selected', 'stale', 'cancelled'].map((status) => ({ status }))
  assert.deepEqual(summarizeCoachInvites(rows), {
    attending: 1,
    maybe: 1,
    awaitingResponse: 1,
    notAttending: 1,
    invitationNotSent: 0,
    deliveryIssue: 0,
    selected: 1,
    notSelected: 1,
    stale: 1,
    cancelled: 1,
    available: 1,
    unavailable: 1,
    awaiting: 1,
  })
})

test('Match availability collapses recipient rows to one authoritative Player response', () => {
  const rows = [
    { id: 'pending-parent-1', eventId: 'match-1', playerId: 'player-1', playerName: 'Alex', sentAt: '2026-08-19T08:00:00Z', status: 'pending' },
    { id: 'pending-parent-2', eventId: 'match-1', playerId: 'player-1', playerName: 'Alex', sentAt: '2026-08-19T08:01:00Z', status: 'awaiting' },
    { id: 'response-parent-1', eventId: 'match-1', playerId: 'player-1', playerName: 'Alex', respondedAt: '2026-08-19T08:02:00Z', status: 'available' },
    { id: 'pending-player-2', eventId: 'match-1', playerId: 'player-2', playerName: 'Blair', sentAt: '2026-08-19T08:03:00Z', status: 'pending' },
  ]
  const collapsed = collapseCoachInvitesByPlayer(rows)
  assert.equal(collapsed.length, 2)
  assert.equal(collapsed.find((invite) => invite.playerId === 'player-1').status, 'available')
  assert.equal(summarizeCoachInvites(collapsed).attending, 1)
  assert.equal(summarizeCoachInvites(collapsed).awaitingResponse, 1)
})

test('Training availability prefers a delivered recipient over an obsolete failed contact and counts Players once', () => {
  const rows = [
    normalizeCoachInvite({
      calendar_event_id: 'training-1',
      email_sent_at: '2026-08-27T08:00:00Z',
      id: 'delivered',
      player_id: 'player-1',
      player_name: 'Alex Player',
      status: 'sent',
    }, 'training'),
    normalizeCoachInvite({
      calendar_event_id: 'training-1',
      id: 'obsolete',
      last_error: 'Recipient authority changed before delivery.',
      player_id: 'player-1',
      player_name: 'Alex Player',
      status: 'cancelled',
    }, 'training'),
  ]
  const collapsed = collapseCoachInvitesByPlayer(rows)
  const summary = summarizeCoachInvites(collapsed)
  assert.equal(collapsed.length, 1)
  assert.equal(collapsed[0].deliveryStatus, 'delivered')
  assert.equal(collapsed[0].cancelled, false)
  assert.equal(summary.awaitingResponse, 1)
  assert.equal(summary.deliveryIssue, 0)
})

test('Match availability creation includes only Players without an active request', () => {
  const players = [{ id: 'player-1' }, { id: 'player-2' }, { id: 'player-3' }]
  const invites = [
    { id: 'invite-1', eventId: 'match-1', playerId: 'player-1', status: 'available' },
    { id: 'invite-2', eventId: 'match-1', playerId: 'player-2', status: 'pending' },
    { id: 'invite-3', eventId: 'match-2', playerId: 'player-3', status: 'pending' },
  ]
  assert.deepEqual(getCoachPlayersWithoutAvailabilityRequest(players, invites, 'match-1').map((player) => player.id), ['player-3'])
})

test('all Phase 31E domains allow encrypted reads but require online mutation', () => {
  for (const domain of COACH_PHASE_31E_DOMAINS) {
    assert.equal(getCoachPhase31EOfflinePolicy(domain).cache, true)
    assert.equal(getCoachPhase31EOfflinePolicy(domain).mutations, 'online_required')
    assert.equal(getCoachPhase31EOfflinePolicy(domain).replay, 'disabled')
  }
})

test('unknown domains are not cached and remain mutation-blocked', () => {
  assert.deepEqual(getCoachPhase31EOfflinePolicy('unknown'), { cache: false, mutations: 'blocked' })
})

test('Phase 31E applies the eight-role operational matrix and fails closed for global role alone', () => {
  const base = { activeTeamId: 'team-1', clubId: 'club-1', contextStatus: 'active', hasActivePlanAccess: true, id: 'user-1' }
  for (const [role, roleRank] of [['coach', 30], ['head_manager', 70], ['team_admin', 60], ['manager', 50], ['assistant_coach', 20]]) {
    assert.equal(getCoachPhase31EAccess({ domain: 'development', user: { ...base, role, roleRank } }).allowed, true, role)
  }
  assert.equal(getCoachPhase31EAccess({ domain: 'development', user: { ...base, role: 'parent_portal', roleRank: 10 } }).allowed, false)
  assert.equal(getCoachPhase31EAccess({ domain: 'development', user: { ...base, role: 'adult_player', roleRank: 10 } }).allowed, false)
  assert.equal(getCoachPhase31EAccess({ domain: 'development', user: { ...base, role: 'super_admin', roleRank: 100 } }).allowed, false)
})

test('Phase 31E access blocks payment, wrong Team, removed staff, archive, stale data, and closed Poll writes', () => {
  const user = { activeTeamId: 'team-1', clubId: 'club-1', contextStatus: 'active', hasActivePlanAccess: true, id: 'user-1', role: 'manager', roleRank: 50 }
  assert.match(getCoachPhase31EAccess({ domain: 'resources', mutation: true, user: { ...user, hasActivePlanAccess: false } }).reason, /payment/)
  assert.match(getCoachPhase31EAccess({ domain: 'resources', entity: { teamId: 'team-2' }, user }).reason, /Wrong Team/)
  assert.match(getCoachPhase31EAccess({ domain: 'resources', user: { ...user, contextStatus: 'removed' } }).reason, /inactive/)
  assert.match(getCoachPhase31EAccess({ domain: 'resources', user: { ...user, teamArchivedAt: 'now' } }).reason, /Archived/)
  assert.match(getCoachPhase31EAccess({ domain: 'resources', mutation: true, stale: true, user }).reason, /Reconnect/)
  assert.match(getCoachPhase31EAccess({ domain: 'polls', entity: { status: 'closed' }, mutation: true, user }).reason, /read-only/)
})

test('Development data uses dynamic forms, governed drafts, versioning, and no pilot submit function', async () => {
  const [adapter, legacy] = await Promise.all([
    readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/mobile-core/src/data.js', import.meta.url), 'utf8'),
  ])
  assert.match(adapter, /from\('feedback_forms'\)/)
  assert.match(adapter, /from\('evaluation_drafts'\)/)
  assert.match(adapter, /client_save_version/)
  assert.match(adapter, /feedback_form_snapshot/)
  assert.match(adapter, /from\('feedback_form_starter_templates'\)/)
  assert.match(adapter, /from\('feedback_form_starter_preferences'\)/)
  assert.match(adapter, /platform-starter:/)
  assert.match(adapter, /form\.installedFormId \|\| \(form\.isPlatformTemplate \? null : form\.id\)/)
  assert.match(adapter, /assessment_session_id/)
  assert.doesNotMatch(adapter, /parent_shared_responses|staff_private_responses|\n\s{4}session_id:/)
  assert.doesNotMatch(legacy, /submitCoachAssessment|getCoachAssessmentFields/)
})

test('Phase 31E mutation adapters accept only approved resolved TEST or production environments', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  assert.match(source, /!config\.isUsable \|\| !\['test', 'production'\]\.includes\(config\.supabaseEnvironment\)/)
  assert.match(source, /if \(!config\.isProduction\) assertSyntheticCoachCommunicationTarget\(target\)/)
  assert.doesNotMatch(source, /hvapkizujvsahvgspser/)
  assert.doesNotMatch(source, /productionAccess:\s*true/)
})

test('Resource adapter reuses canonical RPCs and signed URLs', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  for (const marker of ['create_external_resource_library_item', 'assign_resource_library_item_with_parent_notifications', 'remove_resource_library_link', 'createSignedUrl']) assert.match(source, new RegExp(marker))
  assert.doesNotMatch(source, /service_role/)
})

test('Chat adapter keeps Staff Chat and Parent Chat authority separate', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  for (const marker of ['staff_chat_conversations', 'staff_chat_messages', 'get_parent_chat_rooms', 'get_parent_chat_messages', 'send_parent_chat_message', 'mark_parent_chat_room_read']) assert.match(source, new RegExp(marker))
  assert.match(source, /assertSyntheticTargetInTest\(room\)/)
})

test('Poll adapter uses canonical idempotent RPCs without push side effects', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  assert.match(source, /create_team_poll/)
  assert.match(source, /set_team_poll_status/)
  assert.match(source, /p_request_id/)
  assert.doesNotMatch(source, /sendParentMobilePushNotification|sendCoachMobilePushNotification/)
})

test('Invite TEST intent remains audit-only while production resend uses the canonical recipient service', async () => {
  const source = await readFile(new URL('../apps/mobile-core/src/coachPhase31EData.js', import.meta.url), 'utf8')
  assert.match(source, /invite_\$\{action\}_intent/)
  assert.match(source, /communicationDelivery: 'disabled'/)
  assert.match(source, /schedules: 'disabled'/)
  assert.match(source, /send-event-player-invitation/)
  assert.match(source, /idempotencyKey: requestId\('coach-invite-resend'\)/)
  assert.doesNotMatch(source, /sendEmail|sendSms|exp\.host\/--\/api\/v2\/push\/send/i)
})

test('native screen routes every Phase 31E domain through semantic palette styles', async () => {
  const [app, screen] = await Promise.all([
    readFile(new URL('../apps/coach-mobile/App.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /\['development', 'resources', 'chat', 'messages', 'polls', 'invites'\]/)
  assert.match(screen, /phaseStyles\(palette\)/)
  for (const token of ['textPrimary', 'textSecondary', 'accentForeground', 'background']) assert.match(screen, new RegExp(`palette\\.${token}`))
  assert.doesNotMatch(screen, /palette\.(?:text|input|onAccent)\b/)
  assert.doesNotMatch(screen, /#[0-9a-f]{3,8}/i)
})

test('native Chat opens from an informative conversation list into one focused room', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  assert.match(screen, /getCoachChatRoomDisplay/)
  assert.match(screen, /Mark all as read/)
  assert.match(screen, /buildCoachChatRoomSections/)
  assert.match(screen, /reloadHome\(\{ refresh: true \}\)/)
  assert.match(screen, /Back to conversations/)
  assert.match(screen, /chatRoomCard/)
  assert.match(screen, /messageBubble/)
  assert.match(screen, /accessibilityLabel="Chat message"/)
  assert.doesNotMatch(screen, /Choose conversation/)
  assert.doesNotMatch(screen, /Team Calendar/)
})

test('native screen marks stale encrypted reads and disables unsafe writes', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  assert.match(screen, /Offline and read-only/)
  assert.doesNotMatch(screen, /Safety boundary/)
  assert.match(screen, /disabled=\{stale/)
  assert.doesNotMatch(screen, /Unsafe offline replay is disabled/)
})

test('native screen exposes required accessible and confirmation patterns', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  assert.match(screen, /accessibilityRole="header"/)
  assert.match(screen, /accessibilityLabel=/)
  assert.match(screen, /accessibilityLiveRegion=/)
  assert.match(screen, /Alert\.alert\('Finalise and share this Development record\?'/)
  assert.match(screen, /Alert\.alert\('Archive this Poll\?'/)
})

test('native Development renders a single-choice form picker and isolates draft values when switching', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  assert.match(screen, /Choose form/)
  assert.match(screen, /accessibilityRole="radio"/)
  assert.match(screen, /accessibilityState=\{\{ selected \}\}/)
  assert.match(screen, /onPress=\{\(\) => selectDevelopmentForm\(item\)\}/)
  assert.match(screen, /setFormId\(nextForm\.id\)[\s\S]*setValues\(\{\}\)[\s\S]*setNotes\(''\)[\s\S]*setDraft\(null\)/)
})

test('Parent feature source is not imported into the Coach Phase 31E UI', async () => {
  const screen = await readFile(new URL('../apps/coach-mobile/src/CoachPhase31EScreens.js', import.meta.url), 'utf8')
  assert.doesNotMatch(screen, /parent-mobile/)
  assert.doesNotMatch(screen, /submitParentPollVote|sendParentChatMessage/)
})
