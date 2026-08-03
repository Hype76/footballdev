import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import {
  buildFormationBoardPngBuffer,
  buildPdfBuffer,
  countPdfPages,
} from '../../src/lib/pdf-builder.js'
import { buildFormationBoardDocument } from '../../src/lib/pdf-document.js'
import { adaptFormationVersionToPortrait } from '../../src/lib/formation-board-orientation.js'
import { buildPdfBrandingForAuthorisedScope } from './lib/_pdf-branding.js'
import {
  createPublicSupabaseClient,
  createSupabaseAdminClient,
} from './lib/_supabase.js'

const MAX_REQUEST_BYTES = 4_096
const REQUEST_FIELDS = ['purpose', 'requestId']
const THUMBNAIL_BUCKET = 'resource-library'

function safeJson(status, code, message, extra = {}) {
  return Response.json(
    { error: message, code, ...extra },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
}

function successJson(payload) {
  return Response.json(payload, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function requestToEvent(request) {
  return { headers: Object.fromEntries(request.headers.entries()) }
}

function parseBody(rawBody) {
  let body

  try {
    body = JSON.parse(rawBody)
  } catch {
    throw Object.assign(new Error('The export request is not valid.'), { statusCode: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('The export request is not valid.'), { statusCode: 400 })
  }

  if (Object.keys(body).some((key) => !REQUEST_FIELDS.includes(key))) {
    throw Object.assign(new Error('The export request contains an unsupported field.'), { statusCode: 400 })
  }

  const requestId = String(body.requestId ?? '').trim()
  const purpose = String(body.purpose ?? 'download').trim()

  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId) || !['download', 'thumbnail'].includes(purpose)) {
    throw Object.assign(new Error('The export request is not valid.'), { statusCode: 400 })
  }

  return { purpose, requestId }
}

function safeFilename(value, fallback = 'formation-board') {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80)

  return normalized || fallback
}

function mapPublicError(error) {
  const statusCode = Number(error?.statusCode ?? 500)
  const message = String(error?.message ?? '')

  if (statusCode === 400 || statusCode === 413) {
    return { status: statusCode, code: 'FORMATION_EXPORT_INVALID', message: 'The export request is not valid.' }
  }

  if (statusCode === 401 || message.includes('auth') || message.includes('JWT')) {
    return { status: 401, code: 'FORMATION_EXPORT_AUTH_REQUIRED', message: 'Login is required.' }
  }

  if (statusCode === 403 || message.includes('forbidden') || message.includes('not found')) {
    return { status: 403, code: 'FORMATION_EXPORT_DENIED', message: 'This Formation Board export is not available.' }
  }

  return { status: 500, code: 'FORMATION_EXPORT_FAILED', message: 'Formation Board export failed.' }
}

async function resolvePayload(request, requestId) {
  const authorization = request.headers.get('authorization') || ''

  if (!authorization.startsWith('Bearer ')) {
    throw Object.assign(new Error('Login is required.'), { statusCode: 401 })
  }

  const database = createPublicSupabaseClient(requestToEvent(request), {
    global: { headers: { Authorization: authorization } },
  })
  const { data, error } = await database.rpc('get_formation_board_export_payload', {
    target_request_id: requestId,
  })

  if (error || !data?.request || !data?.board || !data?.version || !data?.club || !data?.team) {
    throw Object.assign(new Error(error?.message || 'formation_board_export_forbidden'), { statusCode: 403 })
  }

  return data
}

function createDocument(payload) {
  const board = payload.board
  const version = adaptFormationVersionToPortrait(payload.version)
  const roster = Array.isArray(payload.version.bench) ? payload.version.bench : []
  const bench = roster.filter((player) => player?.state !== 'unplaced')
  const unplaced = roster.filter((player) => player?.state === 'unplaced')

  return buildFormationBoardDocument({
    clubName: payload.club.name,
    teamName: payload.team.name,
    reportDate: new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/London',
    }).format(new Date(version.created_at || board.updated_at)),
    title: board.title,
    description: board.description,
    gameFormat: version.game_format,
    formation: version.formation_preset_key,
    orientation: version.pitch_orientation,
    placements: version.placements,
    bench,
    unplaced,
    notes: version.notes,
  })
}

async function completeRequest(database, requestId, values) {
  const { error } = await database
    .from('formation_board_export_requests')
    .update({ completed_at: new Date().toISOString(), ...values })
    .eq('id', requestId)
    .eq('export_state', 'pending')

  if (error) throw error
}

export function createFormationBoardExportHandler({
  adminFactory = createSupabaseAdminClient,
  payloadResolver = resolvePayload,
  pdfRenderer = buildPdfBuffer,
  pngRenderer = buildFormationBoardPngBuffer,
  brandingBuilder = buildPdfBrandingForAuthorisedScope,
  thumbnailConverter = (buffer) => sharp(buffer).resize({ width: 480, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer(),
  logger = console,
} = {}) {
  return async function formationBoardExport(request, context = {}) {
    const requestReference = String(context.requestId ?? '').trim() || randomUUID()
    let body
    let authorised = false
    let database

    try {
      if (request.method !== 'POST') {
        return safeJson(405, 'FORMATION_EXPORT_METHOD_NOT_ALLOWED', 'Method not allowed.')
      }

      if (!String(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
        return safeJson(415, 'FORMATION_EXPORT_CONTENT_TYPE_REQUIRED', 'Content-Type must be application/json.')
      }

      const bytes = new Uint8Array(await request.arrayBuffer())

      if (bytes.byteLength > MAX_REQUEST_BYTES) {
        return safeJson(413, 'FORMATION_EXPORT_REQUEST_TOO_LARGE', 'The export request is not valid.')
      }

      body = parseBody(new TextDecoder().decode(bytes))
      const payload = await payloadResolver(request, body.requestId)
      authorised = true
      database = adminFactory(requestToEvent(request))
      const format = String(payload.request.export_format ?? '').trim()

      if (!['png', 'pdf'].includes(format) || (body.purpose === 'thumbnail' && format !== 'png')) {
        throw Object.assign(new Error('The export request format is not valid.'), { statusCode: 400 })
      }

      const document = createDocument(payload)
      const branding = await brandingBuilder({
        supabaseAdmin: database,
        club: payload.club,
        team: payload.team,
        reportType: 'formation-board',
      })
      const rendererDiagnostics = {}
      const output = format === 'pdf'
        ? await pdfRenderer(document, { branding, diagnostics: rendererDiagnostics })
        : await pngRenderer({
          clubName: payload.club.name,
          teamName: payload.team.name,
          reportDate: document.context.reportDate,
          title: document.title,
          description: document.description,
          gameFormat: document.gameFormat,
          formation: document.formation,
          orientation: document.orientation,
          placements: document.placements,
          bench: document.bench,
          notes: document.notes,
        }, { branding, diagnostics: rendererDiagnostics })

      if (body.purpose === 'thumbnail') {
        const thumbnail = await thumbnailConverter(output)
        const thumbnailPath = `${payload.board.club_id}/${payload.board.team_id}/formation-boards/${payload.board.id}/versions/${payload.version.id}/thumbnail.png`
        const { error: uploadError } = await database.storage
          .from(THUMBNAIL_BUCKET)
          .upload(thumbnailPath, thumbnail, {
            contentType: 'image/png',
            upsert: true,
          })

        if (uploadError) throw uploadError

        await completeRequest(database, body.requestId, {
          export_state: 'ready',
          output_bucket: THUMBNAIL_BUCKET,
          output_path: thumbnailPath,
          failure_code: null,
        })

        return successJson({ thumbnailPath })
      }

      await completeRequest(database, body.requestId, {
        export_state: 'ready',
        output_bucket: null,
        output_path: null,
        failure_code: null,
      })

      const extension = format
      const filename = `${safeFilename(payload.board.title)}-v${payload.version.version_number}.${extension}`
      const pageCount = format === 'pdf' ? countPdfPages(output) : 0

      return new Response(output, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Content-Type': format === 'pdf' ? 'application/pdf' : 'image/png',
          'X-Content-Type-Options': 'nosniff',
          'X-Formation-Export-Format': format,
          'X-Formation-Export-Page-Count': String(pageCount),
          'X-Formation-Export-Request': requestReference,
        },
      })
    } catch (error) {
      const publicError = mapPublicError(error)

      if (authorised && database && body?.requestId) {
        try {
          await completeRequest(database, body.requestId, {
            export_state: 'failed',
            output_bucket: null,
            output_path: null,
            failure_code: String(error?.code || error?.name || 'FORMATION_EXPORT_FAILED').slice(0, 120),
          })
        } catch (completionError) {
          logger.error?.('Formation Board export failure could not be recorded', {
            requestRef: createHash('sha256').update(body.requestId).digest('hex').slice(0, 12),
            errorName: String(completionError?.name || 'Error'),
          })
        }
      }

      logger.error?.('Formation Board export failed', {
        requestRef: body?.requestId
          ? createHash('sha256').update(body.requestId).digest('hex').slice(0, 12)
          : 'none',
        errorName: String(error?.name || 'Error'),
        status: publicError.status,
      })

      return safeJson(publicError.status, publicError.code, publicError.message)
    }
  }
}

export default createFormationBoardExportHandler()
