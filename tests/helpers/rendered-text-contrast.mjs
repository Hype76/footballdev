import assert from 'node:assert/strict'

export async function assertRenderedTextContrast(page, context) {
  const failures = await page.evaluate(() => {
    const parse = value => {
      const channels = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0]
      return [...channels.slice(0, 3), channels[3] ?? 1]
    }
    const over = (top, bottom) => {
      const alpha = top[3] + bottom[3] * (1 - top[3])
      return [...[0, 1, 2].map(i => alpha ? (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / alpha : 0), alpha]
    }
    const luminance = color => color.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const failures = []
    while (walker.nextNode()) {
      const node = walker.currentNode, element = node.parentElement, text = node.textContent.trim()
      if (!text || !element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest('[aria-disabled="true"],:disabled,script,style,svg')) continue
      if (/^[\s\uE000-\uF8FF]+$/.test(text)) continue // Icon font glyphs are checked by theme token tests.
      let foreground = parse(getComputedStyle(element).color), background = [0, 0, 0, 0]
      for (let current = element; current; current = current.parentElement) {
        const style = getComputedStyle(current), layer = parse(style.backgroundColor)
        foreground = over(foreground, layer); background = over(background, layer)
        foreground[3] *= Number(style.opacity); background[3] *= Number(style.opacity)
      }
      foreground = over(foreground, [255, 255, 255, 1]); background = over(background, [255, 255, 255, 1])
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
      const ratio = (values[0] + 0.05) / (values[1] + 0.05)
      if (ratio < 4.5) failures.push({ text: text.slice(0, 90), ratio: +ratio.toFixed(2) })
    }
    return failures
  })
  assert.deepEqual(failures, [], `Rendered text contrast: ${context}`)
}
