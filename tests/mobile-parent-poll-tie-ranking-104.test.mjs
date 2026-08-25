import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { rankParentPollResults } from '../apps/parent-mobile/src/parentExperience.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const appSource = await fs.readFile(`${root}/apps/parent-mobile/App.js`, 'utf8')

test('Parent Poll results use shared competition ranks for every tie', () => {
  const ranked = rankParentPollResults(
    [
      { id: 'yes', label: 'Yes' },
      { id: 'sometimes', label: 'Sometimes' },
      { id: 'no', label: 'No' },
      { id: 'wonder', label: 'Wonder kid needs to sort this out' },
      { id: 'never', label: 'Never' },
    ],
    [
      { optionId: 'yes', count: 2 },
      { optionId: 'sometimes', count: 2 },
      { optionId: 'no', count: 1 },
      { optionId: 'wonder', count: 1 },
      { optionId: 'never', count: 0 },
    ],
  )

  assert.deepEqual(
    ranked.map(({ count, id, rank }) => ({ count, id, rank })),
    [
      { count: 2, id: 'yes', rank: 1 },
      { count: 2, id: 'sometimes', rank: 1 },
      { count: 1, id: 'no', rank: 3 },
      { count: 1, id: 'wonder', rank: 3 },
      { count: 0, id: 'never', rank: 5 },
    ],
  )
})

test('Parent Poll result cards highlight every joint leader and render shared ranks', () => {
  assert.match(appSource, /rankParentPollResults\(poll\.options, poll\.votes\)/)
  assert.match(appSource, /label=\{`\$\{option\.rank\}`\}/)
  assert.match(appSource, /option\.rank === 1 && option\.count > 0/)
  assert.doesNotMatch(appSource, /index === 0 && option\.count > 0/)
})
