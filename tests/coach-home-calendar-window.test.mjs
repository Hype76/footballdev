import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@babel/parser'
import { buildCoachCalendarEvents, buildCoachCalendarOccurrenceDates, buildCoachHomeCalendarEvents } from '../apps/mobile-core/src/coachCalendarCore.js'
import { getDateInTimeZone } from '../apps/mobile-core/src/parentCalendarCore.js'

const now=new Date('2026-11-18T12:00:00Z')
const series={id:'series',title:'Training',event_type:'training',starts_at:'2024-11-18T18:00:00Z',ends_at:'2024-11-18T19:00:00Z',recurrence_frequency:'weekly',recurrence_until:'2027-12-31'}

test('Home finds current long-running weekly, fortnightly and month-end series without replaying historical occurrences',()=>{
  for(const recurrence_frequency of ['weekly','fortnightly','monthly']){
    const [event]=buildCoachHomeCalendarEvents({calendarEvents:[{...series,recurrence_frequency}],now})
    assert.ok(event)
    assert.ok(Date.parse(event.endsAt)>=now.getTime())
    assert.ok(event.calendarDate>='2026-11-18')
    assert.equal(event.sourceId,'series')
    assert.equal(event.recurrenceFrequency,recurrence_frequency)
  }
  const [month]=buildCoachHomeCalendarEvents({calendarEvents:[{...series,starts_at:'2024-01-31T18:00:00Z',ends_at:'2024-01-31T19:00:00Z',recurrence_frequency:'monthly',recurrence_until:'2026-02-28'}],now:new Date('2026-02-01T12:00:00Z')})
  assert.equal(month.calendarDate,'2026-02-28')
})

test('Home includes series-until and exact end boundaries, skips deleted dates, and continues beyond a deleted date batch',()=>{
  const dated={...series,starts_at:'2024-11-20T18:00:00Z',ends_at:'2024-11-20T19:00:00Z',recurrence_until:'2026-11-18'}
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[dated],now:new Date('2026-11-18T19:00:00Z')})[0].calendarDate,'2026-11-18')
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[dated],now:new Date('2026-11-18T19:00:00.001Z')}).length,0)
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[{...dated,deleted_occurrence_dates:['2026-11-18']}],now}).length,0)
  const dates=buildCoachCalendarOccurrenceDates({date:'2024-11-18',recurrenceFrequency:'weekly',recurrenceUntil:'2029-12-31',windowStart:'2026-11-18',windowEnd:'2029-12-31'})
  assert.equal(dates.length,52)
  const [later]=buildCoachHomeCalendarEvents({calendarEvents:[{...series,recurrence_until:'2029-12-31',deleted_occurrence_dates:dates}],now})
  assert.ok(later.calendarDate>dates.at(-1),'Deleted dates do not silently truncate the next available occurrence')
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[{...dated,cancelled_at:'2026-11-18T10:00:00Z'}],now}).length,0)
})

test('Home retains an ongoing previous-London-day event and converts summer/winter occurrences using existing timezone rules',()=>{
  const overnight={...series,starts_at:'2024-07-03T21:00:00Z',ends_at:'2024-07-04T00:00:00Z',recurrence_until:'2027-12-31'}
  const [ongoing]=buildCoachHomeCalendarEvents({calendarEvents:[overnight],now:new Date('2026-07-01T23:30:00Z')})
  assert.equal(ongoing.calendarDate,'2026-07-01')
  assert.equal(ongoing.startsAt,'2026-07-01T21:00:00.000Z')
  assert.equal(ongoing.endsAt,'2026-07-02T00:00:00.000Z')
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[{...overnight,recurrence_until:'2026-07-01'}],now:new Date('2026-07-01T23:30:00Z')})[0].calendarDate,'2026-07-01')
  const [winter]=buildCoachHomeCalendarEvents({calendarEvents:[overnight],now})
  assert.equal(winter.calendarTime,'22:00')
  assert.equal(winter.startsAt,'2026-11-18T22:00:00.000Z')
  const ordinary={id:'ordinary',title:'One event',starts_at:'2026-11-18T12:00:00Z',ends_at:'2026-11-18T13:00:00Z'}
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[ordinary],now}).length,1)
  assert.equal(buildCoachHomeCalendarEvents({calendarEvents:[{...ordinary,deleted_occurrence_dates:['2026-11-18']}],now}).length,0)
})

test('Home preserves an ongoing multi-day first occurrence and each series keeps its existing event type',()=>{
  const multi={...series,starts_at:'2026-11-16T18:00:00Z',ends_at:'2026-11-19T19:00:00Z',recurrence_until:'2026-11-16'}
  const [ongoing]=buildCoachHomeCalendarEvents({calendarEvents:[multi],now})
  assert.equal(ongoing.calendarDate,'2026-11-16')
  assert.equal(ongoing.endsAt,'2026-11-19T19:00:00Z')
  const events=buildCoachHomeCalendarEvents({calendarEvents:[{...series,id:'social',event_type:'social'},series],now})
  assert.equal(events.find(event=>event.sourceId==='social').eventType,'social')
  assert.equal(events.find(event=>event.sourceId==='series').eventType,'training')
})

test('Home formats one useful occurrence per series while the full Calendar keeps its existing expansion',()=>{
  const rows=Array.from({length:20},(_,index)=>({...series,id:'series-'+index}))
  const before=performance.now(),full=buildCoachCalendarEvents({calendarEvents:rows}),fullMs=performance.now()-before
  const started=performance.now(),home=buildCoachHomeCalendarEvents({calendarEvents:rows,now}),homeMs=performance.now()-started
  assert.equal(full.length,1040)
  assert.equal(home.length,20)
  assert.ok(home.every(event=>Date.parse(event.endsAt)>=now.getTime()))
  console.log(`Calendar synthetic workload: full ${full.length} occurrences in ${Math.round(fullMs)}ms; Home ${home.length} in ${Math.round(homeMs)}ms. Desktop measurement only.`)
})

test('actual Home Calendar loader selects deletion metadata, keeps club/team RLS scope and avoids nested detail reads',async()=>{
  const source=readFileSync('apps/mobile-core/src/coachCalendarData.js','utf8')
  const node=parse(source,{sourceType:'module'}).program.body.find(node=>node.declaration?.id?.name==='getCoachCalendarResources').declaration
  const calls=[]
  const query={select(fields){calls.push(['select',fields]);return this},eq(...args){calls.push(['eq',...args]);return this},is(){return this},gte(...args){calls.push(['gte',...args]);return this},lt(){return this},neq(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:[series],error:null}).then(resolve)}}
  const dependencies={assertCoachOperationalRead:()=>{},supabase:{from:table=>{calls.push(['from',table]);return query}},scopeCoachQuery:(query,user,options)=>{calls.push(['scope',user.clubId,user.activeTeamId,options]);return query},
    getDateInTimeZone,readAllPages:async create=>{create();return []},buildCoachHomeCalendarEvents:options=>buildCoachHomeCalendarEvents({...options,now})}
  const load=new Function(...Object.keys(dependencies),source.slice(node.start,node.end)+';return getCoachCalendarResources')(...Object.values(dependencies))
  const result=await load({clubId:'club',activeTeamId:'team',role:'coach'},{homeSummary:true,includeDetails:false})
  assert.equal(result.length,1)
  assert.ok(calls.filter(call=>call[0]==='from').every(call=>call[1]==='calendar_events'))
  assert.ok(calls.filter(call=>call[0]==='select').every(call=>call[1].includes('deleted_occurrence_dates')))
  assert.equal(calls.filter(call=>call[0]==='scope' && call[1]==='club' && call[2]==='team' && call[3].includeClubWide).length,2)
  assert.ok(calls.some(call=>call[0]==='gte' && call[1]==='recurrence_until' && call[2]===getDateInTimeZone(new Date(Date.now()-86400000))))
})
