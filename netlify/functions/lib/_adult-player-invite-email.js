import { buildEmailLogoMarkup } from '../../../src/lib/email-branding.js'
import { adultInvitePalette } from '../../../src/lib/adult-player-invite-branding.js'

const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function buildAdultPlayerInviteEmail({ clubName, teamName, logoUrl, accent, link }) {
  const club = String(clubName || 'Your club').replace(/\s+/g, ' ').trim()
  const team = String(teamName || 'your team').replace(/\s+/g, ' ').trim()
  const logo = buildEmailLogoMarkup({ clubLogoUrl: logoUrl, altText: `${club} badge`, maxWidth: 72, maxHeight: 72, origin: 'https://footballplayer.online' })
  const title = `${club} has invited you to Football Player`
  const palette = adultInvitePalette(accent)
  return {
    subject: `${club}: set up your Player access`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(title)}</title><style>@media(prefers-color-scheme:dark){.email-background{background:#0b1110!important}.email-content{background:#14201c!important;color:#f6fbf8!important}.email-muted{color:#d7e3dc!important}.email-rule{border-color:#466052!important}.email-link{color:#a7e7d6!important}}@media(max-width:480px){.email-padding{padding:24px 20px!important}.email-heading{font-size:28px!important}}</style></head>
<body class="email-background" style="margin:0;padding:0;background:#f2f5f3;font-family:Arial,Helvetica,sans-serif;color:#142018">
<div style="display:none;max-height:0;overflow:hidden">Your invitation to ${escape(team)}. Create your login or use your existing Football Player account.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" class="email-content" style="width:100%;max-width:600px;background:#ffffff;color:#142018;border-top:5px solid ${palette.background}">
<tr><td class="email-padding" style="padding:32px 36px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="92" valign="middle">${logo}</td><td valign="middle" style="padding-left:4px"><p style="margin:0;font-size:19px;line-height:1.3;font-weight:bold">${escape(club)}</p><p class="email-muted" style="margin:6px 0 0;font-size:14px;color:#536461">${escape(team)}</p></td></tr></table></td></tr>
<tr><td class="email-padding" style="padding:8px 36px 32px"><p class="email-muted" style="margin:0 0 12px;font-size:11px;font-weight:bold;letter-spacing:2px;color:#536461;text-transform:uppercase">Your Player invitation</p><h1 class="email-heading" style="margin:0 0 18px;font-size:34px;line-height:1.15;letter-spacing:-1px">Welcome to your team.</h1><p style="margin:0 0 16px;font-size:16px;line-height:1.65">${escape(club)} has invited you to join ${escape(team)} on Football Player.</p><p class="email-muted" style="margin:0 0 26px;font-size:15px;line-height:1.65;color:#536461">Set up your own Player login to see what is coming up and respond to match, training and calendar event invitations.</p>
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="${palette.background}" style="background:${palette.background};border-radius:6px;text-align:center"><a href="${escape(link)}" style="display:inline-block;padding:16px 24px;font-size:15px;line-height:20px;background:${palette.background};color:${palette.foreground};font-weight:bold;text-decoration:none;border-radius:6px">Set up Player access</a></td></tr></table>
<p class="email-muted" style="margin:14px 0 28px;font-size:12px;line-height:1.6;color:#536461">Your secure setup link expires in seven days.</p>
<div class="email-rule" style="border-top:1px solid #d7e5dc;padding-top:22px"><p style="margin:0 0 8px;font-size:14px;font-weight:bold">Already have an account?</p><p class="email-muted" style="margin:0;font-size:14px;line-height:1.65;color:#536461">Open the invitation and choose <strong>I already have an account</strong>. You can use your existing Parent login and keep access to your children.</p></div>
<p class="email-muted" style="margin:24px 0 8px;font-size:12px;line-height:1.65;color:#536461">If the button does not work, copy and paste this full link into your browser:</p><p style="margin:0;font-size:12px;line-height:1.65;word-break:break-all;overflow-wrap:anywhere"><a class="email-link" href="${escape(link)}" style="color:#146c3a;text-decoration:underline">${escape(link)}</a></p></td></tr>
<tr><td class="email-rule email-padding email-muted" style="border-top:1px solid #d7e5dc;padding:22px 36px;font-size:12px;line-height:1.65;color:#536461">Invited by ${escape(club)}. If you were not expecting this invitation, contact your club.<br>Powered by Football Player</td></tr>
</table></td></tr></table></body></html>`,
    text: `${title}\n\nYou have been invited to access ${team} as a player. Open the link to create an account or sign in with your existing account. Once connected, you can view and respond to match, training and calendar event invitations.\n\n${link}\n\nThis invitation expires in seven days.\n\nAlready have a Parent account? Choose I already have an account. Your existing access to your children stays available.\n\nIf you were not expecting this invitation, contact ${club}.\n\nPowered by Football Player.`,
  }
}
