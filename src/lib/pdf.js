import fallbackLogo from '../assets/football-development-logo-optimized.jpg'

const LOGO_TIMEOUT_MS = 2500

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatPreviewValue(value) {
  if (typeof value === 'number') {
    return value
  }

  const normalizedValue = String(value ?? '').trim()
  return normalizedValue || 'Not provided'
}

function formatSessionForDisplay(value) {
  const normalizedValue = String(value ?? '').trim()

  if (!normalizedValue) {
    return 'Not scheduled'
  }

  const parsedSourceDate = new Date(normalizedValue)
  const dateOnlyValue = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? normalizedValue
    : Number.isNaN(parsedSourceDate.getTime())
      ? ''
      : parsedSourceDate.toISOString().slice(0, 10)

  if (!dateOnlyValue) {
    return normalizedValue
  }

  const parsedDate = new Date(`${dateOnlyValue}T00:00:00`)

  if (Number.isNaN(parsedDate.getTime())) {
    return normalizedValue
  }

  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsedDate)
}

function waitForPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve)
    })
  })
}

function withTimeout(task, timeoutMs) {
  return Promise.race([
    task,
    new Promise((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs)
    }),
  ])
}

async function waitForImages(element) {
  const images = Array.from(element.querySelectorAll('img'))

  await Promise.all(
    images.map((image) => {
      if (image.complete) {
        return Promise.resolve()
      }

      return withTimeout(
        new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true })
          image.addEventListener('error', resolve, { once: true })
        }),
        LOGO_TIMEOUT_MS,
      )
    }),
  )
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function resolvePdfLogoUrl(logoUrl) {
  const normalizedLogoUrl = String(logoUrl ?? '').trim()

  if (!normalizedLogoUrl) {
    return fallbackLogo
  }

  try {
    const parsedUrl = new URL(normalizedLogoUrl, window.location.origin)

    if (parsedUrl.origin === window.location.origin || parsedUrl.hostname.endsWith('.supabase.co')) {
      return parsedUrl.toString()
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS)

    try {
      const response = await fetch(parsedUrl.toString(), {
        mode: 'cors',
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Logo request failed with status ${response.status}.`)
      }

      const blob = await response.blob()

      return await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(String(reader.result || fallbackLogo))
        reader.onerror = () => reject(new Error('Could not read the uploaded logo.'))
        reader.readAsDataURL(blob)
      })
    } finally {
      window.clearTimeout(timeoutId)
    }
  } catch (error) {
    console.error('Falling back to default PDF logo.', error)
    return fallbackLogo
  }
}

export function buildEvaluationSummary(evaluation) {
  const responseEntries = Object.entries(evaluation.formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return (
    evaluation.comments?.overall ||
    evaluation.comments?.strengths ||
    evaluation.comments?.improvements ||
    'No written summary provided.'
  )
}

function buildResponseItemsMarkup(responseItems) {
  if (!responseItems.length) {
    return '<p style="margin: 14px 0 0; color: #64748b; font-size: 13px;">No responses provided.</p>'
  }

  return responseItems
    .map(
      (item) => `
        <div style="break-inside: avoid; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 10px; background: #ffffff;">
          <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">${escapeHtml(item.label)}</p>
          <p style="margin: 5px 0 0; color: #334155; font-size: 11px; line-height: 1.35; white-space: pre-wrap;">${escapeHtml(formatPreviewValue(item.value))}</p>
        </div>
      `,
    )
    .join('')
}

function buildPdfMarkup({ previewProps, mode, logoUrl }) {
  const showScoring = mode === 'scored'
  const showEmailTemplate = mode === 'email'
  const responseItems = showScoring ? previewProps.responseItems ?? [] : []

  return `
    <section style="box-sizing: border-box; width: 760px; padding: 22px; background: #ffffff; color: #0f172a; font-family: Arial, sans-serif;">
      <div style="display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid #e7ece3; padding-bottom: 14px;">
        <div style="min-width: 0;">
          <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;">${showEmailTemplate ? 'Parent Email Template' : 'Assessment PDF'}</p>
          <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(previewProps.clubName)}" style="display: block; max-width: 120px; max-height: 56px; margin-top: 10px; object-fit: contain;" />
          <h1 style="margin: 8px 0 0; color: #0f172a; font-size: 20px; line-height: 1.15;">${escapeHtml(previewProps.clubName || 'Club Name')}</h1>
        </div>
        <div style="align-self: flex-start; border-radius: 12px; background: #eef3ea; color: #4f6552; padding: 9px 12px; font-size: 12px; font-weight: 700; white-space: nowrap;">${escapeHtml(previewProps.section || 'Trial')}</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px;">
        <div>
          <p style="margin: 0; color: #64748b; font-size: 12px; font-weight: 700;">Player</p>
          <h2 style="margin: 6px 0 0; color: #0f172a; font-size: 24px; line-height: 1.1;">${escapeHtml(previewProps.playerName || 'Player Name')}</h2>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 9px;">
            <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">Team</p>
            <p style="margin: 5px 0 0; color: #334155; font-size: 12px; font-weight: 700;">${escapeHtml(previewProps.team || 'Not provided')}</p>
          </div>
          <div style="border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 9px;">
            <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">Session</p>
            <p style="margin: 5px 0 0; color: #334155; font-size: 12px; font-weight: 700;">${escapeHtml(formatSessionForDisplay(previewProps.session))}</p>
          </div>
          <div style="grid-column: 1 / -1; border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 9px;">
            <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">Section</p>
            <p style="margin: 5px 0 0; color: #334155; font-size: 12px; font-weight: 700;">${escapeHtml(previewProps.section || 'Trial')}</p>
          </div>
          ${
            previewProps.recipientNames || previewProps.recipientEmails
              ? `
                <div style="grid-column: 1 / -1; border: 1px solid #e7ece3; border-radius: 10px; background: #fbfcf9; padding: 9px;">
                  <p style="margin: 0; color: #5a6b5b; font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">Recipients</p>
                  <p style="margin: 5px 0 0; color: #334155; font-size: 12px; font-weight: 700;">${escapeHtml(previewProps.recipientNames || previewProps.recipientEmails)}</p>
                </div>
              `
              : ''
          }
        </div>
      </div>

      <div style="margin-top: 14px; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 12px;">
        <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">${showScoring ? 'Summary' : 'Email Subject'}</p>
        <p style="margin: 8px 0 0; color: #334155; font-size: 12px; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(showEmailTemplate ? previewProps.emailSubject || 'No email subject available.' : previewProps.summary || 'No written summary provided.')}</p>
      </div>

      ${
        showScoring
          ? `
            <div style="margin-top: 14px; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 12px;">
              <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">Evaluation Responses</p>
              <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px;">
                ${buildResponseItemsMarkup(responseItems)}
              </div>
            </div>
          `
          : showEmailTemplate
            ? `
            <div style="margin-top: 14px; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 14px;">
              <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">Parent Message</p>
              <p style="margin: 10px 0 0; color: #334155; font-size: 12px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(previewProps.emailBody || 'No parent email template is available for this assessment yet.')}</p>
            </div>
          `
            : `
            <div style="margin-top: 14px; border: 1px solid #e7ece3; border-radius: 14px; background: #fbfcf9; padding: 12px;">
              <p style="margin: 0; color: #5a6b5b; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;">Scores</p>
              <p style="margin: 8px 0 0; color: #334155; font-size: 12px; line-height: 1.45;">Scores are not included in this PDF.</p>
            </div>
          `
      }
    </section>
  `
}

export async function exportEvaluationPdf({ filename, previewProps, mode = 'scored' }) {
  const safeLogoUrl = await resolvePdfLogoUrl(previewProps?.logoUrl)
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '0'
  container.style.top = '0'
  container.style.width = '760px'
  container.style.opacity = '0.01'
  container.style.pointerEvents = 'none'
  container.style.zIndex = '-1'
  container.innerHTML = buildPdfMarkup({
    previewProps: previewProps ?? {},
    mode,
    logoUrl: safeLogoUrl,
  })

  document.body.appendChild(container)

  try {
    await waitForPaint()
    await waitForImages(container)

    const html2pdfModule = await import('html2pdf.js')
    const pdfExporter = html2pdfModule.default || html2pdfModule

    if (typeof pdfExporter !== 'function') {
      throw new Error('PDF exporter did not load correctly.')
    }

    const pdfBlob = await withTimeout(
      pdfExporter()
        .set({
          margin: [8, 8, 8, 8],
          filename,
          image: { type: 'jpeg', quality: 0.92 },
          html2canvas: {
            scale: 1.35,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            logging: false,
            removeContainer: true,
            windowWidth: 820,
          },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(container.firstElementChild)
        .outputPdf('blob'),
      15000,
    )

    if (!pdfBlob) {
      throw new Error('PDF export timed out.')
    }

    downloadBlob(pdfBlob, filename)
  } finally {
    container.remove()
  }
}
