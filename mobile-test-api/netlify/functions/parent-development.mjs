import { jsonResponse, requireAuthenticatedFixture } from './_shared/environment.mjs'
import { buildSimplePdf, normalizeText, requireUuid } from './_shared/parent-portal.mjs'

async function loadReports(fixture, parentLinkId) {
  const response = await fetch(`${fixture.environment.supabaseUrl}/rest/v1/rpc/get_mobile_test_parent_development_reports`, {
    method: 'POST',
    headers: { ...fixture.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ parent_link_id_value: parentLinkId }),
  })
  const reports = await response.json().catch(() => [])
  if (!response.ok) throw Object.assign(new Error('development_history_unavailable'), { status: response.status })
  return Array.isArray(reports) ? reports : []
}

function buildReportPdf(report) {
  return buildSimplePdf([
    'Football Player Parents',
    report.form?.name || 'Development report',
    `${report.player?.name || 'Player'} | ${report.team?.name || 'Team'}`,
    `Report date: ${report.recordDate || report.finalizedAt || 'Not provided'}`,
    report.overallScore == null ? '' : `Overall score: ${report.overallScore} / ${report.overallMaxScore || 10}`,
    ...(report.responseItems || []).map((item) => `${item.label}: ${item.displayValue}`),
    ...(report.sections || []).flatMap((section) => [section.title, section.body]),
  ])
}

export default async function handler(request) {
  if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'method_not_allowed' }, 405)
  try {
    const fixture = await requireAuthenticatedFixture(request)
    if (fixture.response) return fixture.response
    const url = new URL(request.url)
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    const parentLinkId = requireUuid(body.parentLinkId || url.searchParams.get('parentLinkId'), 'parent_link_invalid')
    const reports = await loadReports(fixture, parentLinkId)

    if (request.method === 'POST' && body.action === 'list') {
      return jsonResponse({ reports, success: true })
    }

    if (request.method !== 'GET') throw Object.assign(new Error('development_action_invalid'), { status: 400 })
    const reportId = requireUuid(url.searchParams.get('reportId'), 'development_report_invalid')
    const report = reports.find((item) => normalizeText(item.id) === reportId)
    if (!report?.canDownloadPdf) throw Object.assign(new Error('development_pdf_unavailable'), { status: 404 })
    const pdf = buildReportPdf(report)
    return new Response(pdf, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store, max-age=0',
        'content-disposition': `attachment; filename="development-report-${report.id}.pdf"`,
        'content-length': String(pdf.length),
        'content-security-policy': "sandbox; default-src 'none'",
        'content-type': 'application/pdf',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (error) {
    const status = Number(error?.status || 500)
    return jsonResponse({
      error: status >= 500 ? 'development_access_failed' : error.message,
      message: status >= 500 ? 'Development history could not be prepared.' : 'This Development report is not available for the selected child.',
    }, status)
  }
}

export const config = { path: '/api/mobile-test/parent-development' }
