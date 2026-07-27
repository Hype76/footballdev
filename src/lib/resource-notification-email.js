import {
  buildEmailLogoMarkup,
  resolveReachableEmailLogo,
} from './email-branding.js'

export const RESOURCE_NOTIFICATION_PARENT_PORTAL_URL = 'https://parent.footballplayer.online/parent-portal?section=resources'
export const RESOURCE_NOTIFICATION_PLATFORM_ORIGIN = 'https://footballplayer.online'

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

export function buildResourceNotificationHtml({
  clubLogoUrl,
  clubName,
  fallbackLogoUrl,
  logoSource,
  playerName,
  portalUrl = RESOURCE_NOTIFICATION_PARENT_PORTAL_URL,
  resourceDescription,
  resourceTitle,
  teamName,
}) {
  const resolvedClubName = normalizeText(clubName) || 'Your club'
  const resolvedTeamName = normalizeText(teamName) || 'Your team'
  const resolvedPlayerName = normalizeText(playerName) || 'your child'
  const resolvedResourceTitle = normalizeText(resourceTitle) || 'Shared resource'
  const resolvedDescription = normalizeText(resourceDescription)
  const logoMarkup = buildEmailLogoMarkup({
    altText: `${resolvedClubName} logo`,
    clubLogoUrl: logoSource === 'club' ? clubLogoUrl : '',
    fallbackLogoUrl: logoSource === 'football-player' ? fallbackLogoUrl : '',
    maxHeight: 72,
    maxWidth: 200,
    origin: RESOURCE_NOTIFICATION_PLATFORM_ORIGIN,
  })

  return `
    <div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:24px;line-height:1.55;max-width:640px;margin:0 auto;color-scheme:light;">
      ${logoMarkup}
      <p style="margin:0 0 6px;color:#047857;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(resolvedClubName)}</p>
      <h1 style="margin:0 0 4px;color:#142018;font-size:25px;line-height:1.25;">${escapeHtml(resolvedClubName)}</h1>
      <p style="margin:0 0 22px;color:#52635a;font-size:15px;font-weight:700;">${escapeHtml(resolvedTeamName)}</p>
      <p style="margin:0 0 16px;color:#142018;font-size:16px;">A new resource has been shared for ${escapeHtml(resolvedPlayerName)}.</p>
      <div style="margin:0 0 22px;padding:18px;border:1px solid #d8e5dc;border-radius:12px;background:#f7faf8;">
        <h2 style="margin:0;color:#142018;font-size:20px;line-height:1.35;">${escapeHtml(resolvedResourceTitle)}</h2>
        ${resolvedDescription ? `<p style="margin:10px 0 0;color:#3f5147;font-size:14px;line-height:1.55;">${escapeHtml(resolvedDescription)}</p>` : ''}
      </div>
      <p style="margin:0 0 22px;">
        <a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:#f7d74b;color:#142018;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;">Open Parent Portal</a>
      </p>
      <p style="margin:0;color:#52635a;font-size:13px;">Shared by ${escapeHtml(resolvedClubName)} for ${escapeHtml(resolvedTeamName)}.</p>
      <div style="border-top:1px solid #e7ece3;margin-top:24px;padding-top:14px;">
        <p style="margin:0;color:#64748b;font-size:11px;line-height:1.45;">Delivered securely through Footballplayer.online.</p>
      </div>
    </div>
  `
}

export async function buildAuthoritativeResourceNotificationEmail({
  clubLogoUrl,
  clubName,
  fetchImpl = globalThis.fetch,
  playerName,
  resourceDescription,
  resourceTitle,
  teamName,
} = {}) {
  const resolvedClubName = cleanEmailCopy(clubName, 'Your club')
  const resolvedTeamName = cleanEmailCopy(teamName, 'Your team')
  const resolvedPlayerName = cleanEmailCopy(playerName, 'your child')
  const resolvedResourceTitle = cleanEmailCopy(resourceTitle, 'Shared resource')
  const resolvedDescription = normalizeText(resourceDescription)
  const resolvedLogo = await resolveReachableEmailLogo({
    clubLogoUrl,
    fetchImpl,
    origin: RESOURCE_NOTIFICATION_PLATFORM_ORIGIN,
  })
  const html = buildResourceNotificationHtml({
    clubLogoUrl: resolvedLogo.source === 'club' ? resolvedLogo.url : '',
    clubName: resolvedClubName,
    fallbackLogoUrl: resolvedLogo.source === 'football-player' ? resolvedLogo.url : '',
    logoSource: resolvedLogo.source,
    playerName: resolvedPlayerName,
    resourceDescription: resolvedDescription,
    resourceTitle: resolvedResourceTitle,
    teamName: resolvedTeamName,
  })

  return {
    clubName: resolvedClubName,
    fromDisplayName: `${resolvedClubName} via Football Player`,
    html,
    logoSource: resolvedLogo.source,
    logoUrl: resolvedLogo.url,
    playerName: resolvedPlayerName,
    portalUrl: RESOURCE_NOTIFICATION_PARENT_PORTAL_URL,
    resourceDescription: resolvedDescription,
    resourceTitle: resolvedResourceTitle,
    subject: `${resolvedClubName} shared a new resource for ${resolvedPlayerName}`,
    teamName: resolvedTeamName,
  }
}
