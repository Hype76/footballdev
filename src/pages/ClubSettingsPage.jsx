import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageClubSettings, useAuth } from '../lib/auth.js'
import {
  MAX_LOGO_FILE_SIZE_BYTES,
  getClubSettings,
  updateClubSettings,
  uploadClubLogo,
} from '../lib/supabase.js'

function createInitialFormData() {
  return {
    name: '',
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
  }
}

export function ClubSettingsPage() {
  const { updateCurrentClubDetails, user } = useAuth()
  const [formData, setFormData] = useState(createInitialFormData)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedLogoFile, setSelectedLogoFile] = useState(null)

  useEffect(() => {
    let isMounted = true

    const loadClubSettings = async () => {
      if (!user?.clubId) {
        setIsLoading(false)
        return
      }

      setIsLoading(true)

      try {
        const club = await getClubSettings(user.clubId)

        if (!isMounted) {
          return
        }

        setFormData({
          name: club.name,
          logoUrl: club.logoUrl,
          contactEmail: club.contactEmail,
          contactPhone: club.contactPhone,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setFormData(createInitialFormData())
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadClubSettings()

    return () => {
      isMounted = false
    }
  }, [user])

  useEffect(() => {
    if (!isSaved) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setIsSaved(false)
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [isSaved])

  useEffect(() => {
    if (!uploadSuccessMessage) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setUploadSuccessMessage('')
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [uploadSuccessMessage])

  if (!canManageClubSettings(user)) {
    return <Navigate to="/dashboard" replace />
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setErrorMessage('')
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] ?? null
    setUploadSuccessMessage('')
    setErrorMessage('')

    if (!nextFile) {
      setSelectedLogoFile(null)
      return
    }

    if (!String(nextFile.type ?? '').toLowerCase().startsWith('image/')) {
      setSelectedLogoFile(null)
      setErrorMessage('Please select an image file.')
      return
    }

    if (nextFile.size > MAX_LOGO_FILE_SIZE_BYTES) {
      setSelectedLogoFile(null)
      setErrorMessage('Logo must be 2MB or smaller.')
      return
    }

    setSelectedLogoFile(nextFile)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')

    try {
      const updatedClub = await updateClubSettings({
        clubId: user.clubId,
        data: formData,
      })

      setFormData({
        name: updatedClub.name,
        logoUrl: updatedClub.logoUrl,
        contactEmail: updatedClub.contactEmail,
        contactPhone: updatedClub.contactPhone,
      })
      updateCurrentClubDetails(updatedClub)
      setIsSaved(true)
    } catch (error) {
      console.error(error)
      setIsSaved(false)
      setErrorMessage('Could not save club settings.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogoUpload = async () => {
    if (!user?.clubId) {
      setErrorMessage('Club not found for this account.')
      return
    }

    if (!selectedLogoFile) {
      setErrorMessage('Select a logo file before uploading.')
      return
    }

    setIsUploading(true)
    setIsSaved(false)
    setUploadSuccessMessage('')
    setErrorMessage('')

    try {
      const logoUrl = await uploadClubLogo({
        clubId: user.clubId,
        file: selectedLogoFile,
      })

      const updatedClub = await updateClubSettings({
        clubId: user.clubId,
        data: {
          ...formData,
          logoUrl,
        },
      })

      setFormData({
        name: updatedClub.name,
        logoUrl: updatedClub.logoUrl,
        contactEmail: updatedClub.contactEmail,
        contactPhone: updatedClub.contactPhone,
      })
      updateCurrentClubDetails(updatedClub)
      setSelectedLogoFile(null)
      setUploadSuccessMessage('Logo uploaded successfully')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Logo upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Club Settings"
        title="Club details"
        description="Update the shared club information shown across the workspace and PDF preview."
      />

      {isSaved ? (
        <div className="rounded-[20px] border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#46604a]">
          Saved successfully
        </div>
      ) : null}

      {uploadSuccessMessage ? (
        <div className="rounded-[20px] border border-[#dbe3d6] bg-[#eef3ea] px-4 py-3 text-sm font-medium text-[#46604a]">
          {uploadSuccessMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-[20px] border border-[#ead7d7] bg-[#faf2f2] px-4 py-3 text-sm font-medium text-[#8b4b4b]">
          {errorMessage}
        </div>
      ) : null}

      <SectionCard
        title="Club profile"
        description="These details are used in the topbar and parent-facing preview."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] px-4 py-4 text-sm text-slate-600">
            Loading club settings...
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[0.72fr_1fr]">
            <div className="rounded-[24px] border border-[#dbe3d6] bg-[#f8faf7] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">Logo preview</p>
              <div className="mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-[24px] border border-dashed border-[#cfd8c9] bg-white p-4">
                {formData.logoUrl ? (
                  <img src={formData.logoUrl} alt={formData.name || 'Club logo'} className="max-h-40 w-auto object-contain" />
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-[24px] border border-[#dbe3d6] bg-[#f5f7f3] text-xs font-semibold uppercase tracking-[0.18em] text-[#5a6b5b]">
                    Logo
                  </div>
                )}
              </div>

              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-700">Upload new logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="block min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-white px-4 py-3 text-sm text-slate-700 file:mr-4 file:rounded-xl file:border-0 file:bg-[#eef3ea] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[#46604a]"
                  />
                  <p className="mt-2 text-xs leading-5 text-slate-500">PNG, JPG, or SVG. Maximum file size 2MB.</p>
                </label>

                <button
                  type="button"
                  onClick={handleLogoUpload}
                  disabled={isUploading || !selectedLogoFile}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[#dbe3d6] bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-[#f3f6f1] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            </div>

            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Club Name</span>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Logo URL</span>
                <input
                  type="text"
                  name="logoUrl"
                  value={formData.logoUrl}
                  onChange={handleChange}
                  className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Contact Email</span>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Contact Phone</span>
                <input
                  type="text"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  className="min-h-11 w-full rounded-2xl border border-[#dbe3d6] bg-[#f8faf7] px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                />
              </label>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-500 sm:w-auto"
                >
                  {isSaving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
