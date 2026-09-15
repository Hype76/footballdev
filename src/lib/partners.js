export const PARTNER_COLUMNS = 4
export const PARTNER_ROWS = 24
export const EMPTY_PARTNER_LAYOUT = { items: [] }

export function safePartnerUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(url.hostname) || url.hostname.startsWith('[')) return ''
    return url.href
  } catch { return '' }
}

export function partnerRect(cells) {
  if (!cells.length) return { x: 0, y: 0, w: 2, h: 2 }
  const xs = cells.map((n) => n % PARTNER_COLUMNS)
  const ys = cells.map((n) => Math.floor(n / PARTNER_COLUMNS))
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 }
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export function validatePartnerLayout(layout) {
  const items = layout?.items
  if (!Array.isArray(items) || items.length > 48) throw new Error('Use up to 48 partner images.')
  const ids = new Set()
  for (const item of items) {
    if (!item.id || ids.has(item.id)) throw new Error('Each image needs a unique identity.')
    ids.add(item.id)
    if (![item.x, item.y, item.w, item.h].every(Number.isInteger) || item.x < 0 || item.y < 0 || item.w < 1 || item.h < 1 || item.x + item.w > PARTNER_COLUMNS || item.y + item.h > PARTNER_ROWS) throw new Error('Keep images inside the grid.')
    if (!item.title?.trim() || !item.alt?.trim()) throw new Error('Add a partner name and image description.')
    if (!safePartnerUrl(item.imageUrl) || (item.url && !safePartnerUrl(item.url))) throw new Error('Use a valid public HTTPS image and website address.')
    if ((item.startsAt && !Number.isFinite(Date.parse(item.startsAt))) || (item.endsAt && !Number.isFinite(Date.parse(item.endsAt))) || (item.startsAt && item.endsAt && Date.parse(item.endsAt) <= Date.parse(item.startsAt))) throw new Error('The offer end must be after its start.')
    if (items.some((other) => other.id !== item.id && overlaps(item, other))) throw new Error('Images cannot overlap. Move or resize the selected image.')
  }
  return layout
}

export function visiblePartnerItems(items, now = Date.now()) {
  return (items || []).filter((item) => !item.hidden && (!item.startsAt || Date.parse(item.startsAt) <= now) && (!item.endsAt || Date.parse(item.endsAt) > now))
}

export function findPartnerSpace(items, w = 2, h = 2) {
  for (let y = 0; y <= PARTNER_ROWS - h; y++) for (let x = 0; x <= PARTNER_COLUMNS - w; x++) {
    const rect = { x, y, w, h }
    if (!items.some((item) => overlaps(rect, item))) return rect
  }
  throw new Error('The grid is full. Remove an image or use a smaller size.')
}

export function csvCell(value) {
  const text = String(value ?? '')
  return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`
}
