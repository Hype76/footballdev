import { useEffect, useMemo, useState } from 'react'
import { SectionCard } from '../ui/SectionCard.jsx'

const PRESET_OPTIONS = [
  ['today', 'Today'],
  ['7_days', 'Last 7 days'],
  ['30_days', 'Last 30 days'],
  ['90_days', 'Last 90 days'],
  ['custom', 'Custom range'],
]

const METRIC_OPTIONS = [
  ['meaningfulActions', 'Meaningful actions'],
  ['successfulLogins', 'Successful logins'],
  ['pageViews', 'Page views'],
]

const ACCOUNT_ESTATE_CARDS = [
  ['customerClubs', 'Customer clubs', 'Active, non-test customer workspaces whose commercial scope is Club.', 'customerClubs'],
  ['customerWorkspaces', 'Customer workspaces', 'Active, non-test customer storage containers across all commercial scopes.', 'customerWorkspaces'],
  ['teams', 'Teams', 'Active football teams in counted customer workspaces.', 'teams'],
  ['activePlayers', 'Active players', 'Players with active status attached to an active team in a counted workspace.', 'activePlayers'],
  ['staffAccounts', 'Staff accounts', 'Distinct active customer staff profiles, whether or not they currently have a team assignment.', 'staffAccounts'],
  ['staffAssignments', 'Staff assignments', 'Current team-role assignments. One staff account can have several assignments.', 'staffAssignments'],
  ['usersWithParentAccess', 'Users with Parent access', 'Distinct active authenticated users with an accepted active Parent relationship.', 'parentAccess'],
  ['parentContacts', 'Parent and guardian contacts', 'Distinct current, non-revoked contact relationships. Authentication is not required.', 'parentContacts'],
  ['activeParentChildLinks', 'Active Parent-child links', 'Distinct accepted authenticated Parent-to-player relationships.', 'activeParentChildLinks'],
  ['developmentRecords', 'Development records', 'Saved customer Development history, including records whose player lifecycle later changed.', 'developmentRecords'],
]

const PRODUCT_ACTIVITY_CARDS = [
  ['activeUsersToday', 'Active today', 'Distinct authenticated users with a qualifying meaningful action today.'],
  ['activeUsers7Days', 'Active in 7 days', 'Distinct authenticated users with a qualifying meaningful action in the last 7 calendar days.'],
  ['activeUsers30Days', 'Active in 30 days', 'Distinct authenticated users with a qualifying meaningful action in the last 30 calendar days.'],
  ['activeParents', 'Active parents', 'Authenticated parent accounts with qualifying Parent Portal activity in the selected period.'],
  ['activeStaff', 'Active staff', 'Distinct current staff accounts with qualifying staff activity in the selected period.'],
  ['activeClubs', 'Active clubs', 'Clubs with qualifying customer activity in the selected period, excluding internal inspection by default.'],
  ['pageViews', 'Page views', 'Canonical authenticated page-view events in the selected period.'],
  ['meaningfulActions', 'Meaningful actions', 'Approved product outcomes, excluding navigation and authentication-only activity.'],
  ['newActiveUsers', 'New active users', 'Users whose first qualifying product activity falls inside the selected period.'],
  ['returningActiveUsers', 'Returning active users', 'Users active in the selected period with earlier qualifying product activity.'],
]

function labelValue(value) {
  return String(value ?? '')
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatChange(metric) {
  if (!metric?.comparisonAvailable) return 'No previous-period comparison'
  const change = Number(metric.changePercent ?? 0)
  return `${change > 0 ? '+' : ''}${change}% from previous period`
}

function formatMetricValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'Unavailable'
  return Number(value).toLocaleString()
}

function displayCellValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Not observed'
  if (key.toLowerCase().endsWith('at') && !Number.isNaN(new Date(value).getTime())) return new Date(value).toLocaleString('en-GB')
  if (typeof value === 'number') return value.toLocaleString()
  return labelValue(value)
}

function HumanBreakdown({ label, rows = [], total = 0 }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const columns = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => key !== 'count'), [rows])
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(needle)))
  }, [query, rows])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const breakdownTotal = rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0)

  return (
    <div className="mt-3 space-y-3">
      <label className="grid gap-1 text-xs font-black uppercase tracking-[0.08em] text-[var(--text-muted)]">
        Search this breakdown
        <input
          className="min-h-10 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-3 text-sm font-semibold normal-case tracking-normal text-[var(--text-primary)]"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setPage(1)
          }}
          placeholder={`Search ${label.toLowerCase()}`}
        />
      </label>
      {visibleRows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <caption className="sr-only">{label} breakdown. Row counts total {breakdownTotal.toLocaleString()} against a headline of {Number(total ?? 0).toLocaleString()}.</caption>
            <thead><tr>{columns.map((column) => <th key={column} className="border-b border-[var(--border-color)] px-2 py-2 font-black text-[var(--text-muted)]">{labelValue(column)}</th>)}<th className="border-b border-[var(--border-color)] px-2 py-2 text-right font-black text-[var(--text-muted)]">Count</th></tr></thead>
            <tbody>{visibleRows.map((row, index) => <tr key={`${page}-${index}-${JSON.stringify(row)}`} className="border-b border-[var(--border-color)]">{columns.map((column) => <td key={column} className="px-2 py-2 font-semibold text-[var(--text-primary)]">{displayCellValue(column, row[column])}</td>)}<td className="px-2 py-2 text-right font-black text-[var(--text-primary)]">{Number(row.count ?? 0).toLocaleString()}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="font-semibold text-[var(--text-muted)]" role="status">No counted records match this search.</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-[var(--text-muted)]">
        <p>Breakdown total: {breakdownTotal.toLocaleString()}. Headline: {Number(total ?? 0).toLocaleString()}.</p>
        {pageCount > 1 ? <div className="flex items-center gap-2"><button className="min-h-9 rounded-md border border-[var(--border-color)] px-3" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {pageCount}</span><button className="min-h-9 rounded-md border border-[var(--border-color)] px-3" type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button></div> : null}
      </div>
    </div>
  )
}

function OverviewCard({ focusKey = '', label, value, detail = '', definition = '', refreshedAt = '', drilldown }) {
  return (
    <article id={focusKey ? `metric-${focusKey}` : undefined} tabIndex={focusKey ? -1 : undefined} className="scroll-mt-28 rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 shadow-sm focus-within:ring-2 focus-within:ring-[var(--accent)]">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-[var(--text-muted)]" title={definition}>{label}{definition ? ' [?]' : ''}</p>
      <p className="mt-2 text-3xl font-black text-[var(--text-primary)]">{formatMetricValue(value)}</p>
      {detail ? <p className="mt-1 text-xs font-bold text-[var(--text-muted)]">{detail}</p> : null}
      {refreshedAt ? <p className="mt-2 text-xs font-semibold text-[var(--text-muted)]">Refreshed {new Date(refreshedAt).toLocaleString('en-GB')}</p> : null}
      {Array.isArray(drilldown) ? <details className="mt-2 text-xs"><summary className="min-h-9 cursor-pointer py-2 font-black text-[var(--accent)]">View human-readable breakdown</summary><HumanBreakdown label={label} rows={drilldown} total={value} /></details> : null}
    </article>
  )
}

function BarComparison({ title, description = '', rows = [], totalKey = 'count', activeKey = '', emptyMessage = 'No data is available for this scope.' }) {
  const maximum = Math.max(1, ...rows.map((row) => Number(row[totalKey] ?? 0)))
  return (
    <article className="rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
      <h3 className="text-lg font-black text-[var(--text-primary)]">{title}</h3>
      {description ? <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">{description}</p> : null}
      {rows.length ? <div className="mt-4 space-y-3">{rows.map((row) => { const label = row.label || row.role || labelValue(row.state); const total = Number(row[totalKey] ?? 0); const active = activeKey ? Number(row[activeKey] ?? 0) : 0; return <div key={`${label}-${total}`}><div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-black text-[var(--text-primary)]">{label}</span><span className="font-bold text-[var(--text-muted)]">{activeKey ? `${active.toLocaleString()} active of ` : ''}{total.toLocaleString()}</span></div><div className="mt-1 h-3 overflow-hidden rounded-full bg-[var(--panel-alt)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(total ? 2 : 0, (total / maximum) * 100)}%` }}>{activeKey ? <div className="h-full rounded-full bg-emerald-300" style={{ width: `${total ? (active / total) * 100 : 0}%` }} /> : null}</div></div></div> })}</div> : <p className="mt-3 text-sm font-semibold text-[var(--text-muted)]">{emptyMessage}</p>}
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">Tabular values for {title}</caption><thead><tr><th className="py-2 font-black text-[var(--text-muted)]">Group</th>{activeKey ? <th className="py-2 text-right font-black text-[var(--text-muted)]">Active</th> : null}<th className="py-2 text-right font-black text-[var(--text-muted)]">Total</th></tr></thead><tbody>{rows.map((row) => { const label = row.label || row.role || labelValue(row.state); return <tr key={`table-${label}`} className="border-t border-[var(--border-color)]"><th className="py-2 font-bold text-[var(--text-primary)]">{label}</th>{activeKey ? <td className="py-2 text-right font-semibold">{Number(row[activeKey] ?? 0).toLocaleString()}</td> : null}<td className="py-2 text-right font-semibold">{Number(row[totalKey] ?? 0).toLocaleString()}</td></tr> })}</tbody></table></div>
    </article>
  )
}

function TrendChart({ title, description, rows = [], series = [] }) {
  const width = 720
  const height = 180
  const values = rows.flatMap((row) => series.map((item) => Number(row[item.key] ?? 0)))
  const maximum = Math.max(1, ...values)
  const pointsFor = (key) => rows.map((row, index) => `${rows.length <= 1 ? width / 2 : (index / (rows.length - 1)) * width},${height - (Number(row[key] ?? 0) / maximum) * (height - 20)}`).join(' ')
  return (
    <article className="rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
      <h3 className="text-lg font-black text-[var(--text-primary)]">{title}</h3><p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">{description}</p>
      {rows.length ? <><div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-[var(--text-muted)]">{series.map((item) => <span key={item.key} className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />{item.label}</span>)}</div><div className="mt-3 overflow-x-auto"><svg className="h-48 min-w-[40rem] w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${description}`}><line x1="0" y1={height} x2={width} y2={height} stroke="var(--border-color)" />{series.map((item) => <polyline key={item.key} fill="none" stroke={item.color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={pointsFor(item.key)} />)}</svg></div><details className="mt-2 text-xs"><summary className="min-h-9 cursor-pointer py-2 font-black text-[var(--accent)]">View daily values</summary><div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-left"><thead><tr><th className="py-2 font-black">Date</th>{series.map((item) => <th key={item.key} className="py-2 text-right font-black">{item.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.date} className="border-t border-[var(--border-color)]"><th className="py-2 font-bold">{new Date(`${row.date}T12:00:00Z`).toLocaleDateString('en-GB')}</th>{series.map((item) => <td key={item.key} className="py-2 text-right font-semibold">{Number(row[item.key] ?? 0).toLocaleString()}</td>)}</tr>)}</tbody></table></div></details></> : <p className="mt-3 text-sm font-semibold text-[var(--text-muted)]">No trend data matches these filters.</p>}
    </article>
  )
}

function FilterSelect({ label, name, value, options, onChange }) {
  return (
    <label className="grid gap-1 text-xs font-black uppercase tracking-[0.1em] text-slate-600">
      {label}
      <select
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold normal-case tracking-normal text-slate-900"
        name={name}
        value={value}
        onChange={onChange}
      >
        <option value="all">All</option>
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value
          const optionLabel = typeof option === 'string' ? labelValue(option) : option.label
          return <option key={optionValue} value={optionValue}>{optionLabel}</option>
        })}
      </select>
    </label>
  )
}

function HeatmapCell({ value, maximum, detail = null, onSelect = null }) {
  const intensity = maximum ? Math.min(1, Number(value ?? 0) / maximum) : 0
  const backgroundColor = intensity
    ? `color-mix(in srgb, var(--accent) ${Math.max(18, Math.round(intensity * 100))}%, var(--panel-bg))`
    : 'var(--panel-alt)'

  const title = detail
    ? `${detail.day}, ${String(detail.hour).padStart(2, '0')}:00. ${Number(value ?? 0).toLocaleString()} events, ${detail.distinctUsers} users, ${detail.distinctClubs} clubs, ${detail.internalEvents} internal, ${detail.fpTestEvents} FP TEST.`
    : `${Number(value ?? 0).toLocaleString()} events`

  return (
    <td className="min-w-11 border border-[var(--panel-bg)] p-0 text-center text-xs font-black text-[var(--text-primary)]" style={{ backgroundColor }}>
      <button className="min-h-10 w-full px-1 py-2" type="button" title={title} aria-label={title} onClick={() => onSelect?.(detail)}>
        {Number(value ?? 0).toLocaleString()}
      </button>
    </td>
  )
}

function OverallHeatmap({ heatmap }) {
  const [metric, setMetric] = useState('meaningfulActions')
  const [selectedCell, setSelectedCell] = useState(null)
  const values = heatmap?.metrics?.[metric] ?? []
  const maximum = Math.max(0, ...values.flat())
  const visibleTotal = values.flat().reduce((total, value) => total + Number(value ?? 0), 0)
  const sourceTotal = Number(heatmap?.totals?.[metric] ?? 0)

  return (
    <div className="space-y-3">
      <label className="grid max-w-xs gap-1 text-xs font-black uppercase tracking-[0.1em] text-slate-600">
        Heatmap metric
        <select
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold normal-case tracking-normal text-slate-900"
          value={metric}
          onChange={(event) => setMetric(event.target.value)}
        >
          {METRIC_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <p className="text-sm font-black text-slate-700">Displayed events: {visibleTotal.toLocaleString()}. Selected-period total: {sourceTotal.toLocaleString()}{visibleTotal === sourceTotal ? '.' : '. Some selected events are not shown in the grid.'}</p>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="mb-2 text-left text-sm font-black text-slate-900">{labelValue(metric)} by hour and day, UK time</caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-xs font-black text-slate-600">Hour</th>
              {(heatmap?.days ?? []).map((day) => <th key={day} className="px-2 py-2 text-center text-xs font-black text-slate-600">{day.slice(0, 3)}</th>)}
            </tr>
          </thead>
          <tbody>
            {(heatmap?.hours ?? []).map((hour) => (
              <tr key={hour}>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-xs font-black text-slate-800">{String(hour).padStart(2, '0')}:00</th>
                {(values[hour] ?? []).map((value, day) => <HeatmapCell key={day} value={value} maximum={maximum} detail={heatmap?.cells?.[hour]?.[day]} onSelect={setSelectedCell} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedCell ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950" role="status">
          <p className="font-black">Selected hour details</p>
          <p className="mt-1 font-semibold">
            {selectedCell.day}, {String(selectedCell.hour).padStart(2, '0')}:00 Europe/London. Metric: {labelValue(metric)}. Event count: {selectedCell[metric] ?? 0}. Distinct users: {selectedCell.distinctUsers}. Distinct clubs: {selectedCell.distinctClubs}. Internal events: {selectedCell.internalEvents}. FP TEST events: {selectedCell.fpTestEvents}.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function AnalyticsFilters({ filters, options, onChange, onReset }) {
  const handleChange = (event) => {
    const { checked, name, type, value } = event.target
    onChange({ ...filters, [name]: type === 'checkbox' ? checked : value })
  }

  return (
    <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <legend className="px-2 text-sm font-black text-slate-950">Report filters</legend>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs font-black uppercase tracking-[0.1em] text-slate-600">
          Date range
          <select
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold normal-case tracking-normal text-slate-900"
            name="preset"
            value={filters.preset}
            onChange={handleChange}
          >
            {PRESET_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {filters.preset === 'custom' ? (
          <>
            <label className="grid gap-1 text-xs font-black uppercase tracking-[0.1em] text-slate-600">
              Start date
              <input className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900" type="date" name="startDate" value={filters.startDate} onChange={handleChange} />
            </label>
            <label className="grid gap-1 text-xs font-black uppercase tracking-[0.1em] text-slate-600">
              End date
              <input className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900" type="date" name="endDate" value={filters.endDate} onChange={handleChange} />
            </label>
          </>
        ) : null}
        <FilterSelect label="Role" name="role" value={filters.role} options={options.roles ?? []} onChange={handleChange} />
        <FilterSelect label="Platform" name="platform" value={filters.platform} options={options.platforms ?? []} onChange={handleChange} />
        <FilterSelect
          label="Club"
          name="clubId"
          value={filters.clubId}
          options={(options.clubs ?? []).map((club) => ({ value: club.id, label: club.name }))}
          onChange={handleChange}
        />
        <FilterSelect label="Plan" name="plan" value={filters.plan} options={options.plans ?? []} onChange={handleChange} />
        <FilterSelect label="Activity type" name="activityType" value={filters.activityType} options={(options.activityTypes ?? []).map((value) => ({ value, label: labelValue(value) }))} onChange={handleChange} />
        <FilterSelect label="Environment" name="environment" value={filters.environment} options={options.environments ?? []} onChange={handleChange} />
        <FilterSelect label="Page family" name="pageFamily" value={filters.pageFamily} options={options.pageFamilies ?? []} onChange={handleChange} />
        <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800">
          <input type="checkbox" name="includeInternal" checked={Boolean(filters.includeInternal)} onChange={handleChange} />
          Include internal and Platform Admin activity
        </label>
        <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800">
          <input type="checkbox" name="includeFpTest" checked={Boolean(filters.includeFpTest)} onChange={handleChange} />
          Include FP TEST activity and estate
        </label>
        <button className="min-h-11 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-800" type="button" onClick={onReset}>Reset filters</button>
      </div>
      <p className="mt-3 text-xs font-semibold text-slate-600">Date ranges use Europe/London calendar-day boundaries and query UTC timestamps safely.</p>
    </fieldset>
  )
}

export function PlatformAnalyticsSection({
  errorMessage = '',
  filters,
  isLoading = false,
  onFiltersChange,
  onFiltersReset,
  onRefresh,
  report,
}) {
  const overview = report?.overview ?? {}
  const accountEstate = report?.accountEstate ?? {}
  const authentication = report?.authentication ?? {}
  const productActivity = report?.productActivity ?? {}
  const dataQuality = report?.dataQuality ?? {}
  const processor = report?.processor ?? {}
  const maintenance = report?.maintenanceWindow
  const parentStages = report?.parentAdoption?.stages ?? []
  const trend = report?.trend ?? []
  const staffRoleAdoption = report?.staffRoleAdoption ?? []
  const workspaceActivity = report?.workspaceActivity ?? {}
  const requestedFocus = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('focus') || ''

  useEffect(() => {
    if (!report || typeof window === 'undefined') return undefined
    const focus = requestedFocus
    if (!focus) return undefined
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`metric-${focus}`) || document.getElementById(`analytics-${focus}`)
      target?.querySelector('details')?.setAttribute('open', '')
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [report, requestedFocus])

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="platform-analytics-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-teal-700">Privacy-safe aggregate reporting</p>
          <h2 id="platform-analytics-title" className="mt-1 text-2xl font-black text-slate-950">Platform analytics</h2>
          <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-600">
            Review authenticated usage, adoption, and operational patterns. Reports exclude child names, messages, notes, search text, and free-text metadata.
          </p>
        </div>
        <button
          className="min-h-11 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={isLoading}
          onClick={onRefresh}
        >
          {isLoading ? 'Refreshing analytics' : 'Refresh analytics'}
        </button>
      </div>

      <AnalyticsFilters filters={filters} options={report?.options ?? {}} onChange={onFiltersChange} onReset={onFiltersReset} />

      {errorMessage ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3" role="alert">
          <p className="font-black text-amber-950">Analytics data is not available</p>
          <p className="mt-1 text-sm font-semibold text-amber-900">{errorMessage}</p>
        </div>
      ) : null}

      {!report && isLoading ? <p className="text-sm font-bold text-slate-600" role="status">Loading aggregate analytics.</p> : null}
      {!report && !isLoading && !errorMessage ? <p className="text-sm font-bold text-slate-600">No aggregate analytics are available yet.</p> : null}

      {report ? (
        <>
          {report.dataState !== 'available' ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3" role="status">
              <p className="font-black text-slate-900">
                {report.dataState === 'empty' ? 'No activity matches these filters' : 'Insufficient analytics history'}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {report.dataState === 'empty'
                  ? 'Change the report filters to inspect another period or audience.'
                  : 'Aggregate reporting will become available after privacy-safe events have been processed.'}
              </p>
            </div>
          ) : null}

          <SectionCard title="Account estate" description="Current canonical account and football-record counts. Date and activity filters do not rewrite current-state definitions." storageKey="platform-analytics-account-estate">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {ACCOUNT_ESTATE_CARDS.map(([key, label, definition, drillKey]) => (
                <OverviewCard
                  key={key}
                  focusKey={key}
                  label={label}
                  value={accountEstate[key]}
                  definition={definition}
                  refreshedAt={report.generatedAt}
                  drilldown={drillKey ? accountEstate.drilldown?.[drillKey] ?? [] : undefined}
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Authentication" description="Authentication activity is reported separately from qualifying product activity." storageKey="platform-analytics-authentication">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <OverviewCard label="Successful logins today" value={authentication.successfulLoginsToday ?? overview.successfulLoginsToday} definition="Successful authentication events today in Europe/London time." refreshedAt={report.generatedAt} drilldown={authentication.drilldown} />
              <OverviewCard label="Successful logins in period" value={authentication.successfulLoginsSelected ?? overview.selectedSuccessfulLogins?.current} definition="Successful authentication events in the selected period." refreshedAt={report.generatedAt} drilldown={authentication.drilldown} />
              <OverviewCard label="Distinct users logging in" value={authentication.distinctUsersLoggingIn ?? overview.distinctUsersLoggingIn} definition="Distinct authenticated actors with a successful login event in the selected period." refreshedAt={report.generatedAt} drilldown={authentication.drilldown} />
              <OverviewCard label="Failed logins" value={authentication.failedLoginsAvailable ? authentication.failedLogins : null} detail={authentication.failedLoginsAvailable ? 'Privacy-safe failure count' : 'Failure telemetry is unavailable'} definition="Failed authentication attempts where privacy-safe telemetry is available." refreshedAt={report.generatedAt} />
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">First successful parent login</p><p className="mt-2 text-sm font-black text-slate-950">{authentication.firstParentLoginAt ? new Date(authentication.firstParentLoginAt).toLocaleString('en-GB') : 'Not observed'}</p></article>
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">First successful staff login</p><p className="mt-2 text-sm font-black text-slate-950">{authentication.firstStaffLoginAt ? new Date(authentication.firstStaffLoginAt).toLocaleString('en-GB') : 'Not observed'}</p></article>
            </div>
            <div className="mt-5">
              <TrendChart
                title="Authentication trend"
                description="Daily successful logins, distinct users who logged in, and privacy-safe failed-login telemetry."
                rows={trend}
                series={[
                  { key: 'successfulLogins', label: 'Successful logins', color: 'var(--accent)' },
                  { key: 'uniqueLoginUsers', label: 'Users logging in', color: '#38bdf8' },
                  { key: 'failedLogins', label: 'Failed logins', color: '#f97316' },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard title="Product activity" description="Qualifying product activity is distinct from login and page navigation." storageKey="platform-analytics-product-activity">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {PRODUCT_ACTIVITY_CARDS.map(([key, label, definition]) => (
                <OverviewCard key={key} label={label} value={productActivity[key] ?? ({
                  activeUsersToday: overview.activeUsersToday,
                  activeUsers7Days: overview.activeUsers7Days,
                  activeUsers30Days: overview.activeUsers30Days,
                  activeParents: overview.activeParents,
                  activeStaff: overview.activeStaff,
                  activeClubs: overview.activeClubs,
                  pageViews: overview.pageViews?.current,
                  meaningfulActions: overview.meaningfulActions,
                  newActiveUsers: overview.newUsers,
                  returningActiveUsers: overview.returningUsers,
                })[key]} definition={definition} refreshedAt={report.generatedAt} drilldown={key === 'pageViews' ? productActivity.pageDrilldown : productActivity.drilldown} />
              ))}
            </div>
            <div id="analytics-productActivity" tabIndex="-1" className="mt-5 grid scroll-mt-28 gap-5 xl:grid-cols-2">
              <TrendChart
                title="Product activity trend"
                description="Daily meaningful actions, active users, and page views using the selected filters."
                rows={trend}
                series={[
                  { key: 'meaningfulActions', label: 'Meaningful actions', color: 'var(--accent)' },
                  { key: 'activeUsers', label: 'Active users', color: '#38bdf8' },
                  { key: 'pageViews', label: 'Page views', color: '#a78bfa' },
                ]}
              />
              <TrendChart
                title="New and returning activity"
                description="Daily active users grouped by whether their first observed meaningful action happened that day."
                rows={trend}
                series={[
                  { key: 'newActiveUsers', label: 'New active users', color: '#34d399' },
                  { key: 'returningActiveUsers', label: 'Returning active users', color: '#f59e0b' },
                ]}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Page and role activity"
            description="Top routes and privacy-safe role totals for the selected period."
            defaultCollapsed
            storageKey="platform-analytics-page-role"
          >
          <div className="grid gap-5 xl:grid-cols-2">
            <article className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-lg font-black text-slate-950">Top pages</h3>
              <div className="mt-3 space-y-3">
                {report.topPages.length ? report.topPages.slice(0, 10).map((page) => (
                  <div key={page.route}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-black text-slate-900" title={page.route}>{page.label || page.route}</span>
                      <span className="font-bold text-slate-600">{page.pageViews.toLocaleString()} views, {page.uniqueUsers.toLocaleString()} users, {page.percentage}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.max(1, page.percentage)}%` }} />
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-500">{formatChange(page.comparison)}</p>
                  </div>
                )) : <p className="text-sm font-bold text-slate-500">No page views match these filters.</p>}
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-lg font-black text-slate-950">Activity by role at event time</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">Historical events keep their authoritative workspace role. Current account roles are reported separately in Staff activity.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr><th className="py-2 font-black text-slate-600">Role</th><th className="py-2 text-right font-black text-slate-600">Active users</th><th className="py-2 text-right font-black text-slate-600">Actions</th></tr></thead>
                  <tbody>
                    {report.roleActivity.length ? report.roleActivity.map((row) => <tr key={row.role} className="border-t border-slate-100"><th className="py-2 font-black text-slate-900">{labelValue(row.role)}</th><td className="py-2 text-right font-bold">{Number(row.activeUsers ?? 0).toLocaleString()}</td><td className="py-2 text-right font-bold">{Number(row.meaningfulActions ?? 0).toLocaleString()}</td></tr>) : <tr><td className="py-3 font-semibold text-slate-500" colSpan="3">No qualifying role activity matches these filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
          </SectionCard>

          <SectionCard
            title="Activity heatmap"
            description="Choose one event basis. Every cell uses the same filters and Europe/London time."
            defaultCollapsed
            storageKey="platform-analytics-overall-heatmap"
          >
            <p className="mb-4 text-sm font-semibold text-slate-600">Monday to Sunday and 00:00 to 23:00. Select a cell for privacy-safe counts of events, users, clubs, internal activity, and FP TEST activity.</p>
            <OverallHeatmap heatmap={report.overallHeatmap} />
          </SectionCard>

          <SectionCard
            title="Parent adoption"
            description="Contacts, authenticated accounts, observed login, activation, and selected-period activity remain distinct."
            defaultCollapsed
            storageKey="platform-analytics-parent-adoption"
          >
            <article className="rounded-xl border border-slate-200 p-4">
              <ol className="mt-3 space-y-2">
                {parentStages.map((stage) => (
                  <li key={stage.key} className="flex items-start justify-between gap-3 text-sm">
                    <span className="font-bold text-slate-700">{stage.label}</span>
                    <span className="font-black text-slate-950">{stage.available ? stage.count.toLocaleString() : 'Unavailable'}</span>
                  </li>
                ))}
              </ol>
            </article>
            <div className="mt-5">
              <BarComparison title="Parent adoption stages" description="Each stage is a distinct population and is not presented as a conversion rate." rows={parentStages.filter((stage) => stage.available)} />
            </div>
          </SectionCard>

          <SectionCard title="Staff activity" description="Current accounts and assignments are separate from selected-period staff activity." defaultCollapsed forceOpen={requestedFocus === 'staffAccounts'} storageKey="platform-analytics-staff-activity">
            <div id="analytics-staffAccounts" tabIndex="-1" className="grid scroll-mt-28 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard label="Staff accounts" value={report.staffAccounts?.authenticatedStaffAccounts} definition="Distinct active customer staff profiles, whether or not they currently have a team assignment." refreshedAt={report.generatedAt} />
              <OverviewCard label="Staff assignments" value={report.staffAccounts?.assignmentCount} definition="Current team-role assignments. One account may have several assignments." refreshedAt={report.generatedAt} />
              <OverviewCard label="Multi-team staff" value={report.staffAccounts?.multiTeamAccounts} definition="Current staff accounts assigned to more than one team." refreshedAt={report.generatedAt} />
              <OverviewCard label="Active staff" value={report.staffAccounts?.activeStaffAccounts} definition="Current staff accounts with qualifying activity in the selected period." refreshedAt={report.generatedAt} />
            </div>
            <div className="mt-5">
              <BarComparison title="Staff accounts by role" description="Total current customer staff accounts compared with accounts that had meaningful activity in the selected period." rows={staffRoleAdoption} totalKey="totalAccounts" activeKey="activeAccounts" />
            </div>
          </SectionCard>

          <SectionCard title="Club adoption and dormancy" description="Current club estate, lifecycle evidence, and operationally honest dormancy states." defaultCollapsed storageKey="platform-analytics-club-adoption">
            <div className="grid gap-5 xl:grid-cols-2">
              <div id="analytics-workspaceActivity" tabIndex="-1" className="scroll-mt-28">
                <BarComparison title="Customer workspace activity" description={workspaceActivity.definition} rows={workspaceActivity.states ?? []} />
                <details className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--panel-bg)] p-4 text-xs"><summary className="min-h-9 cursor-pointer py-2 font-black text-[var(--accent)]">View workspace status breakdown</summary><HumanBreakdown label="Customer workspace activity" rows={workspaceActivity.drilldown ?? []} total={accountEstate.customerWorkspaces ?? 0} /></details>
              </div>
              <article className="rounded-xl border border-slate-200 p-4">
                <h3 className="text-lg font-black text-slate-950">Club activity</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-600">Active</dt><dd className="mt-1 text-xl font-black text-slate-950">{formatMetricValue(report.clubActivity?.active)}</dd></div>
                  <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-600">Never activated</dt><dd className="mt-1 text-xl font-black text-slate-950">{formatMetricValue(report.clubActivity?.neverActivated)}</dd></div>
                  <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-600">Dormant 30 days</dt><dd className="mt-1 text-xl font-black text-slate-950">{formatMetricValue(report.clubActivity?.dormancy?.['30Days'])}</dd></div>
                  <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-600">Insufficient history</dt><dd className="mt-1 text-xl font-black text-slate-950">{formatMetricValue(report.clubActivity?.dormancy?.insufficientHistory)}</dd></div>
                </dl>
              </article>
            <article className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-lg font-black text-slate-950">Quiet-window guidance</h3>
              {maintenance?.available ? (
                <>
                  <p className="mt-3 text-2xl font-black text-slate-950">{maintenance.day}, {String(maintenance.startHour).padStart(2, '0')}:00 to {String(maintenance.endHour).padStart(2, '0')}:00</p>
                  <p className="mt-2 text-sm font-bold text-slate-600">{maintenance.confidence} confidence across {maintenance.weeksAnalyzed} weeks. Peak active users: {maintenance.maximumActiveUsers}.</p>
                  <p className="mt-2 text-sm font-semibold text-slate-600">{maintenance.message}</p>
                </>
              ) : <p className="mt-3 text-sm font-bold text-slate-600">{maintenance?.message || 'Insufficient data.'}</p>}
            </article>
            </div>
          </SectionCard>

          <SectionCard title="Data quality and processor state" description="Read-only guidance for attribution, freshness, quarantine, and processing health." defaultCollapsed storageKey="platform-analytics-data-quality">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard label="Unattributed users" value={dataQuality.unattributedUsers} definition="Selected events without an authoritative actor profile." refreshedAt={report.generatedAt} />
              <OverviewCard label="Unattributed roles" value={dataQuality.unattributedRoles} definition="Selected events whose event-time role family is unknown." refreshedAt={report.generatedAt} />
              <OverviewCard label="Unattributed clubs" value={dataQuality.unattributedClubs} definition="Selected customer events without a club attribution." refreshedAt={report.generatedAt} />
              <OverviewCard label="Unknown event names" value={dataQuality.unknownEventNames} definition="Selected events outside the approved event category registry." refreshedAt={report.generatedAt} />
              <OverviewCard label="Quarantined events" value={dataQuality.quarantinedEvents} definition="Unresolved privacy-safe processor quarantine records." refreshedAt={report.generatedAt} />
              <OverviewCard label="Unprocessed events" value={dataQuality.unprocessedEvents} definition="Canonical events still waiting for processor completion." refreshedAt={report.generatedAt} />
              <OverviewCard label="Internal events" value={dataQuality.internalEvents} definition="Selected events classified as internal or Platform Admin." refreshedAt={report.generatedAt} />
              <OverviewCard label="FP TEST events" value={dataQuality.fpTestEvents} definition="Selected events classified to the controlled FP TEST scope." refreshedAt={report.generatedAt} />
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div><dt className="font-black text-slate-700">Last event received</dt><dd className="font-semibold text-slate-600">{processor.lastEventReceivedAt ? new Date(processor.lastEventReceivedAt).toLocaleString('en-GB') : 'Not observed'}</dd></div>
              <div><dt className="font-black text-slate-700">Last processor success</dt><dd className="font-semibold text-slate-600">{processor.lastProcessorSuccessAt ? new Date(processor.lastProcessorSuccessAt).toLocaleString('en-GB') : 'Not observed'}</dd></div>
              <div><dt className="font-black text-slate-700">Last aggregate refresh</dt><dd className="font-semibold text-slate-600">{processor.lastAggregateRefreshAt ? new Date(processor.lastAggregateRefreshAt).toLocaleString('en-GB') : 'Not observed'}</dd></div>
              <div><dt className="font-black text-slate-700">Processing lag</dt><dd className="font-semibold text-slate-600">{formatMetricValue(processor.processingLagSeconds)} seconds</dd></div>
              <div><dt className="font-black text-slate-700">Duplicate suppression</dt><dd className="font-semibold text-slate-600">{dataQuality.duplicateEventsState || 'Unavailable'}</dd></div>
              <div><dt className="font-black text-slate-700">Capture began</dt><dd className="font-semibold text-slate-600">{dataQuality.historicalCoverageStart || report.identityCaptureStartDate || 'Not observed'}</dd></div>
            </dl>
            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-600">Guidance only. Investigate delayed processing or unattributed evidence at source. This dashboard does not delete or rewrite raw analytics evidence.</p>
          </SectionCard>

          <SectionCard
            title="Definitions and exclusions"
            description="How aggregate measures are calculated and which activity is excluded."
            defaultCollapsed
            storageKey="platform-analytics-definitions"
          >
            <dl className="mt-3 space-y-3 text-sm">
              {Object.entries(report.definitions).filter(([, value]) => typeof value === 'string').map(([key, value]) => <div key={key}><dt className="font-black text-slate-900">{labelValue(key)}</dt><dd className="font-semibold text-slate-600">{value}</dd></div>)}
            </dl>
            <p className="mt-3 text-sm font-bold text-slate-600">
              Internal inclusion is {filters.includeInternal ? 'on' : 'off'}. FP TEST inclusion is {filters.includeFpTest ? 'on' : 'off'}. Environment: {labelValue(filters.environment)}.
            </p>
          </SectionCard>
        </>
      ) : null}
    </section>
  )
}
