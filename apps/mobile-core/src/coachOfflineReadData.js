import { withMobileAsyncTimeout } from './http.js'
import { normalizeCoachPlayer, normalizeCoachPlayerEvaluation, normalizeCoachPlayerField } from './coachPlayersCore.js'
import { normalizeCoachSession, normalizeCoachSessionPlayer } from './coachSessionsCore.js'
import { normalizeCoachMatchDay } from './coachMatchDayNormalization.js'
import { normalizeCoachFormationBoard, normalizeCoachFormationPreset } from './coachFormationBoardPayload.js'
import { buildCoachCalendarEvents, buildCoachHomeCalendarEvents } from './coachCalendarCore.js'
import { normalizeCoachDevelopmentField, normalizeCoachDevelopmentForm, normalizeCoachDevelopmentRecord, normalizeCoachResource,
  normalizeCoachChatRoom, normalizeCoachChatMessage, normalizeCoachMessage, normalizeCoachPoll, normalizeCoachInvite, summarizeCoachInvites, collapseCoachInvitesByPlayer } from './coachPhase31ECore.js'
import { buildCoachHomeOperationalSnapshot } from './coachPhase31GCore.js'
import { calculatePlayerPlayingTime } from '../../../src/lib/domain/player-playing-time.js'
import { normalizeClubPlayerType, attachPlayerTypeRules } from '../../../src/lib/player-participation.js'

export const COACH_OFFLINE_RESOURCE_KEYS = Object.freeze(['players','development','sessions','calendar','matches','resources','chat','messages','polls','invites','formations','notifications'])
const text = value => String(value ?? '')
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const byDate = field => (a,b) => text(b[field]).localeCompare(text(a[field])) || text(a.id).localeCompare(text(b.id))
const objectById = rows => new Map(rows.map(row => [row.id,row]))
const group = (rows,key) => {
  const result = new Map()
  for(const row of rows) result.set(row[key],[...(result.get(row[key]) || []),row])
  return result
}

function assertContext(user,context) {
  if (!uuid.test(user?.id || '') || !uuid.test(context?.clubId || '') || !uuid.test(context?.teamId || '')
    || user.clubId !== context.clubId || user.activeTeamId !== context.teamId
    || (Array.isArray(user.coachContexts) && !user.coachContexts.some(item => item.id === context.id && item.clubId === context.clubId && item.teamId === context.teamId))) {
    throw new Error('coach_offline_context_invalid')
  }
}

async function defaultRpc(name,params) {
  const { supabase } = await import('./supabase.js')
  return supabase.rpc(name,params)
}

export async function readCoachOfflineFamily(user,context,key,{rpc=defaultRpc,isCurrent=()=>true}={}) {
  assertContext(user,context)
  if (!COACH_OFFLINE_RESOURCE_KEYS.includes(key)) throw new Error('coach_offline_resource_unknown')
  const items=[],identities=new Set(),cursors=new Set()
  let cursor=null, revision=null, total=null
  do {
    if(!isCurrent()) throw new Error('coach_offline_cancelled')
    const {data,error}=await withMobileAsyncTimeout(() => rpc('get_own_coach_offline_resource', {
      club_value:context.clubId,team_value:context.teamId,resource_key:key,cursor_value:cursor,
    }), { timeoutMs: 20000, timeoutMessage: 'Team records took too long to respond. Retry while connected.' })
    if(error) throw error
    if(!isCurrent()) throw new Error('coach_offline_cancelled')
    if(!data || data.schemaVersion!==1 || data.userId!==user.id || data.clubId!==context.clubId || data.teamId!==context.teamId || data.resourceKey!==key
      || !Array.isArray(data.items) || !Number.isSafeInteger(data.totalCount) || data.totalCount<0 || typeof data.revision!=='string'
      || typeof data.complete!=='boolean' || (revision!==null && data.revision!==revision) || (total!==null && data.totalCount!==total)) throw new Error('coach_offline_page_invalid')
    revision=data.revision;total=data.totalCount
    for(const item of data.items) {
      const identity=`${item.kind}:${item.id}`
      if(!item.kind || !item.id || !item.data || typeof item.data!=='object' || identities.has(identity)) throw new Error('coach_offline_page_duplicate')
      identities.add(identity);items.push(item)
    }
    if(data.complete) {
      if(data.nextCursor!==null || items.length!==total) throw new Error('coach_offline_page_incomplete')
      return items
    }
    if(!data.items.length || typeof data.nextCursor!=='string' || !data.nextCursor || cursors.has(data.nextCursor)) throw new Error('coach_offline_cursor_invalid')
    cursors.add(data.nextCursor);cursor=data.nextCursor
  } while(cursor)
  throw new Error('coach_offline_page_incomplete')
}

export async function authorizeCoachOfflineMedia(user,context,resource,{request,getToken,apiBaseUrl}={}) {
  assertContext(user,context)
  const kind=['badge','kit'].includes(resource?.kind) ? resource.kind : 'file'
  const resourceId=kind==='kit' ? resource?.sourceId : resource?.id
  if(kind!=='badge' && !uuid.test(resourceId || '')) throw new Error('coach_offline_resource_invalid')
  if(resource?.clubId && resource.clubId!==context.clubId || resource?.teamId && resource.teamId!==context.teamId) throw new Error('coach_offline_resource_invalid')
  if(!request || !getToken || !apiBaseUrl) {
    const [{fetchJsonWithTimeout},{getAccessToken},{getMobileRuntimeConfig}]=await Promise.all([import('./http.js'),import('./supabase.js'),import('./config.js')])
    request ||= fetchJsonWithTimeout; getToken ||= getAccessToken;apiBaseUrl ||= getMobileRuntimeConfig('coach').apiBaseUrl
  }
  const token=await getToken()
  if(!token || !apiBaseUrl) throw new Error('coach_offline_login_required')
  const response=await request(`${apiBaseUrl.replace(/\/$/,'')}/.netlify/functions/coach-offline-media`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({clubId:context.clubId,teamId:context.teamId,kind,...(kind!=='badge' ? {resourceId} : {})})})
  if(!response.ok || response.result?.success!==true) throw Object.assign(new Error(response.result?.message || 'This offline file is unavailable.'),{status:response.status})
  const result=response.result,canonical=result.resource
  if(!canonical || canonical.clubId!==context.clubId || canonical.teamId!==context.teamId || canonical.id!==(kind==='badge' ? `badge:${context.teamId}` : kind==='kit' ? `kit:${resourceId}` : resource.id)
    || typeof result.signedUrl!=='string' || !Number.isSafeInteger(canonical.fileSizeBytes) || canonical.fileSizeBytes<=0) throw new Error('coach_offline_media_response_invalid')
  return {...result,resource:{...canonical,kind,type:'file'}}
}

function developmentWorkspace(records) {
  const fields=(records.fields || []).map(normalizeCoachDevelopmentField)
  const teamForms=records.forms || [],preferences=new Set((records.starterPreferences || []).filter(item=>item.hidden).map(item=>item.template_key))
  const installed=new Map(teamForms.filter(item=>item.starter_template_key).map(item=>[item.starter_template_key,item]))
  const forms=[...(records.starterTemplates || []).filter(item=>!preferences.has(item.template_key)).map(item=>normalizeCoachDevelopmentForm({...item,
    id:`platform-starter:${item.template_key}:${item.version}`,installed_form_id:installed.get(item.template_key)?.id || '',is_platform_template:true})),
  ...teamForms.filter(item=>!item.starter_template_key).map(item=>normalizeCoachDevelopmentForm({...item,fields:item.fields || fields}))]
  if(!forms.length && fields.length) forms.push(normalizeCoachDevelopmentForm({id:'canonical-default',name:'Development record',fields}))
  return {forms,players:[],records:(records.evaluations || []).map(normalizeCoachDevelopmentRecord).sort(byDate('date')),historyLoading:false,historyError:'',
    drafts:(records.drafts || []).filter(item=>item.status==='draft' && item.report_type==='development_record').map(item=>({id:item.id,playerId:item.player_id,
      formId:item.draft_data?.selectedFeedbackFormId || item.draft_data?.draftContext?.formId || '',values:item.draft_data?.responseValues || {},notes:item.draft_data?.notes || '',
      clientSaveVersion:Number(item.client_save_version || item.draft_data?.draftMeta?.clientSaveVersion || 0),lastSavedAt:item.last_saved_at || '',status:item.status}))}
}

export async function loadCoachOfflineContext(user,context,{isCurrent=()=>true,onResource=async()=>{},onMedia=async()=>{},onMatch=async()=>{},onStage=()=>{},deferMediaAuthorization=false,rpc=defaultRpc,authorizeMedia=authorizeCoachOfflineMedia}={}) {
  assertContext(user,context)
  const records={},onlineOnly=[]
  let resourceCount=0
  const assertCurrent=()=>{if(!isCurrent()) throw new Error('coach_offline_cancelled')}
  const emit=async(cacheKey,value,count=Array.isArray(value) ? value.length : 1)=>{
    assertCurrent();await onResource({cacheKey,value,complete:true,count});assertCurrent();resourceCount++
  }
  for(const key of COACH_OFFLINE_RESOURCE_KEYS) {
    assertCurrent();onStage(key)
    const rows=await readCoachOfflineFamily(user,context,key,{rpc,isCurrent})
    for(const item of rows) (records[item.kind] ||= []).push(item.data)
    if(key==='players') {
      const types=(records.playerTypes || []).map(normalizeClubPlayerType)
      records.normalizedPlayers=attachPlayerTypeRules(records.players || [],types).map(row=>normalizeCoachPlayer(row,{canViewContacts:true}))
      for(const cacheKey of ['players','calendarPlayers','matchDayPlayers','sessionPlayers']) await emit(cacheKey,records.normalizedPlayers)
    }
    if(key==='development') {
      records.development=developmentWorkspace(records)
      records.development.players=(records.players || []).map(row=>({id:row.id,playerName:row.player_name,section:row.section,status:row.status,team:row.team,teamId:row.team_id}))
      await emit('phase31e:development',records.development,records.development.records.length+records.development.drafts.length)
    }
    if(key==='sessions') {
      records.normalizedSessions=(records.sessions || []).map(normalizeCoachSession).sort(byDate('sessionDate'))
      await emit('sessions',records.normalizedSessions)
      const participants=group(records.sessionPlayers || [],'session_id'),players=objectById(records.players || [])
      for(const session of records.normalizedSessions) await emit(`sessionDetail:${session.id}`,{session,players:(participants.get(session.id) || []).map(row=>normalizeCoachSessionPlayer({...row,players:players.get(row.player_id)}))})
    }
    if(key==='matches') {
      records.normalizedMatches=(records.matches || []).map(row=>normalizeCoachMatchDay({...row,clubName:context.clubName,teams:{name:context.teamName},
        match_day_events:(records.events || []).filter(item=>item.match_day_id===row.id),match_day_shootout_kicks:(records.shootoutKicks || []).filter(item=>item.match_day_id===row.id),
        match_day_player_availability:(records.availability || []).filter(item=>item.match_day_id===row.id),match_day_player_squad_decisions:(records.squadDecisions || []).filter(item=>item.match_day_id===row.id),
        match_day_availability_requests:(records.matchRequests || []).filter(item=>item.match_day_id===row.id),match_day_role_assignments:(records.roleAssignments || []).filter(item=>item.match_day_id===row.id),
        match_day_final_reports:(records.finalReports || []).find(item=>item.match_day_id===row.id)})).sort(byDate('matchDate'))
      await emit('matchDayList',records.normalizedMatches)
      for(const detail of records.normalizedMatches) {assertCurrent();await onMatch(detail);assertCurrent()}
    }
    if(key==='resources') {
      records.normalizedResources=(records.resources || []).map(row=>normalizeCoachResource({...row,teams:{name:context.teamName},
        resource_library_links:(records.resourceLinks || []).filter(link=>link.resource_id===row.id),
        resource_library_external_links:(records.resourceExternalLinks || []).find(link=>link.resource_id===row.id)}))
      await emit('phase31e:resources',records.normalizedResources)
      await emit('calendarResourceOptions',records.normalizedResources)
      for(const resource of records.normalizedResources) {
        if(resource.type==='external_link') {onlineOnly.push({kind:'external_link',id:resource.id,title:resource.title});continue}
        assertCurrent();await onMedia({...resource,kind:'file'});assertCurrent()
      }
    }
    if(key==='messages') await emit('phase31e:messages',(records.messages || []).map(normalizeCoachMessage).sort(byDate('createdAt')))
    if(key==='polls') {
      records.normalizedPolls=(records.polls || []).map(row=>normalizeCoachPoll({...row,teams:{name:context.teamName},poll_votes:(records.votes || []).filter(vote=>vote.poll_id===row.id)},user.id))
      await emit('phase31e:polls',records.normalizedPolls)
    }
    if(key==='formations') {
      await emit('formations',(records.formations || []).map(normalizeCoachFormationBoard).filter(Boolean))
      await emit('formationPresets',(records.formationPresets || []).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)).map(normalizeCoachFormationPreset))
      await emit('formationPublications',(records.formationPublications || []).sort(byDate('published_at')))
      const kits=new Map()
      for(const row of records.formations || []) if(row.currentVersion?.shirt_kit?.imagePath) kits.set(row.currentVersion.id,row.currentVersion.shirt_kit.imagePath)
      for(const row of records.formationPublications || []) if(row.shirt_kit?.imagePath) kits.set(row.board_version_id,row.shirt_kit.imagePath)
      for(const [sourceId,path] of kits) {
        assertCurrent()
        const resource = {id:`kit:${sourceId}`,sourceId,kind:'kit',clubId:context.clubId,teamId:context.teamId}
        if (deferMediaAuthorization) {
          await onMedia({...resource, expectedStoragePath:path, title:'Kit image'})
          continue
        }
        const authorization=await authorizeMedia(user,context,resource)
        assertCurrent()
        if(authorization.resource.storagePath!==path) throw new Error('coach_offline_kit_revision_changed')
        await onMedia({...authorization.resource,kind:'kit',type:'file'});assertCurrent()
      }
    }
  }
  const players=objectById(records.players || []),events=objectById(records.calendarEvents || []),requests=objectById(records.trainingRequests || []),matches=objectById(records.matches || [])
  const matchResponses=new Map((records.availability || []).map(item=>[`${item.match_day_id}:${item.player_id}`,item]))
  const trainingResponses=new Map((records.trainingResponses || []).map(item=>[`${item.request_id}:${item.player_id}`,item]))
  const calendar=(records.calendarInvites || []).map(row=>normalizeCoachInvite({...row,title:events.get(row.calendar_event_id)?.title,cancelled_at:events.get(row.calendar_event_id)?.cancelled_at,player_name:players.get(row.player_id)?.player_name},'calendar'))
  const match=(records.matchRequests || []).map(row=>normalizeCoachInvite({...row,availability_status:matchResponses.get(`${row.match_day_id}:${row.player_id}`)?.status,
    title:matches.get(row.match_day_id)?.opponent,match_date:matches.get(row.match_day_id)?.match_date,player_name:players.get(row.player_id)?.player_name,
    cancelled_at:matches.get(row.match_day_id)?.status==='cancelled' ? '1970-01-01T00:00:00Z' : null},'match'))
  const training=(records.trainingPlayers || []).map(row=>{
    const request=requests.get(row.request_id),event=events.get(row.calendar_event_id)
    return normalizeCoachInvite({...row,...trainingResponses.get(`${row.request_id}:${row.player_id}`),title:event?.title,cancelled_at:event?.cancelled_at,
      recurrence_frequency:event?.recurrence_frequency,occurrence_date:request?.occurrence_date,occurrence_starts_at:request?.occurrence_starts_at},'training')
  })
  const trainingCoaches=(records.coachAttendance || []).map(row=>({id:row.id,requestId:row.request_id,clubId:row.club_id,teamId:row.team_id,eventId:row.calendar_event_id,
    occurrenceDate:row.occurrence_date,occurrenceStartsAt:row.occurrence_starts_at,coachUserId:row.coach_user_id,coachName:row.coach_name,status:row.status,respondedAt:row.responded_at,
    notificationStatus:row.notification_status,notificationSentAt:row.notification_sent_at,notificationError:row.notification_error,
    cancelled:requests.get(row.request_id)?.status==='cancelled' || Boolean(events.get(row.calendar_event_id)?.cancelled_at)}))
  const invites={calendar,match,training,trainingCoaches,matches:records.normalizedMatches || [],players:records.normalizedPlayers || [],all:[...match,...training,...calendar]}
  await emit('phase31e:invites',invites,invites.all.length+trainingCoaches.length)
  const availability={}
  for(const request of records.trainingRequests || []) {
    const rows=training.filter(item=>item.eventId===request.calendar_event_id && item.occurrenceDate===request.occurrence_date)
    const collapsed=collapseCoachInvitesByPlayer(rows)
    availability[`${request.calendar_event_id}:${request.occurrence_date}`]={...summarizeCoachInvites(collapsed),details:collapsed}
  }
  const calendarEvents=(records.calendarEvents || []).map(row=>({...row,canEdit:user.role==='admin' || Boolean(row.team_id),isInheritedClubEvent:!row.team_id,
    involvedPlayerIds:(records.calendarInvites || []).filter(invite=>invite.calendar_event_id===row.id && invite.invite_status!=='cancelled' && !invite.cancelled_at).map(invite=>invite.player_id)}))
  const normalizedCalendar=buildCoachCalendarEvents({availabilityByEventId:availability,calendarEvents,
    matches:(records.matches || []).filter(row=>row.team_id===context.teamId),sessions:records.sessions || []})
  await emit('calendar',normalizedCalendar)
  await emit('trainingEvents',normalizedCalendar.filter(row=>row.sourceType==='calendar_event' && row.eventType==='training'))
  await emit('trainingLocations',[...new Set(normalizedCalendar.map(item=>item.location).filter(Boolean))])
  const chat={staff:[],parent:[]}
  for(const [kind,roomKind,messageKind] of [['staff','staffRooms','staffMessages'],['parent','parentRooms','parentMessages']]) {
    for(const row of records[roomKind] || []) {
      const messages=(records[messageKind] || []).filter(item=>(item.conversation_id || item.room_id)===row.id).sort((a,b)=>text(a.created_at).localeCompare(text(b.created_at))).map(normalizeCoachChatMessage)
      const member=kind==='staff' ? (records.staffMembers || []).find(item=>item.conversation_id===row.id && item.user_id===user.id)
        : (records.parentMembers || []).find(item=>item.room_id===row.id && item.auth_user_id===user.id)
      const room=normalizeCoachChatRoom({...row,team_name:context.teamName,club_name:context.clubName,player_name:players.get(row.player_id)?.player_name,
        latest_message:messages.at(-1)?.body || '',latest_message_at:messages.at(-1)?.createdAt || '',unread_count:messages.filter(item=>item.senderId!==user.id && item.createdAt>text(member?.last_read_at)).length,
        can_post:kind==='staff' || (row.status==='active' && (row.room_type!=='match_squad' || ['scheduled','scorer_request','live','half_time'].includes(matches.get(row.match_day_id)?.status))),
        staff_chat_members:(records.staffMembers || []).filter(item=>item.conversation_id===row.id)},kind)
      chat[kind].push(room)
      await emit(`chatMessages:${kind}:${room.id}`,messages)
    }
  }
  await emit('phase31e:chat',chat,chat.staff.length+chat.parent.length)
  const year=Number(new Intl.DateTimeFormat('en-GB',{year:'numeric',timeZone:'Europe/London'}).format(new Date()))
  const yearMatches=(records.matches || []).filter(item=>item.team_id===context.teamId && text(item.match_date)>=`${year}-01-01` && text(item.match_date)<`${year+1}-01-01`)
  for(const player of records.normalizedPlayers || []) {
    const scoring=(records.scoring || []).find(item=>item.player_id===player.id)
    const completed=yearMatches.filter(item=>item.status==='full_time')
    const time=calculatePlayerPlayingTime(completed,records.startingSquads || [],records.events || [],player.id)
    const squad=(records.squadDecisions || []).filter(item=>item.player_id===player.id && item.status==='selected' && yearMatches.some(match=>match.id===item.match_day_id && !['cancelled','postponed'].includes(match.status) && (match.status==='full_time' || match.concluded_at))).length
    await emit(`playerDetail:${player.id}`,{player,evaluations:(records.evaluations || []).filter(row=>row.player_id===player.id).sort(byDate('date')).map(normalizeCoachPlayerEvaluation),
      fields:(records.fields || []).map(normalizeCoachPlayerField),parentLinks:(records.parentLinks || []).filter(row=>row.player_id===player.id),parentLinksError:'',
      matchStats:{year,matchdaySquad:squad,goals:scoring ? Number(scoring.goals) : null,assists:scoring ? Number(scoring.assists) : null,playerOfTheMatch:scoring ? Number(scoring.motm_votes) : null,playingMinutes:time.minutes,playingTimeMatches:time.recordedMatches},matchStatsError:'',
      sessions:(records.sessionPlayers || []).filter(row=>row.player_id===player.id).map(row=>{const session=(records.sessions || []).find(item=>item.id===row.session_id);return {id:row.session_id,notes:row.notes || '',sessionDate:session?.session_date || '',sessionType:session?.session_type || '',status:session?.status || '',title:session?.title || ''}})})
  }
  await emit('home',{...buildCoachHomeOperationalSnapshot({matches:records.normalizedMatches,sessions:records.normalizedSessions,calendar:buildCoachHomeCalendarEvents({calendarEvents}),
    chatRooms:chat,polls:records.normalizedPolls,messages:(records.messages || []).map(normalizeCoachMessage),invites,development:records.development}),
    homeSources:{development:true,chatRooms:true,polls:true,invites:true},savedAt:new Date().toISOString()})
  return {complete:true,resourceCount,onlineOnly}
}
