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
  playerName,
  team,
  club,
  summary,
  responses,
  emailBody,
}) {
  const responseItems = normaliseResponses(responses)
  const summaryContent = emailBody || summary || 'No summary provided'

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; background: #ffffff; padding: 20px; line-height: 1.5;">
      <h2 style="margin: 0 0 8px; font-size: 22px; line-height: 1.25;">${escapeHtml(club || 'Club')}</h2>
      <h3 style="margin: 0 0 8px; font-size: 18px; line-height: 1.3;">${escapeHtml(playerName || 'Player')}</h3>
      <p style="margin: 0 0 20px; font-size: 14px;"><strong>Team:</strong> ${escapeHtml(team || 'Team')}</p>

      <h4 style="margin: 0 0 8px; font-size: 15px; line-height: 1.3;">Summary</h4>
      <div style="margin: 0 0 20px; font-size: 14px;">${formatLines(summaryContent)}</div>

      <h4 style="margin: 0 0 8px; font-size: 15px; line-height: 1.3;">Evaluation</h4>
      <ul style="padding-left: 20px; margin: 0; font-size: 14px;">
        ${
          responseItems.length > 0
            ? responseItems
              .map((item) => `<li style="margin: 0 0 6px;"><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`)
              .join('')
            : '<li style="margin: 0 0 6px;">No responses provided</li>'
        }
      </ul>
    </div>
  `
}

export async function sendParentEmail(data) {
  const html = buildEmailHtml(data)

  const response = await fetch('/.netlify/functions/send-parent-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentEmail: data.parentEmail,
      displayName: data.displayName,
      teamName: data.team,
      clubName: data.club,
      replyToEmail: data.replyToEmail,
      subject: data.subject || 'Player Feedback Report',
      html,
    }),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(result.error || 'Email failed')
  }

  return result
}
