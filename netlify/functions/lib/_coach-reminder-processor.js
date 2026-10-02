import { processCoachReminderJob,deliverCoachReminderNotification } from './_coach-reminder-worker.js'

export async function runCoachReminderProcessor({repository,transport,clock=()=>new Date().toISOString(),budgetMs=18000}) {
  const started=Date.parse(clock()),withinBudget=()=>Date.parse(clock())-started<budgetMs
  const result={planned:0,processed:0,delivered:0,held:0,interrupted:false}
  for(const candidate of await repository.discoverCandidates()){
    if(!withinBudget()){result.interrupted=true;break}
    try{
      const jobs=await repository.planCandidate(candidate,clock());await repository.storeJobs(jobs);result.planned+=jobs.length
    }catch(error){if(!/ambiguous|nonexistent|schedule is too large/.test(error.message))throw error}
  }
  for(const job of await repository.pendingJobs(30,clock())){
    if(!withinBudget()){result.interrupted=true;break}
    try{await processCoachReminderJob({repository,jobKey:job.job_key,now:clock()});result.processed++}
    catch(error){if(error.code!=='reminder_context_changed')throw error}
  }
  for(const notification of await repository.pendingNotifications()){
    if(!withinBudget()){result.interrupted=true;break}
    try{
      const delivered=await deliverCoachReminderNotification({repository,transport,notificationKey:notification.delivery_key,now:clock()})
      if(delivered.state==='accepted')result.delivered++
    }catch{result.held++}
  }
  return result
}
