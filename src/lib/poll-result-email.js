import {
  buildEmailLogoMarkup,
  resolveReachableEmailLogo,
} from './email-branding.js'

export const POLL_RESULT_PARENT_PORTAL_URL = 'https://parent.footballplayer.online/parent-portal?section=polls'
export const POLL_RESULT_PLATFORM_ORIGIN = 'https://footballplayer.online'

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

export function resolvePollResultAccent(value) {
  const normalizedValue = normalizeText(value).toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(normalizedValue)) return normalizedValue
  return ACCENT_COLOURS[normalizedValue] || ACCENT_COLOURS.green
}

export function getPollResultSummary(ranked = []) {
  const normalizedRanked = Array.isArray(ranked) ? ranked : []
  const topCount = Number(normalizedRanked[0]?.count || 0)
  const leaders = normalizedRanked.filter((option) => Number(option?.count || 0) === topCount && topCount > 0)

  if (leaders.length === 0) return 'The poll closed without any recorded votes.'
  if (leaders.length === 1) return `${cleanEmailCopy(leaders[0].label, 'One option')} finished first with ${topCount} vote${topCount === 1 ? '' : 's'}.`
  return `${leaders.map((option) => cleanEmailCopy(option.label, 'Option')).join(', ')} finished level with ${topCount} vote${topCount === 1 ? '' : 's'} each.`
}

function getPollResultRows(ranked = []) {
  const options = (Array.isArray(ranked) ? ranked : []).map((option, index) => ({
    count: Math.max(0, Number(option?.count || 0)),
    id: normalizeText(option?.id) || `option-${index + 1}`,
    label: cleanEmailCopy(option?.label, `Option ${index + 1}`),
  }))
  const totalVotes = options.reduce((total, option) => total + option.count, 0)
  return {
    options: options.map((option) => ({
      ...option,
      percentage: totalVotes > 0 ? Math.round((option.count / totalVotes) * 100) : 0,
    })),
    totalVotes,
  }
}

export function buildPollResultHtml({
  clubLogoUrl = '',
  clubName,
  logoSource = '',
  logoUrl = '',
  pollTitle,
  portalUrl = POLL_RESULT_PARENT_PORTAL_URL,
  ranked = [],
  teamName,
  themeAccent = '',
} = {}) {
  const resolvedAccent = resolvePollResultAccent(themeAccent)
  const resolvedClubName = cleanEmailCopy(clubName, 'Your club')
  const resolvedTeamName = cleanEmailCopy(teamName, resolvedClubName)
  const resolvedPollTitle = cleanEmailCopy(pollTitle, 'Parent poll')
  const result = getPollResultSummary(ranked)
  const { options, totalVotes } = getPollResultRows(ranked)
  const logoMarkup = buildEmailLogoMarkup({
    altText: `${resolvedClubName} logo`,
    clubLogoUrl: logoSource === 'club' ? logoUrl : clubLogoUrl,
    fallbackLogoUrl: logoSource === 'football-player' ? logoUrl : '',
    maxHeight: 72,
    maxWidth: 200,
    origin: POLL_RESULT_PLATFORM_ORIGIN,
  })

  return `
    <div style="font-family:Arial,sans-serif;color:#142018;background:#ffffff;padding:24px;line-height:1.55;max-width:680px;margin:0 auto;color-scheme:light;">
      ${logoMarkup}
      <p style="margin:0 0 6px;color:${escapeHtml(resolvedAccent)};font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(resolvedClubName)}</p>
      <h1 style="margin:0 0 4px;color:#142018;font-size:25px;line-height:1.25;">Poll result</h1>
      <p style="margin:0 0 22px;color:#52635a;font-size:15px;font-weight:700;">${escapeHtml(resolvedTeamName)}</p>
      <div style="margin:0 0 22px;padding:20px;border:1px solid #d8e5dc;border-radius:14px;background:#f7faf8;">
        <p style="margin:0 0 8px;color:#52635a;font-size:12px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;">Question</p>
        <h2 style="margin:0 0 12px;color:#142018;font-size:22px;line-height:1.3;">${escapeHtml(resolvedPollTitle)}</h2>
        <p style="margin:0;color:#142018;font-size:16px;font-weight:700;">${escapeHtml(result)}</p>
      </div>
      <div style="margin:0 0 22px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 10px;">
          <h2 style="margin:0;color:#142018;font-size:18px;">Full result</h2>
          <p style="margin:0;color:#52635a;font-size:13px;font-weight:700;">${totalVotes} vote${totalVotes === 1 ? '' : 's'} recorded</p>
        </div>
        ${options.length ? options.map((option) => `
          <div style="margin:0 0 12px;padding:14px;border:1px solid #d8e5dc;border-radius:12px;background:#ffffff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tr>
                <td style="color:#142018;font-size:14px;font-weight:800;">${escapeHtml(option.label)}</td>
                <td align="right" style="color:#142018;font-size:14px;font-weight:800;white-space:nowrap;">${option.count} vote${option.count === 1 ? '' : 's'} · ${option.percentage}%</td>
              </tr>
            </table>
            <div style="height:8px;margin-top:10px;background:#e7ece3;border-radius:999px;overflow:hidden;">
              <div style="height:8px;width:${option.percentage}%;background:${escapeHtml(resolvedAccent)};border-radius:999px;"></div>
            </div>
          </div>
        `).join('') : '<p style="margin:0;color:#52635a;font-size:14px;">No answer options were available.</p>'}
      </div>
      ${normalizeText(portalUrl) ? `<p style="margin:0 0 22px;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;background:${escapeHtml(resolvedAccent)};color:#ffffff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:10px;">Open polls</a></p>` : ''}
      <p style="margin:0;color:#52635a;font-size:13px;">Sent by ${escapeHtml(resolvedClubName)} for ${escapeHtml(resolvedTeamName)}.</p>
      <div style="border-top:1px solid #e7ece3;margin-top:24px;padding-top:14px;">
        <p style="margin:0;color:#64748b;font-size:11px;line-height:1.45;">Delivered securely through Footballplayer.online.</p>
      </div>
    </div>
  `
}

export async function buildAuthoritativePollResultEmail({
  clubLogoUrl,
  clubName,
  fetchImpl = globalThis.fetch,
  pollId,
  pollTitle,
  ranked,
  teamName,
  themeAccent,
} = {}) {
  const resolvedClubName = cleanEmailCopy(clubName, 'Your club')
  const resolvedTeamName = cleanEmailCopy(teamName, resolvedClubName)
  const resolvedPollTitle = cleanEmailCopy(pollTitle, 'Parent poll')
  const resolvedLogo = await resolveReachableEmailLogo({
    clubLogoUrl,
    fetchImpl,
    origin: POLL_RESULT_PLATFORM_ORIGIN,
  })
  const portalUrl = `${POLL_RESULT_PARENT_PORTAL_URL}&pollId=${encodeURIComponent(normalizeText(pollId))}`
  const result = getPollResultSummary(ranked)
  const { options, totalVotes } = getPollResultRows(ranked)

  return {
    fromDisplayName: `${resolvedClubName} via Football Player`,
    html: buildPollResultHtml({
      clubLogoUrl: resolvedLogo.source === 'club' ? resolvedLogo.url : '',
      clubName: resolvedClubName,
      logoSource: resolvedLogo.source,
      logoUrl: resolvedLogo.url,
      pollTitle: resolvedPollTitle,
      portalUrl,
      ranked,
      teamName: resolvedTeamName,
      themeAccent,
    }),
    subject: `${resolvedClubName}: Poll result - ${resolvedPollTitle}`,
    text: [
      resolvedClubName,
      resolvedTeamName,
      '',
      `Poll result: ${resolvedPollTitle}`,
      result,
      '',
      ...options.map((option) => `${option.label}: ${option.count} vote${option.count === 1 ? '' : 's'} (${option.percentage}%)`),
      '',
      `${totalVotes} vote${totalVotes === 1 ? '' : 's'} recorded`,
      `Open polls: ${portalUrl}`,
    ].join('\n'),
  }
}
