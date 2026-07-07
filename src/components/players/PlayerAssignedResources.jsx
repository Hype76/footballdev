import { useEffect, useState } from 'react'
import { canManageResourceLibrary, canUseResourceLibrary } from '../../lib/auth.js'
import {
  formatResourceLibraryFileSize,
  getAssignedResourcesForPlayer,
  getResourceLibraryDownloadUrl,
  removeResourceLibraryLink,
} from '../../lib/supabase.js'

const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-3 py-2 text-sm font-black text-[#101828] shadow-sm shadow-[#047857]/10 transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

function getResourceFileLabel(resource) {
  if (resource.resourceType === 'external_link') {
    return resource.externalUrl || 'External link'
  }

  return `${resource.originalFilename} | ${formatResourceLibraryFileSize(resource.fileSizeBytes)}`
}

export function PlayerAssignedResources({ primaryPlayer, user }) {
  const [resources, setResources] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState('')
  const [removingLinkId, setRemovingLinkId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const canOpenResources = canUseResourceLibrary(user)
  const canManage = canManageResourceLibrary(user)

  useEffect(() => {
    let isMounted = true

    const loadResources = async () => {
      if (!canOpenResources || !primaryPlayer?.id) {
        setResources([])
        return
      }

      setIsLoading(true)
      setErrorMessage('')

      try {
        const nextResources = await getAssignedResourcesForPlayer({ playerId: primaryPlayer.id, user })

        if (isMounted) {
          setResources(nextResources)
        }
      } catch (error) {
        console.error(error)

        if (isMounted) {
          setErrorMessage(error.message || 'Assigned resources could not be loaded.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadResources()

    return () => {
      isMounted = false
    }
  }, [canOpenResources, primaryPlayer?.id, user])

  if (!canOpenResources || !primaryPlayer?.id) {
    return null
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

  const handleRemove = async (resource) => {
    if (!resource.link?.id) {
      return
    }

    setRemovingLinkId(resource.link.id)
    setErrorMessage('')

    try {
      await removeResourceLibraryLink({ linkId: resource.link.id, user })
      setResources((current) => current.filter((item) => item.link?.id !== resource.link.id))
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Assigned resource could not be removed.')
    } finally {
      setRemovingLinkId('')
    }
  }

  return (
    <section className="rounded-lg border border-[#d7e5dc] bg-white p-5 shadow-sm shadow-[#047857]/10 sm:p-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#047857]">Assigned resources</p>
          <h2 className="mt-2 text-2xl font-black text-[#101828]">{resources.length} active</h2>
        </div>
        {isLoading ? <p className="text-sm font-bold text-[#4b5f55]">Loading resources...</p> : null}
      </div>

      {errorMessage ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {resources.length === 0 ? (
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-5 text-sm font-semibold leading-6 text-[#4b5f55]">
          No resources assigned to this player.
        </div>
      ) : (
        <div className="space-y-3">
          {resources.map((resource) => (
            <article key={resource.link?.id || resource.id} className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 shadow-sm shadow-[#047857]/10">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-base font-black text-[#101828]">{resource.title}</p>
                  <p className="mt-1 text-sm font-semibold text-[#4b5f55]">
                    {getResourceFileLabel(resource)}
                  </p>
                  {resource.link?.parentVisible ? (
                    <p className="mt-2 w-fit rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-2 py-1 text-xs font-black text-[#047857]">
                      Shared with linked parents
                    </p>
                  ) : null}
                  {resource.description ? (
                    <p className="mt-2 text-sm font-semibold leading-6 text-[#4b5f55]">{resource.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => void handleDownload(resource)} disabled={downloadingId === resource.id} className={secondaryButtonClass}>
                    {downloadingId === resource.id ? 'Preparing...' : resource.resourceType === 'external_link' ? 'Open' : 'Download'}
                  </button>
                  {canManage ? (
                    <button type="button" onClick={() => void handleRemove(resource)} disabled={removingLinkId === resource.link?.id} className={secondaryButtonClass}>
                      {removingLinkId === resource.link?.id ? 'Removing...' : 'Remove'}
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
