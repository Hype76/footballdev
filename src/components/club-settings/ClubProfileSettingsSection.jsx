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
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          Loading club settings...
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[0.72fr_1fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Logo preview</p>
            <div className="mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-white p-4">
              <img src={resolvedLogoUrl} alt={formData.name || 'Club logo'} className="max-h-40 w-auto object-contain" />
            </div>

            {canChangeClubLogo ? (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-950">Upload new logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFileChange}
                    className="block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 file:mr-4 file:rounded-xl file:border-0 file:bg-slate-950 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    PNG, JPG, or SVG. Maximum file size 2MB.
                  </p>
                </label>

                <button
                  type="button"
                  onClick={onLogoUpload}
                  disabled={isUploading || !selectedLogoFile}
                  title={uploadDisabledReason}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
                {canUseBasicBranding ? 'Only club admins can change the club logo.' : createFeatureUpgradeMessage('basicBranding')}
              </div>
            )}
          </div>

          <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Club Name</span>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={onChange}
                required
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Contact Email</span>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={onChange}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-950">Contact Phone</span>
              <input
                type="text"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={onChange}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:bg-white"
              />
            </label>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={isSaving}
                title={saveDisabledReason}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
