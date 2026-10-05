import test from 'node:test'
import assert from 'node:assert/strict'
import { createMatchDayGoalCorrectionDraft, mergeMatchDayParticipantEventIdentities, normalizeMatchDayParticipantRoster } from '../apps/mobile-core/src/matchDayParticipantRoster.js'
import { getCoachMatchDaySelectedPlayers, isCoachMatchDayGoalCorrectionApplied, pickCoachMatchDayLinkedPlayer, updateCoachMatchDayLinkedPlayer, validateCoachMatchDayEventForm, validateCoachMatchDayEventParticipants } from '../apps/mobile-core/src/coachMatchDayCore.js'
import { appendParentScorerCommand, projectParentScorerOutbox } from '../apps/parent-mobile/src/parentScorerOutboxCore.js'
import { validateScorerMatchEvent } from '../src/lib/matchday-scorer-event.js'

const match = { id:'fixture',teamId:'team',clubId:'club',updatedAt:'2026-10-04T09:00:00Z',status:'live',isScorer:true,events:[],homeScore:0,awayScore:0,homeAway:'home' }
const raw = { matchId:match.id,teamId:match.teamId,players:[{id:'one',team_id:'team',player_name:'Same Name',shirt_number:''},{id:'two',team_id:'team',player_name:'Same Name',shirt_number:''}] }

test('roster parsing distinguishes verified empty from missing/malformed/cross-team data', () => {
  assert.deepEqual(normalizeMatchDayParticipantRoster({...raw,players:[]},match),[])
  for(const data of [null,{}, {...raw,matchId:'other'}, {...raw,teamId:'other'}, {...raw,players:null}, {...raw,players:[{...raw.players[0],team_id:'other'}]}, {...raw,players:[raw.players[0],raw.players[0]]}]) {
    assert.throws(()=>normalizeMatchDayParticipantRoster(data,match),/could not be verified/)
  }
  assert.equal(normalizeMatchDayParticipantRoster(raw,match).length,2)
  // No client inference from an empty decision list or available local roster.
  assert.deepEqual(getCoachMatchDaySelectedPlayers(raw.players,{...match,squadDecisions:[]}),[])
  assert.deepEqual(getCoachMatchDaySelectedPlayers(raw.players,{...match,eventParticipants:[]}),[])
})

test('duplicate names retain chosen IDs through Coach validation and manual edits clear stale IDs', () => {
  const players=normalizeMatchDayParticipantRoster(raw,match)
  let form=pickCoachMatchDayLinkedPlayer({eventType:'substitution',teamSide:'club',minute:3},'player',players[0])
  form=pickCoachMatchDayLinkedPlayer(form,'playerOn',players[1])
  const payload=validateCoachMatchDayEventParticipants(validateCoachMatchDayEventForm(form),players)
  assert.equal(payload.playerPlayerId,'one'); assert.equal(payload.playerOnPlayerId,'two')
  assert.equal(validateScorerMatchEvent(payload).playerOnPlayerId,'two')
  assert.throws(()=>validateCoachMatchDayEventParticipants({...payload,playerOnPlayerId:'one'},players),/different player/)
  assert.equal(updateCoachMatchDayLinkedPlayer(form,'player','name','Unknown',players).playerPlayerId,'')
  assert.equal(pickCoachMatchDayLinkedPlayer({},'scorer',players[1]).scorerPlayerId,'two')
})

test('offline journal/reload preserves authorised roster and chosen goal/assist IDs without changing squad decisions', () => {
  const players=normalizeMatchDayParticipantRoster(raw,match)
  const base={...match,eventParticipants:players,squadDecisions:[]}
  const capture='2026-10-04T09:01:00Z'
  const saved=appendParentScorerCommand({baseMatch:base,pending:[],verifiedAt:base.updatedAt},
    {id:'goal',kind:'goal',capturedAt:capture,payload:{participantRosterVersion:1,teamSide:'club',minute:1,scorerName:'Same Name',assistName:'Same Name',scorerPlayerId:'one',assistPlayerId:'two'}})
  const reloaded=JSON.parse(JSON.stringify(saved))
  assert.equal(reloaded.pending[0].payload.scorerPlayerId,'one')
  assert.equal(reloaded.pending[0].payload.assistPlayerId,'two')
  assert.deepEqual(projectParentScorerOutbox(reloaded).eventParticipants,players)
  assert.deepEqual(reloaded.baseMatch.squadDecisions,[])
  const handed=appendParentScorerCommand(reloaded,{id:'review',kind:'request-review',capturedAt:capture})
  assert.throws(()=>appendParentScorerCommand(handed,{id:'later',kind:'goal',capturedAt:capture}),/sent to the Coach/)
})

test('event reads preserve IDs, renamed correction drafts retain identity, and legacy names never infer one',()=>{
  const old={id:'event',eventType:'goal',teamSide:'club',scorerName:'Old Name',assistName:'Same Name',minute:3}
  const [event]=mergeMatchDayParticipantEventIdentities([old],{...raw,eventIdentities:[{id:'event',scorer_player_id:'one',assist_player_id:'two',participant_identity_version:1}]},match)
  assert.equal(event.scorerPlayerId,'one'); assert.equal(event.assistPlayerId,'two')
  const players=normalizeMatchDayParticipantRoster(raw,match)
  players[0].playerName='Renamed'
  const draft=createMatchDayGoalCorrectionDraft(event,players)
  assert.equal(draft.scorerName,'Renamed'); assert.equal(draft.scorerPlayerId,'one')
  assert.equal(createMatchDayGoalCorrectionDraft(old,players).scorerPlayerId,'')
  assert.throws(()=>mergeMatchDayParticipantEventIdentities([old],{...raw,eventIdentities:[{id:'event'},{id:'event'}]},match),/could not be verified/)
  const corrected={...draft,eventStatus:'corrected',correctionReason:'Fix',scorerShirtNumber:'',assistShirtNumber:'',isOwnGoal:false,isPenaltyGoal:false}
  assert.equal(isCoachMatchDayGoalCorrectionApplied({events:[corrected]},'event',corrected,'Fix'),true)
  assert.equal(isCoachMatchDayGoalCorrectionApplied({events:[{...corrected,scorerPlayerId:'two'}]},'event',corrected,'Fix'),false)
})

test('corrected saved cards/substitutions validate new identity and reject stale duplicate-name IDs',()=>{
  const players=normalizeMatchDayParticipantRoster(raw,match)
  let form=pickCoachMatchDayLinkedPlayer({eventType:'yellow_card',teamSide:'club',minute:3,participantType:'player'},'player',players[0])
  form=updateCoachMatchDayLinkedPlayer(form,'player','name','Unknown',players)
  assert.equal(form.playerPlayerId,'')
  assert.throws(()=>validateCoachMatchDayEventParticipants(validateCoachMatchDayEventForm(form),players),/Choose a selected/)
  form=pickCoachMatchDayLinkedPlayer(form,'player',players[1])
  assert.equal(validateCoachMatchDayEventParticipants(validateCoachMatchDayEventForm(form),players).playerPlayerId,'two')
  assert.equal(validateCoachMatchDayEventForm({...form,participantType:'other',playerName:'Match participant'}).playerPlayerId,'')
  players[1].playerName='Renamed'
  assert.throws(()=>validateCoachMatchDayEventParticipants(validateCoachMatchDayEventForm(form),players),/Choose a selected/)
  form=pickCoachMatchDayLinkedPlayer(form,'player',players[1])
  assert.equal(validateCoachMatchDayEventParticipants(validateCoachMatchDayEventForm(form),players).playerName,'Renamed')
})
