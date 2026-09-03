import { getSafeEmailImageUrl, isSafeEmailImageProbeUrl } from './email-branding.js'
import { getMatchDayDisplayName } from './matchday-display.js'
import { createThemeColorTokens } from './theme.js'

const clean = (value) => String(value ?? '').trim()
const escapeHtml = (value) => clean(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')

// Pending receipts can still contain the previous closing sentence.
export function cleanSquadNotificationCopy(value) {
  return clean(value).replace(/\s*Thank you for your support\.\s*$/i, '')
}

function formatMatchDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(value))) return 'Date to be confirmed'
  const date = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return 'Date to be confirmed'
  return date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })
}

export function buildSquadDecisionEmail({ match = {}, receipt = {}, logoUrl = '' } = {}) {
  const clubName = clean(match.clubs?.name) || 'Your football club'
  const teamName = clean(match.teams?.name)
  const colours = createThemeColorTokens(match.clubs?.theme_accent, 'light')
  const body = cleanSquadNotificationCopy(receipt.body)
  const heading = receipt.decision_status === 'selected' ? 'Squad confirmed' : 'Squad selection update'
  const status = receipt.decision_status === 'selected' ? 'Selected' : receipt.decision_status === 'not_selected' ? 'Not selected this time' : 'Squad update'
  const fixture = getMatchDayDisplayName({ ...match, teamName })
  const date = formatMatchDate(match.match_date)
  const kickoff = !match.kickoff_time_tbc && /^\d{2}:\d{2}/.test(clean(match.kickoff_time)) ? clean(match.kickoff_time).slice(0, 5) : 'Time to be confirmed'
  const venue = clean(match.venue_name ?? match.venue)
  const safeLogo = getSafeEmailImageUrl(logoUrl)
  const initials = clubName.split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase()
  const crest = safeLogo && isSafeEmailImageProbeUrl(safeLogo)
    ? `<img src="${escapeHtml(safeLogo)}" width="72" alt="${escapeHtml(clubName)} crest" style="display:block;width:72px;max-height:88px;object-fit:contain;border:0;">`
    : `<div style="width:64px;height:64px;line-height:64px;text-align:center;background:${colours.accent};color:${colours.accentText};border-radius:16px;font-size:22px;font-weight:700;">${escapeHtml(initials)}</div>`
  const detailRow = (label, value) => `<tr><td style="padding:0 0 16px;"><p style="margin:0 0 4px;font-size:11px;line-height:16px;letter-spacing:1px;font-weight:700;color:#596860;text-transform:uppercase;">${label}</p><p style="margin:0;font-size:16px;line-height:24px;color:#172b24;">${escapeHtml(value)}</p></td></tr>`
  const signoff = teamName ? `${teamName} coaching team` : `${clubName} coaching team`
  const text = `${clubName}${teamName ? `\n${teamName}` : ''}\n\n${status}\n\n${body}\n\n${fixture}\n${date}\nKick-off: ${kickoff}${venue ? `\nVenue: ${venue}` : ''}\n\n${signoff}`
  const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(clubName)}: Squad update</title>
<style>body{margin:0;padding:0;}table{border-collapse:collapse;}@media(max-width:480px){.outer{padding:12px 8px!important;}.content{padding:24px!important;}.club-name{font-size:21px!important;}.headline{font-size:29px!important;}}</style></head>
<body style="margin:0;padding:0;background:#f1f4f2;font-family:Arial,Helvetica,sans-serif;color:#172b24;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(body)}</div>
<table role="presentation" width="100%" style="width:100%;background:#f1f4f2;"><tr><td class="outer" align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;table-layout:fixed;">
<tr><td height="8" style="height:8px;background:${colours.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td class="content" style="padding:32px 36px;overflow-wrap:break-word;word-wrap:break-word;">
${crest}
<p class="club-name" style="margin:18px 0 4px;font-size:25px;line-height:1.2;font-weight:700;letter-spacing:-0.5px;color:#172b24;">${escapeHtml(clubName)}</p>
${teamName ? `<p style="margin:0;font-size:14px;line-height:21px;color:#596860;">${escapeHtml(teamName)}</p>` : ''}
<div style="height:1px;background:#e0e8e2;margin:26px 0;"></div>
<p style="margin:0 0 14px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.7px;color:${colours.textSecondary};text-transform:uppercase;">Squad update</p>
<h1 class="headline" style="margin:0 0 16px;font-size:34px;line-height:1.15;font-weight:700;letter-spacing:-1px;color:#172b24;">${heading}</h1>
<p style="margin:0 0 22px;"><span style="display:inline-block;padding:7px 12px;border-radius:6px;background:${colours.accentSoft};color:#172b24;font-size:12px;line-height:18px;font-weight:700;">${status}</span></p>
<p style="margin:0 0 28px;font-size:17px;line-height:28px;color:#34483f;">${escapeHtml(body)}</p>
<table role="presentation" width="100%" style="width:100%;border-top:3px solid ${colours.accent};table-layout:fixed;"><tr><td style="padding:20px 0 18px;"><p style="margin:0 0 7px;font-size:11px;line-height:16px;letter-spacing:1px;font-weight:700;color:#596860;text-transform:uppercase;">The fixture</p><p style="margin:0;font-size:20px;line-height:27px;font-weight:700;color:#172b24;">${escapeHtml(fixture)}</p></td></tr>
${detailRow('When', date)}${detailRow('Kick-off', kickoff)}${venue ? detailRow('Where', venue) : ''}</table>
<p style="margin:10px 0 0;padding-top:22px;border-top:1px solid #e0e8e2;font-size:13px;line-height:21px;color:#596860;">From your coaches<br><strong style="color:#172b24;">${escapeHtml(signoff)}</strong></p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<p style="margin:18px 0 0;font-size:11px;line-height:18px;color:#68786e;">${escapeHtml(clubName)}<br>Squad news for your family</p>
</td></tr></table></body></html>`
  return { subject: `${clubName}: Squad update`, html, text }
}
