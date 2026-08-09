import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'
import { normalizeText, requireUuid } from './_shared/parent-portal.mjs'

async function resolveResource(fixture, parentLinkId, resourceId) {
  const response = await fetch(`${fixture.environment.supabaseUrl}/rest/v1/rpc/get_mobile_test_parent_resource_access`, {
    method: 'POST',
    headers: { ...fixture.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ parent_link_id_value: parentLinkId, resource_id_value: resourceId }),
  })
  const rows = await response.json().catch(() => [])
  if (!response.ok) throw Object.assign(new Error('resource_unavailable'), { status: response.status })
  const resource = Array.isArray(rows) ? rows[0] : rows
  if (!resource) throw Object.assign(new Error('resource_unavailable'), { status: 404 })
  return resource
}

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'method_not_allowed' }, 405)
  try {
    const fixture = await requireAuthenticatedFixture(request)
    if (fixture.response) return fixture.response
    const url = new URL(request.url)
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    const parentLinkId = requireUuid(body.parentLinkId || url.searchParams.get('parentLinkId'), 'parent_link_invalid')
    const resourceId = requireUuid(body.resourceId || url.searchParams.get('resourceId'), 'resource_invalid')
    const resource = await resolveResource(fixture, parentLinkId, resourceId)

    if (request.method === 'POST') {
      if (resource.access_type === 'external_link') {
        const externalUrl = normalizeText(resource.external_url)
        if (!externalUrl.startsWith('https://')) throw Object.assign(new Error('resource_unavailable'), { status: 403 })
        return jsonResponse({ accessType: 'external_link', accessUrl: externalUrl, success: true })
      }
      return jsonResponse({
        accessType: 'file',
        downloadUrl: `${url.origin}/api/mobile-test/parent-resource?parentLinkId=${encodeURIComponent(parentLinkId)}&resourceId=${encodeURIComponent(resourceId)}`,
        fileName: normalizeText(resource.original_filename) || `resource-${resourceId}`,
        mimeType: normalizeText(resource.mime_type) || 'application/octet-stream',
        success: true,
      })
    }

    if (resource.access_type !== 'file') throw Object.assign(new Error('resource_download_invalid'), { status: 400 })
    const storagePath = normalizeText(resource.storage_path)
    const storageBucket = normalizeText(resource.storage_bucket)
    const storageResponse = await fetch(
      `${fixture.environment.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(storageBucket)}/${storagePath.split('/').map(encodeURIComponent).join('/')}`,
      { headers: fixture.headers },
    )
    if (!storageResponse.ok) throw Object.assign(new Error('resource_download_unavailable'), { status: storageResponse.status })
    const buffer = await storageResponse.arrayBuffer()
    const mimeType = normalizeText(resource.mime_type) || normalizeText(storageResponse.headers.get('content-type')) || 'application/octet-stream'
    const fileName = normalizeText(resource.original_filename).replace(/[\\/:*?"<>|]+/g, '-') || `resource-${resourceId}`
    return new Response(buffer, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store, max-age=0',
        'content-disposition': `attachment; filename="${fileName}"`,
        'content-length': String(buffer.byteLength),
        'content-type': mimeType,
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    const status = Number(error?.status || 500)
    return jsonResponse({ error: status >= 500 ? 'resource_access_failed' : error.message, message: status >= 500 ? 'Resource access could not be prepared.' : 'This resource is not available for the selected child.' }, status)
  }
}

export const config = { path: '/api/mobile-test/parent-resource' }
