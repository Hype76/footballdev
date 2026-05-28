import {
  canCreateEvaluation,
  isClubAdmin,
  isParentPortalUser,
  isSuperAdmin,
} from './auth-permissions.js'
import { PLAN_KEYS, getPlanKey, getPlanLimit, hasPlanFeature } from './plans.js'
import { supabase } from './supabase-client.js'

export const ONBOARDING_EVENT = 'football-onboarding-state-changed'

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
  ] = await Promise.all([
    safeCount('teams', clubFilter),
    safeCount('clubs', user.clubId ? [['id', user.clubId]] : []),
    safeCount('users', clubFilter),
    safeCount('players', [...clubFilter, ...teamFilter]),
    loadPlayersWithParentContacts(user),
    safeCount('assessment_sessions', [...clubFilter, ...teamFilter]),
    safeCount('evaluations', [...clubFilter, ...teamFilter]),
    safeCount('parent_player_links', clubFilter),
    safeCount('polls', clubFilter),
    safeCount('match_days', clubFilter),
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
  }
}

function makeStep({ actionLabel, complete, detail, href, id, manualLabel = '', rule, title }) {
  return {
    actionLabel,
    complete: Boolean(complete),
    detail,
    href,
    id,
    manualLabel,
    rule,
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

function shouldIncludeParentSetup(user) {
  return hasPlanFeature(user, 'parentEmail')
}

function shouldIncludeStaffSetup(user) {
  const staffLimit = getPlanLimit(user, 'staffLogins')
  return staffLimit === null || Number(staffLimit ?? 0) > 1
}

function buildClubAdminSteps(user, snapshot, scope) {
  const planKey = getPlanKey(user)
  const isSingleTeam = planKey === PLAN_KEYS.individual || planKey === PLAN_KEYS.singleTeam
  const steps = [
    makeStep({
      id: 'club-profile',
      title: 'Confirm club profile',
      rule: 'Club name, logo, and contacts are shared across teams and parent communication.',
      detail: 'Check the club identity before inviting staff or parents.',
      href: '/club-settings',
      actionLabel: 'Open settings',
      complete: Boolean(user.clubName && user.clubName !== 'Unassigned Club') || hasCompletedStep(user, scope, 'club-profile'),
    }),
    makeStep({
      id: 'first-team',
      title: snapshot.teams > 0 ? (isSingleTeam ? 'Confirm the team' : 'Confirm teams') : (isSingleTeam ? 'Create the team' : 'Create first teams'),
      rule: isSingleTeam
        ? 'This tier runs one team, so setup should confirm the assigned squad rather than create a multi-team structure.'
        : 'Players, sessions, staff access, and match day records need team spaces.',
      detail: isSingleTeam
        ? 'Create or confirm the single team before adding players and sessions.'
        : 'Create the first teams or confirm the imported team list.',
      href: '/teams',
      actionLabel: snapshot.teams > 0 ? 'Open teams' : 'Create team',
      complete: snapshot.teams > 0 || hasCompletedStep(user, scope, 'first-team'),
    }),
  ]

  if (shouldIncludeStaffSetup(user)) {
    steps.push(makeStep({
      id: 'staff-access',
      title: 'Add staff access',
      rule: 'Coaches only see the teams and tools their role allows.',
      detail: 'Add staff or confirm the first admin account is enough for testing.',
      href: '/user-access',
      actionLabel: 'Open access',
      manualLabel: 'Admin only for now',
      complete: snapshot.staff > 1 || hasCompletedStep(user, scope, 'staff-access'),
    }))
  }

  steps.push(
    makeStep({
      id: 'players',
      title: 'Add players',
      rule: 'Parent links, sessions, match day, and development records all start from player records.',
      detail: 'Add one player or import the first squad.',
      href: '/add-player',
      actionLabel: 'Add player',
      complete: snapshot.players > 0 || hasCompletedStep(user, scope, 'players'),
    }),
    makeStep({
      id: 'first-session',
      title: 'Create first session',
      rule: 'Attendance and player notes need a real training or match session.',
      detail: 'Create the next training session and attach the relevant players.',
      href: '/sessions/start',
      actionLabel: 'Create session',
      complete: snapshot.sessions > 0 || hasCompletedStep(user, scope, 'first-session'),
    }),
    makeStep({
      id: 'first-match',
      title: 'Create first match day',
      rule: 'Match day should collect squads, scorers, minutes, and parent updates.',
      detail: 'Create the next fixture or mark this step done if the club is training only.',
      href: '/match-day',
      actionLabel: 'Open match day',
      manualLabel: 'Training only for now',
      complete: snapshot.matchDays > 0 || hasCompletedStep(user, scope, 'first-match'),
    }),
  )

  if (shouldIncludeParentSetup(user)) {
    steps.push(
      makeStep({
        id: 'parent-contacts',
        title: 'Add parent contacts',
        rule: 'Parents cannot receive invites or updates until contacts exist on player records.',
        detail: 'Add at least one parent or guardian contact.',
        href: '/players/current',
        actionLabel: 'Open players',
        complete: snapshot.playersWithParentContacts > 0 || hasCompletedStep(user, scope, 'parent-contacts'),
      }),
      makeStep({
        id: 'parent-invites',
        title: 'Invite parents',
        rule: 'Parents need their own portal access. Do not share staff logins with parents.',
        detail: 'Send the first parent invite or confirm parent access is not used yet.',
        href: '/parent-linking',
        actionLabel: 'Open linking',
        manualLabel: 'No parent access yet',
        complete: snapshot.parentLinks > 0 || hasCompletedStep(user, scope, 'parent-invites'),
      }),
    )
  }

  if (!isSingleTeam && hasPlanFeature(user, 'themes')) {
    steps.push(makeStep({
      id: 'branding-theme',
      title: 'Confirm club branding',
      rule: 'Small Club and higher tiers can carry club branding and team themes across the workspace.',
      detail: 'Set the club badge, colours, or confirm defaults before wider rollout.',
      href: '/club-settings',
      actionLabel: 'Open branding',
      manualLabel: 'Defaults are fine',
      complete: Boolean(user.logoUrl || user.clubLogoUrl) || hasCompletedStep(user, scope, 'branding-theme'),
    }))
  }

  if (!isSingleTeam && hasPlanFeature(user, 'auditLogs')) {
    steps.push(makeStep({
      id: 'audit-check',
      title: 'Review activity controls',
      rule: 'Audit logs help managers check who changed player, staff, and parent records.',
      detail: 'Open activity logs once so admins know where accountability checks live.',
      href: '/activity-log',
      actionLabel: 'Open activity',
      manualLabel: 'Review later',
      complete: hasCompletedStep(user, scope, 'audit-check'),
    }))
  }

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
      complete: Boolean(user.activeTeamId || user.activeTeamName) || hasCompletedStep(user, scope, 'assigned-team'),
    }),
    makeStep({
      id: 'team-squad',
      title: 'Check squad',
      rule: 'Sessions, match day, parent updates, and development records need current players.',
      detail: 'Add missing players or confirm the imported squad.',
      href: snapshot.players > 0 ? '/players/current' : '/add-player',
      actionLabel: snapshot.players > 0 ? 'Open squad' : 'Add player',
      complete: snapshot.players > 0 || hasCompletedStep(user, scope, 'team-squad'),
    }),
    makeStep({
      id: 'team-session',
      title: 'Create team session',
      rule: 'A team session gives attendance and notes a real football context.',
      detail: 'Create the next training session for this team.',
      href: '/sessions/start',
      actionLabel: 'Create session',
      complete: snapshot.sessions > 0 || hasCompletedStep(user, scope, 'team-session'),
    }),
    makeStep({
      id: 'team-match-day',
      title: 'Prepare match day',
      rule: 'Team managers can keep fixtures, squads, scorers, and player of the match data in one place.',
      detail: 'Create the next fixture or mark this step done if this team is training only.',
      href: '/match-day',
      actionLabel: 'Open match day',
      manualLabel: 'Training only for now',
      complete: snapshot.matchDays > 0 || hasCompletedStep(user, scope, 'team-match-day'),
    }),
    ...(shouldIncludeParentSetup(user)
      ? [
          makeStep({
            id: 'team-parent-contacts',
            title: 'Check parent contacts',
            rule: 'Parent communication only works when player contact details exist.',
            detail: 'Confirm parent or guardian contact details for the team squad.',
            href: '/players/current',
            actionLabel: 'Open players',
            complete: snapshot.playersWithParentContacts > 0 || hasCompletedStep(user, scope, 'team-parent-contacts'),
          }),
        ]
      : []),
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
          href: '/parent-messages',
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
        ? 'Set up the single-team workspace so coaches and parents can use it this week.'
        : 'Set up enough club data that teams, coaches, and parents can use the workspace this week.',
      firstAction: snapshot.teams > 0 ? '/add-player' : '/teams',
      scope,
      title: 'Club launch setup',
      manualState,
      steps: buildClubAdminSteps(user, snapshot, scope),
    }
  }

  if (isTeamManager(user)) {
    const scope = 'user'
    const manualState = getManualState(user, scope)

    return {
      description: 'Confirm the assigned team is ready for this week without changing club-wide setup.',
      firstAction: user.activeTeamId ? '/players/current' : '/coach',
      scope,
      title: 'Team manager setup',
      manualState,
      steps: buildTeamManagerSteps(user, snapshot, scope),
    }
  }

  if (isCoachOnly(user) && (!user.activeTeamId || snapshot.players === 0)) {
    return {
      description: 'This account is ready for coach work, but the assigned team still needs admin setup before useful records can be created.',
      firstAction: '/coach',
      kind: 'waiting',
      title: 'Waiting for team setup',
      steps: [],
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
    const { error } = await supabase
      .from('users')
      .update({
        onboarding_completed_steps: nextSteps,
        onboarding_dismissed_at: null,
      })
      .eq('id', user.id)

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
    const { error } = await supabase.from('users').update(payload).eq('id', user.id)
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
    const { error } = await supabase.from('users').update(payload).eq('id', user.id)
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
    const { error } = await supabase.from('users').update(payload).eq('id', user.id)
    if (error) {
      throw error
    }
  }

  window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT))
}
