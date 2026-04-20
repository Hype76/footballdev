import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import fallbackLogo from '../assets/football-development-logo-optimized.jpg'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageClubSettings, useAuth } from '../lib/auth.js'
import {
  MAX_LOGO_FILE_SIZE_BYTES,
  getClubSettings,
  updateClubSettings,
  uploadClubLogo,
  withRequestTimeout,
} from '../lib/supabase.js'

function createInitialFormData() {
  return {
    name: '',
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
    requireApproval: true,
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
      setErrorMessage('')

      try {
        const club = await withRequestTimeout(
          () => getClubSettings(user.clubId),
          'Could not load club settings. No data entered yet, or the request took too long.',
        )

        if (!isMounted) {
          return
        }

        setFormData({
          name: club.name,
          logoUrl: club.logoUrl,
          contactEmail: club.contactEmail,
          contactPhone: club.contactPhone,
          requireApproval: Boolean(club.requireApproval ?? true),
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setFormData(createInitialFormData())
          setErrorMessage(error.message || 'Could not load club settings.')
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
    const { name, value, type, checked } = event.target
    setIsSaved(false)
    setErrorMessage('')
    setFormData((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
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
        requireApproval: Boolean(updatedClub.requireApproval ?? true),
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
        requireApproval: Boolean(updatedClub.requireApproval ?? true),
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

  const resolvedLogoUrl = formData.logoUrl || fallbackLogo

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Club Settings"
        title="Club details"
        description="Update the shared club information shown across the workspace and every exported PDF."
      />

      {isSaved ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          Saved successfully
        </div>
      ) : null}

      {uploadSuccessMessage ? (
        <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          {uploadSuccessMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-[20px] border border-[var(--danger-border)] bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--danger-text)]">
          {errorMessage}
        </div>
      ) : null}

      <SectionCard
        title="Club profile"
        description="These details are used in the topbar, parent-facing preview, and exported PDF files."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-4 text-sm text-[var(--text-muted)]">
            Loading club settings...
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[0.72fr_1fr]">
            <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--panel-alt)] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Logo preview</p>
              <div className="mt-4 flex min-h-48 items-center justify-center overflow-hidden rounded-[24px] border border-dashed border-[var(--border-color)] bg-[var(--panel-bg)] p-4">
                <img src={resolvedLogoUrl} alt={formData.name || 'Club logo'} className="max-h-40 w-auto object-contain" />
              </div>

              <div className="mt-5 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Upload new logo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="block min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] file:mr-4 file:rounded-xl file:border-0 file:bg-[var(--panel-soft)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--text-primary)]"
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">PNG, JPG, or SVG. Maximum file size 2MB.</p>
                </label>

                <button
                  type="button"
                  onClick={handleLogoUpload}
                  disabled={isUploading || !selectedLogoFile}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:bg-[var(--panel-soft)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? 'Uploading...' : 'Upload Logo'}
                </button>
              </div>
            </div>

            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Club Name</span>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Logo URL</span>
                <input
                  type="text"
                  name="logoUrl"
                  value={formData.logoUrl}
                  onChange={handleChange}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact Email</span>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">Contact Phone</span>
                <input
                  type="text"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  className="min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-alt)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                />
              </label>

              <label className="inline-flex min-h-11 items-center gap-3 rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm font-medium text-[var(--text-primary)] md:col-span-2">
                <input
                  type="checkbox"
                  name="requireApproval"
                  checked={formData.requireApproval}
                  onChange={handleChange}
                  className="h-4 w-4 rounded border-[var(--border-color)]"
                />
                <span>Require manager approval before sharing evaluations</span>
              </label>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-[var(--button-primary)] px-5 py-3 text-sm font-semibold text-[var(--button-primary-text)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
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
