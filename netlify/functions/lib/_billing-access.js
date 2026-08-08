import {
  assertBillingActionAllowed,
  BILLING_ACCESS_STATES,
  BILLING_ACTION_CATEGORIES,
  PAYMENT_REQUIRED_ERROR_CODE,
  resolveBillingAccess,
} from '../../../src/lib/billing-access.js'
import { supabaseAdmin } from './_supabase.js'

export { BILLING_ACTION_CATEGORIES, PAYMENT_REQUIRED_ERROR_CODE }

export const BILLING_WORKSPACE_SELECT = [
  'id',
  'name',
  'plan_key',
  'plan_status',
  'is_plan_comped',
  'billing_arrangement',
  'billing_start_at',
  'billing_configuration_updated_at',
  'billing_configuration_updated_by',
  'workspace_owner_user_id',
  'stripe_customer_id',
  'stripe_subscription_id',
  'stripe_price_id',
  'current_period_end',
  'status',
  'archived_at',
].join(', ')

function normalizeText(value) {
  return String(value ?? '').trim()
}

export function createBillingContext(profile = {}, workspace = {}) {
  return {
    workspaceId: workspace.id || profile.clubId || profile.club_id || '',
    planKey: workspace.plan_key ?? profile.planKey ?? profile.plan_key,
    planStatus: workspace.plan_status ?? profile.planStatus ?? profile.plan_status,
    isPlanComped: workspace.is_plan_comped ?? profile.isPlanComped ?? profile.is_plan_comped,
    billingArrangement: workspace.billing_arrangement ?? profile.billingArrangement ?? profile.billing_arrangement,
    billingStartAt: workspace.billing_start_at ?? profile.billingStartAt ?? profile.billing_start_at,
    archivedAt: workspace.archived_at ?? profile.clubArchivedAt ?? profile.archived_at,
    role: profile.role,
    roleRank: profile.roleRank ?? profile.role_rank,
    workspaceOwnerUserId: workspace.workspace_owner_user_id ?? profile.workspaceOwnerUserId,
    isWorkspaceOwner: normalizeText(workspace.workspace_owner_user_id ?? profile.workspaceOwnerUserId)
      === normalizeText(profile.id ?? profile.auth_user_id),
  }
}

export async function loadBillingWorkspace(clubId) {
  const normalizedClubId = normalizeText(clubId)

  if (!normalizedClubId) {
    throw Object.assign(new Error('Workspace billing details are required.'), { statusCode: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('clubs')
    .select(BILLING_WORKSPACE_SELECT)
    .eq('id', normalizedClubId)
    .maybeSingle()

  if (error || !data) {
    throw Object.assign(new Error('Workspace billing details could not be loaded.'), { statusCode: 403 })
  }

  return data
}

export async function resolveWorkspaceBillingAccess({ profile = {}, workspace = null, clubId = '', now = null } = {}) {
  const resolvedWorkspace = workspace || await loadBillingWorkspace(clubId || profile.clubId || profile.club_id)
  return {
    decision: resolveBillingAccess(createBillingContext(profile, resolvedWorkspace), { now }),
    workspace: resolvedWorkspace,
  }
}

async function observePaymentRequired({ profile, workspace }) {
  const billingStartAt = workspace.billing_start_at || null
  const { data: stateEvent, error: stateError } = await supabaseAdmin
    .from('billing_access_state_events')
    .upsert({
      club_id: workspace.id,
      billing_start_at: billingStartAt,
      billing_state_key: billingStartAt || 'legacy',
      access_state: BILLING_ACCESS_STATES.paymentRequired,
      first_observed_by: profile.id || null,
      last_observed_at: new Date().toISOString(),
    }, {
      onConflict: 'club_id,billing_state_key,access_state',
      ignoreDuplicates: true,
    })
    .select('id')
    .maybeSingle()

  if (stateError) {
    console.warn('billing_access_state_observation_failed', {
      code: String(stateError.code || 'unknown'),
      workspaceId: workspace.id,
    })
    return
  }

  if (!stateEvent?.id) {
    return
  }

  await supabaseAdmin.from('audit_logs').insert({
    actor_id: profile.id || null,
    actor_email: profile.email || null,
    actor_role_label: profile.roleLabel || profile.role_label || profile.role || 'System',
    actor_role_rank: Number(profile.roleRank ?? profile.role_rank ?? 0),
    club_id: workspace.id,
    action: 'billing_payment_required_observed',
    entity_type: 'club',
    entity_id: workspace.id,
    event_category: 'billing',
    metadata: {
      billingStartAt,
      commercialPlan: workspace.plan_key,
    },
  })
}

export async function assertWorkspaceBillingAction({
  actionCategory = BILLING_ACTION_CATEGORIES.staffMutation,
  clubId = '',
  now = null,
  profile = {},
  workspace = null,
} = {}) {
  const resolved = await resolveWorkspaceBillingAccess({ profile, workspace, clubId, now })

  try {
    assertBillingActionAllowed(
      createBillingContext(profile, resolved.workspace),
      actionCategory,
      { now },
    )
  } catch (error) {
    if (error?.code === PAYMENT_REQUIRED_ERROR_CODE) {
      await observePaymentRequired({ profile, workspace: resolved.workspace })
      error.billingAccess = resolved.decision
    }
    throw error
  }

  return resolved
}

export function billingErrorBody(error) {
  if (error?.code !== PAYMENT_REQUIRED_ERROR_CODE) {
    return null
  }

  return {
    success: false,
    category: PAYMENT_REQUIRED_ERROR_CODE,
    code: PAYMENT_REQUIRED_ERROR_CODE,
    message: error.message,
    billingAccess: error.billingAccess
      ? {
          accessState: error.billingAccess.accessState,
          exportAllowed: true,
          paymentRequired: true,
        }
      : undefined,
  }
}
