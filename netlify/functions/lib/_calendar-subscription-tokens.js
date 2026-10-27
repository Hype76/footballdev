import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const scopeQuery = (query, scope) => Object.entries(scope).reduce((current, [key, value]) => value === null ? current.is(key, null) : current.eq(key, value), query)

// A new connection receives its own secret. Explicit replacement or revocation
// changes only the current secret, never another phone's independent connection.
export async function changeCalendarSubscriptionToken(client, { tables, scope, previousToken = '', nextToken = '' }) {
  if (!previousToken) {
    if (!nextToken) throw Object.assign(new Error('Choose a calendar link.'), { statusCode: 400 })
    const result = await client.from(tables[0]).insert({ ...scope, token_hash: hash(nextToken) })
    if (result.error) throw result.error
    return
  }
  if (!/^[a-f0-9]{64}$/.test(previousToken)) throw Object.assign(new Error('The calendar link is invalid.'), { statusCode: 400 })
  for (const table of tables) {
    const mutation = nextToken ? client.from(table).update({ token_hash: hash(nextToken) }) : client.from(table).delete()
    const result = await scopeQuery(mutation, scope).eq('token_hash', hash(previousToken)).select('id').maybeSingle()
    if (result.error) throw result.error
    if (result.data) return
  }
  if (nextToken) throw Object.assign(new Error('That calendar link is no longer available. Revoke it, then connect again.'), { statusCode: 410 })
}
