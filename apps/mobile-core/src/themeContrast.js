// Keep the chosen brand fill intact; adapt foregrounds to their actual surfaces.
export function mixThemeColor(source, target, weight) {
  return `#${[1, 3, 5].map(offset => {
    const start = Number.parseInt(source.slice(offset, offset + 2), 16)
    const end = Number.parseInt(target.slice(offset, offset + 2), 16)
    return Math.round(start + (end - start) * weight).toString(16).padStart(2, '0')
  }).join('')}`
}

export function themeContrastRatio(foreground, background) {
  const luminance = hex => [1, 3, 5].map(offset => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

export function themeForeground(background) {
  return themeContrastRatio('#000000', background) > themeContrastRatio('#ffffff', background) ? '#000000' : '#ffffff'
}

export function contrastSafeColor(color, surfaces, mode, minimum = 7) {
  const target = mode === 'dark' ? '#ffffff' : '#000000'
  for (let step = 0; step <= 100; step += 1) {
    const candidate = mixThemeColor(color, target, step / 100)
    if (surfaces.every(surface => themeContrastRatio(candidate, surface) >= minimum)) return candidate
  }
  return target
}

export function readableThemeTokens(base, surfaces, mode) {
  const result = { ...base }
  for (const key of ['textPrimary', 'textSecondary', 'textMuted', 'muted', 'success', 'warning', 'danger']) {
    if (base[key]) result[key] = contrastSafeColor(base[key], surfaces, mode)
  }
  result.border = contrastSafeColor(base.border, surfaces, mode, 3)
  result.borderStrong = contrastSafeColor(base.borderStrong || base.border, surfaces, mode, 4.5)
  result.dangerForeground = themeForeground(result.danger)
  return result
}
