import { useState } from 'react'
import {
  downloadCompletedReportCsv,
  downloadCompletedReportPdf,
} from '../../lib/matchday-report-export.js'

const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-2 text-sm font-black text-[var(--text-primary)] shadow-sm shadow-[#047857]/10 transition hover:bg-[var(--panel-bg)] focus:outline-none focus:ring-2 focus:ring-[#047857] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

export function CompletedMatchReportExportActions({ audience = 'parent', match }) {
  const [errorMessage, setErrorMessage] = useState('')
  const [busyFormat, setBusyFormat] = useState('')

  const download = async (format) => {
    setBusyFormat(format)
    setErrorMessage('')
    try {
      if (format === 'pdf') await downloadCompletedReportPdf(match, { audience })
      else downloadCompletedReportCsv(match, { audience })
    } catch (error) {
      console.error(error)
      setErrorMessage(`The ${format.toUpperCase()} export could not be created. The report is still available on screen.`)
    } finally {
      setBusyFormat('')
    }
  }

  return (
    <section className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-3" aria-label="Completed report exports">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-black text-[var(--text-primary)]">Export this completed report</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-[var(--text-muted)]">
            Downloads use the same permission-filtered report shown here.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => void download('pdf')} disabled={Boolean(busyFormat)} className={buttonClass}>
            {busyFormat === 'pdf' ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <button type="button" onClick={() => void download('csv')} disabled={Boolean(busyFormat)} className={buttonClass}>
            {busyFormat === 'csv' ? 'Preparing CSV...' : 'Download CSV'}
          </button>
        </div>
      </div>
      {errorMessage ? <p role="alert" className="mt-3 text-sm font-bold text-[var(--danger-text)]">{errorMessage}</p> : null}
    </section>
  )
}
