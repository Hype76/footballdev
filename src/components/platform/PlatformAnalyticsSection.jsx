import { useState } from 'react'
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
  ['clubs', 'Clubs', 'Current active clubs in the selected commercial scope.', 'clubs'],
  ['teams', 'Teams', 'Current active teams belonging to counted clubs.', 'teams'],
  ['activePlayers', 'Active players', 'Current active players with a valid active team and club.', 'activePlayers'],
  ['authenticatedStaffAccounts', 'Authenticated staff accounts', 'Distinct active authenticated staff users with at least one current team assignment.', 'staffAccounts'],
  ['authenticatedParentAccounts', 'Authenticated parent accounts', 'Distinct active authenticated users with at least one accepted current parent relationship.', 'parentAccounts'],
  ['parentContacts', 'Parent and guardian contacts', 'Distinct non-revoked parent or guardian contact relationships, whether or not authenticated.', 'parentContacts'],
  ['activeParentChildLinks', 'Active parent-child links', 'Distinct accepted authenticated parent-to-player relationships.', 'activeParentChildLinks'],
  ['parentOnlyAccounts', 'Parent-only accounts', 'Authenticated parent accounts with no current staff assignment.', 'parentOnlyAccounts'],
  ['staffWithParentAccess', 'Staff with parent access', 'Authenticated parent accounts that also have a current staff assignment.', 'staffWithParentAccess'],
  ['developmentRecords', 'Development records', 'Current saved development records in the selected club scope.', 'developmentRecords'],
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

function OverviewCard({ label, value, detail = '', definition = '', refreshedAt = '', drilldown = [] }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500" title={definition}>{label}{definition ? ' ⓘ' : ''}</p>
      <p className="mt-2 text-3xl font-black text-slate-950">{formatMetricValue(value)}</p>
      {detail ? <p className="mt-1 text-xs font-bold text-slate-500">{detail}</p> : null}
      {refreshedAt ? <p className="mt-2 text-xs font-semibold text-slate-500">Refreshed {new Date(refreshedAt).toLocaleString('en-GB')}</p> : null}
      {Array.isArray(drilldown) ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-black text-teal-800">Reconciliation detail</summary>
          {drilldown.length ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto font-mono text-slate-600">
              {drilldown.slice(0, 50).map((row) => <li key={`${row.id}-${row.clubId || ''}`}>{row.id}{row.clubId ? ` · club ${row.clubId}` : ''}{row.eventCount !== undefined ? ` · ${row.eventCount} events` : ''}{row.firstQualifyingAt ? ` · first ${row.firstQualifyingAt}` : ''}{row.lastQualifyingAt ? ` · last ${row.lastQualifyingAt}` : ''}</li>)}
            </ul>
          ) : <p className="mt-2 font-semibold text-slate-500">No counted records for this scope.</p>}
        </details>
      ) : null}
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
      <p className="text-sm font-black text-slate-700">Visible cells: {visibleTotal.toLocaleString()}. Source total: {sourceTotal.toLocaleString()}. Result: {visibleTotal === sourceTotal ? 'Reconciled' : 'Mismatch'}.</p>

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
          <p className="font-black">Cell reconciliation</p>
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
            description="Choose one event basis. Every cell reconciles to the same shared filters and Europe/London time."
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
          </SectionCard>

          <SectionCard title="Staff activity" description="Current accounts and assignments are separate from selected-period staff activity." defaultCollapsed storageKey="platform-analytics-staff-activity">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <OverviewCard label="Staff accounts" value={report.staffAccounts?.authenticatedStaffAccounts} definition="Distinct current authenticated staff accounts with a valid assignment." refreshedAt={report.generatedAt} />
              <OverviewCard label="Staff assignments" value={report.staffAccounts?.assignmentCount} definition="Current team-role assignments. One account may have several assignments." refreshedAt={report.generatedAt} />
              <OverviewCard label="Multi-team staff" value={report.staffAccounts?.multiTeamAccounts} definition="Current staff accounts assigned to more than one team." refreshedAt={report.generatedAt} />
              <OverviewCard label="Active staff" value={report.staffAccounts?.activeStaffAccounts} definition="Current staff accounts with qualifying activity in the selected period." refreshedAt={report.generatedAt} />
            </div>
          </SectionCard>

          <SectionCard title="Club adoption and dormancy" description="Current club estate, lifecycle evidence, and operationally honest dormancy states." defaultCollapsed storageKey="platform-analytics-club-adoption">
            <div className="grid gap-5 xl:grid-cols-2">
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
