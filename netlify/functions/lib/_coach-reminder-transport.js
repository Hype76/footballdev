import { createHash } from 'node:crypto'
import { createFromAddress,sendEmail } from './_email-provider.js'
import { sendExpoPushMessages } from './_expo-push.js'
import { writeParentNotificationInbox } from './_parent-notification-inbox.js'
import { formatUkDateTime } from '../../../src/lib/date-format.js'

const checked=result=>{if(result.error)throw result.error;return result.data}
const digest=value=>createHash('sha256').update(value).digest('hex')

export function createCoachReminderTransport({client,email=sendEmail,push=sendExpoPushMessages,inbox=writeParentNotificationInbox,assertPlan,signal,telemetryClient}) {
  return {async send(notification){
    const {job,event}=notification.deliveryContext || {}
    let target=notification.deliveryContext?.target
    if(!job || !target || !event)throw new Error('A freshly validated reminder recipient is required.')
    const refresh=async()=>{
      if(!notification.deliveryContext.refresh)return true
      const current=await notification.deliveryContext.refresh()
      if(!current.valid || !current.target)return false
      target=current.target
      return true
    }
    if(!await refresh())return {skipped:true,reason:'recipient_or_response_changed'}
    const coach=notification.audience==='coach',app=coach?'coach':'parent'
    await assertPlan(job,coach)
    const key=digest(notification.idempotencyKey)
    const title=coach?'Match squad reminder':job.action==='availability_deadline'?'Availability deadline passed':'Availability reminder'
    const body=coach?`The squad for the match on ${formatUkDateTime(event.startsAt)} has not been selected.`
      :job.action==='availability_deadline'?`No availability answer was received before the team deadline for ${formatUkDateTime(event.startsAt)}. This has been automatically marked Not attending by the team deadline policy. Open Football Player to correct your answer.`
      :`Please answer the ${job.kind==='TRAINING'?'training':'match'} availability invitation for ${formatUkDateTime(event.startsAt)}.`
    const data={app,type:coach?'squad_reminder':'availability_follow_up',route:coach?'matchday':'calendar',clubId:job.clubId,teamId:job.teamId,
      ...(job.kind==='MATCH'?{matchDayId:job.eventId}:{calendarEventId:job.eventId,occurrenceDate:job.occurrenceDate}),
      notificationId:key,coachReminderDeliveryKey:key,...(target.parentLinkId?{parentLinkId:target.parentLinkId}:{})}
    let appAllowed=coach || target.appAllowed===true
    let link
    if(!coach && target.parentLinkId){
      link=checked(await client.from('parent_player_links').select('id,auth_user_id').eq('id',target.parentLinkId).eq('club_id',job.clubId).eq('player_id',job.playerId).eq('status','active').maybeSingle())
      if(!link)return {skipped:true,reason:'recipient_removed'}
    }
    const userId=coach?target.id:link?.auth_user_id
    if(appAllowed && userId){
      const preference=checked(await client.from('mobile_notification_preferences').select('invites').eq('app',app).eq('auth_user_id',userId).maybeSingle())
      if(preference?.invites===false)appAllowed=false
    }
    const receipts=[]
    if(appAllowed && userId){
      if(coach){
        checked(await client.from('coach_mobile_notification_events').upsert({coach_reminder_delivery_key:key,auth_user_id:userId,user_profile_id:userId,club_id:job.clubId,team_id:job.teamId,
          intent_type:'coach_update',title,body,data,status:'sent',sent_at:new Date().toISOString()},
        {onConflict:'coach_reminder_delivery_key',ignoreDuplicates:true}))
      }else{
        const saved=await inbox({client,clubId:job.clubId,teamId:job.teamId,parentLinks:[link],title,body,data,intentType:'parent_message'})
        if(!saved.available)throw new Error('Reminder inbox acceptance could not be confirmed.')
      }
      receipts.push(`inbox:${key}`)
      let query=client.from(`${app}_mobile_push_installations`).select('expo_push_token,detail_level').eq('auth_user_id',userId).eq('status','active').eq('enabled',true).neq('detail_level','off')
      if(coach)query=query.eq('club_id',job.clubId)
      const devices=checked(await query) || []
      if(devices.length && await refresh() && (coach || target.appAllowed)){
        const receipt=await push(devices.map(device=>({to:device.expo_push_token,title,body:device.detail_level==='detailed'?body:'Open Football Player to review a team availability update.',data,sound:'default'})),{client,signal})
        if(receipt.failed)throw new Error('Reminder push acceptance is uncertain. Reconciliation is required.')
        receipts.push(`push:${key}:${receipt.sent}`)
      }
    }
    // Squad reminders use the existing Coach inbox/push contract. There is no
    // new unsolicited Coach email preference or fallback channel.
    if(!coach && await refresh() && target.emailAllowed && target.email){
      const response=await email({from:createFromAddress('Football Player'),to:[target.email],subject:title,text:body,emailAppRole:'parent'},
        {idempotencyKey:`coach-reminder:${key}:email`,signal,telemetryClient,context:{emailType:'availability_follow_up',clubId:job.clubId,teamId:job.teamId,logicalKey:key}})
      const providerId=response?.data?.id
      if(!providerId)throw new Error('Reminder email acceptance is uncertain.')
      receipts.push(`email:${providerId}`)
    }
    return receipts.length?{accepted:true,providerId:receipts.join('|')}:{skipped:true,reason:'recipient_opted_out'}
  }}
}
