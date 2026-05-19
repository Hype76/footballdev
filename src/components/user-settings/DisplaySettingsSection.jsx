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
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Theme</span>
          <select
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
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
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          >
            {themeAccentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Button style</span>
          <select
            value={themeButtonStyle}
            onChange={(event) => onThemeButtonStyleChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
          >
            {themeButtonStyleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">Preview</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <span
            aria-hidden="true"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90"
          >
            Primary action
          </span>
          <span className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
            Accent state
          </span>
        </div>
      </div>
      {!canUseThemes ? (
        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">{createFeatureUpgradeMessage('themes')}</p>
      ) : null}
    </SectionCard>
  )
}
