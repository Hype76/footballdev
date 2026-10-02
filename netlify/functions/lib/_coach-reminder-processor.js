import { processCoachReminderJob,deliverCoachReminderNotification } from './_coach-reminder-worker.js'

export async function runCoachReminderProcessor({repository,transport,clock=()=>new Date().toISOString(),budgetMs=18000}) {
  const started=Date.parse(clock()),withinBudget=()=>Date.parse(clock())-started<budgetMs
  const result={planned:0,processed:0,delivered:0,held:0,interrupted:false}
  const phase=repository.nextPhase ? await repository.nextPhase() : 0
  if(![0,1,2].includes(phase))throw new Error('Invalid reminder processor phase.')
  async function plan(){
    for(let scanned=0;scanned<30;scanned++){
      if(!withinBudget()){result.interrupted=true;return}
      // Advance the durable cursor only one candidate at a time. Finish this
      // candidate before checking time again so a slow page cannot skip peers.
      const [candidate]=await repository.discoverCandidates(1)
      if(!candidate)return
      try{
        const jobs=await repository.planCandidate(candidate,clock());await repository.storeJobs(jobs);result.planned+=jobs.length
      }catch(error){if(!/ambiguous|nonexistent|schedule is too large/.test(error.message))throw error}
    }
  }
  async function process(){
    for(const job of await repository.pendingJobs(30,clock())){
      if(!withinBudget()){result.interrupted=true;return}
      try{await processCoachReminderJob({repository,jobKey:job.job_key,now:clock()});result.processed++}
      catch(error){if(error.code!=='reminder_context_changed')throw error}
    }
  }
  async function deliver(){
    for(const notification of await repository.pendingNotifications()){
      if(!withinBudget()){result.interrupted=true;return}
      try{
        const delivered=await deliverCoachReminderNotification({repository,transport,notificationKey:notification.delivery_key,now:clock()})
        if(delivered.state==='accepted')result.delivered++
      }catch{result.held++}
    }
  }
  // Persisted rotation gives each stage first access to the budget once per
  // three invocations, including after an interrupted or slow preceding run.
  const stages=[plan,process,deliver]
  for(let offset=0;offset<3;offset++){
    if(!withinBudget()){result.interrupted=true;break}
    await stages[(phase+offset)%3]()
  }
  return result
}
