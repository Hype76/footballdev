import { jsonResponse, requireMobileTestEnvironment } from './_shared/environment.mjs'

export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  try {
    const environment = requireMobileTestEnvironment()
    return jsonResponse({
      ok: true,
      environment: environment.environment,
      projectRef: environment.projectRef,
      productionAccess: environment.productionAccess,
      communicationsEnabled: environment.communicationsEnabled,
      schedulesEnabled: environment.schedulesEnabled,
    })
  } catch {
    return jsonResponse({ ok: false, error: 'environment_boundary_failed' }, 503)
  }
}

export const config = {
  path: '/api/mobile-test/health',
}
