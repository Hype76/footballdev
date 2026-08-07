import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../lib/auth.js'
import { NoticeBanner } from '../components/ui/NoticeBanner.jsx'

const primaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-[#047857] px-5 py-3 text-sm font-black text-white transition hover:bg-[#065f46] disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButtonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#047857] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'

export function WorkspaceTeamTransferPage() {
  const { requestId } = useParams()
  const { isLoading: isAuthLoading, session, user } = useAuth()
  const [transfer, setTransfer] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const runAction = async (action) => {
    setIsSaving(true)
    setErrorMessage('')

    try {
      const response = await fetch('/.netlify/functions/manage-workspace-team-transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({ action, requestId }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok || result.success === false) {
        throw new Error(result.message || 'This controlled Team transfer could not be opened.')
      }

      setTransfer(result.transfer)
    } catch (error) {
      setErrorMessage(error.message || 'This controlled Team transfer could not be opened.')
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (!isAuthLoading && session?.access_token && requestId) {
      void runAction('view')
    }
  // The current session and route request are the only load authority inputs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthLoading, requestId, session?.access_token])

  if (isAuthLoading) {
    return <main className="min-h-screen bg-[#f7faf8] px-4 py-10 text-[#101828]" />
  }

  if (!session?.access_token || !user) {
    return (
      <main className="min-h-screen bg-[#f7faf8] px-4 py-10 text-[#101828]">
        <section className="mx-auto max-w-xl rounded-lg border border-[#d7e5dc] bg-white p-6 shadow-sm sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Controlled Team transfer</p>
          <h1 className="mt-3 text-2xl font-black">Sign in to review this request</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
            Only the source Team Admin, destination Club Admin, or Platform Admin can open this request.
          </p>
          <Link to="/sign-in" className={`${primaryButtonClass} mt-6`}>Go to sign in</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#f7faf8] px-4 py-10 text-[#101828]">
      <section className="mx-auto max-w-2xl rounded-lg border border-[#d7e5dc] bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-[#047857]">Controlled Team transfer</p>
        <h1 className="mt-3 text-2xl font-black">Review Team ownership change</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-[#4b5f55]">
          This process moves the existing Team without copying or replacing its identity. Both customer owners must approve, then Platform Admin performs the final preservation check.
        </p>

        {errorMessage ? <div className="mt-5"><NoticeBanner title="Transfer not available" message={errorMessage} /></div> : null}

        {transfer ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] p-4">
              <p className="text-lg font-black">{transfer.teamName}</p>
              <p className="mt-2 text-sm font-semibold text-[#4b5f55]">From: {transfer.sourceWorkspaceName}</p>
              <p className="text-sm font-semibold text-[#4b5f55]">To: {transfer.destinationClubName}</p>
              <p className="mt-2 text-sm font-black text-[#047857]">Status: {transfer.status}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-sm font-bold">
                Source Team Admin: {transfer.sourceApproved ? 'Approved' : 'Pending'}
              </p>
              <p className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] p-4 text-sm font-bold">
                Destination Club Admin: {transfer.destinationApproved ? 'Approved' : 'Pending'}
              </p>
            </div>
            {['pending', 'ready'].includes(transfer.status) ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                <button type="button" disabled={isSaving} onClick={() => void runAction('approve')} className={primaryButtonClass}>
                  Approve as authorised owner
                </button>
                <button type="button" disabled={isSaving} onClick={() => void runAction('reject')} className={secondaryButtonClass}>
                  Reject request
                </button>
              </div>
            ) : null}
          </div>
        ) : isSaving ? (
          <p className="mt-6 text-sm font-semibold text-[#4b5f55]">Opening transfer request...</p>
        ) : null}
      </section>
    </main>
  )
}

export default WorkspaceTeamTransferPage
