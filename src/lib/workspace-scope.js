import { normalizePlanKey, PLAN_KEYS } from './plans.js'

export const WORKSPACE_SCOPES = Object.freeze({
  individual: 'individual',
  team: 'team',
  club: 'club',
  unknown: 'unknown',
})

const OWNER_ROLES = Object.freeze({
  individual: Object.freeze({ key: 'head_manager', label: 'Coach Owner', rank: 70 }),
  team: Object.freeze({ key: 'head_manager', label: 'Team Admin', rank: 70 }),
  club: Object.freeze({ key: 'admin', label: 'Club Admin', rank: 90 }),
  unknown: Object.freeze({ key: '', label: 'Unknown', rank: 0 }),
})

const SCOPE_DEFINITIONS = Object.freeze({
  [WORKSPACE_SCOPES.individual]: Object.freeze({
    key: WORKSPACE_SCOPES.individual,
    supported: true,
    inviteType: 'individual_owner',
    ownerRole: OWNER_ROLES.individual,
    createInitialTeam: true,
    entityLabel: 'Squad',
    entityLabelLower: 'squad',
    workspaceLabel: 'individual workspace',
    setupEyebrow: 'Individual setup invite',
    setupTitle: 'Create your coach access',
    setupDescription: 'Confirm the invited account and create secure access to your individual workspace.',
    errorSubject: 'Individual invite',
    accountType: 'coach_owner',
    inviteButtonLabel: 'Create coach account',
  }),
  [WORKSPACE_SCOPES.team]: Object.freeze({
    key: WORKSPACE_SCOPES.team,
    supported: true,
    inviteType: 'team_owner',
    ownerRole: OWNER_ROLES.team,
    createInitialTeam: true,
    entityLabel: 'Team',
    entityLabelLower: 'team',
    workspaceLabel: 'team workspace',
    setupEyebrow: 'Team setup invite',
    setupTitle: 'Create team admin access',
    setupDescription: 'Confirm the invited account and create secure Team Admin access.',
    errorSubject: 'Team invite',
    accountType: 'team_admin',
    inviteButtonLabel: 'Create team admin account',
  }),
  [WORKSPACE_SCOPES.club]: Object.freeze({
    key: WORKSPACE_SCOPES.club,
    supported: true,
    inviteType: 'club_owner',
    ownerRole: OWNER_ROLES.club,
    createInitialTeam: false,
    entityLabel: 'Club',
    entityLabelLower: 'club',
    workspaceLabel: 'club workspace',
    setupEyebrow: 'Club setup invite',
    setupTitle: 'Create club admin access',
    setupDescription: 'Confirm the invited account and create secure Club Admin access.',
    errorSubject: 'Club invite',
    accountType: 'club_admin',
    inviteButtonLabel: 'Create club admin account',
  }),
  [WORKSPACE_SCOPES.unknown]: Object.freeze({
    key: WORKSPACE_SCOPES.unknown,
    supported: false,
    inviteType: 'unknown',
    ownerRole: OWNER_ROLES.unknown,
    createInitialTeam: false,
    entityLabel: 'Workspace',
    entityLabelLower: 'workspace',
    workspaceLabel: 'workspace',
    setupEyebrow: 'Workspace invite',
    setupTitle: 'Create workspace access',
    setupDescription: 'Confirm the invited account to continue.',
    errorSubject: 'Workspace invite',
    accountType: 'workspace_user',
    inviteButtonLabel: 'Create account',
  }),
})

const PLAN_SCOPE_KEYS = Object.freeze({
  [PLAN_KEYS.individual]: WORKSPACE_SCOPES.individual,
  [PLAN_KEYS.singleTeam]: WORKSPACE_SCOPES.team,
  [PLAN_KEYS.smallClub]: WORKSPACE_SCOPES.club,
  [PLAN_KEYS.developmentClub]: WORKSPACE_SCOPES.club,
  [PLAN_KEYS.largeClub]: WORKSPACE_SCOPES.club,
  [PLAN_KEYS.pilot]: WORKSPACE_SCOPES.club,
})

export function getWorkspaceScope(planOrKey) {
  const planKey = normalizePlanKey(planOrKey)
  const scopeKey = PLAN_SCOPE_KEYS[planKey] || WORKSPACE_SCOPES.unknown

  return {
    ...SCOPE_DEFINITIONS[scopeKey],
    planKey,
    ownerRole: { ...SCOPE_DEFINITIONS[scopeKey].ownerRole },
  }
}

export function getWorkspaceScopeKey(planOrKey) {
  return getWorkspaceScope(planOrKey).key
}

export function isClubWorkspace(planOrKey) {
  return getWorkspaceScopeKey(planOrKey) === WORKSPACE_SCOPES.club
}

export function isTeamWorkspace(planOrKey) {
  return getWorkspaceScopeKey(planOrKey) === WORKSPACE_SCOPES.team
}

export function isIndividualWorkspace(planOrKey) {
  return getWorkspaceScopeKey(planOrKey) === WORKSPACE_SCOPES.individual
}

export function getWorkspaceInviteRedirect(planOrKey, billingMode = 'unpaid') {
  const scope = getWorkspaceScope(planOrKey)

  if (!scope.supported) {
    return '/sign-in'
  }

  if (billingMode === 'paid') {
    return '/billing'
  }

  return scope.key === WORKSPACE_SCOPES.club ? '/club-settings' : '/coach'
}

export function shouldPromoteWorkspaceOwnerToClubAdmin(previousPlanOrKey, nextPlanOrKey) {
  const previousScope = getWorkspaceScope(previousPlanOrKey)
  const nextScope = getWorkspaceScope(nextPlanOrKey)

  return previousScope.supported
    && nextScope.supported
    && previousScope.key !== WORKSPACE_SCOPES.club
    && nextScope.key === WORKSPACE_SCOPES.club
}
