import { useMemo, useState } from 'react'

const PRESET_OPTIONS = [
  ['today', 'Today'],
  ['7_days', 'Last 7 days'],
  ['30_days', 'Last 30 days'],
  ['90_days', 'Last 90 days'],
  ['custom', 'Custom range'],
]

const METRIC_OPTIONS = [
  ['meaningfulActions', 'Meaningful actions'],
  ['activeUsers', 'Active users'],
  ['successfulLogins', 'Successful logins'],
  ['pageViews', 'Page views'],
  ['parentActivity', 'Parent activity'],
  ['staffActivity', 'Staff activity'],
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

function OverviewCard({ label, value, detail = '' }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{Number(value ?? 0).toLocaleString()}</p>
      {detail ? <p className="mt-1 text-xs font-bold text-slate-500">{detail}</p> : null}
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

function HeatmapCell({ value, maximum }) {
  const intensity = maximum ? Math.min(1, Number(value ?? 0) / maximum) : 0
  const backgroundColor = intensity
    ? `color-mix(in srgb, #0f766e ${Math.max(18, Math.round(intensity * 100))}%, white)`
    : '#f8fafc'

  return (
    <td
      className="min-w-11 border border-white px-1 py-2 text-center text-xs font-black text-slate-900"
      style={{ backgroundColor }}
      title={`${Number(value ?? 0).toLocaleString()} events`}
    >
      {Number(value ?? 0).toLocaleString()}
    </td>
  )
}

function PageHeatmap({ heatmap }) {
  const maximum = useMemo(
    () => Math.max(0, ...(heatmap?.rows ?? []).flatMap((row) => [...row.byHour, ...row.byDay])),
    [heatmap],
  )

  if (!heatmap?.rows?.length) {
    return <p className="text-sm font-bold text-slate-500">No page activity is available for these filters.</p>
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="mb-2 text-left text-sm font-black text-slate-900">Page activity by hour, UK time</caption>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white px-2 py-2 text-xs font-black text-slate-600">Route</th>
              {heatmap.hours.map((hour) => <th key={hour} className="px-1 py-2 text-center text-xs font-black text-slate-600">{String(hour).padStart(2, '0')}</th>)}
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((row) => (
              <tr key={row.route}>
                <th className="sticky left-0 z-10 max-w-44 truncate bg-white px-2 py-2 text-xs font-black text-slate-800" title={row.route}>{row.route}</th>
                {row.byHour.map((value, hour) => <HeatmapCell key={hour} value={value} maximum={maximum} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-left">
          <caption className="mb-2 text-left text-sm font-black text-slate-900">Page activity by day</caption>
          <thead>
            <tr>
              <th className="px-2 py-2 text-xs font-black text-slate-600">Route</th>
              {heatmap.days.map((day) => <th key={day} className="px-2 py-2 text-center text-xs font-black text-slate-600">{day.slice(0, 3)}</th>)}
            </tr>
          </thead>
          <tbody>
            {heatmap.rows.map((row) => (
              <tr key={row.route}>
                <th className="max-w-44 truncate px-2 py-2 text-xs font-black text-slate-800" title={row.route}>{row.route}</th>
                {row.byDay.map((value, day) => <HeatmapCell key={day} value={value} maximum={maximum} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OverallHeatmap({ heatmap }) {
  const [metric, setMetric] = useState('meaningfulActions')
  const values = heatmap?.metrics?.[metric] ?? []
  const maximum = Math.max(0, ...values.flat())

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
                {(values[hour] ?? []).map((value, day) => <HeatmapCell key={day} value={value} maximum={maximum} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AnalyticsFilters({ filters, options, onChange }) {
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
        <FilterSelect label="Page" name="route" value={filters.route} options={options.routes ?? []} onChange={handleChange} />
        <label className="flex min-h-11 items-center gap-3 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800">
          <input type="checkbox" name="includeExcluded" checked={filters.includeExcluded} onChange={handleChange} />
          Include test, demo, Platform Admin, and non-production activity
        </label>
      </div>
    </fieldset>
  )
}

export function PlatformAnalyticsSection({
  errorMessage = '',
  filters,
  isLoading = false,
  onFiltersChange,
  onRefresh,
  report,
}) {
  const overview = report?.overview ?? {}
  const maintenance = report?.maintenanceWindow
  const parentStages = report?.parentAdoption?.stages ?? []

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

      <AnalyticsFilters filters={filters} options={report?.options ?? {}} onChange={onFiltersChange} />

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

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewCard label="Active today" value={overview.activeUsersToday} />
            <OverviewCard label="Active in 7 days" value={overview.activeUsers7Days} />
            <OverviewCard label="Active in 30 days" value={overview.activeUsers30Days} />
            <OverviewCard label="Selected active users" value={overview.selectedActiveUsers?.current} detail={formatChange(overview.selectedActiveUsers)} />
            <OverviewCard label="Successful logins today" value={overview.successfulLoginsToday} />
            <OverviewCard label="Selected successful logins" value={overview.selectedSuccessfulLogins?.current} detail={formatChange(overview.selectedSuccessfulLogins)} />
            <OverviewCard label="New active users" value={overview.newUsers} />
            <OverviewCard label="Returning active users" value={overview.returningUsers} />
            <OverviewCard label="Active parents" value={overview.activeParents} />
            <OverviewCard label="Active staff" value={overview.activeStaff} />
            <OverviewCard label="Active clubs" value={overview.activeClubs} />
            <OverviewCard label="Page views" value={overview.pageViews?.current} detail={formatChange(overview.pageViews)} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <article className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-lg font-black text-slate-950">Top pages</h3>
              <div className="mt-3 space-y-3">
                {report.topPages.length ? report.topPages.slice(0, 10).map((page) => (
                  <div key={page.route}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-black text-slate-900">{page.route}</span>
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
              <h3 className="text-lg font-black text-slate-950">Activity by role</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr><th className="py-2 font-black text-slate-600">Role</th><th className="py-2 text-right font-black text-slate-600">Active users</th><th className="py-2 text-right font-black text-slate-600">Actions</th></tr></thead>
                  <tbody>
                    {report.roleActivity.map((row) => <tr key={row.role} className="border-t border-slate-100"><th className="py-2 font-black text-slate-900">{labelValue(row.role)}</th><td className="py-2 text-right font-bold">{row.activeUsers.toLocaleString()}</td><td className="py-2 text-right font-bold">{row.meaningfulActions.toLocaleString()}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <article className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-lg font-black text-slate-950">Top-page heatmaps</h3>
            <p className="mb-4 text-sm font-semibold text-slate-600">Exact values remain visible in every cell for screen readers and low-colour environments.</p>
            <PageHeatmap heatmap={report.pageHeatmap} />
          </article>

          <article className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-lg font-black text-slate-950">Overall platform heatmap</h3>
            <p className="mb-4 text-sm font-semibold text-slate-600">Choose one aggregate metric. Hours use Europe/London time.</p>
            <OverallHeatmap heatmap={report.overallHeatmap} />
          </article>

          <div className="grid gap-5 xl:grid-cols-3">
            <article className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-lg font-black text-slate-950">Parent adoption</h3>
              <ol className="mt-3 space-y-2">
                {parentStages.map((stage) => (
                  <li key={stage.key} className="flex items-start justify-between gap-3 text-sm">
                    <span className="font-bold text-slate-700">{stage.label}</span>
                    <span className="font-black text-slate-950">{stage.available ? stage.count.toLocaleString() : 'Unavailable'}</span>
                  </li>
                ))}
              </ol>
            </article>

            <article className="rounded-xl border border-slate-200 p-4">
              <h3 className="text-lg font-black text-slate-950">Club activity</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                {Object.entries(report.clubActivity).map(([key, value]) => <div key={key} className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-600">{labelValue(key)}</dt><dd className="mt-1 text-xl font-black text-slate-950">{Number(value ?? 0).toLocaleString()}</dd></div>)}
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

          <details className="rounded-xl border border-slate-200 p-4">
            <summary className="cursor-pointer text-base font-black text-slate-950">Definitions and exclusions</summary>
            <dl className="mt-3 space-y-3 text-sm">
              {Object.entries(report.definitions).map(([key, value]) => <div key={key}><dt className="font-black text-slate-900">{labelValue(key)}</dt><dd className="font-semibold text-slate-600">{value}</dd></div>)}
            </dl>
            <p className="mt-3 text-sm font-bold text-slate-600">
              Default exclusions are {report.exclusionsActive ? 'active' : 'disabled'} for test accounts, demo accounts, Platform Admin activity, and non-production environments.
            </p>
          </details>
        </>
      ) : null}
    </section>
  )
}
