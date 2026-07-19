import {
  canCreateEvaluation,
  isClubAdmin,
  isParentPortalUser,
  isSuperAdmin,
} from './auth-permissions.js'
import { PLAN_KEYS, getPlanKey, getPlanLimit, hasPlanFeature } from './plans.js'
import { isRecoveryModuleVisible } from './recovery-phase.js'
import { supabase } from './supabase-client.js'

export const ONBOARDING_EVENT = 'football-onboarding-state-changed'
export const ONBOARDING_OPEN_EVENT = 'football-onboarding-open'

export function openOnboarding() {
  window.dispatchEvent(new Event(ONBOARDING_OPEN_EVENT))
}

function asStepList(value) {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : []
}

function hasCompletedStep(user, scope, stepId) {
  const completedSteps =
    scope === 'workspace'
      ? asStepList(user?.workspaceOnboardingCompletedSteps)
      : asStepList(user?.userOnboardingCompletedSteps)

  return completedSteps.includes(stepId)
}

function getManualState(user, scope) {
  return {
    enabled: scope === 'workspace' ? user?.workspaceOnboardingEnabled !== false : user?.userOnboardingEnabled !== false,
    dismissedAt: scope === 'workspace' ? user?.workspaceOnboardingDismissedAt : user?.userOnboardingDismissedAt,
  }
}

async function safeCount(table, filters = []) {
  let query = supabase.from(table).select('id', { count: 'exact', head: true })

  filters.forEach(([column, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query = query.eq(column, value)
    }
  })

  const { count, error } = await query

  if (error) {
    console.error(error)
    return 0
  }

  return Number(count ?? 0)
}

async function loadPlayersWithParentContacts(user) {
  if (!user?.clubId) {
    return 0
  }

  let query = supabase.from('players').select('id, parent_contacts, parent_name, parent_email').eq('club_id', user.clubId)

  if (user.activeTeamId) {
    query = query.eq('team_id', user.activeTeamId)
  }

  const { data, error } = await query.limit(500)

  if (error) {
    console.error(error)
    return 0
  }

  return (data ?? []).filter((player) => {
    const contacts = Array.isArray(player.parent_contacts) ? player.parent_contacts : []
    return contacts.length > 0 || String(player.parent_name ?? '').trim() || String(player.parent_email ?? '').trim()
  }).length
}

async function safeRoleCount(user, roles = []) {
  const normalizedRoles = roles.map((role) => String(role ?? '').trim()).filter(Boolean)

  if (!user?.clubId || normalizedRoles.length === 0) {
    return 0
  }

  let query = supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', user.clubId)

  if (normalizedRoles.length === 1) {
    query = query.eq('role', normalizedRoles[0])
  } else {
    query = query.in('role', normalizedRoles)
  }

  const { count, error } = await query

  if (error) {
    console.error(error)
    return 0
  }

  return Number(count ?? 0)
}

async function safeTeamAssignmentCount(user) {
  if (!user?.clubId) {
    return 0
  }

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('id')
    .eq('club_id', user.clubId)

  if (teamsError) {
    console.error(teamsError)
    return 0
  }

  const teamIds = (teams ?? []).map((team) => team.id).filter(Boolean)

  if (teamIds.length === 0) {
    return 0
  }

  const { count, error } = await supabase
    .from('team_staff')
    .select('id', { count: 'exact', head: true })
    .in('team_id', teamIds)

  if (error) {
    console.error(error)
    return 0
  }

  return Number(count ?? 0)
}

async function safeAssignedRoleCount(user, roles = [], { activeTeamOnly = false } = {}) {
  const normalizedRoles = roles.map((role) => String(role ?? '').trim()).filter(Boolean)

  if (!user?.clubId || normalizedRoles.length === 0) {
    return 0
  }

  let teamQuery = supabase
    .from('teams')
    .select('id')
    .eq('club_id', user.clubId)

  if (activeTeamOnly && user.activeTeamId) {
    teamQuery = teamQuery.eq('id', user.activeTeamId)
  }

  const { data: teams, error: teamsError } = await teamQuery

  if (teamsError) {
    console.error(teamsError)
    return 0
  }

  const teamIds = (teams ?? []).map((team) => team.id).filter(Boolean)

  if (teamIds.length === 0) {
    return 0
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from('team_staff')
    .select('user_id')
    .in('team_id', teamIds)

  if (assignmentError) {
    console.error(assignmentError)
    return 0
  }

  const userIds = [...new Set((assignments ?? []).map((assignment) => assignment.user_id).filter(Boolean))]

  if (userIds.length === 0) {
    return 0
  }

  let userQuery = supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', user.clubId)
    .in('id', userIds)

  if (normalizedRoles.length === 1) {
    userQuery = userQuery.eq('role', normalizedRoles[0])
  } else {
    userQuery = userQuery.in('role', normalizedRoles)
  }

  const { count, error } = await userQuery

  if (error) {
    console.error(error)
    return 0
  }

  return Number(count ?? 0)
}

async function safeUserAssignedTeamCount(user) {
  if (!user?.id || !user?.clubId) {
    return 0
  }

  const { count, error } = await supabase
    .from('team_staff')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if (error) {
    console.error(error)
    return 0
  }

  return Number(count ?? 0)
}

export async function loadOnboardingSnapshot(user) {
  if (!user) {
    return {
      teams: 0,
      clubs: 0,
      staff: 0,
      players: 0,
      playersWithParentContacts: 0,
      sessions: 0,
      evaluations: 0,
      parentLinks: 0,
      polls: 0,
      matchDays: 0,
      clubAdmins: 0,
      teamAdmins: 0,
      teamAssignments: 0,
      assignedTeamAdmins: 0,
      teamCoaches: 0,
      userAssignedTeams: 0,
    }
  }

  const teamFilter = user.activeTeamId ? [['team_id', user.activeTeamId]] : []
  const clubFilter = [['club_id', user.clubId]]

  const [
    teams,
    clubs,
    staff,
    players,
    playersWithParentContacts,
    sessions,
    evaluations,
    parentLinks,
    polls,
    matchDays,
    clubAdmins,
    teamAdmins,
    teamAssignments,
    assignedTeamAdmins,
    teamCoaches,
    userAssignedTeams,
  ] = await Promise.all([
    safeCount('teams', clubFilter),
    safeCount('clubs', user.clubId ? [['id', user.clubId]] : []),
    safeCount('users', clubFilter),
    safeCount('players', [...clubFilter, ...teamFilter]),
    loadPlayersWithParentContacts(user),
    safeCount('assessment_sessions', [...clubFilter, ...teamFilter]),
    safeCount('evaluations', [...clubFilter, ...teamFilter]),
    safeCount('parent_player_links', [...clubFilter, ...teamFilter]),
    safeCount('polls', clubFilter),
    safeCount('match_days', [...clubFilter, ...teamFilter]),
    safeRoleCount(user, ['admin']),
    safeRoleCount(user, ['head_manager']),
    safeTeamAssignmentCount(user),
    safeAssignedRoleCount(user, ['head_manager'], { activeTeamOnly: false }),
    safeAssignedRoleCount(user, ['manager', 'coach', 'assistant_coach'], { activeTeamOnly: true }),
    safeUserAssignedTeamCount(user),
  ])

  return {
    teams,
    clubs,
    staff,
    players,
    playersWithParentContacts,
    sessions,
    evaluations,
    parentLinks,
    polls,
    matchDays,
    clubAdmins,
    teamAdmins,
    teamAssignments,
    assignedTeamAdmins,
    teamCoaches,
    userAssignedTeams,
  }
}

function makeStep({ actionLabel, actionType = '', complete, detail, href, id, manualLabel = '', roleKey = '', rule, targetSelector = '', title }) {
  return {
    actionLabel,
    actionType,
    complete: Boolean(complete),
    detail,
    href,
    id,
    manualLabel,
    roleKey,
    rule,
    targetSelector,
    title,
  }
}

function isClubOwnerOrAdmin(user) {
  return isClubAdmin(user)
}

function isTeamManager(user) {
  return Boolean(user?.clubId) && !isClubOwnerOrAdmin(user) && !isParentPortalUser(user) && Number(user?.roleRank ?? 0) >= 50
}

function isCoachOnly(user) {
  return Boolean(user?.clubId) && !isParentPortalUser(user) && !isClubOwnerOrAdmin(user) && !isTeamManager(user) && canCreateEvaluation(user)
}

function hasClubProfileDetails(user) {
  const hasContact = Boolean(String(user?.clubContactEmail ?? '').trim() || String(user?.clubContactPhone ?? '').trim())

  return Boolean(
    String(user?.clubName ?? '').trim() &&
      user.clubName !== 'Unassigned Club' &&
      hasContact,
  )
}

function buildClubAdminSteps(user, snapshot, scope) {
  const planKey = getPlanKey(user)
  const staffLoginLimit = getPlanLimit(user, 'staffLogins')
  const canInviteMoreStaff = staffLoginLimit === null || Number(staffLoginLimit ?? 0) > 1
  const canUseBranding = hasPlanFeature(user, 'basicBranding') || hasPlanFeature(user, 'themes')
  const needsStaffSetup = planKey !== PLAN_KEYS.individual && canInviteMoreStaff
  const steps = [
    makeStep({
      id: 'club-profile',
      title: 'Set club details',
      rule: 'Club name, logo, and contacts are shared across teams and parent communication.',
      detail: 'Set the club identity and contact details before inviting staff or parents.',
      href: '/club-settings',
      actionLabel: 'Set details',
      actionType: 'club-details',
      targetSelector: '[data-tour-id="club-profile-settings"]',
      complete: hasClubProfileDetails(user) || hasCompletedStep(user, scope, 'club-profile'),
    }),
    ...(canUseBranding
      ? [
          makeStep({
            id: 'branding-theme',
            title: 'Set branding',
            rule: 'Branding should be decided before team admins start inviting parents or creating match day updates.',
            detail: 'Set the club logo and brand defaults, or confirm the current defaults are enough for launch.',
            href: '/club-settings',
            actionLabel: 'Set branding',
            actionType: 'branding-theme',
            manualLabel: 'Defaults are fine',
            targetSelector: '[data-tour-id="club-profile-settings"]',
            complete: Boolean(user.logoUrl || user.clubLogoUrl) || hasCompletedStep(user, scope, 'branding-theme'),
          }),
        ]
      : []),
    ...(needsStaffSetup
      ? [
          makeStep({
            id: 'club-admins',
            title: 'Add club admins',
            rule: 'Club admins control club setup, teams, and staff access.',
            detail: 'Invite another club admin only if this club needs shared ownership.',
            href: '/user-access',
            actionLabel: 'Invite club admin',
            actionType: 'invite-staff',
            manualLabel: 'One admin is enough',
            roleKey: 'admin',
            targetSelector: '[data-tour-id="allocate-role-section"]',
            complete: snapshot.clubAdmins > 1 || hasCompletedStep(user, scope, 'club-admins'),
          }),
          makeStep({
            id: 'team-admins',
            title: 'Add team admins',
            rule: 'Team admins run assigned teams without changing club-wide setup.',
            detail: 'Invite team admins before assigning them to their team spaces.',
            href: '/user-access',
            actionLabel: 'Invite team admin',
            actionType: 'invite-staff',
            roleKey: 'head_manager',
            manualLabel: 'No team admins needed',
            targetSelector: '[data-tour-id="allocate-role-section"]',
            complete: snapshot.teamAdmins > 0 || hasCompletedStep(user, scope, 'team-admins'),
          }),
        ]
      : []),
    makeStep({
      id: 'first-team',
      title: snapshot.teams > 0 ? 'Manage teams' : 'Create team',
      rule: 'Teams are the containers for staff access, players, sessions, assessments, and match day.',
      detail: 'Create, review, edit, or delete team records before team admins start work.',
      href: '/teams',
      actionLabel: snapshot.teams > 0 ? 'Manage teams' : 'Create team',
      actionType: 'manage-teams',
      targetSelector: '[data-tour-id="create-team-section"]',
      complete: snapshot.teams > 0 || hasCompletedStep(user, scope, 'first-team'),
    }),
    ...(needsStaffSetup
      ? [
          makeStep({
            id: 'assign-team-admin',
            title: 'Assign team admin',
            rule: 'A team admin should only see the team or teams they are responsible for.',
            detail: 'Choose a team and attach the correct team admin account.',
            href: '/teams',
            actionLabel: 'Assign admin',
            actionType: 'assign-team-admin',
            manualLabel: 'Assign later',
            targetSelector: '[data-tour-id="team-staff-section"]',
            complete: snapshot.assignedTeamAdmins > 0 || hasCompletedStep(user, scope, 'assign-team-admin'),
          }),
        ]
      : []),
    makeStep({
      id: 'review',
      title: 'Review club setup',
      rule: 'Club setup is ready when the club identity, teams, and staff ownership are clear.',
      detail: 'Review the club setup before handing team, player, and assessment work to team admins and coaches.',
      href: '/feedback/new',
      actionLabel: 'Review setup',
      actionType: 'review-setup',
      complete: hasCompletedStep(user, scope, 'review'),
    }),
    makeStep({
      id: 'tester-feedback',
      title: 'Tester feedback',
      rule: 'Feedback should go through the staging feedback form.',
      detail: 'Open the feedback form if anything in setup was confusing or broken.',
      href: '/feedback/new?route=/club-admin-setup',
      actionLabel: 'Report issue',
      actionType: 'feedback-handoff',
      targetSelector: '[data-tour-id="tester-feedback-form"]',
      complete: hasCompletedStep(user, scope, 'tester-feedback'),
      manualLabel: 'No feedback now',
    }),
  ]

  return steps
}

function buildTeamManagerSteps(user, snapshot, scope) {
  return [
    makeStep({
      id: 'assigned-team',
      title: 'Confirm assigned team',
      rule: 'Team managers work inside teams the club has assigned to them.',
      detail: 'Open the team workspace and confirm the team selector is correct.',
      href: '/coach',
      actionLabel: 'Open team',
      actionType: 'confirm-team',
      complete: Boolean(user.activeTeamId || user.activeTeamName) || hasCompletedStep(user, scope, 'assigned-team'),
    }),
    makeStep({
      id: 'team-staff',
      title: 'Add managers and coaches',
      rule: 'Managers and coaches should be assigned to this team only.',
      detail: 'Invite managers and coaches who can add players, run sessions, and perform assessments.',
      href: '/teams',
      actionLabel: 'Invite staff',
      actionType: 'invite-team-staff',
      manualLabel: 'No extra staff needed',
      complete: snapshot.teamCoaches > 0 || hasCompletedStep(user, scope, 'team-staff'),
    }),
    makeStep({
      id: 'team-squad',
      title: 'Check squad',
      rule: 'Sessions, match day, parent updates, and development records need current players.',
      detail: 'Add missing players or confirm the imported squad.',
      href: '/players/current',
      actionLabel: 'Add player',
      actionType: 'add-player',
      complete: snapshot.players > 0 || hasCompletedStep(user, scope, 'team-squad'),
    }),
    makeStep({
      id: 'team-session',
      title: 'Create team session',
      rule: 'A team session gives attendance and notes a real football context.',
      detail: 'Create the next training session for this team.',
      href: '/sessions/start',
      actionLabel: 'Create session',
      actionType: 'create-session',
      complete: snapshot.sessions > 0 || hasCompletedStep(user, scope, 'team-session'),
    }),
    makeStep({
      id: 'team-assessment',
      title: 'Perform assessments',
      rule: 'Assessment work starts from a real session and the current team squad.',
      detail: 'Create the first assessment context, then score players from the assessment workspace.',
      href: '/sessions/start',
      actionLabel: 'Set up assessment',
      actionType: 'create-assessment',
      manualLabel: 'Assess later',
      complete: snapshot.evaluations > 0 || hasCompletedStep(user, scope, 'team-assessment'),
    }),
    makeStep({
      id: 'team-match-day',
      title: 'Prepare match day',
      rule: 'Team managers can keep fixtures, squads, scorers, and player of the match data in one place.',
      detail: 'Create the next fixture or mark this step done if this team is training only.',
      href: '/match-day',
      actionLabel: 'Create fixture',
      actionType: 'create-fixture',
      manualLabel: 'Training only for now',
      complete: snapshot.matchDays > 0 || hasCompletedStep(user, scope, 'team-match-day'),
    }),
    ...(hasPlanFeature(user, 'parentEmail') && isRecoveryModuleVisible('parentInvites', { user })
      ? [
          makeStep({
            id: 'team-parent-contacts',
            title: 'Send parent invite',
            rule: 'Parent communication only works from saved squad player contacts.',
            detail: 'Choose a squad player and send the first parent portal invite to a saved parent or guardian email.',
            href: '/parent-linking',
            actionLabel: 'Send invite',
            actionType: 'send-parent-invite',
            manualLabel: 'Invite parents later',
            complete: snapshot.parentLinks > 0 || hasCompletedStep(user, scope, 'team-parent-contacts'),
          }),
        ]
      : []),
  ].filter((step) => step.id !== 'team-match-day' || isRecoveryModuleVisible('matchDay', { user }))
}

function buildCoachSteps(user, snapshot, scope) {
  return [
    makeStep({
      id: 'coach-team',
      title: 'Confirm team access',
      rule: 'Coaches work only inside teams assigned by a team admin or club admin.',
      detail: 'Confirm the team selector before adding players or recording football activity.',
      href: '/coach',
      actionLabel: 'Open team',
      actionType: 'confirm-team',
      complete: Boolean(user.activeTeamId || user.activeTeamName) || hasCompletedStep(user, scope, 'coach-team'),
    }),
    makeStep({
      id: 'coach-players',
      title: 'Add or update players',
      rule: 'Player records must exist before sessions and assessments can be useful.',
      detail: 'Add a player if your role allows it, or open the squad to review the records.',
      href: '/players/current',
      actionLabel: 'Add player',
      actionType: 'add-player',
      complete: snapshot.players > 0 || hasCompletedStep(user, scope, 'coach-players'),
    }),
    makeStep({
      id: 'coach-session',
      title: 'Run a session',
      rule: 'Sessions are the coach workspace for attendance, notes, and development context.',
      detail: 'Create the next training or match session for this team.',
      href: '/sessions/start',
      actionLabel: 'Create session',
      actionType: 'create-session',
      complete: snapshot.sessions > 0 || hasCompletedStep(user, scope, 'coach-session'),
    }),
    makeStep({
      id: 'coach-assessment',
      title: 'Perform assessments',
      rule: 'Assessments should use the current squad and a real football session.',
      detail: 'Set up the assessment context, then score players from the assessment workspace.',
      href: '/sessions/start',
      actionLabel: 'Set up assessment',
      actionType: 'create-assessment',
      manualLabel: 'Assess later',
      complete: snapshot.evaluations > 0 || hasCompletedStep(user, scope, 'coach-assessment'),
    }),
  ]
}

export function buildOnboardingPlan(user, snapshot = {}) {
  if (!user) {
    return null
  }

  if (isSuperAdmin(user)) {
    const scope = 'user'
    const manualState = getManualState(user, scope)

    return {
      description: 'Check platform controls, support routes, tester access, and billing operations before managing live clubs.',
      firstAction: '/platform-admin',
      scope,
      title: 'Platform admin first run',
      manualState,
      steps: [
        makeStep({
          id: 'platform-overview',
          title: 'Review platform dashboard',
          rule: 'Platform admins manage clubs without exposing player personal details.',
          detail: 'Open the dashboard and confirm live operational numbers are loading.',
          href: '/platform-admin',
          actionLabel: 'Open dashboard',
          complete: snapshot.clubs > 0 || hasCompletedStep(user, scope, 'platform-overview'),
        }),
        makeStep({
          id: 'club-management',
          title: 'Check club management',
          rule: 'Club status, access, and plan controls affect real workspaces.',
          detail: 'Open club management before making support or billing changes.',
          href: '/platform-clubs',
          actionLabel: 'Open clubs',
          complete: hasCompletedStep(user, scope, 'club-management'),
        }),
        makeStep({
          id: 'billing-controls',
          title: 'Check billing controls',
          rule: 'Plan changes, comped access, and promotions can change what clubs can use.',
          detail: 'Open platform billing and confirm the available controls.',
          href: '/platform-billing-options',
          actionLabel: 'Open billing',
          complete: hasCompletedStep(user, scope, 'billing-controls'),
        }),
        makeStep({
          id: 'feedback-support',
          title: 'Check feedback support',
          rule: 'Platform feedback is operational support data, not a public feature tour.',
          detail: 'Open feedback so support requests have an owner and status.',
          href: '/platform-feedback',
          actionLabel: 'Open feedback',
          complete: hasCompletedStep(user, scope, 'feedback-support'),
        }),
      ],
    }
  }

  if (isParentPortalUser(user)) {
    if (!isRecoveryModuleVisible('parentPortal', { user })) {
      return null
    }

    const scope = 'user'
    const manualState = getManualState(user, scope)

    return {
      description: 'Confirm the child link, contact route, and the places parents must check each week.',
      firstAction: '/parent-portal',
      scope,
      title: 'Parent first run',
      manualState,
      steps: [
        makeStep({
          id: 'child-link',
          title: 'Check child link',
          rule: 'Parent accounts only see linked players. Staff notes stay private unless shared.',
          detail: 'Open the portal and check the child shown is correct.',
          href: '/parent-portal',
          actionLabel: 'Open portal',
          complete: (user.parentPortalLinks ?? []).length > 0 || hasCompletedStep(user, scope, 'child-link'),
        }),
        makeStep({
          id: 'messages',
          title: 'Know where messages land',
          rule: 'Club messages and match updates are controlled by staff. Replies may be limited.',
          detail: 'Open messages so parents know where official updates live.',
          href: '/parent-chat',
          actionLabel: 'Open messages',
          complete: hasCompletedStep(user, scope, 'messages'),
        }),
        makeStep({
          id: 'polls-and-match-day',
          title: 'Check polls and match day',
          rule: 'Availability, votes, and match details are child-specific.',
          detail: 'Use Polls and Match Day before training or fixtures.',
          href: '/parent-polls',
          actionLabel: 'Open polls',
          complete: hasCompletedStep(user, scope, 'polls-and-match-day'),
        }),
      ],
    }
  }

  if (isClubOwnerOrAdmin(user)) {
    const scope = 'workspace'
    const manualState = getManualState(user, scope)
    const planKey = getPlanKey(user)

    return {
      description: planKey === PLAN_KEYS.singleTeam || planKey === PLAN_KEYS.individual
        ? 'Set up club details, one team, and the team admin who will run it.'
        : 'Set up club details, branding, club admins, team admins, teams, and team assignments.',
      firstAction: '/club-settings',
      scope,
      title: 'Club launch setup',
      manualState,
      steps: buildClubAdminSteps(user, snapshot, scope),
    }
  }

  if (isTeamManager(user)) {
    const scope = 'user'
    const manualState = getManualState(user, scope)

    if (!user.activeTeamId && Number(snapshot.userAssignedTeams ?? 0) === 0) {
      return {
        description: 'This team admin account is active, but a club admin needs to assign a team before setup can continue.',
        firstAction: '/coach',
        kind: 'waiting',
        manualState,
        scope,
        title: 'Waiting for team assignment',
        steps: buildTeamManagerSteps(user, snapshot, scope),
      }
    }

    return {
      description: 'Confirm the assigned team is ready for this week without changing club-wide setup.',
      firstAction: user.activeTeamId ? '/players/current' : '/coach',
      scope,
      title: 'Team setup',
      manualState,
      steps: buildTeamManagerSteps(user, snapshot, scope),
    }
  }

  if (isCoachOnly(user) && !user.activeTeamId) {
    const scope = 'user'
    const manualState = getManualState(user, scope)

    if (Number(snapshot.userAssignedTeams ?? 0) === 0) {
      return {
        description: 'This coach account is active, but a team admin needs to assign a team before useful work can start.',
        firstAction: '/coach',
        kind: 'waiting',
        manualState,
        scope,
        title: 'Waiting for team assignment',
        steps: buildCoachSteps(user, snapshot, scope),
      }
    }
  }

  if (isCoachOnly(user)) {
    const scope = 'user'
    const manualState = getManualState(user, scope)

    return {
      description: 'Use only the coach tools assigned to this team.',
      firstAction: '/coach',
      scope,
      title: 'Coach setup',
      manualState,
      steps: buildCoachSteps(user, snapshot, scope),
    }
  }

  return null
}

export function getOnboardingProgress(plan) {
  const steps = plan?.steps ?? []
  const completedCount = steps.filter((step) => step.complete).length
  const totalCount = steps.length

  return {
    completedCount,
    isComplete: totalCount > 0 && completedCount >= totalCount,
    totalCount,
  }
}

export async function saveOnboardingStep({ scope, stepId, user }) {
  if (!user?.id || !stepId) {
    return
  }

  const completedSteps =
    scope === 'workspace'
      ? asStepList(user.workspaceOnboardingCompletedSteps)
      : asStepList(user.userOnboardingCompletedSteps)
  const nextSteps = Array.from(new Set([...completedSteps, stepId]))

  if (scope === 'workspace' && user.clubId) {
    const { error } = await supabase
      .from('clubs')
      .update({
        onboarding_completed_steps: nextSteps,
        onboarding_dismissed_at: null,
      })
      .eq('id', user.clubId)

    if (error) {
      throw error
    }
  } else {
    const { error } = await supabase.rpc('update_own_onboarding_state', {
      onboarding_operation: 'complete_step',
      onboarding_step_id: stepId,
    })

    if (error) {
      throw error
    }
  }

  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT))
}

export async function dismissOnboarding({ scope, user }) {
  if (!user?.id) {
    return
  }

  const payload = {
    onboarding_dismissed_at: new Date().toISOString(),
  }

  if (scope === 'workspace' && user.clubId) {
    const { error } = await supabase.from('clubs').update(payload).eq('id', user.clubId)
    if (error) {
      throw error
    }
  } else {
    const { error } = await supabase.rpc('update_own_onboarding_state', {
      onboarding_operation: 'dismiss',
    })
    if (error) {
      throw error
    }
  }

  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT))
}

export async function reopenOnboarding({ scope, user }) {
  if (!user?.id) {
    return
  }

  const payload = {
    onboarding_dismissed_at: null,
    onboarding_enabled: true,
  }

  if (scope === 'workspace' && user.clubId) {
    const { error } = await supabase.from('clubs').update(payload).eq('id', user.clubId)
    if (error) {
      throw error
    }
  } else {
    const { error } = await supabase.rpc('update_own_onboarding_state', {
      onboarding_operation: 'reopen',
    })
    if (error) {
      throw error
    }
  }

  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT))
}

export async function resetOnboarding({ scope, user }) {
  if (!user?.id) {
    return
  }

  const payload = {
    onboarding_completed_steps: [],
    onboarding_dismissed_at: null,
    onboarding_enabled: true,
    onboarding_reset_at: new Date().toISOString(),
  }

  if (scope === 'workspace' && user.clubId) {
    const { error } = await supabase.from('clubs').update(payload).eq('id', user.clubId)
    if (error) {
      throw error
    }
  } else {
    const { error } = await supabase.rpc('update_own_onboarding_state', {
      onboarding_operation: 'reset',
    })
    if (error) {
      throw error
    }
  }

  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT))
}
