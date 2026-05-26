import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { themeAccentOptions, themeButtonStyleOptions, themeModeOptions } from '../../lib/theme.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#10231a]'
const selectClass = 'min-h-11 w-full rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] px-4 py-3 text-sm font-semibold text-[#10231a] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5] disabled:cursor-not-allowed disabled:opacity-60'

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
          <span className={labelClass}>Theme</span>
          <select
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className={selectClass}
          >
            {themeModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelClass}>Accent colour</span>
          <select
            value={themeAccent}
            onChange={(event) => onThemeAccentChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className={selectClass}
          >
            {themeAccentOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={labelClass}>Button style</span>
          <select
            value={themeButtonStyle}
            onChange={(event) => onThemeButtonStyleChange(event.target.value)}
            disabled={!canUseThemes}
            title={!canUseThemes ? createFeatureUpgradeMessage('themes') : undefined}
            className={selectClass}
          >
            {themeButtonStyleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 rounded-lg border border-[#bfe8cd] bg-[#f8fdf9] p-4 shadow-sm shadow-[#d7eadf]/60">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-[#067a46]">Preview</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <span
            aria-hidden="true"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a]"
          >
            Primary action
          </span>
          <span className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#9addb4] bg-white px-4 py-3 text-sm font-black text-[#10231a]">
            Accent state
          </span>
        </div>
      </div>
      {!canUseThemes ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-[#5f7468]">{createFeatureUpgradeMessage('themes')}</p>
      ) : null}
    </SectionCard>
  )
}
