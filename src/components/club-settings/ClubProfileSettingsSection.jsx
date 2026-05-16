import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { SectionCard } from '../ui/SectionCard.jsx'

export function ClubProfileSettingsSection({
  canChangeClubLogo,
  canUseBasicBranding,
  formData,
  isLoading,
  isSaving,
  isUploading,
  onChange,
  onFileChange,
  onLogoUpload,
  onSubmit,
  resolvedLogoUrl,
  selectedLogoFile,
}) {
  const uploadDisabledReason = isUploading
    ? 'Please wait while the logo is uploading.'
    : !selectedLogoFile
      ? 'Choose a logo file before uploading.'
      : undefined
  const saveDisabledReason = isSaving ? 'Please wait while club settings are being saved.' : undefined

  return (
    <SectionCard
      title="Club profile"
      description="These details are used in the topbar and parent-facing preview."
      tourId="club-profile-settings"
    >
      {isLoading ? (
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
          Loading club settings...
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[0.72fr_1fr]">
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Logo preview</p>
            <div className="mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
              <img src={resolvedLogoUrl} alt={formData.name || 'Club logo'} className="max-h-40 w-auto object-contain" />
            </div>

            {canChangeClubLogo ? (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Upload new logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFileChange}
                    className="block min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] file:mr-4 file:rounded-lg file:border-0 file:bg-[var(--panel-soft)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--text-primary)]"
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                    PNG, JPG, or SVG. Maximum file size 2MB.
                  </p>
                </label>

                <button
                  type="button"
                  onClick={onLogoUpload}
                  disabled={isUploading || !selectedLogoFile}
                  title={uploadDisabledReason}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm leading-6 text-[var(--text-muted)]">
                {canUseBasicBranding ? 'Only club admins can change the club logo.' : createFeatureUpgradeMessage('basicBranding')}
              </div>
            )}
          </div>

          <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club Name</span>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={onChange}
                required
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact Email</span>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={onChange}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact Phone</span>
              <input
                type="text"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={onChange}
                className="min-h-11 w-full rounded-lg border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={isSaving}
                title={saveDisabledReason}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {isSaving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </SectionCard>
  )
}
