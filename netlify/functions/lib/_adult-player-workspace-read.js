const rows = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data || []
}
const eventOccurrence = (item) => {
  const match = String(item.id || '').match(/^([a-f0-9-]{36}):(\d{4}-\d{2}-\d{2})$/i)
  return match ? { eventId: match[1], date: match[2] } : null
}

export async function loadAdultPlayerCalendarExtras(client, scope, calendar, { includeResources = false } = {}) {
  const occurrences = calendar.map(eventOccurrence).filter(Boolean)
  const ids = [...new Set(occurrences.map(item => item.eventId))]
  if (!ids.length) return { calendarDetails: [], calendarResources: [] }
  const events = await rows(client.from('calendar_events').select('id,club_id,team_id,notes,notes_pinned,parent_visible,parent_audience')
    .eq('club_id', scope.club.id).eq('team_id', scope.team.id).eq('parent_visible', true).neq('parent_audience', 'none').is('cancelled_at', null).in('id', ids))
  const visibleIds = new Set(events.map(event => event.id))
  const calendarDetails = events.map(event => ({ id: event.id, notes: event.notes || '', notesPinned: event.notes_pinned === true }))
  if (!includeResources || !visibleIds.size) return { calendarDetails, calendarResources: [] }
  const links = await rows(client.from('resource_library_links')
    .select('resource_id,club_id,team_id,linked_id,calendar_occurrence_date,removed_at,resource_library_items!inner(id,title,category,mime_type,original_filename,file_size_bytes,archived_at,club_id,team_id)')
    .eq('club_id', scope.club.id).eq('team_id', scope.team.id).eq('linked_type', 'calendar_event').is('removed_at', null).in('linked_id', [...visibleIds]).limit(5000))
  if (links.length === 5000) throw new Error('Too many calendar resources to load safely.')
  const calendarResources = links.flatMap(link => {
    const item = Array.isArray(link.resource_library_items) ? link.resource_library_items[0] : link.resource_library_items
    if (!item || item.archived_at || item.club_id !== scope.club.id || item.team_id !== scope.team.id
      || item.mime_type === 'application/vnd.footballplayer.formation-board+json'
      || !occurrences.some(occurrence => occurrence.eventId === link.linked_id && occurrence.date === link.calendar_occurrence_date)) return []
    return [{ id: item.id, title: item.title, category: item.category, resourceType: 'file',
      originalFilename: item.original_filename || '', fileSizeBytes: Number(item.file_size_bytes) || 0,
      eventId: link.linked_id, occurrenceDate: link.calendar_occurrence_date, sourceType: 'calendar_event' }]
  })
  return { calendarDetails, calendarResources }
}

export async function enrichAdultPlayerMatches(client, scope, matches) {
  if (!matches.length) return matches
  const ids = matches.map(match => match.id)
  const [events, kicks, state] = await Promise.all([
    rows(client.from('match_day_events').select('id,match_day_id,event_type,event_status,team_side,minute,stoppage_minute,match_phase,phase_order,event_sequence,scorer_name,scorer_shirt_number,assist_name,assist_shirt_number,is_penalty_goal,is_own_goal,home_score,away_score,created_at')
      .in('match_day_id', ids).in('event_status', ['active', 'corrected']).order('created_at', { ascending: true }).limit(10000)),
    rows(client.from('match_day_shootout_kicks').select('id,match_day_id,team_side,outcome,player_name,created_at,voided_at')
      .in('match_day_id', ids).order('created_at', { ascending: true }).limit(5000)),
    rows(client.from('match_days').select('id,club_id,team_id,match_conclusion_rule,normal_time_home_score,normal_time_away_score,extra_time_home_score,extra_time_away_score,home_shootout_score,away_shootout_score,shootout_winner,venue_address,notes')
      .eq('club_id', scope.club.id).in('id', ids)),
  ])
  if (events.length === 10000 || kicks.length === 5000) throw new Error('Too many match events to load safely.')
  return matches.map(match => ({ ...match, ...state.find(item => item.id === match.id),
    events: events.filter(event => event.match_day_id === match.id),
    shootout_events: kicks.filter(kick => kick.match_day_id === match.id), is_scorer: false }))
}
