import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [parentAppSource, parentPortalSource, parentScreensSource] = await Promise.all([
  readFile(new URL('../apps/parent-mobile/App.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/parentPortalData.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/parent-mobile/src/ParentPortalScreens.js', import.meta.url), 'utf8'),
])

const invitationPresentationSource = parentPortalSource.slice(
  parentPortalSource.indexOf('export function normalizeParentInvitation'),
  parentPortalSource.indexOf('export function getInvitationResponseOptions'),
)

test('canonical Parent invitation presentation preserves current and historical Match requests', () => {
  assert.match(invitationPresentationSource, /sourceEventType: normalizeText\(row\.source_event_type \?\? row\.sourceEventType\)/)
  assert.match(invitationPresentationSource, /\.map\(normalizeParentInvitation\)/)
  assert.match(invitationPresentationSource, /if \(left\.isPending !== right\.isPending\)/)
  assert.match(invitationPresentationSource, /return left\.isPending \? -1 : 1/)
  assert.match(invitationPresentationSource, /left\.eventTitle\.localeCompare\(right\.eventTitle\)/)
  assert.doesNotMatch(invitationPresentationSource, /\.filter\(/)
})

test('Parent mobile fetches the canonical invitation summary without a client date or status exclusion', () => {
  assert.match(parentPortalSource, /supabase\.rpc\('get_parent_portal_invitation_summary', \{ parent_link_id_value: link\.id \}\)/)
  assert.match(parentPortalSource, /return prepareParentInvitations\(\(invitationResult\.data \|\| \[\]\)\.map/)
  assert.doesNotMatch(invitationPresentationSource, /Date\.now|new Date|matchDate|responseDeadline.*filter|invitationState.*filter/)
})

test('Parent mobile response reuses the canonical Match invitation command and authority fields', () => {
  assert.match(parentPortalSource, /supabase\.rpc\('respond_parent_portal_match_day_invitation'/)
  assert.match(parentPortalSource, /parent_link_id_value: link\.id/)
  assert.match(parentPortalSource, /request_id_value: invitation\.sourceRecordId/)
  assert.match(parentPortalSource, /response_kind_value: invitation\.invitationType === 'match_role' \? 'role' : 'attendance'/)
  assert.match(parentPortalSource, /role_type_value: invitation\.invitationType === 'match_role' \? invitation\.roleType : null/)
  assert.match(parentPortalSource, /response_value: response/)
})

test('Parent Home names the Invites destination and shares its grouped response count', () => {
  assert.match(parentAppSource, /getParentInvitationCounts\(visibleInvitationsWithMatchTimes\)\.needsResponse/)
  assert.match(parentAppSource, /inviteCount=\{unansweredInvites\}/)
  assert.match(parentAppSource, /count=\{inviteCount\} iconKey="parent.invites" label="Invites"/)
  assert.match(parentAppSource, /onPress=\{onOpenInvites\}/)
  assert.match(parentAppSource, /moreSection === 'invites'/)
  assert.match(parentAppSource, /<InvitationsScreen/)
})

test('Parent Match cards label arrival and kick-off as separate fixture times', () => {
  assert.match(parentAppSource, /const visibleInvitationsWithMatchTimes = useMemo/)
  assert.match(parentAppSource, /enrichParentMatchInvitations\(visibleInvitations, resources\.matches\.items\)/)
  assert.match(parentScreensSource, /Arrive \{formatParentProductTime\(primary\.arrivalTime\)\}/)
  assert.match(parentScreensSource, /Kick-off \{primary\?\.kickoffTimeTbc \? 'Time TBC' : formatParentProductTime\(kickoffTime\)\}/)
  assert.match(parentScreensSource, /Arrive \{formatParentProductTime\(match\.arrivalTime\)\}/)
  assert.match(parentScreensSource, /Kick-off: \{selectedMatch\.kickoffTimeTbc \? 'Time TBC' : formatParentProductTime\(selectedMatch\.kickoffTime\)\}/)
  assert.doesNotMatch(parentScreensSource, /formatDate\(invitation\.eventStart \|\| invitation\.eventDate\)/)
})

test('Parent request and Home cards show the operational time Parents need', () => {
  assert.match(parentScreensSource, /formatParentProductTime\(primary\.eventStart\)/)
  assert.match(parentAppSource, /match\.arrivalTime \? `Arrive \$\{formatTime\(match\.arrivalTime\)\}` : `Kick-off \$\{formatTime\(match\.kickoffTime, match\.kickoffTimeTbc\)\}`/)
})
