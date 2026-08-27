function normalizeNamePart(value) {
  const part = String(value ?? '')
  if (!part) return ''

  const tail = part.slice(1)
  const tailHasDeliberateCase = tail && tail !== tail.toLowerCase() && tail !== tail.toUpperCase()
  return `${part.charAt(0).toUpperCase()}${tailHasDeliberateCase ? tail : tail.toLowerCase()}`
}

export function normalizePersonName(value) {
  return String(value ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word
      .split(/([-'’])/)
      .map((part) => /^[-'’]$/.test(part) ? part : normalizeNamePart(part))
      .join(''))
    .join(' ')
}
