import { createHash } from 'node:crypto'
import { DEFAULT_COACH_REMINDER_POLICY, coachReminderLocalStart, planAvailabilityAutomation, planSquadAutomation, validateCoachReminderNotification } from '../../../src/lib/coach-reminder-policy.js'
import { normalizeTeamCoachReminderPolicy } from '../../../src/lib/coach-reminder-settings.js'
import { buildOccurrences } from './_training-calendar.js'
import { resolveCoachAvailabilityReminderRecipients } from './_coach-reminder-recipients.js'

const checked = result => { if (result.error) throw result.error; return result.data }
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const later = (a,b) => Date.parse(a) >= Date.parse(b) ? a : b

export function normalizeCoachReminderContext(raw, job) {
  const eventRow=raw?.event || {}, enrolment=raw?.enrolment, invite=raw?.invitation, response=raw?.response
  const policy=raw?.policy ? normalizeTeamCoachReminderPolicy(raw.policy,{ clubId:eventRow.club_id,teamId:eventRow.team_id })
    : { id:job.policyId || 'removed',revision:'removed',clubId:job.clubId,teamId:job.teamId,options:DEFAULT_COACH_REMINDER_POLICY,optedIn:false }
  if (policy.effectiveFrom && raw?.release?.activated_at) policy.effectiveFrom=later(policy.effectiveFrom,raw.release.activated_at)
  const training=job.kind==='TRAINING'
  const occurrence=training ? buildOccurrences(eventRow).find(item=>item.occurrenceDate===job.occurrenceDate) : null
  const event={ id:eventRow.id,clubId:eventRow.club_id,teamId:eventRow.team_id,kind:training && eventRow.event_type!=='training' ? 'OTHER' : job.kind,
    revision:hash(eventRow),status:eventRow.status || 'scheduled',cancelled:Boolean(eventRow.cancelled_at),deleted:Boolean(eventRow.deleted_at),
    startsAt:training ? occurrence ? coachReminderLocalStart(occurrence.occurrenceDate,new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(eventRow.starts_at))) : '' : eventRow.kickoff_time_tbc ? '' : coachReminderLocalStart(eventRow.match_date,eventRow.kickoff_time),
    kickoffTimeTbc:eventRow.kickoff_time_tbc === true,timeZone:'Europe/London',occurrenceDate:job.occurrenceDate || '',createdAt:eventRow.created_at }
  const invitation=enrolment ? { id:enrolment.id,revision:hash([invite?.id,invite?.invited_at]),
    responseRevision:hash(response || 'no_response'),clubId:enrolment.club_id,teamId:enrolment.team_id,eventId:enrolment.event_id,
    occurrenceDate:enrolment.occurrence_date || '',playerId:enrolment.player_id,createdAt:enrolment.source_created_at,deliveredAt:enrolment.first_delivered_at,
    parentResponderActive:raw.parentResponderActive === true,
    adultResponderActive:raw.adultResponderActive === true,
    memberActive:raw.memberActive === true && enrolment.policy_id===policy.id && Number(enrolment.policy_revision)===Number(policy.revision)
      && Date.parse(enrolment.source_created_at)>=Date.parse(policy.effectiveFrom),
    revoked:!invite || invite.invite_status==='cancelled' || Boolean(invite.cancelled_at),
    responseStatus:response?.status || 'pending',responseSource:response?.response_source || (response?.selected_by_parent_link_id ? 'parent' : 'explicit_response') } : null
  return { policy,event,invitation,authorityActive:raw?.authorityActive === true,squadSelected:raw?.squadSelected === true }
}

export function createCoachReminderRepository(client) {
  async function load(job) {
    const raw=checked(await client.rpc('team_coach_reminder_context_v1',{ job_value:job }))
    const context=normalizeCoachReminderContext(raw,job)
    let recipients=[]
    if (job.action==='squad_reminder') {
      recipients=(raw?.coaches || []).map(coach=>({ ...coach,clubId:job.clubId,teamId:job.teamId,audience:'coach',active:true,authorized:true }))
    } else if (context.invitation?.memberActive && raw?.event?.parent_visible===true && raw?.event?.parent_audience!=='none') {
      const emails=new Set(raw?.recipientEmails || [])
      recipients=(await resolveCoachAvailabilityReminderRecipients(client,{ clubId:job.clubId,teamId:job.teamId,playerId:job.playerId }))
        .filter(recipient=>emails.has(recipient.email))
    }
    return { raw,context:{ ...context,recipients } }
  }
  return {
    async loadContext(job) { return (await load(job)).context },
    async withLockedJob(key, callback) {
      const stored=checked(await client.from('team_coach_reminder_jobs').select('*').eq('job_key',key).maybeSingle())
      if (!stored) return callback({ getJob:async()=>null })
      const job={ ...stored.payload,state:stored.state }, effects=[],notifications=[]
      let current,completion
      const result=await callback({ getJob:async()=>job,
        loadCurrentContext:async()=>{ current=await load(job);return current.context },
        insertEffectOnce:async effect=>{ effects.push(effect) },
        insertNotificationOnce:async notification=>{ notifications.push(notification) },
        finish:async value=>{ completion=value },
      })
      if (!completion) return result
      const committed=checked(await client.rpc('commit_team_coach_reminder_job_v1',{
        job_key_value:key,context_snapshot_value:current.raw,effect_value:effects[0] || null,notifications_value:notifications,
        state_value:completion.state,reason_value:completion.reason,
      }))
      if (!committed?.committed) throw Object.assign(new Error('Reminder context changed before commit.'),{ code:'reminder_context_changed' })
      return { ...result,duplicate:committed.duplicate === true }
    },
    async claimNotification(key) {
      const row=checked(await client.rpc('claim_team_coach_reminder_notification_v1',{ delivery_key_value:key }))
      return row ? { notification:row.payload,leaseToken:row.lease_token,deliveryKey:key } : null
    },
    async validateNotification(claim,now) {
      const stored=checked(await client.from('team_coach_reminder_jobs').select('payload').eq('job_key',claim.notification.jobKey).maybeSingle())
      if (!stored) return { valid:false,reason:'job_removed' }
      const current=await load(stored.payload)
      const decision=validateCoachReminderNotification({ ...current.context,job:stored.payload,notification:claim.notification,now })
      const target=current.context.recipients.find(recipient=>recipient.id===claim.notification.recipientId)
      return { ...decision,deliveryContext:decision.valid ? { job:stored.payload,target,event:current.context.event,
        refresh:async()=>{
          const fresh=await load(stored.payload)
          const valid=validateCoachReminderNotification({ ...fresh.context,job:stored.payload,notification:claim.notification,now:new Date().toISOString() })
          return { ...valid,target:fresh.context.recipients.find(recipient=>recipient.id===claim.notification.recipientId) }
        },
      } : null }
    },
    async skipNotification(claim,reason) { checked(await client.from('team_coach_reminder_outbox').update({ state:'skipped',reason,lease_token:null,lease_until:null }).eq('delivery_key',claim.deliveryKey).eq('lease_token',claim.leaseToken)) },
    async acceptNotification(key,leaseToken,receipt) {
      const row=checked(await client.from('team_coach_reminder_outbox').update({ state:'accepted',provider_id:receipt.providerId,lease_token:null,lease_until:null }).eq('delivery_key',key).eq('lease_token',leaseToken).eq('state','pending').select('delivery_key').maybeSingle())
      if (!row) throw new Error('Reminder delivery lease was lost. Reconcile provider acceptance before retrying.')
    },
    async holdNotification(key,leaseToken,reason) { checked(await client.from('team_coach_reminder_outbox').update({ state:'held',reason }).eq('delivery_key',key).eq('lease_token',leaseToken)) },
    async storeJobs(jobs) {
      if (!jobs.length) return
      checked(await client.from('team_coach_reminder_jobs').upsert(jobs.map(job=>({ job_key:job.key,club_id:job.clubId,team_id:job.teamId,payload:job })),{ onConflict:'job_key',ignoreDuplicates:true }))
    },
    async planCandidate(candidate,now) {
      const current=await load(candidate)
      const jobs=candidate.action==='squad_reminder' ? planSquadAutomation({ ...current.context,now }) : planAvailabilityAutomation({ ...current.context,now })
      return jobs.map(job=>({ ...job,enrolmentId:candidate.enrolmentId || '' }))
    },
    async nextPhase() { return checked(await client.rpc('next_team_coach_reminder_processor_phase_v1',{})) },
    async discoverCandidates(limit=30) { return checked(await client.rpc('scan_team_coach_reminder_candidates_v1',{batch_size:limit})) || [] },
    async pendingJobs(limit=30,now=new Date().toISOString()) { return checked(await client.from('team_coach_reminder_jobs').select('job_key').eq('state','pending').lte('payload->>dueAt',now).order('created_at').limit(limit)) || [] },
    async pendingNotifications(limit=30) { return checked(await client.from('team_coach_reminder_outbox').select('delivery_key').eq('state','pending').order('created_at').limit(limit)) || [] },
  }
}
