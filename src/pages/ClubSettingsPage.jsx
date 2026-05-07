import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import fallbackLogo from '../assets/player-feedback-logo.png'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageClubSettings, useAuth } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  MAX_LOGO_FILE_SIZE_BYTES,
  getClubSettings,
  readViewCache,
  readViewCacheValue,
  updateClubSettings,
  uploadClubLogo,
  withRequestTimeout,
  writeViewCache,
} from '../lib/supabase.js'

function createInitialFormData() {
  return {
    name: '',
    logoUrl: '',
    contactEmail: '',
    contactPhone: '',
  }
}

function getFallbackFormData(user) {
  return {
    name: String(user?.clubName ?? '').trim(),
    logoUrl: String(user?.clubLogoUrl ?? '').trim(),
    contactEmail: String(user?.clubContactEmail ?? '').trim(),
    contactPhone: String(user?.clubContactPhone ?? '').trim(),
  }
}

export function ClubSettingsPage() {
  const { updateCurrentClubDetails, user } = useAuth()
  const cacheKey = user?.clubId ? `club-settings:${user.clubId}` : ''
  const [formData, setFormData] = useState(() =>
    readViewCacheValue(cacheKey, 'formData', getFallbackFormData(user) || createInitialFormData()),
  )
  const [isLoading, setIsLoading] = useState(() => {
    const cachedFormData = readViewCacheValue(cacheKey, 'formData', null)
    return !cachedFormData && !user?.clubName
  })
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSaved, setIsSaved] = useState(false)
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [errorTitle, setErrorTitle] = useState('')
  const [selectedLogoFile, setSelectedLogoFile] = useState(null)
  const userScopeKey = user ? `${user.id}:${user.clubId || ''}:${user.role}:${user.roleRank}` : ''

  useEffect(() => {
    let isMounted = true
    const cachedValue = readViewCache(cacheKey)

    const loadClubSettings = async () => {
      if (!user?.clubId) {
        setIsLoading(false)
        return
      }

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
        })
        writeViewCache(cacheKey, {
          formData: {
            name: club.name,
            logoUrl: club.logoUrl,
            contactEmail: club.contactEmail,
            contactPhone: club.contactPhone,
          },
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.formData && user?.clubName) {
            setFormData(getFallbackFormData(user))
          } else if (!cachedValue?.formData) {
            setFormData(createInitialFormData())
          }
          setErrorTitle('Using saved club details')
          setErrorMessage('The latest club settings could not be refreshed just now. You can still review or update the details shown below.')
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
  }, [cacheKey, user, userScopeKey])

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
    return <Navigate to="/" replace />
  }

  const canUseBasicBranding = hasPlanFeature(user, 'basicBranding')

  const handleChange = (event) => {
    const { name, value, type, checked } = event.target
    setIsSaved(false)
    setErrorTitle('')
    setErrorMessage('')
    setFormData((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  const handleFileChange = (event) => {
    const nextFile = event.target.files?.[0] ?? null
    setUploadSuccessMessage('')
    setErrorTitle('')
    setErrorMessage('')

    if (!canUseBasicBranding) {
      setSelectedLogoFile(null)
      setErrorTitle('Logo upload problem')
      setErrorMessage(createFeatureUpgradeMessage('basicBranding'))
      return
    }

    if (!nextFile) {
      setSelectedLogoFile(null)
      return
    }

    if (!String(nextFile.type ?? '').toLowerCase().startsWith('image/')) {
      setSelectedLogoFile(null)
      setErrorTitle('Logo upload problem')
      setErrorMessage('Please select an image file.')
      return
    }

    if (nextFile.size > MAX_LOGO_FILE_SIZE_BYTES) {
      setSelectedLogoFile(null)
      setErrorTitle('Logo upload problem')
      setErrorMessage('Logo must be 2MB or smaller.')
      return
    }

    setSelectedLogoFile(nextFile)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorTitle('')
    setErrorMessage('')

    try {
      const updatedClub = await updateClubSettings({
        clubId: user.clubId,
        data: formData,
        user,
      })

      setFormData({
        name: updatedClub.name,
        logoUrl: updatedClub.logoUrl,
        contactEmail: updatedClub.contactEmail,
        contactPhone: updatedClub.contactPhone,
      })
      writeViewCache(cacheKey, {
        formData: {
          name: updatedClub.name,
          logoUrl: updatedClub.logoUrl,
          contactEmail: updatedClub.contactEmail,
          contactPhone: updatedClub.contactPhone,
        },
      })
      updateCurrentClubDetails(updatedClub)
      setIsSaved(true)
    } catch (error) {
      console.error(error)
      setIsSaved(false)
      setErrorTitle('Could not save club settings')
      setErrorMessage(error.message || 'Could not save club settings.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleLogoUpload = async () => {
    if (!user?.clubId) {
      setErrorTitle('Logo upload problem')
      setErrorMessage('Club not found for this account.')
      return
    }

    if (!canUseBasicBranding) {
      setErrorTitle('Logo upload problem')
      setErrorMessage(createFeatureUpgradeMessage('basicBranding'))
      return
    }

    if (!selectedLogoFile) {
      setErrorTitle('Logo upload problem')
      setErrorMessage('Select a logo file before uploading.')
      return
    }

    setIsUploading(true)
    setIsSaved(false)
    setUploadSuccessMessage('')
    setErrorTitle('')
    setErrorMessage('')

    try {
      const logoUrl = await uploadClubLogo({
        clubId: user.clubId,
        file: selectedLogoFile,
        user,
      })

      const updatedClub = await updateClubSettings({
        clubId: user.clubId,
        data: {
          ...formData,
          logoUrl,
        },
        user,
      })

      setFormData({
        name: updatedClub.name,
        logoUrl: updatedClub.logoUrl,
        contactEmail: updatedClub.contactEmail,
        contactPhone: updatedClub.contactPhone,
      })
      writeViewCache(cacheKey, {
        formData: {
          name: updatedClub.name,
          logoUrl: updatedClub.logoUrl,
          contactEmail: updatedClub.contactEmail,
          contactPhone: updatedClub.contactPhone,
        },
      })
      updateCurrentClubDetails(updatedClub)
      setSelectedLogoFile(null)
      setUploadSuccessMessage('Logo uploaded successfully')
    } catch (error) {
      console.error(error)
      setErrorTitle('Logo upload problem')
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
        <NoticeBanner
          tone={errorTitle === 'Using saved club details' ? 'info' : 'error'}
          title={errorTitle || 'Action could not be completed'}
          message={errorMessage}
        />
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
                    disabled={!canUseBasicBranding}
                    className="block min-h-11 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--panel-bg)] px-4 py-3 text-sm text-[var(--text-primary)] file:mr-4 file:rounded-xl file:border-0 file:bg-[var(--panel-soft)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--text-primary)]"
                  />
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                    {canUseBasicBranding ? 'PNG, JPG, or SVG. Maximum file size 2MB.' : createFeatureUpgradeMessage('basicBranding')}
                  </p>
                </label>

                <button
                  type="button"
                  onClick={handleLogoUpload}
                  disabled={isUploading || !selectedLogoFile || !canUseBasicBranding}
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
