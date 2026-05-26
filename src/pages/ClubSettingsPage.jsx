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

const clubSettingsRules = [
  {
    label: 'Identity before invites',
    body: 'Set the club name, badge, and contact route before parents receive portal links or match updates.',
  },
  {
    label: 'One public contact',
    body: 'The contact details shown here are reused on parent-facing screens and staff workspace previews.',
  },
  {
    label: 'Badge control',
    body: 'Only authorised club admins can change the badge that appears across the football workspace.',
  },
]

const eyebrowClass = 'text-xs font-black uppercase tracking-[0.18em] text-[#2563eb]'
const bodyTextClass = 'text-sm font-semibold leading-6 text-[#475569]'
const panelClass = 'rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10'

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
  const hasContacts = Boolean(String(formData.contactEmail || formData.contactPhone || '').trim())
  const identityChecksComplete = [Boolean(String(formData.name || '').trim()), hasContacts, Boolean(formData.logoUrl)].filter(Boolean).length

  return (
    <div className="space-y-5 sm:space-y-6">
      <ClubSettingsHero
        canChangeClubLogo={canChangeClubLogo}
        formData={formData}
        identityChecksComplete={identityChecksComplete}
        resolvedLogoUrl={resolvedLogoUrl}
        rules={clubSettingsRules}
        user={user}
      />

      {isSaved ? (
        <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm font-black text-[#1d4ed8] shadow-sm shadow-[#2563eb]/10">
          Saved successfully
        </div>
      ) : null}

      {uploadSuccessMessage ? (
        <div className="rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm font-black text-[#1d4ed8] shadow-sm shadow-[#2563eb]/10">
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

function ClubSettingsHero({ canChangeClubLogo, formData, identityChecksComplete, resolvedLogoUrl, rules, user }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="px-5 py-6 sm:px-6 lg:px-8">
          <div className="max-w-5xl">
            <p className={eyebrowClass}>Club setup</p>
            <h1 className="mt-3 text-4xl font-black leading-[1.02] tracking-tight text-[#0f172a] sm:text-5xl">
              Make the workspace recognisable before parents see it.
            </h1>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#475569]">
              Club name, contact details, and badge appear across staff screens, parent previews, emails, and shared football records.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {rules.map((rule) => (
                <article key={rule.label} className="rounded-lg border border-[#cbd5e1] bg-[#f8fafc] p-4 shadow-sm shadow-[#2563eb]/10">
                  <p className="text-sm font-black text-[#0f172a]">{rule.label}</p>
                  <p className={`mt-2 ${bodyTextClass}`}>{rule.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>

        <aside className="border-t border-[#cbd5e1] bg-[#eff6ff] p-5 sm:p-6 xl:border-l xl:border-t-0">
          <div className={panelClass}>
            <p className={eyebrowClass}>Setup state</p>
            <p className="mt-3 text-3xl font-black tracking-tight text-[#0f172a]">{identityChecksComplete} of 3 ready</p>
            <p className={`mt-2 ${bodyTextClass}`}>
              Club name, contacts, and badge are the first setup details parents and staff will see.
            </p>
          </div>
          <div className="mt-4 rounded-lg border border-[#cbd5e1] bg-white p-4 shadow-sm shadow-[#2563eb]/10">
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-sm shadow-[#2563eb]/10">
                <img src={resolvedLogoUrl} alt="" className="h-full w-full object-contain p-1" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-black text-[#0f172a]">{formData.name || user?.clubName || 'Club name not set'}</p>
                <p className="mt-1 truncate text-sm font-semibold text-[#475569]">
                  {formData.contactEmail || formData.contactPhone || 'Add a contact before inviting parents'}
                </p>
              </div>
            </div>
          </div>
          <p className={`mt-4 ${bodyTextClass}`}>
            {canChangeClubLogo ? 'Logo changes are available for this account.' : 'Logo changes are restricted for this account.'}
          </p>
        </aside>
      </div>
    </section>
  )
}
