export const MOBILE_RUNTIME_STATE_SCHEMA_VERSION = 1

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function getMobileRuntimeStateKey(appRole) {
  const app = normalize(appRole)
  if (!['coach', 'parent'].includes(app)) throw new Error('runtime_state_app_mismatch')
  return `fp.mobile.runtime.v${MOBILE_RUNTIME_STATE_SCHEMA_VERSION}.${app}`
}

export function getMobileRuntimeOwnership(config) {
  let projectRef = ''
  try {
    projectRef = new URL(config?.supabaseUrl || '').hostname.split('.')[0]
  } catch {
    projectRef = ''
  }

  return {
    appRole: normalize(config?.appRole),
    environment: normalize(config?.supabaseEnvironment),
    projectRef: normalize(projectRef),
    schemaVersion: MOBILE_RUNTIME_STATE_SCHEMA_VERSION,
  }
}

function parseRuntimeOwnership(value) {
  try {
    const parsed = JSON.parse(String(value || ''))
    if (
      parsed?.schemaVersion !== MOBILE_RUNTIME_STATE_SCHEMA_VERSION
      || !['coach', 'parent'].includes(normalize(parsed?.appRole))
      || !['test', 'production'].includes(normalize(parsed?.environment))
      || !/^[a-z0-9]+$/.test(normalize(parsed?.projectRef))
    ) {
      return null
    }
    return getMobileRuntimeOwnership({
      appRole: parsed.appRole,
      supabaseEnvironment: parsed.environment,
      supabaseUrl: `https://${parsed.projectRef}.supabase.co`,
    })
  } catch {
    return null
  }
}

export async function inspectMobileRuntimeOwnership({ config, storage }) {
  const expected = getMobileRuntimeOwnership(config)
  const key = getMobileRuntimeStateKey(expected.appRole)
  const raw = await storage.getItem(key)
  const previous = raw ? parseRuntimeOwnership(raw) : null
  const matches = Boolean(
    previous
    && previous.appRole === expected.appRole
    && previous.environment === expected.environment
    && previous.projectRef === expected.projectRef
  )

  return {
    expected,
    key,
    previous,
    status: matches ? 'ready' : raw ? 'incompatible' : 'first_boot',
  }
}

export async function commitMobileRuntimeOwnership({ ownership, storage }) {
  await storage.setItem(ownership.key, JSON.stringify(ownership.expected))
  return ownership.expected
}
