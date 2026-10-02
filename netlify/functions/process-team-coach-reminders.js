import process from 'node:process'
import { authorizeProcessorRequest } from './lib/_processor-auth.js'
import { createCoachReminderRepository } from './lib/_coach-reminder-repository.js'
import { createCoachReminderTransport } from './lib/_coach-reminder-transport.js'
import { runCoachReminderProcessor } from './lib/_coach-reminder-processor.js'

// Deliberately no schedule Config. Installation/activation is a release action.
export default async function(request){
  if((globalThis.Netlify?.env?.get?.('ENABLE_COACH_REMINDER_AUTOMATION') || process.env.ENABLE_COACH_REMINDER_AUTOMATION)!=='true')return Response.json({success:false,message:'Team reminders are disabled.'},{status:503})
  const auth=authorizeProcessorRequest({httpMethod:request.method,headers:Object.fromEntries(request.headers),body:await request.text()})
  if(!auth.ok)return new Response(auth.response.body,{status:auth.response.statusCode,headers:auth.response.headers})
  const {createSupabaseAdminClient}=await import('./lib/_supabase.js')
  const client=createSupabaseAdminClient()
  const release=await client.from('team_coach_reminder_release_control').select('enabled').eq('singleton',true).single()
  if(release.error || !release.data?.enabled)return Response.json({success:false,message:'Team reminder release is disabled.'},{status:503})
  const {getClubPlanProfile,assertTrustedSystemPlanFeature}=await import('./lib/_plan-gate.js')
  const transport=createCoachReminderTransport({client,assertPlan:async(job,coach)=>{
    if(!coach)assertTrustedSystemPlanFeature({...await getClubPlanProfile(job.clubId,{client}),role:'system',roleRank:100,teamId:job.teamId,activeTeamId:job.teamId,playerId:job.playerId},'parentEmails')
  }})
  try{return Response.json({success:true,...await runCoachReminderProcessor({repository:createCoachReminderRepository(client),transport})})}
  catch{return Response.json({success:false,message:'Team reminder processing could not be completed.'},{status:500})}
}
