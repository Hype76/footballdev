import { processCoachReminderJob,deliverCoachReminderNotification } from './_coach-reminder-worker.js'

export async function runCoachReminderProcessor({repository,transport,clock=()=>new Date().toISOString(),budgetMs=18000,hardBudgetMs=25000,itemReserveMs=5000,remainingMs}) {
  const started=Date.parse(clock()),withinBudget=()=>Date.parse(clock())-started<budgetMs
  const hardRemaining=remainingMs || (()=>hardBudgetMs-(Date.parse(clock())-started))
  const canStart=priority=>hardRemaining()>=itemReserveMs && (withinBudget() || priority)
  const result={planned:0,processed:0,delivered:0,held:0,interrupted:false}
  const phase=repository.nextPhase ? await repository.nextPhase() : 0
  if(![0,1,2].includes(phase))throw new Error('Invalid reminder processor phase.')
  async function plan(){
    for(let scanned=0;scanned<30;scanned++){
      if(!canStart(false)){result.interrupted=true;return}
      // Advance the durable cursor only one candidate at a time. Finish this
      // candidate before checking time again so a slow page cannot skip peers.
      const [candidate]=await repository.discoverCandidates(1)
      if(!candidate)return
      if(hardRemaining()<itemReserveMs){result.interrupted=true;return}
      try{
        const jobs=await repository.planCandidate(candidate,clock());await repository.storeJobs(jobs);result.planned+=jobs.length
      }catch(error){if(!/ambiguous|nonexistent|schedule is too large/.test(error.message))throw error}
    }
  }
  async function process(priority){
    let first=true
    for(const job of await repository.pendingJobs(30,clock())){
      if(!canStart(priority && first)){result.interrupted=true;return}
      first=false
      try{await processCoachReminderJob({repository,jobKey:job.job_key,now:clock()});result.processed++}
      catch(error){if(error.code!=='reminder_context_changed')throw error}
    }
  }
  async function deliver(priority){
    let first=true
    for(const notification of await repository.pendingNotifications()){
      if(!canStart(priority && first)){result.interrupted=true;return}
      first=false
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
    if(!canStart(false)){result.interrupted=true;break}
    // Only the first item in the first-priority stage can cross the soft
    // budget after its list read, and only with the explicit hard reserve.
    await stages[(phase+offset)%3](offset===0)
  }
  return result
}
