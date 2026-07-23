import { createHash, randomBytes } from 'node:crypto'
import { buildEmailLogoMarkup, buildEventMapLinksMarkup } from '../../../src/lib/email-branding.js'
import { isFixtureKickoffTimeTbc } from '../../../src/lib/calendar-datetime-integrity.js'
import { resolveMatchDayVolunteerRequestMessages } from '../../../src/lib/email-templates.js'
import { getMatchDayDisplayName } from '../../../src/lib/matchday-display.js'

export function normalizeInvitationText(value) {
  return String(value ?? '').trim()
}

export function normalizeInvitationEmail(value) {
  return normalizeInvitationText(value).toLowerCase()
}

export function isValidInvitationEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeInvitationText(value))
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createInvitationToken() {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashInvitationToken(token) }
}

function escapeHtml(value) {
  return normalizeInvitationText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatTime(value) {
  const normalizedValue = normalizeInvitationText(value)
  return normalizedValue ? normalizedValue.slice(0, 5) : 'Not set'
}

export function getRequestedMatchDayRoles(match = {}, volunteerTemplates = []) {
  const messages = resolveMatchDayVolunteerRequestMessages(volunteerTemplates)

  return [
    match.request_scorer === true ? { key: 'scorer', label: 'Scorer', message: messages.scorer } : null,
    match.request_linesman === true ? { key: 'linesman', label: 'Linesman', message: messages.linesman } : null,
    match.request_referee === true ? { key: 'referee', label: 'Referee', message: messages.referee } : null,
  ].filter(Boolean)
}

export function getPlayerInvitationContacts(player = {}) {
  const contacts = Array.isArray(player.parent_contacts) ? player.parent_contacts : []
  const contactType = normalizeInvitationText(player.contact_type || 'parent')
  const fallbackContact = {
    name: normalizeInvitationText(player.parent_name),
    email: normalizeInvitationEmail(player.parent_email),
    type: contactType === 'self' ? 'self' : 'parent',
  }
  const normalizedContacts = contacts
    .map((contact) => ({
      name: normalizeInvitationText(contact?.name || contact?.parentName),
      email: normalizeInvitationEmail(contact?.email || contact?.parentEmail),
      type: normalizeInvitationText(contact?.type || contact?.contactType) === 'self' ? 'self' : 'parent',
    }))
    .filter((contact) => contact.email)
  const usableContacts = normalizedContacts.length > 0
    ? normalizedContacts
    : [fallbackContact].filter((contact) => contact.email)

  if (contactType === 'self') {
    return usableContacts
      .filter((contact) => contact.type === 'self' || usableContacts.length === 1)
      .map((contact) => ({ ...contact, type: 'player' }))
  }

  if (contactType === 'both') {
    return usableContacts.map((contact) => ({
      ...contact,
      type: contact.type === 'self' ? 'player' : 'parent',
    }))
  }

  return usableContacts
    .filter((contact) => contact.type !== 'self')
    .map((contact) => ({ ...contact, type: 'parent' }))
}

export function findInvitationParentLink(parentLinks, player, contact) {
  if (contact.type !== 'parent') {
    return null
  }

  const contactEmail = normalizeInvitationEmail(contact.email)
  return (parentLinks ?? []).find((link) =>
    String(link.player_id) === String(player.id)
    && normalizeInvitationEmail(link.email) === contactEmail,
  ) || null
}

export function buildMatchDayActionableInvitationEmail({
  appOrigin,
  match,
  player,
  recipient,
  responseUrl,
  updated = false,
  volunteerTemplates = [],
}) {
  const teamName = normalizeInvitationText(match.teams?.name || match.team_name || 'the team')
  const matchName = getMatchDayDisplayName({ ...match, teamName })
  const subject = `${updated ? 'Updated ' : ''}${teamName} availability: ${matchName}`
  const clubName = normalizeInvitationText(match.clubs?.name || match.club_name || 'Football Player')
  const logoMarkup = buildEmailLogoMarkup({
    altText: clubName,
    clubLogoUrl: normalizeInvitationText(match.clubs?.logo_url),
    origin: appOrigin,
  })
  const mapLinksMarkup = buildEventMapLinksMarkup(normalizeInvitationText(match.venue_address || match.venue_name))
  const requestedRoles = getRequestedMatchDayRoles(match, volunteerTemplates)
  const kickoffTimeTbc = isFixtureKickoffTimeTbc(match.kickoff_time_tbc)
  const details = [
    ['Fixture', matchName],
    ['Date', match.match_date || 'Not set'],
    ['Kick off', kickoffTimeTbc ? 'Time TBC' : formatTime(match.kickoff_time)],
    ['Arrival', kickoffTimeTbc ? 'Available when kickoff is confirmed' : formatTime(match.arrival_time)],
    ['Venue', match.venue_name || 'Not set'],
    ['Address', match.venue_address || 'Not set'],
  ]
  const actionUrl = (status) => `${responseUrl}&status=${status}`
  const roleLinks = requestedRoles.map((role) => ({
    ...role,
    url: `${responseUrl}#volunteer-${role.key}`,
  }))
  const rows = details.map(([label, value]) => `
    <tr>
      <td style="padding:8px 0;color:#4b5f55;font-weight:700;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:#101828;font-weight:800;">${escapeHtml(value)}</td>
    </tr>
  `).join('')
  const availabilityLinks = [
    ['Available', actionUrl('available'), '#047857'],
    ['Maybe', actionUrl('maybe'), '#a16207'],
    ['Unavailable', actionUrl('unavailable'), '#b42318'],
  ]
  const availabilityHtml = availabilityLinks.map(([label, url, color]) => `
    <a href="${escapeHtml(url)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 16px;background:${color};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:900;">${label}</a>
  `).join('')
  const volunteerHtml = roleLinks.length > 0 ? `
    <p style="margin:20px 0 10px;color:#101828;font-size:14px;font-weight:900;">Volunteer for Match Day</p>
    ${roleLinks.map((role) => `
      <div style="margin:0 0 14px;">
        <p style="margin:0 0 8px;color:#4b5f55;font-size:14px;line-height:1.5;font-weight:700;">${escapeHtml(role.message)}</p>
        <a href="${escapeHtml(role.url)}" style="display:inline-block;padding:10px 14px;border:2px solid #047857;color:#047857;text-decoration:none;border-radius:8px;font-weight:900;">Volunteer as ${escapeHtml(role.label)}</a>
      </div>
    `).join('')}
  ` : ''
  const updateNotice = updated
    ? 'The fixture details have been updated. Your existing response is preserved, and you can review or change it using these secure links.'
    : recipient.type === 'player' ? 'Please confirm your availability.' : 'Please confirm availability for this player.'
  const text = [
    updated ? 'UPDATED FIXTURE INVITATION' : 'FIXTURE INVITATION',
    `Can ${normalizeInvitationText(player.player_name) || 'the player'} play?`,
    updateNotice,
    ...details.map(([label, value]) => `${label}: ${normalizeInvitationText(value)}`),
    '',
    `Available: ${actionUrl('available')}`,
    `Maybe: ${actionUrl('maybe')}`,
    `Unavailable: ${actionUrl('unavailable')}`,
    `Review response: ${responseUrl}`,
    ...roleLinks.flatMap((role) => [role.message, `Volunteer as ${role.label}: ${role.url}`]),
    '',
    `This link is unique to ${normalizeInvitationEmail(recipient.email)}. Do not forward it.`,
  ].join('\n')

  return {
    subject,
    text,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#101828;">
        ${logoMarkup}
        <p style="margin:0 0 8px;color:#047857;font-size:12px;font-weight:900;letter-spacing:0.16em;text-transform:uppercase;">${updated ? 'Updated fixture invitation' : 'Fixture availability'}</p>
        <h1 style="margin:0 0 12px;font-size:26px;line-height:1.15;">Can ${escapeHtml(player.player_name)} play?</h1>
        <p style="margin:0 0 20px;color:#4b5f55;font-size:15px;line-height:1.6;">${escapeHtml(updateNotice)}</p>
        <p style="margin:0 0 20px;color:#4b5f55;font-size:14px;line-height:1.6;font-weight:700;">An Available response does not confirm squad selection. The coaching team will confirm the final squad separately.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">${rows}</table>
        ${mapLinksMarkup}
        <div style="display:block;margin:22px 0;">${availabilityHtml}</div>
        <p style="margin:12px 0;"><a href="${escapeHtml(responseUrl)}" style="color:#047857;font-weight:900;">Open the full response form</a></p>
        ${volunteerHtml}
        <p style="margin:20px 0 0;color:#64748b;font-size:12px;line-height:1.5;">This link is unique to ${escapeHtml(recipient.email)}. Do not forward it.</p>
      </div>
    `,
  }
}
