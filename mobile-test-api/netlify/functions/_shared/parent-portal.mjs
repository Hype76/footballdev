const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function normalizeText(value) {
  return String(value ?? '').trim()
}

export function requireUuid(value, errorCode = 'invalid_identifier') {
  const normalized = normalizeText(value)
  if (!UUID_PATTERN.test(normalized)) {
    const error = new Error(errorCode)
    error.status = 400
    throw error
  }
  return normalized
}

export async function restJson(environment, path, options = {}) {
  const response = await fetch(`${environment.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: options.headers,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error('test_data_request_failed')
    error.status = response.status
    throw error
  }
  return payload
}

export async function loadAuthorisedParentScope({ authUserId, environment, headers, parentLinkId }) {
  const linkId = requireUuid(parentLinkId, 'parent_link_invalid')
  const rows = await restJson(
    environment,
    `parent_player_links?id=eq.${encodeURIComponent(linkId)}&auth_user_id=eq.${encodeURIComponent(authUserId)}&status=eq.active&select=id,auth_user_id,club_id,team_id,player_id,status`,
    { headers },
  )
  const parentLink = rows?.[0]
  if (!parentLink) {
    const error = new Error('parent_scope_unavailable')
    error.status = 403
    throw error
  }
  const players = await restJson(
    environment,
    `players?id=eq.${encodeURIComponent(parentLink.player_id)}&club_id=eq.${encodeURIComponent(parentLink.club_id)}&select=id,club_id,team_id,player_name,status,archived_at`,
    { headers },
  )
  const player = players?.[0]
  if (!player || player.archived_at || normalizeText(player.status || 'active') === 'archived') {
    const error = new Error('parent_scope_unavailable')
    error.status = 403
    throw error
  }
  if (parentLink.team_id && parentLink.team_id !== player.team_id) {
    const error = new Error('parent_scope_unavailable')
    error.status = 403
    throw error
  }
  return { parentLink, player }
}

function pdfEscape(value) {
  return normalizeText(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replace(/[^\x20-\x7E]/g, '')
}

export function buildSimplePdf(lines = []) {
  const safeLines = lines.map(pdfEscape).filter(Boolean).slice(0, 45)
  const textCommands = safeLines.map((line, index) => `BT /F1 ${index === 0 ? 18 : 11} Tf 50 ${790 - (index * 16)} Td (${line.slice(0, 100)}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(textCommands)} >>\nstream\n${textCommands}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  return Buffer.from(pdf)
}
