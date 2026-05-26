import {
  canCreateEvaluation,
  canManageClubSettings,
  canManageTeamSettings,
  isParentPortalUser,
  isSuperAdmin,
} from './auth-permissions.js'
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

function makeStep({ actionLabel, complete, detail, href, id, rule, title }) {
  return {
    actionLabel,
    complete: Boolean(complete),
    detail,
    href,
    id,
    rule,
    title,
  }
}

export function buildOnboardingPlan(user, snapshot = {}) {
  if (!user || isSuperAdmin(user)) {
    return null
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

  if (canManageClubSettings(user) || canManageTeamSettings(user)) {
    const scope = 'workspace'
    const manualState = getManualState(user, scope)

    return {
      description: 'Set up enough club data that coaches and parents can use the workspace this week.',
      firstAction: snapshot.teams > 0 ? '/add-player' : '/teams',
      scope,
      title: 'Club launch setup',
      manualState,
      steps: [
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
          title: 'Create first team',
          rule: 'Players, sessions, staff access, and match day records need a team.',
          detail: 'Create the first team or confirm the imported team list.',
          href: '/teams',
          actionLabel: 'Open teams',
          complete: snapshot.teams > 0 || hasCompletedStep(user, scope, 'first-team'),
        }),
        makeStep({
          id: 'staff-access',
          title: 'Add staff access',
          rule: 'Coaches only see the teams and tools their role allows.',
          detail: 'Add staff or confirm the first admin account is enough for testing.',
          href: '/user-access',
          actionLabel: 'Open access',
          complete: snapshot.staff > 1 || hasCompletedStep(user, scope, 'staff-access'),
        }),
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
          id: 'parent-contacts',
          title: 'Add parent contacts',
          rule: 'Parents cannot receive invites or updates until contacts exist on player records.',
          detail: 'Add at least one parent or guardian contact.',
          href: '/players/current',
          actionLabel: 'Open players',
          complete: snapshot.playersWithParentContacts > 0 || hasCompletedStep(user, scope, 'parent-contacts'),
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
          complete: snapshot.matchDays > 0 || hasCompletedStep(user, scope, 'first-match'),
        }),
        makeStep({
          id: 'parent-invites',
          title: 'Invite parents',
          rule: 'Parents need their own portal access. Do not share staff logins with parents.',
          detail: 'Send the first parent invite or confirm parent access is not used yet.',
          href: '/parent-linking',
          actionLabel: 'Open linking',
          complete: snapshot.parentLinks > 0 || hasCompletedStep(user, scope, 'parent-invites'),
        }),
      ],
    }
  }

  if (canCreateEvaluation(user)) {
    const scope = 'user'
    const manualState = getManualState(user, scope)

    return {
      description: 'Open the assigned team, start a session, and record the first useful player note.',
      firstAction: user.activeTeamId ? '/sessions/start' : '/coach',
      scope,
      title: 'Coach first run',
      manualState,
      steps: [
        makeStep({
          id: 'assigned-team',
          title: 'Check assigned team',
          rule: 'You only work inside teams your club admin has assigned to you.',
          detail: 'Confirm the team selector shows the correct squad.',
          href: '/coach',
          actionLabel: 'Open home',
          complete: Boolean(user.activeTeamId || user.activeTeamName) || hasCompletedStep(user, scope, 'assigned-team'),
        }),
        makeStep({
          id: 'players',
          title: 'Review players',
          rule: 'Coach notes, development records, and parent summaries attach to player records.',
          detail: 'Open the current players list before starting session work.',
          href: '/players/current',
          actionLabel: 'Open players',
          complete: snapshot.players > 0 || hasCompletedStep(user, scope, 'players'),
        }),
        makeStep({
          id: 'session',
          title: 'Open or create session',
          rule: 'A session gives attendance, notes, and development records a real football context.',
          detail: 'Open the next training session or create one.',
          href: '/sessions/start',
          actionLabel: 'Open sessions',
          complete: snapshot.sessions > 0 || hasCompletedStep(user, scope, 'session'),
        }),
        makeStep({
          id: 'first-note',
          title: 'Add first player note',
          rule: 'Private coach notes stay staff-only unless shared through parent-facing tools.',
          detail: 'Record one practical observation or complete one development record.',
          href: '/assess-player/new',
          actionLabel: 'Add note',
          complete: snapshot.evaluations > 0 || hasCompletedStep(user, scope, 'first-note'),
        }),
      ],
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
