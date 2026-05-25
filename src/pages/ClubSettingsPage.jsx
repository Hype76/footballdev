import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import fallbackLogo from '../assets/football-player-logo.png'
import { ClubProfileSettingsSection } from '../components/club-settings/ClubProfileSettingsSection.jsx'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageClubLogo, canManageClubSettings, useAuth } from '../lib/auth.js'
import { createFeatureUpgradeMessage, hasPlanFeature } from '../lib/plans.js'
import {
  createInitialClubSettingsFormData,
  getFallbackClubSettingsFormData,
  mapClubToSettingsFormData,
} from '../hooks/club-settings/clubSettingsUtils.js'
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

export function ClubSettingsPage() {
  const { updateCurrentClubDetails, user } = useAuth()
  const { showToast } = useToast()
  const cacheKey = user?.clubId ? `club-settings:${user.clubId}` : ''
  const [formData, setFormData] = useState(() =>
    readViewCacheValue(cacheKey, 'formData', getFallbackClubSettingsFormData(user) || createInitialClubSettingsFormData()),
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

        const nextFormData = mapClubToSettingsFormData(club)
        setFormData(nextFormData)
        writeViewCache(cacheKey, {
          formData: nextFormData,
        })
      } catch (error) {
        console.error(error)

        if (isMounted) {
          if (!cachedValue?.formData && user?.clubName) {
            setFormData(getFallbackClubSettingsFormData(user))
          } else if (!cachedValue?.formData) {
            setFormData(createInitialClubSettingsFormData())
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
  const canChangeClubLogo = canManageClubLogo(user) && canUseBasicBranding

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

    if (!canManageClubLogo(user)) {
      setSelectedLogoFile(null)
      setErrorTitle('Logo upload problem')
      setErrorMessage('Only club admins can change the club logo.')
      return
    }

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

      const nextFormData = mapClubToSettingsFormData(updatedClub)
      setFormData(nextFormData)
      writeViewCache(cacheKey, {
        formData: nextFormData,
      })
      updateCurrentClubDetails(updatedClub)
      setIsSaved(true)
      showToast({ title: 'Club settings saved', message: 'Club details have been updated.' })
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

    if (!canManageClubLogo(user)) {
      setErrorTitle('Logo upload problem')
      setErrorMessage('Only club admins can change the club logo.')
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

      const nextFormData = mapClubToSettingsFormData(updatedClub)
      setFormData(nextFormData)
      writeViewCache(cacheKey, {
        formData: nextFormData,
      })
      updateCurrentClubDetails(updatedClub)
      setSelectedLogoFile(null)
      setUploadSuccessMessage('Logo uploaded successfully')
      showToast({ title: 'Logo saved', message: 'The club logo has been updated.' })
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
      <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white p-5 shadow-sm shadow-emerald-900/5 sm:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">Club settings</p>
            <h1 className="mt-3 max-w-4xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Keep the club identity consistent everywhere.
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-700">
              These details appear across staff screens, parent previews, emails, and shared football records.
            </p>
          </div>
          <div className="rounded-lg border border-lime-200 bg-lime-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">Club rule</p>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-950">
              Set the club name, contacts, and logo before inviting parents so every message looks official.
            </p>
          </div>
        </div>
      </section>

      {isSaved ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          Saved successfully
        </div>
      ) : null}

      {uploadSuccessMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
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

      <ClubProfileSettingsSection
        canChangeClubLogo={canChangeClubLogo}
        canUseBasicBranding={canUseBasicBranding}
        formData={formData}
        isLoading={isLoading}
        isSaving={isSaving}
        isUploading={isUploading}
        onChange={handleChange}
        onFileChange={handleFileChange}
        onLogoUpload={handleLogoUpload}
        onSubmit={handleSubmit}
        resolvedLogoUrl={resolvedLogoUrl}
        selectedLogoFile={selectedLogoFile}
      />
    </div>
  )
}
