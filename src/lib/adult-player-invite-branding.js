const accents = { yellow: '#c7ff32', blue: '#244d8f', green: '#146c3a', red: '#b42336', purple: '#6843a3' }

// Only pass the accent returned by the scoped branding authority.
export function adultInvitePalette(accent) {
  const background = accents[accent] || (/^#[0-9a-f]{6}$/i.test(accent || '') ? accent : accents.green)
  const channels = background.slice(1).match(/.{2}/g).map(part => parseInt(part, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return { background, foreground: (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#000000' : '#ffffff' }
}
