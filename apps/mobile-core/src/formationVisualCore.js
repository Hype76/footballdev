export function getFormationMarkerVisualPosition(position = {}, layout = {}, {
  anchorY = 33,
  markerHeight = 86,
  markerWidth = 78,
} = {}) {
  const width = Number(layout.width || 0)
  const height = Number(layout.height || 0)
  const x = Math.max(0, Math.min(1, Number(position.x || 0)))
  const y = Math.max(0, Math.min(1, Number(position.y || 0)))
  if (!(width > 0) || !(height > 0)) return { x, y }
  const halfWidthRatio = Math.min(0.5, (markerWidth / 2) / width)
  const topRatio = Math.min(0.5, anchorY / height)
  const bottomRatio = Math.min(0.5, (markerHeight - anchorY) / height)
  return {
    x: Math.max(halfWidthRatio, Math.min(1 - halfWidthRatio, x)),
    y: Math.max(topRatio, Math.min(1 - bottomRatio, y)),
  }
}

