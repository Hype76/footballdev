import assert from 'node:assert/strict'
import test from 'node:test'
process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'
const [{ handler }, { supabaseAdmin }] = await Promise.all([
  import('../netlify/functions/send-coach-mobile-push.js'),
  import('../netlify/functions/lib/_supabase.js'),
])

test('a linked Parent with no staff profile can notify Coaches after a saved training response', async (t) => {
  const originalFrom = supabaseAdmin.from
  const originalUser = supabaseAdmin.auth.getUser
  const originalError = console.error
  t.after(() => { supabaseAdmin.from = originalFrom; supabaseAdmin.auth.getUser = originalUser; console.error = originalError })
  console.error = () => {}
  let suspended = false
  let wrongChild = false
  let stale = false
  let recipientLookup = 0
  supabaseAdmin.auth.getUser = async () => ({data:{user:{id:'parent-1'}}})
  supabaseAdmin.from = (table) => {
    const filters = []
    const query = new Proxy({}, {get(_target,key) {
      if (key === 'then') return (resolve,reject) => {
        let data
        if (table === 'users') data = suspended ? {id:'parent-1',club_id:'club-1',role:'parent_portal',status:'suspended'} : null
        else if (table === 'parent_player_links') {
          assert.ok(filters.some(([key,value]) => key === 'auth_user_id' && value === 'parent-1'))
          data = {id:'link-1',club_id:'club-1',team_id:'team-1',player_id:'child-1',status:'active'}
        } else if (table === 'players') data = {id:'child-1',status:'active'}
        else if (table === 'training_availability_request_players') {
          assert.ok(filters.some(([key,value]) => key === 'player_id' && value === 'child-1'))
          data = wrongChild ? null : {id:'request-1',request_id:'batch-1',club_id:'club-1',team_id:'team-1',calendar_event_id:'event-1',player_id:'child-1',player_name:'FP TEST Player',status:'responded'}
        } else if (table === 'training_availability_responses') data = {status:'available',responded_at:stale ? 'old-time' : '2026-09-02T10:00:00+00:00'}
        else if (table === 'calendar_events') data = {id:'event-1',club_id:'club-1',team_id:'team-1',event_type:'training',title:'FP TEST Training'}
        else if (table === 'clubs') data = filters.some(([key]) => key === 'id')
          ? {id:'club-1',status:'active',is_plan_comped:true,plan_key:'single_team',plan_status:'active'}
          : [{id:'club-1',name:'FP TEST'}]
        else if (table === 'teams') data = [{id:'team-1',name:'FP TEST Team'}]
        else if (table === 'coach_mobile_push_installations') { recipientLookup += 1; data = [] }
        else if (table === 'billing_access_state_events') data = null
        else throw new Error('Unexpected table ' + table)
        return Promise.resolve({data,error:null}).then(resolve,reject)
      }
      if (key === 'eq') return (key,value) => {filters.push([key,value]);return query}
      return () => query
    }})
    return query
  }
  const event = {httpMethod:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({
    type:'training_availability_response',parentLinkId:'link-1',requestPlayerId:'request-1',respondedAt:'2026-09-02T10:00:00+00:00',
  })}
  const success = await handler(event)
  assert.equal(success.statusCode,200,success.body)
  assert.equal(JSON.parse(success.body).success,true)
  assert.equal(recipientLookup,1)
  suspended = true
  assert.equal((await handler(event)).statusCode,403)
  suspended = false
  wrongChild = true
  assert.equal((await handler(event)).statusCode,403)
  wrongChild = false
  stale = true
  assert.equal((await handler(event)).statusCode,409)
  assert.equal(recipientLookup,1)
})
