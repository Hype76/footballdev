import { useEffect, useState } from 'react'
import {
  CUSTOM_THEME_ACCENT_OPTION,
  DEFAULT_CUSTOM_THEME_ACCENT,
  getSystemTheme,
  getThemeColorVariableStyle,
  isCustomThemeAccent,
  themeAccentOptions,
  themeButtonStyleOptions,
  themeModeOptions,
} from '../../lib/theme.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const selectClass = 'min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] focus:bg-[var(--panel-bg)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-60'

export function DisplaySettingsSection({
  canEditBranding,
  brandingUnavailableMessage,
  brandingSaveMessage,
  brandingSaveState,
  customThemeAccent,
  hasUnsavedBranding,
  isBrandingDraftValid,
  isSavingBranding,
  onCustomThemeAccentChange,
  onSaveBranding,
  onThemeAccentChange,
  onThemeButtonStyleChange,
  onThemeModeChange,
  themeButtonStyle,
  themeAccent,
  themeMode,
  showBrandingControls = false,
}) {
  const [systemTheme, setSystemTheme] = useState(getSystemTheme)
  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode
  const previewAccent = themeAccent === CUSTOM_THEME_ACCENT_OPTION && isCustomThemeAccent(customThemeAccent)
    ? customThemeAccent
    : themeAccent === CUSTOM_THEME_ACCENT_OPTION
      ? DEFAULT_CUSTOM_THEME_ACCENT
      : themeAccent
  const previewStyle = getThemeColorVariableStyle(previewAccent, resolvedTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleSystemThemeChange = () => setSystemTheme(mediaQuery.matches ? 'dark' : 'light')

    handleSystemThemeChange()
    mediaQuery.addEventListener?.('change', handleSystemThemeChange)

    return () => mediaQuery.removeEventListener?.('change', handleSystemThemeChange)
  }, [])

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

      {showBrandingControls && themeAccent === CUSTOM_THEME_ACCENT_OPTION ? (
        <div className="mt-4 grid gap-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 sm:grid-cols-[auto_1fr]">
          <label className="block">
            <span className={labelClass}>Custom accent colour picker</span>
            <input
              type="color"
              value={isCustomThemeAccent(customThemeAccent) ? customThemeAccent : DEFAULT_CUSTOM_THEME_ACCENT}
              onChange={(event) => onCustomThemeAccentChange(event.target.value)}
              disabled={!canEditBranding}
              className="h-12 w-20 cursor-pointer rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] p-1 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className={labelClass}>Custom accent hexadecimal value</span>
            <input
              type="text"
              value={customThemeAccent}
              onChange={(event) => onCustomThemeAccentChange(event.target.value)}
              disabled={!canEditBranding}
              pattern="#[0-9a-f]{6}"
              maxLength={7}
              placeholder="#047857"
              autoComplete="off"
              spellCheck="false"
              aria-invalid={!isBrandingDraftValid}
              aria-describedby="custom-accent-guidance"
              className={selectClass}
            />
            <span
              id="custom-accent-guidance"
              className={`mt-2 block text-xs font-semibold ${
                isBrandingDraftValid ? 'text-[var(--text-secondary)]' : 'text-[#b42318]'
              }`}
            >
              {isBrandingDraftValid
                ? 'Use a lowercase six-digit hexadecimal colour.'
                : 'Enter a lowercase six-digit value such as #2b6cb0.'}
            </span>
          </label>
        </div>
      ) : null}

      {showBrandingControls ? (
        <div
          className="club-display-preview mt-4 rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-4 shadow-sm shadow-[#101828]/10"
          data-button-style={themeButtonStyle}
          data-resolved-theme={resolvedTheme}
          style={previewStyle}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--text-secondary)]">Preview</p>
            <p className="text-xs font-semibold text-[var(--text-secondary)]">
              {resolvedTheme === 'dark' ? 'Dark' : 'Light'} mode
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="club-display-preview-primary">
              Primary action
            </button>
            <span className="club-display-preview-accent">
              Accent state
            </span>
            <button type="button" className="club-display-preview-primary" disabled>
              Disabled action
            </button>
          </div>
        </div>
      ) : null}

      {showBrandingControls && canEditBranding ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p
            role={brandingSaveState === 'error' ? 'alert' : 'status'}
            className={`text-xs font-semibold ${
              brandingSaveState === 'error'
                ? 'text-[#b42318]'
                : brandingSaveState === 'saved' && !hasUnsavedBranding
                  ? 'text-[#067647]'
                  : 'text-[var(--text-secondary)]'
            }`}
          >
            {brandingSaveState === 'error'
              ? brandingSaveMessage
              : hasUnsavedBranding
                ? 'Preview only until saved.'
                : brandingSaveState === 'saved'
                  ? brandingSaveMessage
                  : 'Matches the saved club display.'}
          </p>
          <button
            type="button"
            onClick={onSaveBranding}
            disabled={isSavingBranding || !isBrandingDraftValid || !hasUnsavedBranding}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-black text-[var(--button-primary-text)] shadow-sm transition hover:bg-[var(--button-primary-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--button-primary-disabled)] disabled:text-[var(--button-primary-disabled-text)]"
          >
            {isSavingBranding ? 'Saving display...' : 'Save club display'}
          </button>
        </div>
      ) : null}

      {showBrandingControls && !canEditBranding ? (
        <p className="mt-3 text-xs font-semibold leading-5 text-[#4b5f55]">{brandingUnavailableMessage}</p>
      ) : null}
    </SectionCard>
  )
}
