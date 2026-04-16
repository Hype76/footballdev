import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { SectionCard } from '../components/ui/SectionCard.jsx'
import { canManageClubSettings, useAuth } from '../lib/auth.js'
import { getClubSettings, updateClubSettings } from '../lib/supabase.js'

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
  const [isSaved, setIsSaved] = useState(false)

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

  if (!canManageClubSettings(user)) {
    return <Navigate to="/dashboard" replace />
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setIsSaved(false)
    setFormData((current) => ({
      ...current,
      [name]: value,
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setIsSaving(true)

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
    } finally {
      setIsSaving(false)
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

      <SectionCard
        title="Club profile"
        description="These details are used in the topbar and parent-facing preview."
      >
        {isLoading ? (
          <div className="rounded-[20px] border border-[#dbe3d6] bg-[#f8faf7] px-4 py-4 text-sm text-slate-600">
            Loading club settings...
          </div>
        ) : (
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
        )}
      </SectionCard>
    </div>
  )
}
