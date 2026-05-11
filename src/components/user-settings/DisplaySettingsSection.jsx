import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { themeAccentOptions, themeModeOptions } from '../../lib/theme.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function DisplaySettingsSection({
  canUseThemes,
  onThemeAccentChange,
  onThemeModeChange,
  themeAccent,
  themeMode,
}) {
  return (
    <SectionCard
      title="Display"
      description="Choose the theme and accent colour for your workspace."
      tourId="display-settings"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Theme</span>
          <select
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value)}
            disabled={!canUseThemes}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          >
            {themeModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Accent colour</span>
          <select
            value={themeAccent}
            onChange={(event) => onThemeAccentChange(event.target.value)}
            disabled={!canUseThemes}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          >
            {themeAccentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!canUseThemes ? (
        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{createFeatureUpgradeMessage('themes')}</p>
      ) : null}
    </SectionCard>
  )
}
