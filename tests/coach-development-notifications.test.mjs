import assert from 'node:assert/strict'
import test from 'node:test'
import { notifyCoachDevelopmentParents } from '../netlify/functions/lib/_coach-development-notifications.js'

const delivery = { id: 'delivery', lease: 'lease', to: 'ExpoPushToken[test]', parentLinkId: 'parent-link', teamId: 'team', clubName: 'Club', teamName: 'U14' }
const input = { evaluationId: 'evaluation', profile: { id: 'coach' }, selectedParentLinkIds: ['parent-link'] }
function fixture({ deliveries = [delivery], remaining = deliveries.length, current = true, complete = true, error } = {}) {
  const calls = []
  const client = { rpc: async (name, args) => {
    calls.push({ name, args })
    if (error) return { error }
    return { data: name === 'claim_coach_assessment_notifications' ? { deliveries, remaining, inboxRecipients: 1 }
      : name === 'coach_assessment_notification_is_current' ? current : complete }
  } }
  return { client, calls }
}
const succeeds = async () => ({ sent: 1, failed: 0, skipped: 0, invalidTokens: [] })
const retry = error => error.statusCode === 503 && !error.message.includes('ExpoPushToken')

test('targeted report push uses stable inbox identity and exact service actor, recipients and lease', async () => {
  const { client, calls } = fixture(); const pushes = []
  const result = await notifyCoachDevelopmentParents(client, input, async (messages, options) => {
    pushes.push(messages); assert.equal(options.client, client); assert.ok(options.signal instanceof AbortSignal); return succeeds()
  })
  assert.deepEqual(calls[0].args, { actor_value: 'coach', evaluation_value: 'evaluation', selected_links_value: ['parent-link'] })
  assert.deepEqual(pushes[0][0].data, { app: 'parent', route: 'development', type: 'development_report', reportId: 'evaluation', notificationId: 'evaluation', parentLinkId: 'parent-link', clubName: 'Club', teamName: 'U14', teamId: 'team' })
  assert.equal(pushes[0][0].title, 'Club | U14 | Development report')
  assert.deepEqual(calls.at(-1).args, { delivery_value: 'delivery', lease_value: 'lease', delivered_value: true, invalid_value: false, skipped_value: false })
  assert.deepEqual(result, { inboxRecipients: 1, notificationDelivery: 'processed' })
})

test('saved inbox without devices completes, but concurrent leases or additional batches request durable retry', async () => {
  const empty = fixture({ deliveries: [], remaining: 0 })
  assert.equal((await notifyCoachDevelopmentParents(empty.client, input, () => assert.fail('no device'))).inboxRecipients, 1)
  const concurrent = fixture({ deliveries: [], remaining: 1 })
  await assert.rejects(notifyCoachDevelopmentParents(concurrent.client, input, succeeds), retry)
  const batch = fixture({ remaining: 13 })
  await assert.rejects(notifyCoachDevelopmentParents(batch.client, input, succeeds), retry)
  assert.equal(batch.calls.at(-1).args.delivered_value, true)
})

test('fresh revocation skips provider and terminates the matching leased delivery', async () => {
  const { client, calls } = fixture({ current: false })
  await notifyCoachDevelopmentParents(client, input, () => assert.fail('revoked recipient'))
  assert.equal(calls.at(-1).args.skipped_value, true)
  assert.equal(calls.at(-1).args.delivered_value, false)
})

test('failed provider releases lease and returns retry without exposing tokens or provider error', async () => {
  for (const provider of [async () => { throw new Error('ExpoPushToken[secret]') }, async () => ({ sent: 0, failed: 1, skipped: 0 })]) {
    const { client, calls } = fixture()
    await assert.rejects(notifyCoachDevelopmentParents(client, input, provider), retry)
    assert.deepEqual(calls.at(-1).args, { delivery_value: 'delivery', lease_value: 'lease', delivered_value: false, invalid_value: false, skipped_value: false })
  }
})

test('invalid provider token and delivery preference filtering finish terminally', async () => {
  const invalid = fixture()
  await notifyCoachDevelopmentParents(invalid.client, input, async () => ({ sent: 0, failed: 1, invalidTokens: [delivery.to] }))
  assert.equal(invalid.calls.at(-1).args.invalid_value, true)
  const filtered = fixture()
  await notifyCoachDevelopmentParents(filtered.client, input, async () => ({ sent: 0, failed: 0, skipped: 1 }))
  assert.equal(filtered.calls.at(-1).args.skipped_value, true)
})

test('stale lease acknowledgement remains retryable and service authority errors fail closed', async () => {
  const stale = fixture({ complete: false })
  await assert.rejects(notifyCoachDevelopmentParents(stale.client, input, succeeds), retry)
  const forbidden = fixture({ error: { code: '42501' } })
  await assert.rejects(notifyCoachDevelopmentParents(forbidden.client, input, succeeds), error => error.statusCode === 403)
  const unavailable = fixture({ error: { code: '08006' } })
  await assert.rejects(notifyCoachDevelopmentParents(unavailable.client, input, succeeds), retry)
  await assert.rejects(notifyCoachDevelopmentParents({ rpc: () => { throw new Error('secret transport payload') } }, input, succeeds), retry)
})

test('unexpected oversized database batch does not contact provider', async () => {
  const { client } = fixture({ deliveries: Array(13).fill(delivery) })
  await assert.rejects(notifyCoachDevelopmentParents(client, input, () => assert.fail('oversized batch')), retry)
})

test('real Expo adapter filters current installation and maps invalid ticket without leaking provider data', async t => {
  const { client, calls } = fixture(); const provider = []; let enabled = true; let development = true
  client.from = table => {
    const query = { select: () => query, eq: () => query, in: () => query,
      abortSignal: signal => { assert.ok(signal instanceof AbortSignal); return query },
      then: resolve => resolve({ data: table === 'parent_mobile_push_installations'
        ? [{ auth_user_id: 'parent-auth', expo_push_token: delivery.to, enabled, status: 'active', detail_level: 'detailed' }]
        : [{ auth_user_id: 'parent-auth', development, chats: false }], error: null }) }
    return query
  }
  const priorFetch = globalThis.fetch; t.after(() => { globalThis.fetch = priorFetch })
  globalThis.fetch = async (_url, options) => {
    provider.push(JSON.parse(options.body))
    return { ok: true, json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }) }
  }
  await notifyCoachDevelopmentParents(client, input)
  assert.equal(provider.length, 1); assert.equal(provider[0][0].data.parentLinkId, 'parent-link')
  assert.equal(calls.at(-1).args.invalid_value, true)
  development = false
  await notifyCoachDevelopmentParents(client, input)
  assert.equal(provider.length, 1); assert.equal(calls.at(-1).args.skipped_value, true)
  development = true
  enabled = false
  await notifyCoachDevelopmentParents(client, input)
  assert.equal(provider.length, 1); assert.equal(calls.at(-1).args.skipped_value, true)
})

test('real pre-delivery database query receives deadline abort and remains retryable without late provider send', async t => {
  const { client, calls } = fixture(); let fetches = 0
  const priorTimeout = AbortSignal.timeout; const priorFetch = globalThis.fetch
  t.after(() => { AbortSignal.timeout = priorTimeout; globalThis.fetch = priorFetch })
  AbortSignal.timeout = milliseconds => priorTimeout(milliseconds > 20000 ? 5 : milliseconds)
  globalThis.fetch = () => { fetches++; assert.fail('aborted filter must not reach provider') }
  client.from = () => {
    let signal
    const query = { select: () => query, in: () => query,
      abortSignal: value => { signal = value; return query },
      then: (resolve, reject) => new Promise((ok, no) => {
        if (signal.aborted) no(signal.reason)
        else signal.addEventListener('abort', () => no(signal.reason), { once: true })
        // Keep the test event loop live while the actual abort signal runs.
        const timer = setTimeout(() => no(new Error('deadline was not propagated')), 1000)
        signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
      }).then(resolve, reject) }
    return query
  }
  await assert.rejects(notifyCoachDevelopmentParents(client, input), retry)
  assert.equal(fetches, 0); assert.equal(calls.at(-1).args.delivered_value, false)
  assert.equal(calls.at(-1).args.invalid_value, false); assert.equal(calls.at(-1).args.skipped_value, false)
})

test('actual sharing handler notifies eligible recipients for older apps without a notification flag', async () => {
  const {readFile}=await import('node:fs/promises')
  const {parse}=await import('@babel/parser')
  const source=await readFile('netlify/functions/send-parent-email.js','utf8')
  let branch
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='IfStatement'&&source.slice(node.test.start,node.test.end).includes("=== 'finalize_development_parent_report'"))branch=node;for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value)}
  visit(parse(source,{sourceType:'module'}));assert.ok(branch)
  const execute=new (Object.getPrototypeOf(async function(){}).constructor)('body','supabaseAdmin','requestUser','finalizeDevelopmentParentReportSnapshot','notifyCoachDevelopmentParents','successResponse',source.slice(branch.start,branch.end))
  for(const flag of [undefined,false,true]) {
    const calls=[];const body={action:'finalize_development_parent_report',evaluationId:'evaluation',selectedParentLinkIds:['eligible','removed'],...(flag===undefined?{}:{notifyParents:flag})}
    const report={evaluationId:'evaluation',version:1,responseItems:[],eligibleRecipients:[{linkId:'eligible'}],ineligibleRecipients:[{linkId:'removed'}]}
    const result=await execute(body,{},input.profile,async()=>report,async(_client,args)=>{calls.push(args);return {notificationDelivery:'processed'}},value=>value)
    assert.deepEqual(calls,[{evaluationId:'evaluation',profile:input.profile,selectedParentLinkIds:['eligible']}])
    assert.equal(result.notificationResult.notificationDelivery,'processed')
  }
  await execute({action:'finalize_development_parent_report'}, {}, input.profile,async()=>({evaluationId:'evaluation',responseItems:[],eligibleRecipients:[]}),()=>assert.fail('no authorised recipient'),value=>value)
})
