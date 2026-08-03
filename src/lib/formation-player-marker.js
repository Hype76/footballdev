export const FORMATION_PLAYER_SILHOUETTE = Object.freeze({
  head: Object.freeze({ cx: 12, cy: 8, r: 4 }),
  shouldersPath: 'M4 21a8 8 0 0 1 16 0H4Z',
})

export function renderFormationPlayerSilhouetteSvg({ className = 'formation-silhouette', title = '' } = {}) {
  const titleMarkup = title ? `<title>${String(title).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])}</title>` : ''
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${titleMarkup}<circle cx="${FORMATION_PLAYER_SILHOUETTE.head.cx}" cy="${FORMATION_PLAYER_SILHOUETTE.head.cy}" r="${FORMATION_PLAYER_SILHOUETTE.head.r}"></circle><path d="${FORMATION_PLAYER_SILHOUETTE.shouldersPath}"></path></svg>`
}
