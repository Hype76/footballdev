import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { themeAccentOptions, themeButtonStyleOptions, themeModeOptions } from '../../lib/theme.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function DisplaySettingsSection({
  canUseThemes,
  onThemeAccentChange,
  onThemeButtonStyleChange,
  onThemeModeChange,
  themeButtonStyle,
  themeAccent,
  themeMode,
}) {
  return (
    <SectionCard
      title="Display"
      description="Choose the shared theme and button style for your active team."
      tourId="display-settings"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Theme</span>
          <select
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            {themeModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Accent colour</span>
          <select
            value={themeAccent}
            onChange={(event) => onThemeAccentChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            {themeAccentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-950">Button style</span>
          <select
            value={themeButtonStyle}
            onChange={(event) => onThemeButtonStyleChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className="min-h-11 w-full rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
          >
            {themeButtonStyleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Preview</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <span
            aria-hidden="true"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            Primary action
          </span>
          <span className="inline-flex min-h-11 items-center justify-center rounded-md border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950">
            Accent state
          </span>
        </div>
      </div>
      {!canUseThemes ? (
        <p className="mt-3 text-xs leading-5 text-slate-600">{createFeatureUpgradeMessage('themes')}</p>
      ) : null}
    </SectionCard>
  )
}
