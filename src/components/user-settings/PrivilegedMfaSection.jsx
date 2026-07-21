import { useEffect, useState } from 'react'
import { SectionCard } from '../ui/SectionCard.jsx'
import {
  beginTotpEnrollment,
  getMfaStatus,
  removeTotpFactor,
  verifyTotpEnrollment,
} from '../../lib/auth-mfa.js'

const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-[#d7e5dc] bg-white px-5 py-3 text-sm font-black text-[#101828] transition hover:border-[#0f9f6e] hover:bg-[#ecfdf5] disabled:cursor-not-allowed disabled:opacity-60'
const inputClass = 'min-h-11 w-full rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#101828] outline-none focus:border-[#047857] focus:bg-white focus:ring-2 focus:ring-[#d1fae5]'

export function PrivilegedMfaSection({ isPlatformAdmin = false }) {
  const [status, setStatus] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isWorking, setIsWorking] = useState(false)

  const refreshStatus = async () => {
    const nextStatus = await getMfaStatus()
    setStatus(nextStatus)
    return nextStatus
  }

  useEffect(() => {
    let isMounted = true

    void getMfaStatus()
      .then((nextStatus) => {
        if (isMounted) {
          setStatus(nextStatus)
        }
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
          setErrorMessage('Authenticator status could not be loaded.')
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  const handleBeginEnrollment = async () => {
    setIsWorking(true)
    setMessage('')
    setErrorMessage('')

    try {
      setEnrollment(await beginTotpEnrollment())
      setMessage('Scan the code, then enter the 6-digit code to finish enrollment.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Authenticator enrollment could not be started.')
    } finally {
      setIsWorking(false)
    }
  }

  const handleVerify = async () => {
    setIsWorking(true)
    setErrorMessage('')

    try {
      await verifyTotpEnrollment({ code, factorId: enrollment?.factorId })
      await refreshStatus()
      setEnrollment(null)
      setCode('')
      setMessage('Authenticator protection is enrolled for this account.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'The authenticator code could not be verified.')
    } finally {
      setIsWorking(false)
    }
  }

  const handleRemove = async (factorId) => {
    setIsWorking(true)
    setMessage('')
    setErrorMessage('')

    try {
      await removeTotpFactor(factorId)
      await refreshStatus()
      setMessage('Authenticator factor removed.')
    } catch (error) {
      console.error(error)
      setErrorMessage(error.message || 'Authenticator factor could not be removed.')
    } finally {
      setIsWorking(false)
    }
  }

  const verifiedFactors = status?.verifiedFactors || []

  return (
    <SectionCard
      title="Authenticator security"
      description={isPlatformAdmin
        ? 'Platform Admin enrollment is available now. Enforcement must be enabled only after every active Platform Admin has enrolled.'
        : 'Authenticator protection is recommended for Club Admin accounts.'}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-[#d7e5dc] bg-[#f7faf8] px-4 py-3 text-sm font-semibold text-[#4b5f55]">
          Current assurance: <span className="font-black text-[#101828]">{status?.currentLevel || 'Loading'}</span>
        </div>

        {verifiedFactors.map((factor) => (
          <div key={factor.id} className="flex flex-col gap-3 rounded-lg border border-[#bbf7d0] bg-[#ecfdf5] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-black text-[#065f46]">Authenticator enrolled</span>
            {!isPlatformAdmin ? (
              <button type="button" onClick={() => void handleRemove(factor.id)} disabled={isWorking} className={buttonClass}>
                Remove factor
              </button>
            ) : null}
          </div>
        ))}

        {enrollment ? (
          <div className="space-y-4 rounded-lg border border-[#d7e5dc] bg-white p-4">
            {enrollment.qrCode ? <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" className="h-48 w-48" /> : null}
            <p className="break-all text-xs font-semibold text-[#4b5f55]">Manual key: {enrollment.secret}</p>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              className={inputClass}
              placeholder="6-digit code"
            />
            <button type="button" onClick={() => void handleVerify()} disabled={isWorking || code.length !== 6} className={buttonClass}>
              Verify authenticator
            </button>
          </div>
        ) : null}

        {verifiedFactors.length === 0 && !enrollment ? (
          <button type="button" onClick={() => void handleBeginEnrollment()} disabled={isWorking} className={buttonClass}>
            Set up authenticator
          </button>
        ) : null}

        {message ? <p className="text-sm font-semibold text-[#065f46]">{message}</p> : null}
        {errorMessage ? <p className="text-sm font-semibold text-[#b42318]">{errorMessage}</p> : null}
      </div>
    </SectionCard>
  )
}
