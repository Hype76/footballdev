import { createFeatureUpgradeMessage } from '../../lib/plans.js'
import { SectionCard } from '../ui/SectionCard.jsx'

const labelClass = 'mb-2 block text-sm font-black text-[#101828]'
const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#20a464] focus:bg-white focus:ring-2 focus:ring-[#d7f8e5]'
const primaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#067a46] px-5 py-3 text-sm font-black text-white transition hover:bg-[#05603a] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto'
const secondaryButtonClass = 'inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60'

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
      description="Update the shared identity used by staff views, parent previews, and outgoing messages."
      tourId="club-profile-settings"
    >
      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-[#f9fafb] px-4 py-4 text-sm font-semibold text-[#667085]">
          Loading club settings...
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[0.72fr_1fr]">
          <div className="rounded-lg border border-slate-200 bg-[#f9fafb] p-5 shadow-sm shadow-slate-200/60">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Badge control</p>
            <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
              Use the same badge parents already recognise from match day and club communication.
            </p>
            <div className="mt-4 flex min-h-56 items-center justify-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white p-4">
              <img src={resolvedLogoUrl} alt={formData.name || 'Club logo'} className="max-h-40 w-auto object-contain" />
            </div>

            {canChangeClubLogo ? (
              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className={labelClass}>Upload new logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onFileChange}
                    className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#101828] file:mr-4 file:rounded-lg file:border-0 file:bg-[#101828] file:px-3 file:py-2 file:text-sm file:font-black file:text-white"
                  />
                  <p className="mt-2 text-xs font-semibold leading-5 text-[#667085]">
                    PNG, JPG, or SVG. Maximum file size 2MB.
                  </p>
                </label>

                <button
                  type="button"
                  onClick={onLogoUpload}
                  disabled={isUploading || !selectedLogoFile}
                  title={uploadDisabledReason}
                  className={secondaryButtonClass}
                >
                  {isUploading ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            ) : (
              <div className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold leading-6 text-[#667085]">
                {canUseBasicBranding ? 'Only club admins can change the club logo.' : createFeatureUpgradeMessage('basicBranding')}
              </div>
            )}
          </div>

          <form className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60" onSubmit={onSubmit}>
            <div className="mb-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#067a46]">Shared details</p>
              <p className="mt-2 text-sm font-semibold leading-6 text-[#667085]">
                Keep this short and practical. These values appear where parents need to trust the club source.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Club name</span>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={onChange}
                required
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Contact email</span>
              <input
                type="email"
                name="contactEmail"
                value={formData.contactEmail}
                onChange={onChange}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Contact phone</span>
              <input
                type="text"
                name="contactPhone"
                value={formData.contactPhone}
                onChange={onChange}
                className={inputClass}
              />
            </label>
            </div>

            <div className="mt-5">
              <button
                type="submit"
                disabled={isSaving}
                title={saveDisabledReason}
                className={primaryButtonClass}
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
