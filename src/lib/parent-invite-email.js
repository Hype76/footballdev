import {
  buildEmailLogoMarkup,
  resolveReachableEmailLogo,
} from './email-branding.js'

export const FOOTBALL_PLAYER_EMAIL_ORIGIN = 'https://footballplayer.online'
export const PARENT_PORTAL_EMAIL_ORIGIN = 'https://parent.footballplayer.online'

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

function getRelatedRow(value) {
  return Array.isArray(value) ? value[0] : value
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

function buildPoweredByFooterMarkup() {
  return `
    <div style="border-top:1px solid #e7ece3;margin-top:24px;padding-top:14px;">
      <p style="margin:0;color:#64748b;font-size:11px;line-height:1.45;">Powered by Football Player | footballplayer.online</p>
    </div>
  `
}

export function buildParentPortalSignInUrl(inviteUrl) {
  const rawUrl = normalizeText(inviteUrl)

  try {
    const url = new URL(rawUrl)
    const token = url.pathname.split('/').filter(Boolean).pop() || ''
    url.pathname = '/parent-login'
    url.search = token ? `?parentInvite=${encodeURIComponent(token)}` : ''
    url.hash = ''
    return url.toString()
  } catch {
    const token = rawUrl.split('/').filter(Boolean).pop() || ''
    return token
      ? `${PARENT_PORTAL_EMAIL_ORIGIN}/parent-login?parentInvite=${encodeURIComponent(token)}`
      : `${PARENT_PORTAL_EMAIL_ORIGIN}/parent-login`
  }
}

export function buildTrustedParentInviteUrl(
  inviteToken,
  { parentOrigin = PARENT_PORTAL_EMAIL_ORIGIN } = {},
) {
  const normalizedToken = normalizeText(inviteToken)

  if (!normalizedToken) {
    throw new Error('Family portal invite token is unavailable.')
  }

  return `${normalizeText(parentOrigin).replace(/\/$/, '')}/parent-invite/${encodeURIComponent(normalizedToken)}`
}

export function buildParentPortalInviteHtml({
  clubLogoUrl,
  clubName,
  existingParentPortalUser = false,
  fallbackLogoUrl,
  inviteUrl,
  logoUrl,
  origin,
  playerName,
  teamName,
  teamLogoUrl,
}) {
  const resolvedClub = normalizeText(clubName) || 'Your club'
  const resolvedPlayer = normalizeText(playerName) || 'your child'
  const resolvedTeam = normalizeText(teamName) || 'their team'
  const actionUrl = existingParentPortalUser ? buildParentPortalSignInUrl(inviteUrl) : inviteUrl
  const actionLabel = existingParentPortalUser ? 'Sign in to parent portal' : 'Create parent access'
  const actionCopy = existingParentPortalUser
    ? 'Open the link below and sign in with your existing parent portal account. After sign-in, Football Player will attach this child or team context to your parent portal safely.'
    : 'Open the link below, create your parent password, then confirm your email address. After confirmation, you will return to the parent login page.'
  const logoMarkup = buildEmailLogoMarkup({
    altText: `${resolvedClub} logo`,
    clubLogoUrl: clubLogoUrl || logoUrl,
    fallbackLogoUrl,
    origin,
    teamLogoUrl,
  })

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 28px; line-height: 1.55; max-width: 680px; margin: 0 auto;">
      ${logoMarkup}
      <p style="margin: 0 0 10px; color: #4f6552; font-size: 9px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;">Family portal invite</p>
      <h1 style="margin: 0 0 14px; font-size: 24px; line-height: 1.25;">${escapeHtml(resolvedClub)} has invited you</h1>
      <p style="margin: 0 0 16px; font-size: 15px;">You have been invited to view parent updates for ${escapeHtml(resolvedPlayer)} in ${escapeHtml(resolvedTeam)}.</p>
      <p style="margin: 0 0 22px; font-size: 15px;">${escapeHtml(actionCopy)}</p>
      <p style="margin: 0 0 22px;">
        <a href="${escapeHtml(actionUrl)}" style="display: inline-block; background: #f7d74b; color: #142018; text-decoration: none; font-weight: 700; padding: 12px 18px; border-radius: 10px;">${escapeHtml(actionLabel)}</a>
      </p>
      <p style="margin: 0 0 8px; color: #5a6b5b; font-size: 13px;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="margin: 0; word-break: break-all; color: #142018; font-size: 13px;">${escapeHtml(actionUrl)}</p>
      ${buildPoweredByFooterMarkup()}
    </div>
  `
}

export async function buildAuthoritativeParentInviteEmail({
  existingParentPortalUser = false,
  fetchImpl = globalThis.fetch,
  inviteLink,
  parentOrigin = PARENT_PORTAL_EMAIL_ORIGIN,
} = {}) {
  const club = getRelatedRow(inviteLink?.clubs)
  const player = getRelatedRow(inviteLink?.players)
  const team = getRelatedRow(inviteLink?.teams)
  const clubName = cleanEmailCopy(club?.name, 'Club')
  const playerName = cleanEmailCopy(player?.player_name, 'your child')
  const teamName = cleanEmailCopy(team?.name, 'Team')
  const inviteUrl = buildTrustedParentInviteUrl(inviteLink?.invite_token, { parentOrigin })
  const resolvedLogo = await resolveReachableEmailLogo({
    clubLogoUrl: club?.logo_url,
    fetchImpl,
    origin: FOOTBALL_PLAYER_EMAIL_ORIGIN,
  })
  const html = buildParentPortalInviteHtml({
    clubLogoUrl: resolvedLogo.source === 'club' ? resolvedLogo.url : '',
    clubName,
    existingParentPortalUser,
    fallbackLogoUrl: resolvedLogo.source === 'football-player' ? resolvedLogo.url : '',
    inviteUrl,
    origin: FOOTBALL_PLAYER_EMAIL_ORIGIN,
    playerName,
    teamName,
  })

  return {
    clubName,
    html,
    inviteUrl,
    logoSource: resolvedLogo.source,
    logoUrl: resolvedLogo.url,
    playerName,
    subject: `Family portal invite for ${playerName}`,
    teamName,
  }
}
