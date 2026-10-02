export async function readCoachReminderProjections(client,kind,eventIds,{enabled=false,parentLinkId}={}){
  const ids=[...new Set(eventIds.filter(Boolean))]
  if(!enabled || !ids.length)return []
  const result=[]
  for(let offset=0;offset<ids.length;offset+=100){
    const {data,error}=await client.rpc('get_team_coach_reminder_projections_v1',{kind_value:kind,event_ids:ids.slice(offset,offset+100),parent_link_id_value:parentLinkId || null})
    if(error)throw error
    result.push(...(data || []))
  }
  return result
}

export function projectCoachReminderMatches(matches,projections,{parentView=false}={}){
  if(!projections.length)return matches
  return matches.map(match=>{
    if(parentView)return applyCoachReminderProjection(match,projections.find(item=>item.eventId===match.id),{statusKey:'availabilityStatus'})
    const relevant=projections.filter(item=>item.eventId===match.id)
    if(!relevant.length)return match
    const project=row=>applyCoachReminderProjection(row,relevant.find(item=>item.playerId===row.playerId))
    const playerAvailability=(match.playerAvailability || []).map(project)
    for(const projection of relevant){
      if(!playerAvailability.some(row=>row.playerId===projection.playerId))playerAvailability.push(project({id:`deadline:${match.id}:${projection.playerId}`,matchDayId:match.id,playerId:projection.playerId,status:'pending'}))
    }
    return {...match,playerAvailability,availabilityRequests:(match.availabilityRequests || []).map(row=>applyCoachReminderProjection(row,relevant.find(item=>item.playerId===row.playerId),{statusKey:'availabilityStatus'}))}
  })
}

export function applyCoachReminderProjection(row,projection,{statusKey='status'}={}){
  if(!projection)return row
  return {...row,[statusKey]:projection.status,availabilityAutomatic:projection.automatic===true,
    availabilityProvenance:projection.provenance,planningExcluded:projection.planningExcluded===true,
    availabilityDeadlineAt:projection.appliedAt || '',availabilityAutomationLabel:projection.automatic?'Automatic team deadline':projection.planningExcluded?'Excluded from planning after team deadline':''}
}

export function findCoachReminderProjection(projections,{eventId,playerId,occurrenceDate=''}){
  return projections.find(item=>item.eventId===eventId && item.playerId===playerId && (item.occurrenceDate || '')===occurrenceDate)
}

export function coachReminderInvitationOccurrence(invite){
  if(invite.invitationType!=='training_attendance' && invite.kind!=='training')return ''
  if(invite.occurrenceDate)return invite.occurrenceDate
  const date=new Date(invite.eventStart || invite.eventAt || invite.eventDate)
  if(Number.isNaN(date.getTime()))return ''
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
