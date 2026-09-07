import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
const source=readFileSync(new URL('../netlify/functions/cleanup-expired-retention.js',import.meta.url),'utf8').replace(/^import .*\r?\n/gm,'').replace(/^export /gm,'')
test('failed voice-file removal preserves its database record and retry path',async()=>{
  let deleted=false
  const query={select(){return this},not(){return this},lte(){return this},limit:async()=>({data:[{id:'note',audio_path:'clip'}]}),delete(){deleted=true;return this},in:async()=>({error:null})}
  const admin={from:()=>query,storage:{from:()=>({remove:async()=>({error:new Error('storage unavailable')})})}}
  const run=new Function('supabaseAdmin','STAFF_VOICE_NOTES_BUCKET',source+';return deleteExpiredVoiceNotes')(admin,'voice')
  await assert.rejects(run('2026-09-07'),/storage unavailable/)
  assert.equal(deleted,false)
})

for (const duplicate of [false, true]) test(`archive retention ${duplicate ? 'preserves ambiguous' : 'scopes unambiguous'} legacy names`, async () => {
  const removed = []
  const player = { id: 'archived', club_id: 'club', player_name: 'Same Name' }
  const admin = { from(table) {
    const filters = [], request = { deleting: false }
    const query = new Proxy(request, { get(target, key) {
      if (key === 'then') return (resolve) => {
        if (target.deleting) removed.push({ table, filters })
        let data = []
        if (!target.deleting && table === 'players') data = filters.some(([field]) => field === 'player_name')
          ? [player, ...(duplicate ? [{ id: 'active' }] : [])] : [player]
        if (table === 'assessment_sessions') data = [{ id: 'session' }]
        resolve({ data, error: null })
      }
      return (...args) => {
        if (key === 'delete') target.deleting = true
        if (['eq','is','in','lte'].includes(key)) filters.push([...args, key])
        return query
      }
    } })
    return query
  }, storage: { from: () => ({ remove: async () => ({error:null}) }) } }
  const run = new Function('supabaseAdmin','STAFF_VOICE_NOTES_BUCKET',source+';return deleteExpiredArchivedPlayers')(admin,'voice')
  assert.equal(await run('2026-09-07'), 1)
  const legacyDeletes = removed.filter(({filters}) => filters.some(([field]) => field === 'player_name'))
  assert.equal(legacyDeletes.length, duplicate ? 0 : 2)
  for (const deletion of legacyDeletes) assert.ok(deletion.filters.some(([field,value,operation]) => field === 'player_id' && value === null && operation === 'is'))
  assert.ok(removed.some(({table,filters}) => table === 'evaluations' && filters.some(([field,value]) => field === 'player_id' && value === 'archived')))
  assert.ok(removed.find(({table}) => table === 'players').filters.some(([field,,operation]) => field === 'archived_delete_at' && operation === 'lte'))
})
