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

  return `
    <div style="font-family: Arial, sans-serif; color: #142018; padding: 20px; line-height: 1.5;">
      <h2 style="margin: 0 0 8px;">${escapeHtml(club || 'Club')}</h2>
      <h3 style="margin: 0 0 12px;">${escapeHtml(playerName || 'Player')}</h3>
      <p style="margin: 0 0 20px;"><strong>Team:</strong> ${escapeHtml(team || 'Team')}</p>

      ${
        emailBody
          ? `<div style="margin: 0 0 24px; white-space: normal;">${formatLines(emailBody)}</div>`
          : `
            <h4 style="margin: 0 0 8px;">Summary</h4>
            <p style="margin: 0 0 20px;">${escapeHtml(summary || 'No summary provided')}</p>
          `
      }

      ${
        responseItems.length > 0
          ? `
            <h4 style="margin: 0 0 8px;">Evaluation</h4>
            <ul style="padding-left: 20px; margin: 0;">
              ${responseItems
                .map((item) => `<li><strong>${escapeHtml(item.label)}:</strong> ${escapeHtml(item.value)}</li>`)
                .join('')}
            </ul>
          `
          : ''
      }
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
