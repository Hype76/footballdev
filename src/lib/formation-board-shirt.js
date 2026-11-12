export function normalizeFormationBoardShirtKit(value) {
  if ((value?.type !== 'home' && value?.type !== 'away') || !/^#[0-9a-f]{6}$/i.test(value.colour)) return null

  const imagePath = typeof value.imagePath === 'string' ? value.imagePath : ''
  const [clubId, kitType, fileName, extra] = imagePath.split('/')
  const validPath = /^[0-9a-f-]{36}$/i.test(clubId) && kitType === value.type && !extra
    && /^[a-z0-9_-]+\.(?:png|jpe?g|webp)$/i.test(fileName)

  return { type: value.type, colour: value.colour, imagePath: validPath ? imagePath : null }
}

export function formationBoardShirtNumberColour(kit) {
  const colour = kit?.colour
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return '#101828'

  const channels = colour.slice(1).match(/../g).map((hex) => {
    const value = Number.parseInt(hex, 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
