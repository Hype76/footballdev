import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'
import { PageHeader } from '../components/ui/PageHeader.jsx'
import { useToast } from '../components/ui/toast-context.js'
import { canManageResourceLibrary, canUseResourceLibrary, useAuth } from '../lib/auth.js'
import {
  RESOURCE_LIBRARY_CATEGORIES,
  archiveResourceLibraryItem,
  assignResourceLibraryItem,
  formatResourceLibraryFileSize,
  getResourceLibraryDownloadUrl,
  getResourceLibraryItems,
  getResourceLibraryPlayers,
  uploadResourceLibraryItem,
  validateResourceLibraryFile,
} from '../lib/supabase.js'

const fieldClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none transition focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5] disabled:cursor-not-allowed disabled:opacity-60'
const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-4 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-4 py-3 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const dangerButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-600 px-4 py-3 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60'

function createUploadDraft() {
  return {
    title: '',
    description: '',
    category: 'general',
    file: null,
  }
}

function stopTextInputSpacePropagation(event) {
  if (event.key === ' ') {
    event.stopPropagation()
  }
}

function getCategoryLabel(value) {
  return RESOURCE_LIBRARY_CATEGORIES.find((category) => category.value === value)?.label || 'General'
}

function getResourceMeta(resource) {
  const scope = resource.teamName || 'Active team'
  const size = formatResourceLibraryFileSize(resource.fileSizeBytes)
  return `${scope} | ${getCategoryLabel(resource.category)} | ${size}`
}

function ResourceList({ canManage, downloadingId, isSaving, onArchive, onDownload, resources }) {
  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-6 text-sm font-semibold leading-6 text-[#4b5f55] shadow-sm shadow-[#047857]/10">
        No staff resources match this view yet.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {resources.map((resource) => (
        <article key={resource.id} className="rounded-lg border border-[#d7e5dc] bg-white p-4 shadow-sm shadow-[#047857]/10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-lg font-black text-[#101828]">{resource.title}</p>
              <p className="mt-1 text-sm font-semibold text-[#4b5f55]">{getResourceMeta(resource)}</p>
              <p className="mt-1 break-words text-xs font-semibold text-[#66756c]">{resource.originalFilename}</p>
              {resource.description ? (
                <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">{resource.description}</p>
              ) : null}
              <p className="mt-3 text-xs font-semibold text-[#66756c]">
                {resource.links.length} assignment{resource.links.length === 1 ? '' : 's'} | Uploaded {resource.createdAt ? new Date(resource.createdAt).toLocaleString('en-GB') : 'Unknown'}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => onDownload(resource)} disabled={downloadingId === resource.id} className={secondaryButtonClass}>
                {downloadingId === resource.id ? 'Preparing...' : 'Download'}
              </button>
              {canManage ? (
                <button type="button" onClick={() => onArchive(resource)} disabled={isSaving} className={dangerButtonClass}>
                  Archive
                </button>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}

export function ResourceLibraryPage() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const canOpenResourceLibrary = canUseResourceLibrary(user)
  const canManage = canManageResourceLibrary(user)
  const activeTeamId = String(user?.activeTeamId ?? '').trim()
  const activeTeamName = String(user?.activeTeamName ?? '').trim() || 'Selected team'
  const [resources, setResources] = useState([])
  const [players, setPlayers] = useState([])
  const [filters, setFilters] = useState({ category: '', searchTerm: '' })
  const [uploadDraft, setUploadDraft] = useState(() => createUploadDraft())
  const [assignmentDraft, setAssignmentDraft] = useState({ resourceId: '', linkedType: 'player', linkedId: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [downloadingId, setDownloadingId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const filteredPlayers = useMemo(() => {
    return players.filter((player) => String(player.teamId ?? '') === activeTeamId)
  }, [activeTeamId, players])

  useEffect(() => {
    let isMounted = true

    const loadResourceLibrary = async () => {
      if (!canOpenResourceLibrary) {
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const [nextResources, nextPlayers] = await Promise.all([
          getResourceLibraryItems({ user, ...filters, teamId: activeTeamId }),
          getResourceLibraryPlayers({ user }),
        ])

        if (isMounted) {
          setResources(nextResources)
          setPlayers(nextPlayers)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Could not load the Resource Library.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadResourceLibrary()

    return () => {
      isMounted = false
    }
  }, [activeTeamId, canOpenResourceLibrary, filters, user])

  if (!canOpenResourceLibrary) {
    return <Navigate to="/coach" replace />
  }

  const refreshResources = async () => {
    const nextResources = await getResourceLibraryItems({ user, ...filters, teamId: activeTeamId })
    setResources(nextResources)
  }

  const handleUpload = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      validateResourceLibraryFile(uploadDraft.file)
      const resource = await uploadResourceLibraryItem({
        user,
        title: uploadDraft.title,
        description: uploadDraft.description,
        category: uploadDraft.category,
        teamId: activeTeamId,
        file: uploadDraft.file,
      })

      setUploadDraft(createUploadDraft())
      await refreshResources()
      setSuccessMessage(`${resource.title} uploaded.`)
      showToast({ title: 'Resource uploaded', message: `${resource.title} is available to authorised staff.` })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not upload this resource.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAssign = async (event) => {
    event.preventDefault()
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const selectedPlayer = players.find((player) => String(player.id) === String(assignmentDraft.linkedId))
      const selectedTeamId = assignmentDraft.linkedType === 'team'
        ? activeTeamId
        : selectedPlayer?.teamId || activeTeamId

      await assignResourceLibraryItem({
        user,
        resourceId: assignmentDraft.resourceId,
        targets: [{
          linkedType: assignmentDraft.linkedType,
          linkedId: assignmentDraft.linkedType === 'team' ? activeTeamId : assignmentDraft.linkedId,
          teamId: selectedTeamId,
        }],
      })

      setAssignmentDraft({ resourceId: '', linkedType: 'player', linkedId: '' })
      await refreshResources()
      setSuccessMessage('Resource assignment saved.')
      showToast({ title: 'Resource assigned', message: 'Staff can now see the assignment in the permitted scope.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not assign this resource.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleArchive = async (resource) => {
    setIsSaving(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      await archiveResourceLibraryItem({ resourceId: resource.id, user })
      await refreshResources()
      setSuccessMessage(`${resource.title} archived.`)
      showToast({ title: 'Resource archived', message: 'Existing assignments are no longer shown.' })
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not archive this resource.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDownload = async (resource) => {
    setDownloadingId(resource.id)
    setErrorMessage('')

    try {
      const signedUrl = await getResourceLibraryDownloadUrl({ resourceId: resource.id, user })

      if (!signedUrl) {
        throw new Error('Resource download link could not be created.')
      }

      window.open(signedUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Could not prepare this resource download.')
    } finally {
      setDownloadingId('')
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        eyebrow="Resource Library"
        title="Team Resource Library"
        description={`Keep approved staff files in the ${activeTeamName} team scope.`}
      />

      {errorMessage ? <NoticeBanner title="Resource Library action failed" message={errorMessage} /> : null}
      {successMessage ? <NoticeBanner title="Resource Library updated" message={successMessage} tone="info" /> : null}

      <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#101828]">Search resources</span>
            <input
              value={filters.searchTerm}
              onChange={(event) => setFilters((current) => ({ ...current, searchTerm: event.target.value }))}
              onKeyDown={stopTextInputSpacePropagation}
              className={fieldClass}
              placeholder="Search title or filename"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-black text-[#101828]">Category</span>
            <select
              value={filters.category}
              onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}
              className={fieldClass}
            >
              <option value="">All categories</option>
              {RESOURCE_LIBRARY_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          </label>
          <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
            <span className="block text-sm font-black text-[#101828]">Team scope</span>
            <span className="mt-2 block text-sm font-semibold text-[#4b5f55]">{activeTeamName}</span>
          </div>
        </div>
      </section>

      {canManage ? (
        <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
          <form className="space-y-4" onSubmit={handleUpload}>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_14rem]">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Title</span>
                <input
                  value={uploadDraft.title}
                  onChange={(event) => setUploadDraft((current) => ({ ...current, title: event.target.value }))}
                  onKeyDown={stopTextInputSpacePropagation}
                  className={fieldClass}
                  placeholder="Example: Pre-season training plan"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">Category</span>
                <select
                  value={uploadDraft.category}
                  onChange={(event) => setUploadDraft((current) => ({ ...current, category: event.target.value }))}
                  className={fieldClass}
                >
                  {RESOURCE_LIBRARY_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </label>
              <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3">
                <span className="block text-sm font-black text-[#101828]">Team scope</span>
                <span className="mt-2 block text-sm font-semibold text-[#4b5f55]">{activeTeamName}</span>
              </div>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Description</span>
              <textarea
                value={uploadDraft.description}
                onChange={(event) => setUploadDraft((current) => ({ ...current, description: event.target.value }))}
                onKeyDown={stopTextInputSpacePropagation}
                className={`${fieldClass} min-h-28 resize-y`}
                placeholder="Short staff note for this resource"
              />
            </label>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="block">
                <span className="mb-2 block text-sm font-black text-[#101828]">File</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx,.pptx,.csv,.txt,.png,.jpg,.jpeg,.webp"
                  onChange={(event) => setUploadDraft((current) => ({ ...current, file: event.target.files?.[0] ?? null }))}
                  className={fieldClass}
                />
              </label>
              <button type="submit" disabled={isSaving} className={primaryButtonClass}>
                {isSaving ? 'Saving...' : 'Upload resource'}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {canManage ? (
        <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
          <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)_auto] lg:items-end" onSubmit={handleAssign}>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Resource</span>
              <select
                value={assignmentDraft.resourceId}
                onChange={(event) => setAssignmentDraft((current) => ({ ...current, resourceId: event.target.value }))}
                className={fieldClass}
              >
                <option value="">Choose resource</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>{resource.title}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">Assign to</span>
              <select
                value={assignmentDraft.linkedType}
                onChange={(event) => setAssignmentDraft({ resourceId: assignmentDraft.resourceId, linkedType: event.target.value, linkedId: event.target.value === 'team' ? activeTeamId : '' })}
                className={fieldClass}
              >
                <option value="player">Player</option>
                <option value="team">Team</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-black text-[#101828]">{assignmentDraft.linkedType === 'team' ? 'Team' : 'Player'}</span>
              <select
                value={assignmentDraft.linkedId}
                onChange={(event) => setAssignmentDraft((current) => ({ ...current, linkedId: event.target.value }))}
                disabled={assignmentDraft.linkedType === 'team'}
                className={fieldClass}
              >
                <option value="">{assignmentDraft.linkedType === 'team' ? 'Choose team' : 'Choose player'}</option>
                {assignmentDraft.linkedType === 'team'
                  ? <option value={activeTeamId}>{activeTeamName}</option>
                  : filteredPlayers.map((player) => <option key={player.id} value={player.id}>{player.playerName} | {player.team || 'No team'}</option>)}
              </select>
            </label>
            <button type="submit" disabled={isSaving} className={primaryButtonClass}>
              Save assignment
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Team Resources</p>
            <h2 className="mt-2 text-2xl font-black text-[#101828]">{resources.length} active</h2>
          </div>
          {isLoading ? <p className="text-sm font-bold text-[#4b5f55]">Loading resources...</p> : null}
        </div>
        <ResourceList
          canManage={canManage}
          downloadingId={downloadingId}
          isSaving={isSaving}
          onArchive={(resource) => void handleArchive(resource)}
          onDownload={(resource) => void handleDownload(resource)}
          resources={resources}
        />
      </section>
    </div>
  )
}
