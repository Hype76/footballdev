import assert from 'node:assert/strict'
import test from 'node:test'
import { addPublishedFormationPlans } from '../netlify/functions/lib/_fan-schedule.js'

test('Parent-linked Player access never queries or returns a published formation', async () => {
  const matches = [{ id: 'match' }]
  const client = { from() { throw new Error('Formation query must not run') } }
  assert.deepEqual(await addPublishedFormationPlans(client, { suppressParentFormation: true, fan: { relationship_type: 'player' } }, matches), matches)
})
