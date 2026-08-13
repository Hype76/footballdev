const BLOCKED_CONTENT_PATTERN = /<(script|style|iframe|object|embed|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const UNCLOSED_BLOCKED_CONTENT_PATTERN = /<(script|style|iframe|object|embed|svg)\b[^>]*>[\s\S]*$/gi
const HTML_TAG_PATTERN = /<[^>]+>/g
const SAFE_LINK_PATTERN = /https:\/\/[^\s<>"']+/gi

function normalizeText(value) {
  return String(value ?? '').trim()
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }

  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const value = Number.parseInt(code, 16)
      return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : ''
    })
    .replace(/&#(\d+);/g, (_match, code) => {
      const value = Number.parseInt(code, 10)
      return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : ''
    })
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name.toLowerCase()] ?? match)
}

export function getSafeParentMessageUrl(value) {
  const normalizedValue = decodeHtmlEntities(normalizeText(value))

  try {
    const url = new URL(normalizedValue)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function stripInlineMarkup(value) {
  return decodeHtmlEntities(String(value ?? '').replace(HTML_TAG_PATTERN, ' '))
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function presentParentMessageBody(value) {
  const links = []
  const rememberLink = (candidate) => {
    const safeUrl = getSafeParentMessageUrl(candidate)

    if (safeUrl && !links.includes(safeUrl)) {
      links.push(safeUrl)
    }

    return safeUrl
  }
  const source = String(value ?? '')
    .replace(BLOCKED_CONTENT_PATTERN, '')
    .replace(UNCLOSED_BLOCKED_CONTENT_PATTERN, '')
  const withReadableLinks = source.replace(
    /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi,
    (_match, doubleQuotedHref, singleQuotedHref, unquotedHref, labelMarkup) => {
      const label = stripInlineMarkup(labelMarkup)
      const safeUrl = rememberLink(doubleQuotedHref || singleQuotedHref || unquotedHref)

      if (!safeUrl) {
        return label
      }

      return !label || label === safeUrl ? safeUrl : `${label} (${safeUrl})`
    },
  )

  for (const candidate of withReadableLinks.match(SAFE_LINK_PATTERN) || []) {
    rememberLink(candidate.replace(/[),.;!?]+$/, ''))
  }

  const body = decodeHtmlEntities(withReadableLinks)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|blockquote)\s*>/gi, '\n')
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { body, links }
}

export function presentParentMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      ...message,
      ...presentParentMessageBody(message?.body),
    }))
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
}
