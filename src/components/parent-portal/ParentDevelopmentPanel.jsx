import { useMemo, useState } from 'react'
import { NoticeBanner } from '../ui/NoticeBanner.jsx'
import { downloadParentPortalDevelopmentPdf } from '../../lib/domain/parent-development.js'

const emptyClass = 'rounded-lg border border-[#d7e5dc] bg-white px-4 py-5 text-sm font-semibold text-[#4b5f55] shadow-sm shadow-[#047857]/10'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

function formatReportDate(value) {
  const parsedDate = new Date(value)

  if (Number.isNaN(parsedDate.getTime())) {
    return value || 'Date not recorded'
  }

  return parsedDate.toLocaleDateString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatOverallScore(value, maxScore) {
  const score = Number(value)
  const maximum = Number(maxScore)
  return Number.isFinite(score) && Number.isFinite(maximum) && maximum > 0
    ? `${score} / ${maximum}`
    : 'Not recorded'
}

function getDeliveryTone(state) {
  if (state === 'sent') {
    return 'border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]'
  }

  if (state === 'failed' || state === 'cancelled') {
    return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  }

  return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
}

function ReportFacts({ report }) {
  const facts = [
    ['Player', report.player?.name || 'Player'],
    ['Team', report.team?.name || 'Team'],
    ['Report date', formatReportDate(report.recordDate || report.finalizedAt)],
    ['Form', report.form?.name || 'Development report'],
    ['Overall score', formatOverallScore(report.overallScore, report.overallMaxScore)],
    ['Author', report.author?.name || 'Not shown'],
  ]

  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
          <dt className="text-[11px] font-black uppercase tracking-[0.12em] text-[#60756a]">{label}</dt>
          <dd className="mt-1 text-sm font-black text-[#101828]">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ReportDetail({
  accessToken,
  onBack,
  report,
  selectedLink,
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const downloadPdf = async () => {
    if (!selectedLink?.id || !report?.id) {
      return
    }

    setIsDownloading(true)
    setDownloadError('')

    try {
      const { blob, filename } = await downloadParentPortalDevelopmentPdf({
        accessToken,
        parentLinkId: selectedLink.id,
        reportId: report.id,
      })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      console.error(error)
      setDownloadError(error.message || 'This Development PDF could not be downloaded.')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <button type="button" onClick={onBack} className={secondaryButtonClass}>
        Back to Development history
      </button>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Development report</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">
            {report.form?.name || 'Development report'}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-black ${getDeliveryTone(report.deliveryState)}`}>
            {report.deliveryLabel}
          </span>
          <span className="rounded-full border border-[#d7e5dc] bg-[#f7faf8] px-3 py-1 text-xs font-black text-[#4b5f55]">
            {report.pdfLabel}
          </span>
        </div>
      </div>

      <div className="mt-4">
        <ReportFacts report={report} />
      </div>

      {downloadError ? (
        <div className="mt-4">
          <NoticeBanner tone="error" title="PDF not downloaded" message={downloadError} />
        </div>
      ) : null}

      {report.canDownloadPdf ? (
        <button
          type="button"
          onClick={() => void downloadPdf()}
          disabled={isDownloading}
          className={`${secondaryButtonClass} mt-4 w-full sm:w-auto`}
        >
          {isDownloading ? 'Preparing PDF...' : 'Download PDF'}
        </button>
      ) : null}

      <div className="mt-5 space-y-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Selected scores and feedback</p>
          {report.responseItems.length > 0 ? (
            <div className="mt-3 grid gap-3">
              {report.responseItems.map((item) => (
                <article key={item.fieldId || `${item.label}-${item.order}`} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <h4 className="font-black text-[#101828]">{item.label}</h4>
                    {item.numericScore !== null && item.maxScore !== null ? (
                      <span className="text-sm font-black text-[#047857]">
                        {item.numericScore} / {item.maxScore}{item.ratingLabel ? ` - ${item.ratingLabel}` : ''}
                      </span>
                    ) : null}
                  </div>
                  {item.numericScore === null || item.maxScore === null ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">
                      {item.displayValue}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className={`mt-3 ${emptyClass}`}>No selected score or feedback fields were included in this shared report.</p>
          )}
        </div>

        {report.sections.map((section) => (
          <article key={section.key || section.title} className="rounded-lg border border-[#d7e5dc] bg-white p-4">
            <h4 className="font-black text-[#101828]">{section.title}</h4>
            {section.body ? (
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-[#4b5f55]">{section.body}</p>
            ) : null}
            {section.chartPoints.length > 0 ? (
              <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                {section.chartPoints.map((point) => (
                  <div key={`${point.label}-${point.value}`} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-3 py-2">
                    <dt className="text-xs font-semibold text-[#60756a]">{point.label}</dt>
                    <dd className="mt-1 text-sm font-black text-[#101828]">{point.value} / 10</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}

export function ParentDevelopmentPanel({
  accessToken,
  isLoading,
  loadError,
  onOpenReport,
  onShowHistory,
  reports,
  requestedReportId,
  selectedLink,
}) {
  const selectedReport = useMemo(
    () => reports.find((report) => report.id === requestedReportId) || null,
    [reports, requestedReportId],
  )

  if (requestedReportId && !isLoading && !selectedReport) {
    return (
      <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
        <NoticeBanner
          tone="error"
          title="Development report not available"
          message="This report is not available for the selected child."
        />
        <button type="button" onClick={onShowHistory} className={`${secondaryButtonClass} mt-4`}>
          View Development history
        </button>
      </section>
    )
  }

  if (selectedReport) {
    return (
      <ReportDetail
        accessToken={accessToken}
        onBack={onShowHistory}
        report={selectedReport}
        selectedLink={selectedLink}
      />
    )
  }

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Development</p>
          <h3 className="mt-2 text-2xl font-black tracking-tight text-[#101828]">Shared Development history</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">
            Final reports the club shared for this child. Coach-only records never appear here.
          </p>
        </div>
        <p className="text-sm font-black text-[#4b5f55]">{reports.length} shared</p>
      </div>

      {loadError ? (
        <div className="mt-4">
          <NoticeBanner tone="error" title="Development history not loaded" message={loadError} />
        </div>
      ) : null}

      <div className="mt-4">
        {!selectedLink ? (
          <p className={emptyClass}>
            No child is linked to this parent account yet. Ask your club or team contact to send a parent invite to the email you use for this portal.
          </p>
        ) : isLoading ? (
          <p className={emptyClass}>Loading Development history...</p>
        ) : reports.length > 0 ? (
          <div className="grid gap-3">
            {reports.map((report) => (
              <article key={report.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[#047857]">
                      {formatReportDate(report.recordDate || report.finalizedAt)}
                    </p>
                    <h4 className="mt-2 text-lg font-black text-[#101828]">
                      {report.form?.name || 'Development report'}
                    </h4>
                    <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                      {report.team?.name || 'Team'} | Overall {formatOverallScore(report.overallScore, report.overallMaxScore)}
                    </p>
                    {report.author?.name ? (
                      <p className="mt-1 text-xs font-semibold text-[#60756a]">Author: {report.author.name}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1 text-xs font-black ${getDeliveryTone(report.deliveryState)}`}>
                      {report.deliveryLabel}
                    </span>
                    <span className="rounded-full border border-[#d7e5dc] bg-white px-3 py-1 text-xs font-black text-[#4b5f55]">
                      {report.pdfLabel}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenReport(report.id)}
                  className={`${secondaryButtonClass} mt-4 w-full sm:w-auto`}
                >
                  View report
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className={emptyClass}>
            No Development reports have been shared for this child yet.
          </p>
        )}
      </div>
    </section>
  )
}
