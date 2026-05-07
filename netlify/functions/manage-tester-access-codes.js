import { supabaseAdmin } from './_supabase.js'
import { json } from './_stripe-billing.js'

const CODE_SELECT = [
  'id',
  'code',
  'label',
  'plan_key',
  'assigned_email',
  'max_uses',
  'redeemed_count',
  'expires_at',
  'is_active',
  'created_at',
  'updated_at',
].join(', ')

function getBearerToken(event) {
  const header = event.headers.authorization || event.headers.Authorization || ''
  const [scheme, token] = String(header).split(' ')
  return scheme?.toLowerCase() === 'bearer' ? token : ''
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase()
}

function normalizeCode(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
}

function normalizePlanKey(value) {
  const normalizedValue = String(value ?? '').trim()
  return ['individual', 'single_team', 'small_club', 'large_club'].includes(normalizedValue)
    ? normalizedValue
    : 'single_team'
}

function normalizeCodeRow(row) {
  return {
    id: row.id,
    code: String(row.code ?? '').trim(),
    label: String(row.label ?? '').trim(),
    planKey: String(row.plan_key ?? '').trim(),
    assignedEmail: String(row.assigned_email ?? '').trim(),
    maxUses: Number(row.max_uses ?? 1),
    redeemedCount: Number(row.redeemed_count ?? 0),
    expiresAt: row.expires_at ?? '',
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  }
}

async function getAuthenticatedSuperAdmin(event) {
  const token = getBearerToken(event)

  if (!token) {
    throw new Error('Login is required.')
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)

  if (authError || !authData?.user?.id) {
    throw new Error('Login is required.')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (profile?.role !== 'super_admin') {
    throw new Error('Only platform admins can manage tester access codes.')
  }

  return profile
}

async function listCodes() {
  const { data, error } = await supabaseAdmin
    .from('tester_access_codes')
    .select(CODE_SELECT)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return (data ?? []).map(normalizeCodeRow)
}

async function createCode(event, adminUser) {
  const body = JSON.parse(event.body || '{}')
  const code = normalizeCode(body.code)
  const label = String(body.label ?? '').trim()
  const assignedEmail = normalizeEmail(body.assignedEmail)
  const maxUses = Math.max(1, Number.parseInt(body.maxUses, 10) || 1)
  const days = Math.max(1, Number.parseInt(body.expiresInDays, 10) || 14)
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  if (!code) {
    throw new Error('Enter an access code.')
  }

  const { error } = await supabaseAdmin
    .from('tester_access_codes')
    .insert({
      code,
      label,
      plan_key: normalizePlanKey(body.planKey),
      assigned_email: assignedEmail || null,
      max_uses: maxUses,
      expires_at: expiresAt,
      created_by: adminUser.id,
    })

  if (error) {
    if (error.code === '23505') {
      throw new Error('That access code already exists.')
    }

    throw error
  }
}

async function updateCode(event) {
  const body = JSON.parse(event.body || '{}')
  const codeId = String(body.id ?? '').trim()

  if (!codeId) {
    throw new Error('Access code ID is required.')
  }

  const payload = {
    updated_at: new Date().toISOString(),
  }

  if (Object.prototype.hasOwnProperty.call(body, 'isActive')) {
    payload.is_active = Boolean(body.isActive)
  }

  const { error } = await supabaseAdmin
    .from('tester_access_codes')
    .update(payload)
    .eq('id', codeId)

  if (error) {
    throw error
  }
}

export async function handler(event) {
  if (!['GET', 'POST', 'PATCH'].includes(event.httpMethod)) {
    return json(405, { success: false, message: 'Method not allowed.' })
  }

  try {
    const adminUser = await getAuthenticatedSuperAdmin(event)

    if (event.httpMethod === 'POST') {
      await createCode(event, adminUser)
    }

    if (event.httpMethod === 'PATCH') {
      await updateCode(event)
    }

    const codes = await listCodes()
    return json(200, { success: true, codes })
  } catch (error) {
    console.error(error)
    return json(400, {
      success: false,
      message: error.message || 'Tester access codes could not be managed.',
    })
  }
}
