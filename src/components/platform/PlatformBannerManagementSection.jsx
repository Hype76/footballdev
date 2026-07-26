import { SectionCard } from '../ui/SectionCard.jsx'
import {
  PLATFORM_BANNER_COLOR_PRESETS,
  PLATFORM_BANNER_MESSAGE_MAX_LENGTH,
  getPlatformBannerTextColor,
} from '../../lib/platform-banner-config.js'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const fieldClass = 'min-h-12 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition placeholder:text-[#94a3b8] focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#bbf7d0]'
const primaryButtonClass = 'inline-flex min-h-12 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'

export function PlatformBannerManagementSection({
  banner,
  errorMessage,
  isLoading,
  isSaving,
  onChange,
  onSubmit,
}) {
  const messageLength = String(banner.message ?? '').length
  const textColor = getPlatformBannerTextColor(banner.backgroundColor)

  return (
    <div className="xl:col-span-2">
      <SectionCard
        title="Banner controls"
        description="Control the announcement shown across the public website and parent login."
        storageKey="platform-banner-controls"
      >
        <form className="grid gap-5" onSubmit={onSubmit}>
          <div className="flex flex-col gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-[#101828]">Public site banner</p>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                {banner.enabled ? 'The banner is currently enabled.' : 'The banner is currently disabled.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={banner.enabled}
              disabled={isLoading || isSaving}
              onClick={() => onChange('enabled', !banner.enabled)}
              className={[
                'inline-flex min-h-11 min-w-32 items-center justify-center rounded-lg border px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-60',
                banner.enabled
                  ? 'border-[#047857] bg-[#047857] text-white hover:bg-[#065f46]'
                  : 'border-[#d7e5dc] bg-white text-[#4b5f55] hover:border-[#047857] hover:text-[#047857]',
              ].join(' ')}
            >
              {banner.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>

          <label className="block">
            <span className={labelClass}>Banner text</span>
            <textarea
              value={banner.message}
              onChange={(event) => onChange('message', event.target.value)}
              maxLength={PLATFORM_BANNER_MESSAGE_MAX_LENGTH}
              rows={4}
              required
              disabled={isLoading || isSaving}
              className={`${fieldClass} min-h-28 resize-y`}
            />
            <span className="mt-2 block text-right text-xs font-bold text-[#4b5f55]">
              {messageLength}/{PLATFORM_BANNER_MESSAGE_MAX_LENGTH}
            </span>
          </label>

          <div>
            <span className={labelClass}>Background colour</span>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label className="inline-flex min-h-12 items-center gap-3 rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
                <input
                  type="color"
                  value={banner.backgroundColor}
                  onChange={(event) => onChange('backgroundColor', event.target.value.toUpperCase())}
                  disabled={isLoading || isSaving}
                  aria-label="Banner background colour"
                  className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0 disabled:cursor-not-allowed"
                />
                <span className="text-sm font-black text-[#101828]">{banner.backgroundColor}</span>
              </label>
              <div className="flex flex-wrap gap-2" aria-label="Banner colour presets">
                {PLATFORM_BANNER_COLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    disabled={isLoading || isSaving}
                    onClick={() => onChange('backgroundColor', preset.value)}
                    aria-pressed={banner.backgroundColor === preset.value}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] transition hover:border-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 rounded-full border border-black/10"
                      style={{ backgroundColor: preset.value }}
                    />
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <p className={labelClass}>Preview</p>
            {banner.enabled ? (
              <div
                role="status"
                aria-label="Banner preview"
                className="rounded-lg border border-black/10 px-4 py-3 text-center text-sm font-black leading-6 shadow-sm sm:text-base"
                style={{ backgroundColor: banner.backgroundColor, color: textColor }}
              >
                {banner.message || 'Enter banner text to preview it.'}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-center text-sm font-semibold text-[#4b5f55]">
                The banner is disabled and will not appear on public pages.
              </div>
            )}
          </div>

          {errorMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold leading-6 text-[#4b5f55]">
              Saved changes appear when a public page is refreshed.
            </p>
            <button
              type="submit"
              disabled={isLoading || isSaving || !String(banner.message ?? '').trim()}
              title={isSaving ? 'Please wait while the banner is being saved.' : undefined}
              className={primaryButtonClass}
            >
              {isSaving ? 'Saving...' : 'Save banner'}
            </button>
          </div>
        </form>
      </SectionCard>
    </div>
  )
}
