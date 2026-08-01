import {
  buildEmailLogoMarkup,
  resolveReachableEmailLogo,
} from './email-branding.js'

export const CALENDAR_NOTIFICATION_PLATFORM_ORIGIN = 'https://footballplayer.online'
export const CALENDAR_NOTIFICATION_PARENT_PORTAL_URL = 'https://parent.footballplayer.online/parent-portal?section=calendar'

const ACCENT_COLOURS = {
  blue: '#1d4ed8',
  green: '#047857',
  purple: '#7c3aed',
  red: '#dc2626',
  yellow: '#ca8a04',
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function cleanEmailCopy(value, fallback) {
  const cleanedValue = normalizeText(value)
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'<>{}[]"\'`;\\'.includes(character)
    })
    .join('')
    .trim()

  return cleanedValue || fallback
}

export function resolveCalendarEmailAccent(value) {
  const normalizedValue = normalizeText(value).toLowerCase()

  if (/^#[0-9a-f]{6}$/.test(normalizedValue)) {
    return normalizedValue
  }

  return ACCENT_COLOURS[normalizedValue] || ACCENT_COLOURS.green
}

export function formatCalendarNotificationDateTime(value) {
  const normalizedValue = normalizeText(value)
  const parsedDate = new Date(normalizedValue)

  if (!normalizedValue || Number.isNaN(parsedDate.getTime())) {
    return 'Date and time to be confirmed'
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Europe/London',
  }).format(parsedDate)
}

export function buildCalendarNotificationHtml({
  action = 'creation',
  clubLogoUrl = '',
  clubName,
  endsAt = '',
  eventTitle,
  eventType,
  location,
  logoSource = '',
  logoUrl = '',
  notes,
  parentName,
  playerName,
  portalUrl = CALENDAR_NOTIFICATION_PARENT_PORTAL_URL,
  responseUrl = '',
  startsAt,
  teamName,
  themeAccent = '',
  trialInvitation = false,
}) {
  const resolvedAction = normalizeText(action).toLowerCase() === 'update' ? 'update' : 'creation'
  const resolvedAccent = resolveCalendarEmailAccent(themeAccent)
  const resolvedClubName = cleanEmailCopy(clubName, 'Your club')
  const resolvedTeamName = cleanEmailCopy(teamName, 'Club event')
  const resolvedParentName = cleanEmailCopy(parentName, 'Parent or guardian')
  const resolvedPlayerName = cleanEmailCopy(playerName, 'your child')
  const resolvedTitle = cleanEmailCopy(eventTitle, 'Club event')
  const resolvedType = cleanEmailCopy(eventType, 'Event')
  const isTraining = normalizeText(eventType).toLowerCase() === 'training'
  const resolvedLocation = normalizeText(location)
  const resolvedNotes = normalizeText(notes)
  const resolvedActionUrl = trialInvitation ? normalizeText(responseUrl) : normalizeText(portalUrl)
  const logoMarkup = buildEmailLogoMarkup({
    altText: `${resolvedClubName} logo`,
    clubLogoUrl: logoSource === 'club' ? logoUrl : clubLogoUrl,
    fallbackLogoUrl: logoSource === 'football-player' ? logoUrl : '',
    maxHeight: 72,
    maxWidth: 200,
    origin: CALENDAR_NOTIFICATION_PLATFORM_ORIGIN,
  })
  const responseCopy = trialInvitation
    ? 'Use the secure response link below to confirm attendance. This link is only for this event and this trial player.'
    : isTraining
      ? 'This Training session has been shared with you. No attendance response has been requested.'
      : 'This event has been shared with you for information. No attendance response has been requested.'
  const actionLabel = trialInvitation ? 'Respond to invitation' : 'View event details'

  return `
    <div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:24px;line-height:1.55;max-width:680px;margin:0 auto;color-scheme:light;">
      ${logoMarkup}
      <p style="margin:0 0 6px;color:${escapeHtml(resolvedAccent)};font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(resolvedClubName)}</p>
      <h1 style="margin:0 0 4px;color:#142018;font-size:25px;line-height:1.25;">${escapeHtml(resolvedTitle)}</h1>
      <p style="margin:0 0 22px;color:#52635a;font-size:15px;font-weight:700;">${escapeHtml(resolvedTeamName)}</p>
      <p style="margin:0 0 16px;color:#142018;font-size:16px;">Hi ${escapeHtml(resolvedParentName)}, ${escapeHtml(resolvedPlayerName)} ${resolvedAction === 'update' ? 'has updated event details' : 'has been invited to an event'} from ${escapeHtml(resolvedClubName)}.</p>
      <div style="margin:0 0 22px;padding:18px;border:1px solid #d8e5dc;border-radius:12px;background:#f7faf8;">
        <p style="margin:0 0 8px;color:#52635a;font-size:12px;font-weight:800;text-transform:uppercase;">Event details</p>
        <p style="margin:0 0 7px;color:#142018;font-size:14px;"><strong>Type:</strong> ${escapeHtml(resolvedType)}</p>
        <p style="margin:0 0 7px;color:#142018;font-size:14px;"><strong>Starts:</strong> ${escapeHtml(formatCalendarNotificationDateTime(startsAt))}</p>
        ${normalizeText(endsAt) ? `<p style="margin:0 0 7px;color:#142018;font-size:14px;"><strong>Ends:</strong> ${escapeHtml(formatCalendarNotificationDateTime(endsAt))}</p>` : ''}
        ${resolvedLocation ? `<p style="margin:0 0 7px;color:#142018;font-size:14px;"><strong>Location:</strong> ${escapeHtml(resolvedLocation)}</p>` : ''}
        ${resolvedNotes ? `<p style="margin:0;color:#142018;font-size:14px;"><strong>Notes:</strong> ${escapeHtml(resolvedNotes)}</p>` : ''}
      </div>
      <p style="margin:0 0 18px;color:#3f5147;font-size:14px;">${escapeHtml(responseCopy)}</p>
      ${resolvedActionUrl ? `<p style="margin:0 0 22px;"><a href="${escapeHtml(resolvedActionUrl)}" style="display:inline-block;background:${escapeHtml(resolvedAccent)};color:#ffffff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;">${escapeHtml(actionLabel)}</a></p>` : ''}
      <p style="margin:0;color:#52635a;font-size:13px;">Sent by ${escapeHtml(resolvedClubName)} for ${escapeHtml(resolvedTeamName)}.</p>
      <div style="border-top:1px solid #e7ece3;margin-top:24px;padding-top:14px;">
        <p style="margin:0;color:#64748b;font-size:11px;line-height:1.45;">Delivered securely through Footballplayer.online.</p>
      </div>
    </div>
  `
}

export async function buildAuthoritativeCalendarNotificationEmail({
  action,
  clubLogoUrl,
  clubName,
  endsAt,
  eventTitle,
  eventType,
  fetchImpl = globalThis.fetch,
  location,
  notes,
  parentName,
  playerName,
  portalUrl,
  responseUrl,
  startsAt,
  teamName,
  themeAccent,
  trialInvitation = false,
} = {}) {
  const resolvedClubName = cleanEmailCopy(clubName, 'Your club')
  const resolvedPlayerName = cleanEmailCopy(playerName, 'your child')
  const resolvedTitle = cleanEmailCopy(eventTitle, 'Club event')
  const resolvedLogo = await resolveReachableEmailLogo({
    clubLogoUrl,
    fetchImpl,
    origin: CALENDAR_NOTIFICATION_PLATFORM_ORIGIN,
  })
  const html = buildCalendarNotificationHtml({
    action,
    clubLogoUrl: resolvedLogo.source === 'club' ? resolvedLogo.url : '',
    clubName: resolvedClubName,
    endsAt,
    eventTitle: resolvedTitle,
    eventType,
    location,
    logoSource: resolvedLogo.source,
    logoUrl: resolvedLogo.url,
    notes,
    parentName,
    playerName: resolvedPlayerName,
    portalUrl,
    responseUrl,
    startsAt,
    teamName,
    themeAccent,
    trialInvitation,
  })

  return {
    clubName: resolvedClubName,
    fromDisplayName: `${resolvedClubName} via Football Player`,
    html,
    logoSource: resolvedLogo.source,
    logoUrl: resolvedLogo.url,
    playerName: resolvedPlayerName,
    subject: `${resolvedClubName}: ${resolvedTitle}`,
    teamName: cleanEmailCopy(teamName, 'Club event'),
  }
}
