function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatLines(value) {
  return escapeHtml(value)
    .split('\n')
    .map((line) => (line.trim() ? line : '&nbsp;'))
    .join('<br />')
}

function normaliseResponses(responses) {
  if (Array.isArray(responses)) {
    return responses
  }

  if (responses && typeof responses === 'object') {
    return Object.entries(responses).map(([label, value]) => ({ label, value }))
  }

  return []
}

export function buildEmailHtml({
  parentName,
  playerName,
  team,
  teamName,
  club,
  clubName,
  summary,
  responses,
  emailBody,
}) {
  const responseItems = normaliseResponses(responses)
  const summaryContent = emailBody || summary || 'No summary provided'
  const resolvedTeam = teamName || team
  const resolvedClub = clubName || club
  const resolvedPlayer = playerName || 'Player'
  const resolvedParent = parentName || 'Parent/Guardian'

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 24px; line-height: 1.6; max-width: 680px; margin: 0 auto;">
      <h2 style="margin: 0 0 6px; font-size: 22px; line-height: 1.25;">${escapeHtml(resolvedClub || 'Club')}</h2>
      <p style="margin: 0 0 22px; color: #5a6b5b; font-size: 13px;">${escapeHtml(resolvedTeam || 'Team')}</p>

      <p style="margin: 0 0 14px; font-size: 15px;">Hi ${escapeHtml(resolvedParent)},</p>
      <p style="margin: 0 0 20px; font-size: 15px;">Here is the latest player feedback report for ${escapeHtml(resolvedPlayer)}.</p>

      <div style="border: 1px solid #e7ece3; border-radius: 16px; background: #fbfcf9; padding: 18px; margin: 0 0 22px;">
        <h3 style="margin: 0 0 8px; font-size: 18px; line-height: 1.3;">${escapeHtml(resolvedPlayer)}</h3>
        <p style="margin: 0; font-size: 14px;"><strong>Team:</strong> ${escapeHtml(resolvedTeam || 'Team')}</p>
      </div>

      <h4 style="margin: 0 0 8px; font-size: 15px; line-height: 1.3;">Summary</h4>
      <div style="margin: 0 0 20px; font-size: 14px;">${formatLines(summaryContent)}</div>

      <h4 style="margin: 0 0 8px; font-size: 15px; line-height: 1.3;">Evaluation</h4>
      <ul style="padding-left: 20px; margin: 0 0 24px; font-size: 14px;">
        ${
          responseItems.length > 0
            ? responseItems
              .map((item) => `<li style="margin: 0 0 6px;"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`)
              .join('')
            : '<li style="margin: 0 0 6px;">No responses provided</li>'
        }
      </ul>

      <p style="margin: 0 0 18px; font-size: 14px;">If you have any questions, just reply to this email.</p>
      <p style="margin: 0; color: #5a6b5b; font-size: 13px;">${escapeHtml(resolvedClub || 'Club')} | ${escapeHtml(resolvedTeam || 'Team')}</p>
    </div>
  `
}

export function buildPlayerFeedbackSubject({ playerName, teamName, team }) {
  const resolvedPlayer = String(playerName ?? '').trim()
  const resolvedTeam = String(teamName || team || '').trim()

  if (resolvedPlayer && resolvedTeam) {
    return `Player Feedback: ${resolvedPlayer} (${resolvedTeam})`
  }

  return 'Player Feedback Report'
}

export async function sendParentEmail(data) {
  const html = buildEmailHtml(data)
  const teamName = data.teamName || data.team
  const clubName = data.clubName || data.club
  const subject = data.subject || buildPlayerFeedbackSubject({
    playerName: data.playerName,
    teamName,
  })

  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentEmail: data.parentEmail,
      displayName: data.displayName,
      teamName,
      clubName,
      replyToEmail: data.replyToEmail || data.clubContactEmail || data.clubEmail,
      clubContactEmail: data.clubContactEmail,
      subject,
      html,
      playerName: data.playerName,
      parentName: data.parentName,
      idempotencyKey: data.idempotencyKey,
      evaluationId: data.evaluationId,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.message || 'Email failed - will retry automatically')
  }

  return result
}
