import process from 'node:process'
import { supabaseAdmin } from './_supabase.js'

const DEMO_EMAIL = 'demo@playerfeedback.online'
const DEMO_PASSWORD = 'Demo12345!'
const DEMO_CLUB_NAME = 'Player Feedback Demo Club'
const DEMO_USER_NAME = 'Demo User'

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

async function ensureDemoClub(authUserId) {
  const { data: existingProfile } = await supabaseAdmin
    .from('users')
    .select('club_id')
    .eq('id', authUserId)
    .maybeSingle()

  let clubId = existingProfile?.club_id || ''

  if (!clubId) {
    const { data: existingClub } = await supabaseAdmin
      .from('clubs')
      .select('id')
      .eq('name', DEMO_CLUB_NAME)
      .maybeSingle()

    clubId = existingClub?.id || ''
  }

  if (!clubId) {
    const insertedClub = await throwOnError(
      await supabaseAdmin
        .from('clubs')
        .insert({
          name: DEMO_CLUB_NAME,
          contact_email: 'info@playerfeedback.online',
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
        contact_email: 'info@playerfeedback.online',
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

async function clearDemoClubData(clubId) {
  const { data: sessions } = await supabaseAdmin
    .from('assessment_sessions')
    .select('id')
    .eq('club_id', clubId)

  const sessionIds = (sessions || []).map((session) => session.id)

  if (sessionIds.length > 0) {
    await supabaseAdmin.from('assessment_session_games').delete().in('session_id', sessionIds)
    await supabaseAdmin.from('assessment_session_players').delete().in('session_id', sessionIds)
  }

  const { data: teams } = await supabaseAdmin.from('teams').select('id').eq('club_id', clubId)
  const teamIds = (teams || []).map((team) => team.id)

  if (teamIds.length > 0) {
    await supabaseAdmin.from('team_staff').delete().in('team_id', teamIds)
  }

  await Promise.all([
    supabaseAdmin.from('assessment_sessions').delete().eq('club_id', clubId),
    supabaseAdmin.from('evaluations').delete().eq('club_id', clubId),
    supabaseAdmin.from('player_staff_notes').delete().eq('club_id', clubId),
    supabaseAdmin.from('communication_logs').delete().eq('club_id', clubId),
    supabaseAdmin.from('audit_logs').delete().eq('club_id', clubId),
    supabaseAdmin.from('record_backups').delete().eq('club_id', clubId),
    supabaseAdmin.from('players').delete().eq('club_id', clubId),
    supabaseAdmin.from('form_fields').delete().eq('club_id', clubId),
    supabaseAdmin.from('club_roles').delete().eq('club_id', clubId),
    supabaseAdmin.from('club_user_invites').delete().eq('club_id', clubId),
    supabaseAdmin.from('teams').delete().eq('club_id', clubId),
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
    team_name: 'U12 Demo',
    club_name: DEMO_CLUB_NAME,
    reply_to_email: 'info@playerfeedback.online',
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
        created_by: authUserId,
        created_by_name: DEMO_USER_NAME,
        created_by_email: DEMO_EMAIL,
      },
      { onConflict: 'auth_user_id,club_id' },
    ),
    'Could not seed demo membership',
  )
}

async function seedTeams(clubId, actorId) {
  const teamNames = ['U12 Demo', 'U14 Demo', 'U16 Demo']
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
  const u12 = teams.find((team) => team.name === 'U12 Demo') || teams[0]
  const u14 = teams.find((team) => team.name === 'U14 Demo') || teams[0]
  const rows = [
    ['Leo Carter', 'Trial', u12, ['Striker', 'Winger'], 'Sam Carter', 'sam.carter@example.com'],
    ['Mason Hill', 'Trial', u12, ['CM'], 'Rachel Hill', 'rachel.hill@example.com'],
    ['Noah Brooks', 'Trial', u14, ['CB'], 'Daniel Brooks', 'daniel.brooks@example.com'],
    ['Oliver Reed', 'Trial', u14, ['GK'], 'Amelia Reed', 'amelia.reed@example.com'],
    ['Ethan Clarke', 'Squad', u12, ['Winger'], 'Sarah Clarke', 'sarah.clarke@example.com'],
    ['Finn Saunders', 'Squad', u12, ['CM', 'CDM'], 'Jon Saunders', 'jon.saunders@example.com'],
    ['Freddie Norman', 'Squad', u14, ['ST'], 'Dave Norman', 'dave.norman@example.com'],
    ['Brendan Templeton', 'Squad', u14, ['LB'], 'Louise Templeton', 'louise.templeton@example.com'],
  ]

  const insertedPlayers = await throwOnError(
    await supabaseAdmin
      .from('players')
      .insert(
        rows.map(([playerName, section, team, positions, parentName, parentEmail]) => ({
          club_id: clubId,
          player_name: playerName,
          section,
          team: team.name,
          parent_name: parentName,
          parent_email: parentEmail,
          parent_contacts: [{ name: parentName, email: parentEmail }],
          positions,
          status: section === 'Squad' ? 'promoted' : 'active',
          notes: `${playerName} is demo data and can be edited safely.`,
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
        })),
      )
      .select('id,player_name,section,team,parent_name,parent_email,parent_contacts'),
    'Could not seed demo players',
  )

  return insertedPlayers.map((player) => ({
    ...player,
    team_id: teams.find((team) => team.name === player.team)?.id || '',
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
  const evaluationSeeds = [
    {
      player: 'Leo Carter',
      values: {
        technical: 4,
        tactical: 3,
        physical: 5,
        mentality: 4,
        coachability: 4,
        strengths: 'Explosive pace and positive attitude.',
        improvements: 'Needs to scan earlier before receiving.',
        overall: 'Strong trial performance with clear attacking threat.',
      },
    },
    {
      player: 'Mason Hill',
      values: {
        technical: 3,
        tactical: 4,
        physical: 3,
        mentality: 4,
        coachability: 5,
        strengths: 'Listens well and adapts quickly.',
        improvements: 'Can be braver playing forward passes.',
        overall: 'Good base to build from in midfield.',
      },
    },
    {
      player: 'Ethan Clarke',
      values: {
        technical: 4,
        tactical: 4,
        physical: 4,
        mentality: 5,
        coachability: 4,
        strengths: 'Reliable squad player with strong work rate.',
        improvements: 'Final delivery can be more consistent.',
        overall: 'Good squad contribution across sessions.',
      },
    },
  ]

  await throwOnError(
    await supabaseAdmin.from('evaluations').insert(
      evaluationSeeds.map((seed, index) => {
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
          session: index === 2 ? 'Training | 2026-05-01' : 'Trial | 2026-05-01',
          date: '01/05/2026',
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
        }
      }),
    ),
    'Could not seed demo evaluations',
  )
}

async function seedSessions(clubId, teams, players, actorId) {
  const u12 = teams.find((team) => team.name === 'U12 Demo') || teams[0]
  const u14 = teams.find((team) => team.name === 'U14 Demo') || teams[0]
  const sessionRows = [
    {
      team: u12,
      opponent: '',
      session_date: '2026-05-02',
      title: 'U12 Demo Training',
      session_type: 'training',
      status: 'open',
    },
    {
      team: u14,
      opponent: 'City Juniors',
      session_date: '2026-05-03',
      title: 'U14 Demo vs City Juniors',
      session_type: 'match',
      status: 'open',
    },
    {
      team: u12,
      opponent: 'Spring Cup',
      session_date: '2026-05-04',
      title: 'U12 Demo Spring Cup',
      session_type: 'tournament',
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

  const tournamentSession = sessions.find((session) => session.session_type === 'tournament')

  if (tournamentSession) {
    await throwOnError(
      await supabaseAdmin.from('assessment_session_games').insert([
        {
          session_id: tournamentSession.id,
          club_id: clubId,
          opponent: 'Rovers',
          team_score: 2,
          opponent_score: 1,
          notes: 'High tempo opening game.',
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
        },
        {
          session_id: tournamentSession.id,
          club_id: clubId,
          opponent: 'United',
          team_score: 1,
          opponent_score: 1,
          notes: 'Good recovery after conceding first.',
          created_by: actorId,
          created_by_name: DEMO_USER_NAME,
          created_by_email: DEMO_EMAIL,
        },
      ]),
      'Could not seed demo tournament games',
    )
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

    const authUser = await ensureDemoAuthUser()
    const clubId = await ensureDemoClub(authUser.id)

    await clearDemoClubData(clubId)
    await seedDemoUser(clubId, authUser.id)
    await seedRoles(clubId, authUser.id)
    const teams = await seedTeams(clubId, authUser.id)
    await seedFormFields(clubId, authUser.id)
    const players = await seedPlayers(clubId, teams, authUser.id)
    await seedEvaluations(clubId, players, authUser.id)
    await seedSessions(clubId, teams, players, authUser.id)

    return successResponse({
      email: DEMO_EMAIL,
    })
  } catch (error) {
    console.error(error)
    return failureResponse(500, 'Demo account could not be prepared right now.')
  }
}
