import process from 'node:process'

const DEMO_EMAIL = 'demo@playerfeedback.online'
const DEMO_PASSWORD = 'Demo12345!'
const DEMO_CLUB_NAME = 'Cambourne Town Academy FC'
const DEMO_USER_NAME = 'Jordan Ellis'
const DEMO_CLUB_CONTACT_EMAIL = 'demo.club@footballplayer.test'

let supabaseAdmin = null

function addDays(date, dayCount) {
  const nextDate = new Date(date)
  nextDate.setDate(nextDate.getDate() + dayCount)
  return nextDate
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10)
}

function toDisplayDate(date) {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

function toUtcIso(date) {
  return date.toISOString()
}

function getDemoDates() {
  const today = new Date()
  return {
    lastMonth: addDays(today, -28),
    twoWeeksAgo: addDays(today, -14),
    lastWeek: addDays(today, -7),
    yesterday: addDays(today, -1),
    today,
    tomorrow: addDays(today, 1),
    nextTraining: addDays(today, 2),
    nextMatch: addDays(today, 5),
    nextWeek: addDays(today, 7),
    pollClose: addDays(today, 3),
    availabilityExpiry: addDays(today, 10),
  }
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

function failureResponse(statusCode, message) {
  return jsonResponse(statusCode, { success: false, message })
}

function successResponse(payload = {}) {
  return jsonResponse(200, { success: true, ...payload })
}

function getMissingEnvVars() {
  return ['SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL'].filter((envName) => !process.env[envName])
}

async function throwOnError(result, message) {
  if (result.error) {
    throw new Error(`${message}: ${result.error.message}`)
  }

  return result.data
}

async function ignoreMissingTable(promise, label) {
  const result = await promise

  if (result.error && result.error.code !== '42P01') {
    console.error(`${label} failed`, result.error)
  }
}

async function findAuthUserByEmail(email) {
  let page = 1

  while (page < 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 100,
    })

    if (error) {
      throw error
    }

    const matchedUser = data?.users?.find((user) => String(user.email ?? '').toLowerCase() === email)

    if (matchedUser) {
      return matchedUser
    }

    if (!data?.users?.length || data.users.length < 100) {
      return null
    }

    page += 1
  }

  return null
}

async function ensureDemoAuthUser() {
  const existingUser = await findAuthUserByEmail(DEMO_EMAIL)

  if (existingUser?.id) {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        name: DEMO_USER_NAME,
      },
    })

    if (error) {
      throw error
    }

    return data.user
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: {
      name: DEMO_USER_NAME,
    },
  })

  if (error) {
    throw error
  }

  return data.user
}

async function ensureDemoClub() {
  const { data: existingClub, error: existingClubError } = await supabaseAdmin
    .from('clubs')
    .select('id')
    .eq('name', DEMO_CLUB_NAME)
    .maybeSingle()

  if (existingClubError) {
    throw existingClubError
  }

  let clubId = existingClub?.id || ''

  if (!clubId) {
    const insertedClub = await throwOnError(
      await supabaseAdmin
        .from('clubs')
        .insert({
          name: DEMO_CLUB_NAME,
          contact_email: DEMO_CLUB_CONTACT_EMAIL,
          contact_phone: '01223 000000',
          require_approval: false,
          status: 'active',
          plan_key: 'large_club',
          plan_status: 'active',
          is_plan_comped: true,
        })
        .select('id')
        .single(),
      'Could not create demo club',
    )
    clubId = insertedClub.id
  }

  await throwOnError(
    await supabaseAdmin
      .from('clubs')
      .update({
        name: DEMO_CLUB_NAME,
        contact_email: DEMO_CLUB_CONTACT_EMAIL,
        contact_phone: '01223 000000',
        require_approval: false,
        status: 'active',
        suspended_at: null,
        plan_key: 'large_club',
        plan_status: 'active',
        is_plan_comped: true,
      })
      .eq('id', clubId),
    'Could not update demo club',
  )

  return clubId
}

async function detachDemoUserFromRealData(authUserId, demoClubId) {
  await Promise.all([
    ignoreMissingTable(
      supabaseAdmin
        .from('user_club_memberships')
        .delete()
        .eq('auth_user_id', authUserId)
        .neq('club_id', demoClubId),
      'demo real membership cleanup',
    ),
    ignoreMissingTable(
      supabaseAdmin
        .from('club_user_invites')
        .delete()
        .eq('email', DEMO_EMAIL)
        .neq('club_id', demoClubId),
      'demo real invite cleanup',
    ),
  ])
}

async function clearDemoClubData(clubId) {
  const { data: matchDays } = await supabaseAdmin
    .from('match_days')
    .select('id')
    .eq('club_id', clubId)

  const matchDayIds = (matchDays || []).map((matchDay) => matchDay.id)

  if (matchDayIds.length > 0) {
    await Promise.all([
      ignoreMissingTable(supabaseAdmin.from('match_day_availability_requests').delete().in('match_day_id', matchDayIds), 'match_day_availability_requests cleanup'),
      ignoreMissingTable(supabaseAdmin.from('match_day_events').delete().in('match_day_id', matchDayIds), 'match_day_events cleanup'),
      ignoreMissingTable(supabaseAdmin.from('match_day_scorer_assignments').delete().in('match_day_id', matchDayIds), 'match_day_scorer_assignments cleanup'),
      ignoreMissingTable(supabaseAdmin.from('match_day_scorer_interest').delete().in('match_day_id', matchDayIds), 'match_day_scorer_interest cleanup'),
    ])
  }

  const { data: polls } = await supabaseAdmin
    .from('polls')
    .select('id')
    .eq('club_id', clubId)

  const pollIds = (polls || []).map((poll) => poll.id)

  if (pollIds.length > 0) {
    await ignoreMissingTable(supabaseAdmin.from('poll_votes').delete().in('poll_id', pollIds), 'poll_votes cleanup')
  }

  const { data: sessions } = await supabaseAdmin
    .from('assessment_sessions')
    .select('id')
    .eq('club_id', clubId)

  const sessionIds = (sessions || []).map((session) => session.id)

  if (sessionIds.length > 0) {
    await supabaseAdmin.from('assessment_session_players').delete().in('session_id', sessionIds)
  }

  const { data: teams } = await supabaseAdmin.from('teams').select('id').eq('club_id', clubId)
  const teamIds = (teams || []).map((team) => team.id)

  if (teamIds.length > 0) {
    await supabaseAdmin.from('team_staff').delete().in('team_id', teamIds)
  }

  await Promise.all([
    ignoreMissingTable(supabaseAdmin.from('assessment_sessions').delete().eq('club_id', clubId), 'assessment_sessions cleanup'),
    ignoreMissingTable(supabaseAdmin.from('match_days').delete().eq('club_id', clubId), 'match_days cleanup'),
    ignoreMissingTable(supabaseAdmin.from('match_locations').delete().eq('club_id', clubId), 'match_locations cleanup'),
    ignoreMissingTable(supabaseAdmin.from('polls').delete().eq('club_id', clubId), 'polls cleanup'),
    ignoreMissingTable(supabaseAdmin.from('parent_player_links').delete().eq('club_id', clubId), 'parent_player_links cleanup'),
    ignoreMissingTable(supabaseAdmin.from('evaluations').delete().eq('club_id', clubId), 'evaluations cleanup'),
    ignoreMissingTable(supabaseAdmin.from('player_staff_notes').delete().eq('club_id', clubId), 'player_staff_notes cleanup'),
    ignoreMissingTable(supabaseAdmin.from('communication_logs').delete().eq('club_id', clubId), 'communication_logs cleanup'),
    ignoreMissingTable(supabaseAdmin.from('audit_logs').delete().eq('club_id', clubId), 'audit_logs cleanup'),
    ignoreMissingTable(supabaseAdmin.from('record_backups').delete().eq('club_id', clubId), 'record_backups cleanup'),
    ignoreMissingTable(supabaseAdmin.from('players').delete().eq('club_id', clubId), 'players cleanup'),
    ignoreMissingTable(supabaseAdmin.from('form_fields').delete().eq('club_id', clubId), 'form_fields cleanup'),
    ignoreMissingTable(supabaseAdmin.from('club_roles').delete().eq('club_id', clubId), 'club_roles cleanup'),
    ignoreMissingTable(supabaseAdmin.from('club_user_invites').delete().eq('club_id', clubId), 'club_user_invites cleanup'),
    ignoreMissingTable(supabaseAdmin.from('teams').delete().eq('club_id', clubId), 'teams cleanup'),
  ])
}

async function seedRoles(clubId, actorId) {
  const roles = [
    { role_key: 'admin', role_label: 'Club Admin', role_rank: 90, is_system: true },
    { role_key: 'head_manager', role_label: 'Team Admin', role_rank: 70, is_system: true },
    { role_key: 'manager', role_label: 'Manager', role_rank: 50, is_system: true },
    { role_key: 'coach', role_label: 'Coach', role_rank: 30, is_system: true },
    { role_key: 'assistant_coach', role_label: 'Assistant Coach', role_rank: 20, is_system: true },
  ].map((role) => ({
    ...role,
    club_id: clubId,
    created_by: actorId,
    created_by_name: DEMO_USER_NAME,
    created_by_email: DEMO_EMAIL,
  }))

  await throwOnError(
    await supabaseAdmin.from('club_roles').upsert(roles, { onConflict: 'club_id,role_key' }),
    'Could not seed demo roles',
  )
}

async function seedDemoUser(clubId, authUserId) {
  const profile = {
    id: authUserId,
    email: DEMO_EMAIL,
    username: DEMO_USER_NAME,
    name: DEMO_USER_NAME,
    display_name: DEMO_USER_NAME,
    role: 'head_manager',
    role_label: 'Team Admin',
    role_rank: 70,
    club_id: clubId,
    force_password_change: false,
    team_name: 'U12 Tigers',
    club_name: DEMO_CLUB_NAME,
    reply_to_email: DEMO_CLUB_CONTACT_EMAIL,
    onboarding_enabled: true,
    onboarding_completed_steps: [],
    onboarding_dismissed_at: null,
    theme_mode: 'system',
    theme_accent: 'yellow',
  }

  await throwOnError(
    await supabaseAdmin.from('users').upsert(profile, { onConflict: 'id' }),
    'Could not seed demo user',
  )

  await throwOnError(
    await supabaseAdmin.from('user_club_memberships').upsert(
      {
        auth_user_id: authUserId,
        club_id: clubId,
        email: DEMO_EMAIL,
        username: DEMO_USER_NAME,
        name: DEMO_USER_NAME,
        role: 'head_manager',
        role_label: 'Team Admin',
        role_rank: 70,
      },
      { onConflict: 'auth_user_id,club_id' },
    ),
    'Could not seed demo membership',
  )
}

async function seedTeams(clubId, actorId) {
  const teamNames = ['U12 Tigers', 'U14 Falcons', 'U16 Lions']
  const insertedTeams = await throwOnError(
    await supabaseAdmin
      .from('teams')
      .insert(
        teamNames.map((name) => ({
          club_id: clubId,
          name,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
        })),
      )
      .select('id,name'),
    'Could not seed demo teams',
  )

  await throwOnError(
    await supabaseAdmin.from('team_staff').insert(
      insertedTeams.map((team) => ({
        team_id: team.id,
        user_id: actorId,
      })),
    ),
    'Could not seed demo team staff',
  )

  return insertedTeams
}

async function seedFormFields(clubId, actorId) {
  const fields = [
    { label: 'Technical', type: 'score_1_5', order_index: 1 },
    { label: 'Tactical', type: 'score_1_5', order_index: 2 },
    { label: 'Physical', type: 'score_1_5', order_index: 3 },
    { label: 'Mentality', type: 'score_1_5', order_index: 4 },
    { label: 'Coachability', type: 'score_1_5', order_index: 5 },
    { label: 'Strengths', type: 'textarea', order_index: 6 },
    { label: 'Improvements', type: 'textarea', order_index: 7 },
    { label: 'Overall Comments', type: 'textarea', order_index: 8 },
  ]

  await throwOnError(
    await supabaseAdmin.from('form_fields').insert(
      fields.map((field) => ({
        ...field,
        club_id: clubId,
        options: field.type === 'score_1_5' ? [1, 2, 3, 4, 5] : [],
        required: ['Technical', 'Tactical', 'Physical', 'Mentality', 'Coachability'].includes(field.label),
        is_default: true,
        is_enabled: true,
        created_by: actorId,
        created_by_name: DEMO_USER_NAME,
        created_by_email: DEMO_EMAIL,
      })),
    ),
    'Could not seed demo form fields',
  )
}

async function seedPlayers(clubId, teams, actorId) {
  const u12 = teams.find((team) => team.name === 'U12 Tigers') || teams[0]
  const u14 = teams.find((team) => team.name === 'U14 Falcons') || teams[0]
  const u16 = teams.find((team) => team.name === 'U16 Lions') || teams[0]
  const rows = [
    ['Alex Morgan', 'Squad', u12, ['Striker', 'Winger'], '12', 'Sam Morgan', 'demo.parent.01@footballplayer.test', 'Sharp movement in the final third.'],
    ['Maya Singh', 'Squad', u12, ['CM'], '8', 'Priya Singh', 'demo.parent.02@footballplayer.test', 'Calm in possession and leads warmups well.'],
    ['Noah Turner', 'Squad', u12, ['CB'], '5', 'Chris Turner', 'demo.parent.03@footballplayer.test', 'Strong one-to-one defending and recovery runs.'],
    ['Ruby Carter', 'Trial', u12, ['GK'], '1', 'Elliot Carter', 'demo.parent.04@footballplayer.test', 'Confident handling, still learning distribution speed.'],
    ['Leo Hughes', 'Squad', u14, ['Winger'], '11', 'Amira Hughes', 'demo.parent.05@footballplayer.test', 'Positive runner who commits defenders.'],
    ['Sofia Brooks', 'Squad', u14, ['CM', 'CDM'], '6', 'Helen Brooks', 'demo.parent.06@footballplayer.test', 'Reads danger early and helps organise shape.'],
    ['Theo Clarke', 'Trial', u14, ['ST'], '9', 'Martin Clarke', 'demo.parent.07@footballplayer.test', 'Good first touch under pressure.'],
    ['Grace Wilson', 'Squad', u16, ['LB'], '3', 'Jamie Wilson', 'demo.parent.08@footballplayer.test', 'Reliable full back with improving delivery.'],
    ['Ben Walker', 'Squad', u16, ['CB'], '4', 'Nadia Walker', 'demo.parent.09@footballplayer.test', 'Voice in the back line and strong aerial timing.'],
    ['Ella Price', 'Trial', u16, ['CAM'], '10', 'Owen Price', 'demo.parent.10@footballplayer.test', 'Creative passer who finds pockets well.'],
  ]

  const insertedPlayers = await throwOnError(
    await supabaseAdmin
      .from('players')
      .insert(
        rows.map(([playerName, section, team, positions, shirtNumber, parentName, parentEmail, notes]) => ({
          club_id: clubId,
          player_name: playerName,
          shirt_number: shirtNumber,
          section,
          team_id: team.id,
          team: team.name,
          parent_name: parentName,
          parent_email: parentEmail,
          parent_contacts: [{ name: parentName, email: parentEmail }],
          contact_type: 'parent',
          positions,
          status: section === 'Squad' ? 'promoted' : 'active',
          notes,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
        })),
      )
      .select('id,player_name,section,team,team_id,parent_name,parent_email,parent_contacts,shirt_number'),
    'Could not seed demo players',
  )

  return insertedPlayers.map((player) => ({
    ...player,
    team_id: player.team_id || teams.find((team) => team.name === player.team)?.id || '',
  }))
}

function createResponses(values) {
  return {
    Technical: values.technical,
    Tactical: values.tactical,
    Physical: values.physical,
    Mentality: values.mentality,
    Coachability: values.coachability,
    Strengths: values.strengths,
    Improvements: values.improvements,
    'Overall Comments': values.overall,
  }
}

function averageScore(values) {
  const scores = [values.technical, values.tactical, values.physical, values.mentality, values.coachability]
    .map(Number)
    .filter((value) => Number.isFinite(value))

  return Number((scores.reduce((total, value) => total + value, 0) / scores.length).toFixed(1))
}

async function seedEvaluations(clubId, players, actorId) {
  const dates = getDemoDates()
  const evaluationSeeds = [
    {
      player: 'Alex Morgan',
      session: 'Training | Pressing from the front',
      date: dates.lastMonth,
      values: {
        technical: 3,
        tactical: 3,
        physical: 4,
        mentality: 4,
        coachability: 4,
        strengths: 'Quick acceleration and brave first press.',
        improvements: 'Needs to check shoulder before receiving wide.',
        overall: 'Positive month one record. Good energy and clear attacking intent.',
      },
    },
    {
      player: 'Alex Morgan',
      session: 'Match | Cambourne Town vs Fen Tigers',
      date: dates.twoWeeksAgo,
      values: {
        technical: 4,
        tactical: 4,
        physical: 4,
        mentality: 4,
        coachability: 4,
        strengths: 'Timed runs well and created two good chances.',
        improvements: 'Can recover into shape quicker after attacks break down.',
        overall: 'Strong match contribution with better decision making in wide areas.',
      },
    },
    {
      player: 'Alex Morgan',
      session: 'Training | Final third combinations',
      date: dates.lastWeek,
      values: {
        technical: 4,
        tactical: 4,
        physical: 5,
        mentality: 5,
        coachability: 4,
        strengths: 'Linked well with the number 10 and pressed with purpose.',
        improvements: 'Keep final pass lower when crossing under pressure.',
        overall: 'Clear upward trend. Ready for more minutes against stronger opposition.',
      },
    },
    {
      player: 'Maya Singh',
      session: 'Training | Midfield receiving angles',
      date: dates.twoWeeksAgo,
      values: {
        technical: 3,
        tactical: 4,
        physical: 3,
        mentality: 4,
        coachability: 5,
        strengths: 'Shows early pictures and supports both sides of the ball.',
        improvements: 'Can be braver playing forward passes through midfield.',
        overall: 'Reliable central player with strong coachability.',
      },
    },
    {
      player: 'Leo Hughes',
      session: 'Match | U14 Falcons vs West Cambs Colts',
      date: dates.yesterday,
      values: {
        technical: 4,
        tactical: 4,
        physical: 4,
        mentality: 5,
        coachability: 4,
        strengths: 'Beat the full back repeatedly and tracked back well.',
        improvements: 'Final delivery can be more consistent after a long carry.',
        overall: 'Good match impact and strong recovery work.',
      },
    },
    {
      player: 'Sofia Brooks',
      session: 'Training | Protecting the back four',
      date: dates.lastWeek,
      values: {
        technical: 4,
        tactical: 5,
        physical: 4,
        mentality: 4,
        coachability: 5,
        strengths: 'Excellent screening position and simple distribution.',
        improvements: 'Use voice earlier when the press starts behind her.',
        overall: 'Very mature session and strong tactical understanding.',
      },
    },
  ]

  await throwOnError(
    await supabaseAdmin.from('evaluations').insert(
      evaluationSeeds.map((seed) => {
        const player = players.find((item) => item.player_name === seed.player)
        const responses = createResponses(seed.values)

        return {
          club_id: clubId,
          player_id: player.id,
          player_name: player.player_name,
          team: player.team,
          team_id: player.team_id,
          coach_id: actorId,
          coach: DEMO_USER_NAME,
          parent_name: player.parent_name,
          parent_email: player.parent_email,
          parent_contacts: player.parent_contacts,
          session: seed.session,
          date: toDisplayDate(seed.date),
          scores: {
            Technical: seed.values.technical,
            Tactical: seed.values.tactical,
            Physical: seed.values.physical,
            Mentality: seed.values.mentality,
            Coachability: seed.values.coachability,
          },
          average_score: averageScore(seed.values),
          comments: {
            strengths: seed.values.strengths,
            improvements: seed.values.improvements,
            overall: seed.values.overall,
          },
          form_responses: responses,
          decision: '',
          status: 'Submitted',
          section: player.section,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
          updated_by: actorId,
          updated_by_name: DEMO_USER_NAME,
          updated_by_email: DEMO_EMAIL,
          created_at: toUtcIso(seed.date),
        }
      }),
    ),
    'Could not seed demo assessments',
  )
}

async function seedSessions(clubId, teams, players, actorId) {
  const dates = getDemoDates()
  const u12 = teams.find((team) => team.name === 'U12 Tigers') || teams[0]
  const u14 = teams.find((team) => team.name === 'U14 Falcons') || teams[0]
  const u16 = teams.find((team) => team.name === 'U16 Lions') || teams[0]
  const sessionRows = [
    {
      team: u12,
      opponent: '',
      session_date: toDateOnly(dates.lastWeek),
      title: 'U12 Tigers pressing practice',
      session_type: 'training',
      status: 'completed',
    },
    {
      team: u14,
      opponent: 'West Cambs Colts',
      session_date: toDateOnly(dates.yesterday),
      title: 'U14 Falcons vs West Cambs Colts',
      session_type: 'match',
      status: 'completed',
    },
    {
      team: u12,
      opponent: '',
      session_date: toDateOnly(dates.nextTraining),
      title: 'U12 Tigers final third combinations',
      session_type: 'training',
      status: 'open',
    },
    {
      team: u16,
      opponent: 'Histon Rangers',
      session_date: toDateOnly(dates.nextMatch),
      title: 'U16 Lions vs Histon Rangers',
      session_type: 'match',
      status: 'open',
    },
  ]

  const sessions = await throwOnError(
    await supabaseAdmin
      .from('assessment_sessions')
      .insert(
        sessionRows.map((session) => ({
          club_id: clubId,
          team_id: session.team.id,
          team: session.team.name,
          opponent: session.opponent,
          session_date: session.session_date,
          title: session.title,
          session_type: session.session_type,
          status: session.status,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
        })),
      )
      .select('id,title,team,team_id,session_type'),
    'Could not seed demo sessions',
  )

  const sessionPlayers = sessions.flatMap((session) =>
    players
      .filter((player) => player.team_id === session.team_id)
      .slice(0, 4)
      .map((player) => ({
        session_id: session.id,
        player_id: player.id,
        player_name: player.player_name,
        section: player.section,
        team: player.team,
        parent_name: player.parent_name,
        parent_email: player.parent_email,
        parent_contacts: player.parent_contacts,
        notes: 'Demo session note.',
        created_by: actorId,
        created_by_name: DEMO_USER_NAME,
        created_by_email: DEMO_EMAIL,
      })),
  )

  if (sessionPlayers.length > 0) {
    await throwOnError(
      await supabaseAdmin.from('assessment_session_players').insert(sessionPlayers),
      'Could not seed demo session players',
    )
  }

  return sessions
}

async function seedParentLinks(clubId, players, actorId) {
  const squadPlayers = players.filter((player) => player.section === 'Squad').slice(0, 7)

  if (squadPlayers.length === 0) {
    return []
  }

  return throwOnError(
    await supabaseAdmin
      .from('parent_player_links')
      .insert(
        squadPlayers.map((player) => ({
          club_id: clubId,
          team_id: player.team_id,
          player_id: player.id,
          link_type: 'parent',
          email: player.parent_email,
          status: 'active',
          invited_by: actorId,
          invited_by_name: DEMO_USER_NAME,
          accepted_at: toUtcIso(addDays(new Date(), -6)),
        })),
      )
      .select('id,club_id,team_id,player_id,email'),
    'Could not seed parent links',
  )
}

async function seedStaffNotes(clubId, players, actorId) {
  const notes = [
    ['Alex Morgan', 'Worked on curved pressing runs after training. Next focus is the recovery sprint after losing the ball.'],
    ['Maya Singh', 'Good leadership in the rondo group. Ask her to call the switch earlier next session.'],
    ['Sofia Brooks', 'Strong tactical detail. Ready to help demonstrate the holding midfield role.'],
  ]

  await ignoreMissingTable(
    supabaseAdmin.from('player_staff_notes').insert(
      notes.map(([playerName, note]) => {
        const player = players.find((item) => item.player_name === playerName)

        return {
          club_id: clubId,
          player_id: player.id,
          user_id: actorId,
          user_name: DEMO_USER_NAME,
          user_email: DEMO_EMAIL,
          note,
          created_at: toUtcIso(addDays(new Date(), -2)),
        }
      }),
    ),
    'Could not seed staff notes',
  )
}

async function seedCommunicationLogs(clubId, players, actorId) {
  const rows = [
    ['Alex Morgan', 'email', 'development_update_sent', 'demo.parent.01@footballplayer.test', { sections: ['summary', 'progressionChart', 'coachComments'] }],
    ['Leo Hughes', 'pdf', 'development_pdf_created', 'demo.parent.05@footballplayer.test', { sections: ['latestRecord', 'matchContext'] }],
    ['Maya Singh', 'parent_invite', 'parent_link_active', 'demo.parent.02@footballplayer.test', { source: 'marketing_demo' }],
  ]

  await ignoreMissingTable(
    supabaseAdmin.from('communication_logs').insert(
      rows.map(([playerName, channel, action, recipientEmail, metadata]) => {
        const player = players.find((item) => item.player_name === playerName)

        return {
          club_id: clubId,
          player_id: player.id,
          user_id: actorId,
          user_name: DEMO_USER_NAME,
          user_email: DEMO_EMAIL,
          channel,
          action,
          recipient_email: recipientEmail,
          metadata,
          created_at: toUtcIso(addDays(new Date(), -1)),
        }
      }),
    ),
    'Could not seed communication logs',
  )
}

async function seedPolls(clubId, teams, players, parentLinks, actorId) {
  const dates = getDemoDates()
  const u12 = teams.find((team) => team.name === 'U12 Tigers') || teams[0]
  const u14 = teams.find((team) => team.name === 'U14 Falcons') || teams[0]
  const alex = players.find((player) => player.player_name === 'Alex Morgan')
  const maya = players.find((player) => player.player_name === 'Maya Singh')
  const noah = players.find((player) => player.player_name === 'Noah Turner')

  const polls = await throwOnError(
    await supabaseAdmin
      .from('polls')
      .insert([
        {
          club_id: clubId,
          team_id: u12.id,
          title: 'Saturday match availability',
          description: 'Can your player make the fixture against Histon Rangers?',
          audience: 'parents',
          poll_type: 'text',
          options: [
            { id: 'available', label: 'Available' },
            { id: 'maybe', label: 'Maybe' },
            { id: 'unavailable', label: 'Unavailable' },
          ],
          status: 'open',
          closes_at: toUtcIso(dates.pollClose),
          allow_multiple: false,
          allow_own_child_votes: true,
          allow_vote_changes: true,
          hide_votes: false,
          allow_comments: false,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
        },
        {
          club_id: clubId,
          team_id: u14.id,
          title: 'Player of the match shortlist',
          description: 'Vote from the coach shortlist after the West Cambs Colts match.',
          audience: 'parents',
          poll_type: 'awards',
          options: [
            { id: 'alex', label: 'Alex Morgan #12', playerId: alex?.id || '' },
            { id: 'maya', label: 'Maya Singh #8', playerId: maya?.id || '' },
            { id: 'noah', label: 'Noah Turner #5', playerId: noah?.id || '' },
          ],
          status: 'open',
          closes_at: toUtcIso(dates.nextWeek),
          allow_multiple: false,
          allow_own_child_votes: false,
          allow_vote_changes: false,
          hide_votes: false,
          allow_comments: false,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
        },
      ])
      .select('id,title,team_id'),
    'Could not seed polls',
  )

  const seededPolls = Array.isArray(polls) ? polls : []
  const availabilityPoll = seededPolls.find((poll) => poll.title === 'Saturday match availability')
  const awardsPoll = seededPolls.find((poll) => poll.title === 'Player of the match shortlist')
  const voteRows = []

  if (availabilityPoll) {
    parentLinks.slice(0, 4).forEach((link, index) => {
      voteRows.push({
        poll_id: availabilityPoll.id,
        club_id: clubId,
        team_id: availabilityPoll.team_id,
        voter_email: link.email,
        voter_name: link.email,
        option_id: index === 2 ? 'maybe' : 'available',
        parent_link_id: link.id,
      })
    })
  }

  if (awardsPoll) {
    parentLinks.slice(0, 3).forEach((link, index) => {
      voteRows.push({
        poll_id: awardsPoll.id,
        club_id: clubId,
        team_id: awardsPoll.team_id,
        voter_email: link.email,
        voter_name: link.email,
        option_id: index === 0 ? 'maya' : 'alex',
        parent_link_id: link.id,
      })
    })
  }

  if (voteRows.length > 0) {
    await ignoreMissingTable(supabaseAdmin.from('poll_votes').insert(voteRows), 'Could not seed poll votes')
  }
}

async function seedMatchDays(clubId, teams, players, parentLinks, actorId) {
  const dates = getDemoDates()
  const u12 = teams.find((team) => team.name === 'U12 Tigers') || teams[0]
  const u16 = teams.find((team) => team.name === 'U16 Lions') || teams[0]

  const locationRows = await throwOnError(
    await supabaseAdmin
      .from('match_locations')
      .insert([
        {
          club_id: clubId,
          name: 'Cambourne Sports Pavilion',
          address: 'Back Lane, Cambourne',
          notes: 'Main grass pitch beside the pavilion.',
          created_by: actorId,
        },
        {
          club_id: clubId,
          name: 'Histon Recreation Ground',
          address: 'New Road, Histon',
          notes: 'Away fixture venue.',
          created_by: actorId,
        },
      ])
      .select('id,name'),
    'Could not seed match locations',
  )

  const locations = Array.isArray(locationRows) ? locationRows : []
  const homeLocation = locations.find((location) => location.name === 'Cambourne Sports Pavilion')
  const awayLocation = locations.find((location) => location.name === 'Histon Recreation Ground')

  const matches = await throwOnError(
    await supabaseAdmin
      .from('match_days')
      .insert([
        {
          club_id: clubId,
          team_id: u12.id,
          location_id: homeLocation?.id || null,
          opponent: 'Fen Tigers',
          match_date: toDateOnly(dates.lastWeek),
          kickoff_time: '10:30',
          home_away: 'home',
          venue_name: 'Cambourne Sports Pavilion',
          venue_address: 'Back Lane, Cambourne',
          notes: 'Pressed well after half time and kept the ball in wide areas.',
          scorer_request_message: 'Can one parent update the live score from the touchline?',
          status: 'full_time',
          home_score: 3,
          away_score: 1,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
        },
        {
          club_id: clubId,
          team_id: u16.id,
          location_id: awayLocation?.id || null,
          opponent: 'Histon Rangers',
          match_date: toDateOnly(dates.nextMatch),
          kickoff_time: '11:00',
          home_away: 'away',
          venue_name: 'Histon Recreation Ground',
          venue_address: 'New Road, Histon',
          notes: 'Confirm availability before naming the squad.',
          scorer_request_message: 'Volunteer scorer needed for the first half.',
          status: 'scorer_request',
          home_score: 0,
          away_score: 0,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
        },
      ])
      .select('id,team_id,opponent,status'),
    'Could not seed match days',
  )

  const seededMatches = Array.isArray(matches) ? matches : []
  const previousMatch = seededMatches.find((match) => match.opponent === 'Fen Tigers')
  const nextMatch = seededMatches.find((match) => match.opponent === 'Histon Rangers')

  if (previousMatch) {
    await ignoreMissingTable(
      supabaseAdmin.from('match_day_events').insert([
        {
          match_day_id: previousMatch.id,
          club_id: clubId,
          team_id: previousMatch.team_id,
          event_type: 'goal',
          team_side: 'club',
          minute: 18,
          scorer_name: 'Alex Morgan',
          scorer_initials: 'AM',
          scorer_shirt_number: '12',
          assist_name: 'Maya Singh',
          assist_initials: 'MS',
          assist_shirt_number: '8',
          home_score: 1,
          away_score: 0,
          notes: 'Low finish after a quick regain.',
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
        },
        {
          match_day_id: previousMatch.id,
          club_id: clubId,
          team_id: previousMatch.team_id,
          event_type: 'goal',
          team_side: 'club',
          minute: 52,
          scorer_name: 'Noah Turner',
          scorer_initials: 'NT',
          scorer_shirt_number: '5',
          assist_name: 'Alex Morgan',
          assist_initials: 'AM',
          assist_shirt_number: '12',
          home_score: 3,
          away_score: 1,
          notes: 'Header from a back post corner.',
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
        },
      ]),
      'Could not seed match events',
    )
  }

  if (nextMatch) {
    const selectedParent = parentLinks.find((link) => link.team_id === nextMatch.team_id) || parentLinks[0]
    if (selectedParent) {
      await ignoreMissingTable(
        supabaseAdmin.from('match_day_scorer_interest').insert({
          match_day_id: nextMatch.id,
          club_id: clubId,
          team_id: nextMatch.team_id,
          parent_link_id: selectedParent.id,
          parent_name: 'Touchline volunteer',
          parent_email: selectedParent.email,
          message: 'Happy to update the score during the first half.',
          status: 'interested',
        }),
        'Could not seed scorer interest',
      )
    }

    const availabilityRows = players
      .filter((player) => player.team_id === nextMatch.team_id)
      .slice(0, 5)
      .map((player, index) => ({
        match_day_id: nextMatch.id,
        club_id: clubId,
        team_id: nextMatch.team_id,
        player_id: player.id,
        player_name: player.player_name,
        recipient_email: player.parent_email,
        recipient_name: player.parent_name,
        recipient_type: 'parent',
        channel: 'email',
        token_hash: `${nextMatch.id}-${player.id}`.replace(/-/g, ''),
        status: index === 1 ? 'maybe' : index === 3 ? 'pending' : 'available',
        responded_at: index === 3 ? null : toUtcIso(addDays(new Date(), -1)),
        expires_at: toUtcIso(dates.availabilityExpiry),
        sent_at: toUtcIso(addDays(new Date(), -2)),
        created_by: actorId,
        created_by_name: DEMO_USER_NAME,
      }))

    if (availabilityRows.length > 0) {
      await ignoreMissingTable(
        supabaseAdmin.from('match_day_availability_requests').insert(availabilityRows),
        'Could not seed availability requests',
      )
    }
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return failureResponse(405, 'Method Not Allowed')
  }

  try {
    const missingEnvVars = getMissingEnvVars()

    if (missingEnvVars.length > 0) {
      return failureResponse(500, `Missing required environment variables: ${missingEnvVars.join(', ')}`)
    }

    ;({ supabaseAdmin } = await import('./_supabase.js'))

    const authUser = await ensureDemoAuthUser()
    const clubId = await ensureDemoClub()

    await detachDemoUserFromRealData(authUser.id, clubId)
    await clearDemoClubData(clubId)
    await seedDemoUser(clubId, authUser.id)
    await seedRoles(clubId, authUser.id)
    const teams = await seedTeams(clubId, authUser.id)
    await seedFormFields(clubId, authUser.id)
    const players = await seedPlayers(clubId, teams, authUser.id)
    await seedEvaluations(clubId, players, authUser.id)
    await seedSessions(clubId, teams, players, authUser.id)
    const parentLinks = await seedParentLinks(clubId, players, authUser.id)
    await seedStaffNotes(clubId, players, authUser.id)
    await seedCommunicationLogs(clubId, players, authUser.id)
    await seedPolls(clubId, teams, players, parentLinks, authUser.id)
    await seedMatchDays(clubId, teams, players, parentLinks, authUser.id)

    return successResponse({
      email: DEMO_EMAIL,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(500, 'Demo account could not be prepared right now.')
  }
}
