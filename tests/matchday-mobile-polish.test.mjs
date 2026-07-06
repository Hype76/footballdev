import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const indexCssUrl = new URL('../src/index.css', import.meta.url)
const matchDayPageUrl = new URL('../src/pages/MatchDayPage.jsx', import.meta.url)

test('dark theme maps Match Day amber and cream panels to dark-compatible surfaces', async () => {
  const source = await readFile(indexCssUrl, 'utf8')

  assert.match(source, /body\.theme-dark \[class\*='bg-\[#fff7ed\]'\]/)
  assert.match(source, /body\.theme-dark \[class\*='bg-\[#ffedd5\]'\]/)
  assert.match(source, /body\.theme-dark \[class\*='border-\[#fed7aa\]'\]/)
  assert.match(source, /body\.theme-dark \[class\*='border-\[#fdba74\]'\]/)
  assert.match(source, /body\.theme-dark \[class\*='text-\[#92400e\]'\]/)
  assert.match(source, /body\.theme-dark \[class\*='text-\[#9a3412\]'\]/)
})

test('Match Day availability request success copy avoids invite queue wording', async () => {
  const source = await readFile(matchDayPageUrl, 'utf8')
  const handlerStart = source.indexOf('const handleConfirmCreateMatch = async () => {')
  const handlerEnd = source.indexOf('const handleStatusChange = async', handlerStart)
  assert.notEqual(handlerStart, -1)
  assert.notEqual(handlerEnd, -1)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /availability request notification/)
  assert.match(handlerSource, /scheduled/)
  assert.doesNotMatch(handlerSource, /invite prepared|invite queued/i)
})
