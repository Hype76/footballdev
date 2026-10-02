import { buildTeamCoachReminderSave, normalizeTeamCoachReminderPolicy } from './coach-reminder-settings.js'

export function createTeamCoachReminderSettingsStore({ clubId, teamId, request, createRequestId = () => globalThis.crypto.randomUUID() }) {
  const empty = normalizeTeamCoachReminderPolicy(null,{ clubId,teamId })
  let state = { policy:empty, options:empty.options, optedIn:false, loaded:false, busy:false, error:'', notice:'', needsReload:false, deliveryEnabled:false }
  let pendingSave, pendingLoad, retryCommand
  const listeners = new Set()
  const update = patch => { state={ ...state,...patch }; for (const listener of listeners) listener() }
  const checkScope = result => {
    if (!result?.policy || result.policy.clubId !== clubId || result.policy.teamId !== teamId) throw new Error('Reminder settings belong to a different team.')
    return result
  }
  return {
    getSnapshot: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    edit(patch) { if (!state.loaded || state.busy || state.needsReload) return; update({ ...patch,error:'',notice:'' }) },
    load() {
      if (pendingLoad) return pendingLoad
      if (pendingSave) return Promise.resolve(false)
      update({ busy:true,error:'',notice:'' })
      pendingLoad = (async () => {
        try {
          const result=checkScope(await request({ action:'get',teamId }))
          retryCommand=null
          update({ policy:result.policy,options:result.policy.options,optedIn:result.policy.optedIn,loaded:true,
            needsReload:false,deliveryEnabled:result.deliveryEnabled === true })
          return true
        } catch(error) { update({ error:error.message }); return false }
        finally { pendingLoad=null; update({ busy:false }) }
      })()
      return pendingLoad
    },
    save() {
      if (pendingSave) return pendingSave
      if (!state.loaded || state.busy || state.needsReload) return Promise.resolve(false)
      let command
      try {
        command=buildTeamCoachReminderSave({ policy:state.policy,options:state.options,optedIn:state.optedIn,
          requestId:retryCommand?.requestId || createRequestId() })
        if (retryCommand && JSON.stringify(command) !== JSON.stringify(retryCommand)) {
          command=buildTeamCoachReminderSave({ policy:state.policy,options:state.options,optedIn:state.optedIn,requestId:createRequestId() })
        }
      } catch(error) { update({ error:error.message,notice:'' }); return Promise.resolve(false) }
      retryCommand=command
      update({ busy:true,error:'',notice:'' })
      pendingSave=(async () => {
        try {
          const result=checkScope(await request(command))
          retryCommand=null
          update({ policy:result.policy,options:result.policy.options,optedIn:result.policy.optedIn,deliveryEnabled:result.deliveryEnabled === true,
            notice:result.duplicate ? 'Team reminder settings confirmed.' : 'Team reminder settings saved.' })
          return true
        } catch(error) {
          const needsReload=error.statusCode === 409
          if (needsReload) retryCommand=null
          update({ error:error.message,needsReload }); return false
        } finally { pendingSave=null; update({ busy:false }) }
      })()
      return pendingSave
    },
  }
}
