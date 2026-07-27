import { themeAccentOptions, themeButtonStyleOptions, themeModeOptions } from '../../lib/theme.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const selectClass = 'min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--panel-bg)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'

export function DisplaySettingsSection({
  canEditBranding,
  brandingUnavailableMessage,
  onThemeAccentChange,
  onThemeButtonStyleChange,
  onThemeModeChange,
  themeButtonStyle,
  themeAccent,
  themeMode,
  showBrandingControls = false,
}) {
  return (
    <SectionCard
      title="Display"
      description={showBrandingControls ? 'Choose your display mode and manage club branding.' : 'Choose your display mode.'}
      tourId="display-settings"
    >
      <div className={showBrandingControls ? 'grid gap-4 md:grid-cols-3' : 'grid gap-4 md:grid-cols-1'}>
        <label className="block">
          <span className={labelClass}>Theme</span>
          <select
            value={themeMode}
            onChange={(event) => onThemeModeChange(event.target.value)}
            className={selectClass}
          >
            {themeModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {showBrandingControls ? (
          <label className="block">
            <span className={labelClass}>Accent colour</span>
            <select
              value={themeAccent}
              onChange={(event) => onThemeAccentChange(event.target.value)}
              disabled={!canEditBranding}
              title={!canEditBranding ? brandingUnavailableMessage : undefined}
              className={selectClass}
            >
              {themeAccentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {showBrandingControls ? (
          <label className="block">
            <span className={labelClass}>Button style</span>
            <select
              value={themeButtonStyle}
              onChange={(event) => onThemeButtonStyleChange(event.target.value)}
              disabled={!canEditBranding}
              title={!canEditBranding ? brandingUnavailableMessage : undefined}
              className={selectClass}
            >
              {themeButtonStyleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {showBrandingControls ? (
        <div className="mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 shadow-sm shadow-[#101828]/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-secondary)]">Preview</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <span
              aria-hidden="true"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-black text-[var(--button-primary-text)] shadow-sm shadow-[#101828]/10 transition"
            >
              Primary action
            </span>
            <span className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--accent)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-black text-[var(--text-primary)] shadow-sm shadow-[#101828]/10">
              Accent state
            </span>
          </div>
        </div>
      ) : null}
      {showBrandingControls && !canEditBranding ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-[#4b5f55]">{brandingUnavailableMessage}</p>
      ) : null}
    </SectionCard>
  )
}
